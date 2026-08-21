/**
 * Eval harness — provider loop + grounded judge + metrics aggregation.
 *
 * Runs any `ModelProvider` (Ollama/Glimmer, Muse Spark, mock) over a
 * `BaseballCase[]`, invokes the web-search-grounded judge (or mock), and
 * aggregates via `computeMetrics` including hallucination/abstention/groundedness,
 * per-slice, bootstrap CI and time-decayed scores.
 *
 * Usage:
 *   const cases = JSON.parse(fs.readFileSync("dataset/seed.json","utf8"));
 *   const run = await runEval({ provider: new MockProvider(), cases, datasetVersion:"v1", datasetPath:"dataset/seed.json", mockJudge:true });
 *   saveEvalRun(run);
 */
import fs from "node:fs";
import path from "node:path";
import { runLoop } from "@/src/agent/loop.ts";
import type { BaseballCase } from "@/src/dataset/schema.ts";
import type { JudgeVerdict } from "@/src/judge/types.ts";
import { batchJudge } from "@/src/judge/verifier.ts";
import type { ModelProvider } from "@/src/providers/types.ts";
import type { EvalMetrics } from "./metrics.ts";
import { computeMetrics, weakestSlices } from "./metrics.ts";

// ---------------------------------------------------------------------------
// Result types — serializable, written to evals/results/<runId>.json
// ---------------------------------------------------------------------------

export type EvalCaseResult = {
  id: string;
  question: string;
  goldAnswer: string;
  alternates: string[];
  category: string;
  team: string | null;
  difficulty: string;
  freshness: string;
  verified_at: string;
  modelAnswer: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  latencyMs: number;
  verdict: JudgeVerdict;
};

export type EvalRun = {
  runId: string;
  timestamp: string;
  provider: string;
  model: string;
  datasetVersion: string;
  datasetPath: string;
  judgeModel: string;
  total: number;
  cases: EvalCaseResult[];
  metrics: EvalMetrics;
  weakestSlices: Array<{ slice: string; acc: number; total: number }>;
};

// ---------------------------------------------------------------------------
// Provider runner — isolated for testability
// ---------------------------------------------------------------------------

export async function runProviderOnCases(
  provider: ModelProvider,
  cases: BaseballCase[],
  opts: { concurrency?: number } = {},
): Promise<
  Array<{
    c: BaseballCase;
    text: string;
    toolCalls: EvalCaseResult["toolCalls"];
    latencyMs: number;
  }>
> {
  const concurrency = opts.concurrency ?? 4;
  const out: Array<{
    c: BaseballCase;
    text: string;
    toolCalls: EvalCaseResult["toolCalls"];
    latencyMs: number;
  }> = [];

  for (let i = 0; i < cases.length; i += concurrency) {
    const chunk = cases.slice(i, i + concurrency);
    const chunkRes = await Promise.all(
      chunk.map(async (c) => {
        const t0 = Date.now();
        let text = "";
        let toolCalls: EvalCaseResult["toolCalls"] = [];
        try {
          const res = await runLoop({
            provider,
            messages: [{ role: "user", content: c.question }],
            temperature: 0,
          });
          text = res.text;
          toolCalls = res.toolCalls.map((tc) => ({
            name: tc.name,
            input: tc.input,
          }));
        } catch (e) {
          text = `[error: ${e instanceof Error ? e.message : String(e)}]`;
        }
        const latencyMs = Date.now() - t0;
        return { c, text, toolCalls, latencyMs };
      }),
    );
    out.push(...chunkRes);
    if (process.stdout.isTTY)
      process.stdout.write(
        `  inference ${Math.min(i + concurrency, cases.length)}/${cases.length}\r`,
      );
  }
  if (process.stdout.isTTY) process.stdout.write("\n");
  return out;
}

// ---------------------------------------------------------------------------
//Judge adapter — normalized input shape
// ---------------------------------------------------------------------------

function toJudgeInput(
  r: {
    id: string;
    question: string;
    goldAnswer: string;
    alternates: string[];
    modelAnswer: string;
  },
  c: BaseballCase,
) {
  return {
    id: r.id,
    question: r.question,
    goldAnswer: c.answer,
    alternates: c.alternates,
    modelAnswer: r.modelAnswer,
    category: c.category,
    team: c.team,
    difficulty: c.difficulty,
    numericGold: c.numeric_answer,
    tolerance: c.tolerance,
    goldSources: c.gold_sources,
    mustCite: c.must_cite,
  };
}

// ---------------------------------------------------------------------------
// Main entry: runEval
// ---------------------------------------------------------------------------

export async function runEval(opts: {
  provider: ModelProvider;
  cases: BaseballCase[];
  datasetVersion: string;
  datasetPath: string;
  concurrency?: number;
  judgeConcurrency?: number;
  mockJudge?: boolean;
}): Promise<EvalRun> {
  if (!opts.cases.length) throw new Error("runEval: empty cases");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const timestamp = new Date().toISOString();

  console.log(
    `[harness] ${opts.cases.length} cases via ${opts.provider.id} (${opts.provider.model}) — judge ${opts.mockJudge ? "mock" : "live"}`,
  );

  // 1) Inference
  const inferred = await runProviderOnCases(opts.provider, opts.cases, {
    concurrency: opts.concurrency,
  });

  const partialResults: EvalCaseResult[] = inferred.map(
    ({ c, text, toolCalls, latencyMs }) => ({
      id: c.id,
      question: c.question,
      goldAnswer: c.answer,
      alternates: c.alternates,
      category: c.category,
      team: c.team,
      difficulty: c.difficulty,
      freshness: c.freshness,
      verified_at: c.verified_at,
      modelAnswer: text,
      toolCalls,
      latencyMs,
      verdict: null as unknown as JudgeVerdict, // filled after judge
    }),
  );

  // 2) Judge — batched with concurrency control
  console.log("[harness] judging...");
  const judgeInputs = inferred.map(({ c, text }) =>
    toJudgeInput(
      {
        id: c.id,
        question: c.question,
        goldAnswer: c.answer,
        alternates: c.alternates,
        modelAnswer: text,
      },
      c,
    ),
  );
  const verdicts: JudgeVerdict[] = await batchJudge(
    judgeInputs as unknown as Parameters<typeof batchJudge>[0],
    { mock: opts.mockJudge ?? false },
    opts.judgeConcurrency ?? 4,
  );

  for (let i = 0; i < partialResults.length; i++)
    partialResults[i]!.verdict = verdicts[i]!;

  // 3) Metrics — include time-decayed via verified_at
  const metrics = computeMetrics(
    verdicts,
    opts.cases.map((c) => ({
      category: c.category,
      team: c.team,
      difficulty: c.difficulty,
      freshness: c.freshness,
      verified_at: c.verified_at,
    })),
    partialResults.map((r) => r.latencyMs),
  );

  const weak = weakestSlices(metrics);

  return {
    runId,
    timestamp,
    provider: opts.provider.id,
    model: opts.provider.model,
    datasetVersion: opts.datasetVersion,
    datasetPath: opts.datasetPath,
    judgeModel: metrics.judgeModel,
    total: partialResults.length,
    cases: partialResults,
    metrics,
    weakestSlices: weak,
  };
}

// ---------------------------------------------------------------------------
// Load helper + save helper (mirrors glimmer-cli report.ts pattern)
// ---------------------------------------------------------------------------

export function loadDataset(filePath: string): {
  cases: BaseballCase[];
  version: string;
} {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  // Accept both manifest {cases:[]} and plain array []
  if (Array.isArray(raw))
    return { cases: raw as BaseballCase[], version: "seed" };
  if (raw.cases && Array.isArray(raw.cases))
    return { cases: raw.cases as BaseballCase[], version: raw.version ?? "v1" };
  throw new Error(
    `Unrecognized dataset shape at ${filePath}: expected array or {cases:[]}`,
  );
}

export function saveEvalRun(
  run: EvalRun,
  outDir = "evals/results",
): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${run.runId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(run, null, 2));

  const md =
    `# Eval ${run.runId}\n\n` +
    `- Provider: ${run.provider} (${run.model})\n` +
    `- Dataset: ${run.datasetPath} (${run.datasetVersion}) — ${run.total} cases\n` +
    `- Judge: ${run.judgeModel}\n` +
    `- Accuracy: ${(run.metrics.accuracy * 100).toFixed(1)}%  (partial ${(run.metrics.partialCreditAccuracy * 100).toFixed(1)}%)\n` +
    `- Hallucination: ${(run.metrics.hallucinationRate * 100).toFixed(1)}%  Abstention: ${(run.metrics.abstentionRate * 100).toFixed(1)}%  Grounded: ${(run.metrics.groundedRate * 100).toFixed(1)}%\n` +
    `- Weighted: ${(run.metrics.weightedAccuracy * 100).toFixed(1)}%  Time-decayed: ${(run.metrics.timeDecayedAccuracy * 100).toFixed(1)}%\n` +
    `- CI95: [${run.metrics.accuracyCI[0].toFixed(3)}, ${run.metrics.accuracyCI[1].toFixed(3)}]  Bootstrap: [${run.metrics.accuracyBootstrapCI[0].toFixed(3)}, ${run.metrics.accuracyBootstrapCI[1].toFixed(3)}]\n` +
    `- Latency p50=${run.metrics.p50LatencyMs}ms p95=${run.metrics.p95LatencyMs}ms avg=${run.metrics.avgLatencyMs}ms\n\n` +
    `## Weakest slices\n${run.weakestSlices.map((s) => `- ${s.slice}: ${(s.acc * 100).toFixed(1)}% (${s.total})`).join("\n")}\n`;
  const mdPath = path.join(outDir, `${run.runId}.md`);
  fs.writeFileSync(mdPath, md);
  // Keep COMPARISON.md as latest
  try {
    fs.writeFileSync(path.join(outDir, "..", "COMPARISON.md"), md);
  } catch {}
  return { jsonPath, mdPath };
}
