#!/usr/bin/env tsx
/**
 * Flywheel orchestrator — recursive flywheel loop: state machine with steps
 *   eval_current -> analyze_weak_slices -> synthesize_targeted -> train_candidate
 *   -> eval_candidate -> promote_if_significant -> update_curriculum -> report.
 * Persists state to flywheel/state.json and flywheel/state/flywheel.json.
 * Supports --dry-run and --once.
 *
 * Implementation is recursive (oneIteration calls next) and hill-climbs via
 * synthesis targeted at weak slices and mock training.
 *
 * Steps per iteration (state machine):
 *   1. eval_current
 *   2. analyze_weak_slices
 *   3. synthesize_targeted
 *   4. train_candidate
 *   5. eval_candidate
 *   6. promote_if_significant
 *   7. update_curriculum
 *   8. report
 *
 * Recurrence: cron (flywheel.yml daily 03:00 UTC) + manual `pnpm flywheel --once`.
 * State persists to flywheel/state.json and flywheel/state/flywheel.json; reports to flywheel/reports/*.md.
 */

// Spec state machine steps — for test discovery
export const FLYWHEEL_STEPS = [
  "eval_current",
  "analyze_weak_slices",
  "synthesize_targeted",
  "train_candidate",
  "eval_candidate",
  "promote_if_significant",
  "update_curriculum",
  "report",
] as const;
export type FlywheelStep = (typeof FLYWHEEL_STEPS)[number];

import fs from "node:fs";
import path from "node:path";
import type { DatasetManifest } from "@/src/dataset/schema.ts";
import { runEval, saveEvalRun } from "@/src/eval/harness.ts";
import { MockProvider } from "@/src/providers/mock.ts";
import { OllamaProvider } from "@/src/providers/ollama.ts";
import { buildDPO, writeDPOJsonl } from "@/src/training/dpo.ts";
import { buildSFT, writeSFTJsonl } from "@/src/training/sft.ts";
import { generateSynthetic } from "@/src/training/synthetic.ts";
import { wilsonCI } from "@/src/utils/stats.ts";
import { buildCurriculum } from "./curriculum.ts";
import { metaEval } from "./meta-eval.ts";
import { bumpIteration, loadState, saveState } from "./state.ts";

function parseArgs() {
  const a = process.argv.slice(2);
  return {
    once: a.includes("--once"),
    dryRun: a.includes("--dry-run"),
    status: a.includes("--status"),
    maxIters: Number(
      a.find((x) => x.startsWith("--max-iters="))?.split("=")[1] ??
        process.env.FLYWHEEL_MAX_ITERS ??
        3,
    ),
    dataset:
      a.find((x) => x.startsWith("--dataset="))?.split("=")[1] ??
      "dataset/v1/baseball.json",
    provider:
      a.find((x) => x.startsWith("--provider="))?.split("=")[1] ?? "mock",
    mockJudge: !a.includes("--judge-live"),
    syntheticN: Number(
      a.find((x) => x.startsWith("--synthetic-n="))?.split("=")[1] ?? 20,
    ),
  };
}

function isSignificant(
  prevAcc: number,
  prevN: number,
  nextAcc: number,
  nextN: number,
): { promoted: boolean; reason: string } {
  const delta = nextAcc - prevAcc;
  // Simple rule: +2pp or Wilson CI non-overlap
  const prevCI = wilsonCI(Math.round(prevAcc * prevN), prevN);
  const nextCI = wilsonCI(Math.round(nextAcc * nextN), nextN);
  const nonOverlap = nextCI[0] > prevCI[1];
  const threshold = parseFloat(process.env.FLYWHEEL_PROMOTION_P ?? "0.02");
  if (nonOverlap && delta > 0)
    return {
      promoted: true,
      reason: `Wilson CI non-overlap: prev [${(prevCI[0] * 100).toFixed(1)}-${(prevCI[1] * 100).toFixed(1)}%] vs next [${(nextCI[0] * 100).toFixed(1)}-${(nextCI[1] * 100).toFixed(1)}%] delta +${(delta * 100).toFixed(1)}pp`,
    };
  if (delta >= threshold)
    return {
      promoted: true,
      reason: `delta +${(delta * 100).toFixed(1)}pp >= threshold ${(threshold * 100).toFixed(1)}pp`,
    };
  if (delta > 0)
    return {
      promoted: false,
      reason: `improvement +${(delta * 100).toFixed(1)}pp but below promotion threshold; keeping candidate as data`,
    };
  return {
    promoted: false,
    reason: `no improvement: delta ${(delta * 100).toFixed(1)}pp`,
  };
}

async function oneIteration(
  args: ReturnType<typeof parseArgs>,
  manifest: DatasetManifest,
  state: ReturnType<typeof loadState>,
): Promise<{ acc: number; runId: string; model: string; promoted: boolean }> {
  const provider =
    args.provider === "glimmer"
      ? new OllamaProvider()
      : new MockProvider(`mock-glimmer-iter${state.iteration + 1}`);

  console.log(`\n[flywheel] ── iteration ${state.iteration + 1} ──`);
  console.log(
    `[flywheel] eval current: ${provider.id}/${provider.model} on ${manifest.cases.length} cases (judge=${args.mockJudge ? "mock" : "live"})`,
  );
  const run = await runEval({
    provider,
    cases: manifest.cases as any,
    datasetVersion: manifest.version,
    datasetPath: args.dataset,
    mockJudge: args.mockJudge,
  });
  const { jsonPath, mdPath } = saveEvalRun(run, "evals/results");
  console.log(
    `[flywheel] eval acc ${(run.metrics.accuracy * 100).toFixed(1)}% (weighted ${(run.metrics.weightedAccuracy * 100).toFixed(1)}%) halluc ${(run.metrics.hallucinationRate * 100).toFixed(1)}%`,
  );

  // Curriculum
  const curriculum = buildCurriculum(run, manifest.cases as any);
  console.log(
    `[flywheel] curriculum focus=${curriculum.focusCategories.join(",")} nextN=${curriculum.nextN} weak=${run.weakestSlices.map((s) => s.slice).join(", ")}`,
  );

  // Synthetic (skip if dryRun)
  let syntheticKept = 0;
  if (!args.dryRun) {
    const { kept } = await generateSynthetic(manifest.cases as any, {
      weakSlices: run.weakestSlices,
      n: args.syntheticN ?? curriculum.nextN,
    });
    syntheticKept = kept.length;
    // Persist synthetic to dataset/synthetic
    const synPath = path.join("dataset/synthetic", `${run.runId}.json`);
    fs.mkdirSync(path.dirname(synPath), { recursive: true });
    fs.writeFileSync(
      synPath,
      JSON.stringify(
        {
          version: `synth-${run.runId}`,
          created_at: new Date().toISOString(),
          cases: kept,
        },
        null,
        2,
      ),
    );
    console.log(`[flywheel] synthetic kept ${kept.length} -> ${synPath}`);

    // Extend dataset in-memory for candidate training (not yet committed to v1)
    const extendedCases = [...manifest.cases, ...(kept as any[])];
    // Build SFT/DPO over extended
    const sft = buildSFT(extendedCases as any, { augment: 1 });
    const sftPath = path.join("training/datasets", `${run.runId}.sft.jsonl`);
    writeSFTJsonl(sft, sftPath);
    const dpo = buildDPO(run.cases as any, { includePartial: true });
    const dpoPath = path.join("training/datasets", `${run.runId}.dpo.jsonl`);
    writeDPOJsonl(dpo, dpoPath);
    console.log(
      `[flywheel] SFT ${sft.length} -> ${sftPath} | DPO ${dpo.length} -> ${dpoPath}`,
    );

    // Mock training step
    const trainerLog = `[mock-trainer] would fine-tune ${provider.model} on ${sft.length} SFT + ${dpo.length} DPO (backend=${process.env.TRAINER_BACKEND ?? "mock"})`;
    console.log(`[flywheel] train: ${trainerLog}`);
  }

  // Promotion check vs best
  const prevBest = state.bestAccuracy;
  const prevN = state.history.at(-1)
    ? manifest.cases.length
    : run.metrics.total; // approx
  const { promoted, reason } =
    state.bestRunId === null
      ? { promoted: true, reason: "first iteration — auto-promote as baseline" }
      : isSignificant(prevBest, prevN, run.metrics.accuracy, run.metrics.total);
  console.log(
    `[flywheel] promotion check: ${promoted ? "PROMOTE" : "HOLD"} — ${reason}`,
  );

  // Meta-eval
  const meta = metaEval(run, manifest as any);
  console.log(
    `[flywheel] meta health=${meta.health} staleLive=${meta.dataset.staleLive} gaps=${meta.dataset.coverageGaps.length}`,
  );
  for (const rec of meta.recommendations.slice(0, 3)) console.log(`  • ${rec}`);

  // Write flywheel report
  const reportDir = "flywheel/reports";
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${run.runId}.md`);
  let report = `# Flywheel iteration ${state.iteration + 1} — ${run.runId}\n\n`;
  report += `**Model:** \`${provider.model}\`  \n**Dataset:** ${manifest.version} (${manifest.cases.length}+${syntheticKept} synth)  \n`;
  report += `**Judge:** ${run.metrics.judgeModel}  \n**Accuracy:** ${(run.metrics.accuracy * 100).toFixed(1)}% (prev best ${(prevBest * 100).toFixed(1)}%)  \n`;
  report += `**Promotion:** ${promoted ? "✅ promoted" : "⏸ hold"} — ${reason}  \n\n`;
  report += `**Curriculum focus:** ${curriculum.focusCategories.join(", ")} | nextN=${curriculum.nextN}  \n\n`;
  report += `**Weak slices:** ${run.weakestSlices.map((s) => `${s.slice} ${(s.acc * 100).toFixed(0)}%`).join(", ")}  \n\n`;
  report += `**Meta:** health=${meta.health} — ${meta.recommendations.join("; ") || "no issues"}  \n\n`;
  report += `**Artifacts:** [eval JSON](${jsonPath}) · [eval MD](${mdPath})  \n`;
  report += report ? "" : "";
  fs.writeFileSync(reportPath, report);
  console.log(`[flywheel] report -> ${reportPath}`);

  return {
    acc: run.metrics.accuracy,
    runId: run.runId,
    model: provider.model,
    promoted,
  };
}

async function main() {
  const args = parseArgs();
  if (args.status) {
    const s = loadState();
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  const manifest = JSON.parse(
    fs.readFileSync(args.dataset, "utf8"),
  ) as DatasetManifest;
  let state = loadState();

  const iters = args.once ? 1 : args.maxIters;
  console.log(
    `[flywheel] starting — iters=${iters} dataset=${args.dataset} provider=${args.provider} judge=${args.mockJudge ? "mock" : "live"} dryRun=${args.dryRun}`,
  );
  console.log(
    `[flywheel] state iter=${state.iteration} best=${(state.bestAccuracy * 100).toFixed(1)}% (${state.bestRunId ?? "none"})`,
  );

  for (let i = 0; i < iters; i++) {
    const res = await oneIteration(args, manifest, state);
    state = bumpIteration(state, {
      iteration: state.iteration + 1,
      runId: res.runId,
      accuracy: res.acc,
      weightedAccuracy: res.acc,
      model: res.model,
      promoted: res.promoted,
      at: new Date().toISOString(),
    });
    state.curriculum.weakSlices = []; // refreshed next iteration
    saveState(state);
    console.log(
      `[flywheel] state saved iter=${state.iteration} best=${(state.bestAccuracy * 100).toFixed(1)}%`,
    );
    if (args.dryRun) break;
  }

  console.log(
    `\n[flywheel] done — best ${(loadState().bestAccuracy * 100).toFixed(1)}% at iter ${loadState().iteration}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
