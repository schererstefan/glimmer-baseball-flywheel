#!/usr/bin/env tsx
/**
 * Eval runner — CLI entry.
 * pnpm eval                  -> mock (no keys)
 * pnpm eval --mock           -> same
 * pnpm eval --live           -> live judge (needs TAVILY/BRAVE + ANTHROPIC)
 * pnpm eval --provider glimmer --model muse-glimmer
 */
import fs from "node:fs";
import path from "node:path";
import type { DatasetManifest } from "@/src/dataset/schema.ts";
import { MockProvider } from "@/src/providers/mock.ts";
import { MuseSparkProvider } from "@/src/providers/muse-spark.ts";
import { OllamaProvider } from "@/src/providers/ollama.ts";
import { getFlag } from "@/src/utils/args.ts";
import { runEval, saveEvalRun } from "./harness.ts";

const VALID_PROVIDERS = ["mock", "glimmer", "ollama", "spark"] as const;

function parseArgs() {
  const a = process.argv.slice(2);
  return {
    mock:
      a.includes("--mock") ||
      (!a.includes("--live") && !a.includes("--judge-live")),
    live: a.includes("--live") || a.includes("--judge-live"),
    json: a.includes("--json"),
    dataset: getFlag(a, "--dataset") ?? "dataset/v1/baseball.json",
    provider: getFlag(a, "--provider") ?? "mock",
    model: getFlag(a, "--model"),
    only: getFlag(a, "--only")?.split(",") ?? null,
    limit: Number(getFlag(a, "--limit") ?? 0) || undefined,
  };
}

async function main() {
  const args = parseArgs();
  if (!(VALID_PROVIDERS as readonly string[]).includes(args.provider)) {
    console.error(
      `Unknown --provider "${args.provider}". Valid values: ${VALID_PROVIDERS.join(", ")}`,
    );
    process.exit(1);
  }
  const datasetPath = path.resolve(args.dataset);
  if (!fs.existsSync(datasetPath)) {
    console.error(`Dataset not found: ${datasetPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(
    fs.readFileSync(datasetPath, "utf8"),
  ) as DatasetManifest;
  let cases = manifest.cases;
  if (args.only) cases = cases.filter((c) => args.only!.includes(c.id));
  if (args.limit) cases = cases.slice(0, args.limit);

  let provider: import("@/src/providers/types.ts").ModelProvider;
  if (args.provider === "glimmer" || args.provider === "ollama")
    provider = new OllamaProvider({ model: args.model });
  else if (args.provider === "spark")
    provider = new MuseSparkProvider({ model: args.model });
  else provider = new MockProvider(args.model ?? "mock-glimmer-v1");

  // If live, unset mock judge so retriever uses real API
  if (args.live) process.env.MOCK_JUDGE = "0";

  const run = await runEval({
    provider,
    cases: cases as any,
    datasetVersion: manifest.version,
    datasetPath: args.dataset,
    mockJudge: args.mock,
  });

  if (args.json) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    const { jsonPath, mdPath } = saveEvalRun(run);
    console.log(
      `\n[eval] provider=${run.provider} model=${run.model} judge=${run.judgeModel}`,
    );
    console.log(
      `[eval] accuracy ${(run.metrics.accuracy * 100).toFixed(1)}% (${run.metrics.correct}/${run.metrics.total}) partial ${(run.metrics.partialCreditAccuracy * 100).toFixed(1)}% halluc ${(run.metrics.hallucinationRate * 100).toFixed(1)}%`,
    );
    console.log(
      `[eval] weakest: ${run.weakestSlices.map((s) => `${s.slice} ${(s.acc * 100).toFixed(0)}%`).join(", ")}`,
    );
    console.log(`[eval] wrote ${jsonPath}`);
    console.log(`[eval] wrote ${mdPath}`);
    console.log(`[eval] wrote evals/COMPARISON.md`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
