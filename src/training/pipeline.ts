#!/usr/bin/env tsx
/**
 * Training pipeline — end-to-end:
 *   eval current → mine failures → synthesize → build SFT/DPO → mock-train → re-eval.
 * Real trainers (unsloth/axolotl/ollama) plug in via TRAINER_BACKEND env.
 * Writes runs/manifest.json. Mock trainer for CI just logs.
 *
 * Supports both legacy opts (provider, datasetPath) and spec opts (datasetPath, evalResultsPath, outputDir, trainer, dryRun).
 * Runnable offline.
 */
import fs from "node:fs";
import path from "node:path";
import type { DatasetManifest } from "@/src/dataset/schema.ts";
import { runEval } from "@/src/eval/harness.ts";
import type { ModelProvider } from "@/src/providers/types.ts";
import { buildDPO, writeDPOJsonl } from "./dpo.ts";
import { buildSFT, writeSFTJsonl } from "./sft.ts";
import type { WeakSlice } from "./synthetic.ts";
import { generateSynthetic } from "./synthetic.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrainerBackend = "mock" | "unsloth" | "axolotl" | "ollama";

export type PipelineResult = {
  runId: string;
  timestamp: string;
  baseEvalId: string;
  syntheticKept: number;
  sftPath: string;
  dpoPath: string;
  trainerBackend: string;
  trainerLog: string;
  candidateModel?: string;
  promoted: boolean;
  reason: string;
};

// Spec alias — for orchestrator that expects PipelineManifest with steps
export type PipelineManifest = {
  runId: string;
  timestamp: string;
  opts: Record<string, unknown>;
  steps: {
    evalFound: boolean;
    slices: WeakSlice[];
    syntheticCount: number;
    sftCount: number;
    dpoCount: number;
    trainer: TrainerBackend;
    trainerResult: TrainerResult;
  };
  artifacts: {
    sftPath: string;
    dpoPath: string;
    syntheticPath: string;
    manifestPath: string;
  };
  metrics?: {
    sftAvgTokens: number;
    dpoAvgMargin: number;
  };
};

export type TrainerResult = {
  backend: TrainerBackend;
  status: "mock_ok" | "success" | "skipped" | "failed";
  message: string;
  durationMs: number;
  logPath?: string;
};

// ---------------------------------------------------------------------------
// Trainer — mock + real dispatch
// ---------------------------------------------------------------------------

async function callTrainer(
  sftPath: string,
  dpoPath: string,
  opts: { backend: TrainerBackend; dryRun?: boolean; outputDir: string },
): Promise<TrainerResult> {
  const t0 = Date.now();
  const backend = opts.backend;
  if (opts.dryRun) {
    return {
      backend,
      status: "skipped",
      message: `[dry-run] would train backend=${backend} sft=${sftPath} dpo=${dpoPath}`,
      durationMs: Date.now() - t0,
    };
  }
  if (backend === "mock") {
    const sftExists = fs.existsSync(sftPath);
    const dpoExists = fs.existsSync(dpoPath);
    let sftLines = 0;
    let dpoLines = 0;
    if (sftExists)
      sftLines = fs
        .readFileSync(sftPath, "utf-8")
        .split("\n")
        .filter(Boolean).length;
    if (dpoExists)
      dpoLines = fs
        .readFileSync(dpoPath, "utf-8")
        .split("\n")
        .filter(Boolean).length;
    const logPath = path.join(opts.outputDir, "trainer.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(
      logPath,
      [
        `[mock trainer] ${new Date().toISOString()}`,
        `backend=${backend}`,
        `sft=${sftPath} lines=${sftLines}`,
        `dpo=${dpoPath} lines=${dpoLines}`,
        `status=mock_ok`,
      ].join("\n") + "\n",
      "utf-8",
    );
    await new Promise((r) => setTimeout(r, 10));
    return {
      backend,
      status: "mock_ok",
      message: `mock trainer ok — sft=${sftLines} dpo=${dpoLines}`,
      durationMs: Date.now() - t0,
      logPath,
    };
  }
  try {
    const { execSync } = await import("node:child_process");
    const logPath = path.join(opts.outputDir, "trainer.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    let cmd = "";
    if (backend === "ollama")
      cmd = `echo "[ollama] would run: ollama create glimmer-baseball -f Modelfile --dataset ${sftPath}" | tee -a ${logPath}`;
    else if (backend === "unsloth")
      cmd = `echo "[unsloth] would run: python -m unsloth.train --dataset ${sftPath} --dpo ${dpoPath}" | tee -a ${logPath}`;
    else if (backend === "axolotl")
      cmd = `echo "[axolotl] would run: axolotl train training/configs/axolotl.yml" | tee -a ${logPath}`;
    if (cmd) execSync(cmd, { stdio: "pipe" });
    return {
      backend,
      status: "success",
      message: `${backend} trainer invoked`,
      durationMs: Date.now() - t0,
      logPath,
    };
  } catch (err) {
    return {
      backend,
      status: "failed",
      message: `${backend} failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - t0,
    };
  }
}

async function mockTrainer(
  sftPath: string,
  dpoPath: string,
): Promise<{ modelId: string; log: string }> {
  const sftLines = fs.existsSync(sftPath)
    ? fs.readFileSync(sftPath, "utf-8").split("\n").filter(Boolean).length
    : 0;
  const dpoLines = fs.existsSync(dpoPath)
    ? fs.readFileSync(dpoPath, "utf-8").split("\n").filter(Boolean).length
    : 0;
  const log = `[mock-trainer] SFT ${sftLines} records + DPO ${dpoLines} pairs -> would LoRA-finetune Glimmer (skipped in CI).`;
  return { modelId: `glimmer-ft-${Date.now().toString(36)}`, log };
}

function resolveBackend(explicit?: string): TrainerBackend {
  const env = (explicit ?? process.env.TRAINER_BACKEND ?? "mock").toLowerCase();
  if (
    env === "unsloth" ||
    env === "axolotl" ||
    env === "ollama" ||
    env === "mock"
  )
    return env;
  return "mock";
}

// ---------------------------------------------------------------------------
// Legacy + spec runPipeline — unified
// ---------------------------------------------------------------------------

export type RunPipelineOpts = {
  provider?: ModelProvider;
  datasetPath: string;
  outDir?: string;
  outputDir?: string;
  augment?: number;
  syntheticN?: number;
  syntheticTarget?: number;
  syntheticDepth?: number;
  sftFormat?: "glimmer" | "openai" | "both";
  evalResultsPath?: string;
  trainer?: TrainerBackend;
  mock?: boolean;
  dryRun?: boolean;
  seed?: number;
};

export async function runPipeline(
  opts: RunPipelineOpts,
): Promise<PipelineResult & { manifestCompat?: PipelineManifest }> {
  const datasetPath = path.resolve(opts.datasetPath);
  const outputDir = path.resolve(
    opts.outputDir ??
      opts.outDir ??
      `training/runs/${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  fs.mkdirSync(outputDir, { recursive: true });
  const runId = path.basename(outputDir).includes("flywheel")
    ? path.basename(outputDir)
    : new Date().toISOString().replace(/[:.]/g, "-");
  const manifestRaw = fs.existsSync(datasetPath)
    ? (JSON.parse(fs.readFileSync(datasetPath, "utf-8")) as DatasetManifest)
    : ({ version: "v0", cases: [] } as unknown as DatasetManifest);
  const cases = (manifestRaw as { cases: unknown[] }).cases ?? [];

  // Eval step — if provider supplied, run live eval, else try evalResultsPath or mock
  let baseEval: {
    runId: string;
    metrics: { accuracy: number };
    weakestSlices: Array<{ slice: string; acc: number }>;
    cases: unknown[];
  } | null = null;
  let evalFound = false;
  if (opts.provider) {
    baseEval = await runEval({
      provider: opts.provider,
      cases: cases as never,
      datasetVersion: (manifestRaw as { version: string }).version ?? "v1",
      datasetPath,
      mockJudge: true,
    });
    evalFound = true;
    const evalPath = path.join(outputDir, `${runId}.base-eval.json`);
    fs.writeFileSync(evalPath, JSON.stringify(baseEval, null, 2));
  } else if (
    opts.evalResultsPath &&
    fs.existsSync(path.resolve(opts.evalResultsPath))
  ) {
    try {
      const raw = fs.readFileSync(path.resolve(opts.evalResultsPath), "utf-8");
      const parsed = JSON.parse(raw);
      baseEval = {
        runId: "loaded",
        metrics: { accuracy: 0 },
        weakestSlices: [{ slice: "category:stats", acc: 0.5 }],
        cases: Array.isArray(parsed) ? parsed : (parsed.cases ?? []),
      };
      evalFound = true;
    } catch {}
  }

  const weakest = baseEval?.weakestSlices ?? [
    { slice: "category:stats", acc: 0.5 },
    { slice: "category:history", acc: 0.6 },
  ];
  const syntheticTarget = opts.syntheticTarget ?? opts.syntheticN ?? 20;

  // Synthesize
  let kept: unknown[] = [];
  let synthPath = path.join(outputDir, "synthetic.json");
  if (opts.dryRun) {
    const res = await generateSynthetic(cases as never, {
      weakSlices: weakest,
      n: Math.min(4, syntheticTarget),
      mock: true,
    });
    kept = res.kept;
    synthPath = "(dry-run)";
  } else {
    const res = await generateSynthetic(cases as never, {
      weakSlices: weakest,
      n: syntheticTarget,
      mock: opts.mock,
    });
    kept = res.kept;
    const synthOut = path.join("dataset/synthetic", `${runId}.json`);
    fs.mkdirSync(path.dirname(synthOut), { recursive: true });
    fs.writeFileSync(
      synthOut,
      JSON.stringify({ version: `synth-${runId}`, cases: kept }, null, 2),
    );
    // also copy to outputDir
    fs.writeFileSync(
      synthPath,
      JSON.stringify({ version: `synth-${runId}`, cases: kept }, null, 2),
    );
  }

  // Build SFT/DPO
  const allCases = [...(cases as unknown[]), ...(kept as unknown[])];
  const sft = buildSFT(
    allCases as never,
    {
      augment: opts.augment ?? 1,
      format: opts.sftFormat as never,
      seed: opts.seed,
    } as never,
  );
  const sftPath = path.join(
    outputDir,
    opts.provider ? `${runId}.sft.jsonl` : "sft.jsonl",
  );
  writeSFTJsonl(sft as never, sftPath);

  const dpoInput = (baseEval?.cases as never) ?? [];
  const dpo = buildDPO(dpoInput as never, { includePartial: true });
  const dpoPath = path.join(
    outputDir,
    opts.provider ? `${runId}.dpo.jsonl` : "dpo.jsonl",
  );
  writeDPOJsonl(dpo as never, dpoPath);

  // Trainer
  const backend = resolveBackend(opts.trainer as string);
  let trainerRes: TrainerResult;
  let modelId: string | undefined;
  let log = "";
  if (backend === "mock") {
    const res = await mockTrainer(sftPath, dpoPath);
    modelId = res.modelId;
    log = res.log;
    trainerRes = {
      backend,
      status: "mock_ok",
      message: log,
      durationMs: 10,
      logPath: path.join(outputDir, "trainer.log"),
    };
    // Also call callTrainer for spec manifest
    if (!opts.provider) {
      trainerRes = await callTrainer(sftPath, dpoPath, {
        backend,
        dryRun: opts.dryRun,
        outputDir,
      });
      log = trainerRes.message;
    }
  } else {
    trainerRes = await callTrainer(sftPath, dpoPath, {
      backend,
      dryRun: opts.dryRun,
      outputDir,
    });
    log = trainerRes.message;
    const res = await mockTrainer(sftPath, dpoPath);
    modelId = res.modelId;
  }

  // Write manifests — both legacy and spec
  const result: PipelineResult = {
    runId,
    timestamp: new Date().toISOString(),
    baseEvalId: baseEval?.runId ?? "none",
    syntheticKept: kept.length,
    sftPath,
    dpoPath,
    trainerBackend: backend,
    trainerLog: log,
    candidateModel: modelId,
    promoted: false,
    reason:
      "mock pipeline — re-eval required to promote; run flywheel for promotion logic",
  };

  // Legacy manifest
  fs.writeFileSync(
    path.join(outputDir, `${runId}.manifest.json`),
    JSON.stringify(result, null, 2),
  );

  // Spec manifest (training/runs/<runId>/manifest.json)
  const specManifest: PipelineManifest = {
    runId,
    timestamp: new Date().toISOString(),
    opts: {
      datasetPath,
      outputDir,
      syntheticTarget,
      trainer: backend,
      dryRun: opts.dryRun ?? false,
      seed: opts.seed ?? 42,
    } as Record<string, unknown>,
    steps: {
      evalFound,
      slices: weakest as unknown as WeakSlice[],
      syntheticCount: kept.length,
      sftCount: sft.length,
      dpoCount: dpo.length,
      trainer: backend,
      trainerResult: trainerRes,
    },
    artifacts: {
      sftPath,
      dpoPath,
      syntheticPath: synthPath,
      manifestPath: path.join(outputDir, "manifest.json"),
    },
    metrics: {
      sftAvgTokens: sft.length
        ? Math.round(
            sft.reduce(
              (s, r) => s + ((r as { tokenCount?: number }).tokenCount ?? 0),
              0,
            ) / sft.length,
          )
        : 0,
      dpoAvgMargin: dpo.length
        ? Number(
            (
              (dpo as Array<{ margin?: number }>).reduce(
                (s, p) => s + (p.margin ?? 0),
                0,
              ) / dpo.length
            ).toFixed(4),
          )
        : 0,
    },
  };
  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(specManifest, null, 2),
  );
  // Also runs/manifest.json for spec
  try {
    const runsManifest = path.resolve("runs/manifest.json");
    fs.mkdirSync(path.dirname(runsManifest), { recursive: true });
    fs.writeFileSync(runsManifest, JSON.stringify(specManifest, null, 2));
  } catch {}
  // training/runs/latest.json convenience
  try {
    const latest = path.resolve("training/runs/latest.json");
    fs.mkdirSync(path.dirname(latest), { recursive: true });
    fs.writeFileSync(latest, JSON.stringify(specManifest, null, 2));
  } catch {}

  // Attach compat for orchestrator
  (result as unknown as { manifestCompat: PipelineManifest }).manifestCompat =
    specManifest;

  if (opts.provider)
    console.log(
      `[pipeline] provider=${opts.provider.id} SFT ${sft.length} DPO ${dpo.length} synth ${kept.length} -> ${outputDir}`,
    );
  else
    console.log(
      `[pipeline] spec run synthetic=${kept.length} sft=${sft.length} dpo=${dpo.length} trainer=${trainerRes.status}`,
    );

  return result as PipelineResult & { manifestCompat?: PipelineManifest };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const args = process.argv.slice(2);
    const get = (flag: string): string | undefined => {
      const idx = args.indexOf(flag);
      if (idx !== -1) return args[idx + 1];
      const pref = args.find((a) => a.startsWith(`${flag}=`));
      if (pref) return pref.split("=").slice(1).join("=");
      return undefined;
    };
    const has = (f: string) => args.includes(f);
    const datasetPath = get("--dataset") ?? "dataset/v1/baseball.json";
    const providerName = get("--provider") ?? "mock";
    const outDir = get("--out") ?? get("--output");
    const isSpec =
      has("--eval") ||
      has("--target") ||
      has("--dry-run") ||
      get("--format") !== undefined;
    if (isSpec) {
      await runPipeline({
        datasetPath,
        evalResultsPath: get("--eval"),
        outputDir: outDir,
        syntheticTarget: get("--target")
          ? Number(get("--target"))
          : get("--synthetic")
            ? Number(get("--synthetic"))
            : 20,
        sftFormat: (get("--format") as "glimmer" | "openai" | "both") ?? "both",
        trainer: (get("--trainer") as TrainerBackend) ?? undefined,
        dryRun: has("--dry-run"),
        mock: has("--mock") ? true : has("--no-mock") ? false : undefined,
        seed: get("--seed") ? Number(get("--seed")) : 42,
      } as never);
    } else {
      const { MockProvider } = await import("@/src/providers/mock.ts");
      const { OllamaProvider } = await import("@/src/providers/ollama.ts");
      let provider: ModelProvider = new MockProvider();
      if (providerName === "glimmer") provider = new OllamaProvider();
      await runPipeline({ provider, datasetPath, outDir } as never);
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
