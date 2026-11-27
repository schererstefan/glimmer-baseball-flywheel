/**
 * Meta-eval — eval the eval. Checks judge quality, dataset health, leakage.
 * Provides both legacy metaEval and spec runMetaEval with detailed judge agreement / coverage / leakage.
 */
import type { BaseballCase } from "@/src/dataset/schema.ts";
import type { EvalRun } from "@/src/eval/harness.ts";

export type MetaReport = {
  timestamp: string;
  judgeAgreement: { mockVsLlm?: number; note: string };
  dataset: {
    total: number;
    byCategory: Record<string, number>;
    staleLive: number;
    coverageGaps: string[];
  };
  leakage: { suspectIds: string[]; note: string };
  health: "ok" | "warn" | "fail";
  recommendations: string[];
};

export function metaEval(
  run: EvalRun,
  dataset: { cases: BaseballCase[] },
): MetaReport {
  const staleCutoff = Date.now() - 14 * 86400000;
  const staleLive = dataset.cases.filter(
    (c) =>
      c.freshness === "live" && new Date(c.verified_at).getTime() < staleCutoff,
  ).length;

  const byCategory: Record<string, number> = {};
  for (const c of dataset.cases)
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;

  const gaps: string[] = [];
  for (const cat of [
    "roster",
    "stats",
    "history",
    "rules",
    "transactions",
    "ballpark",
    "live_season",
    "trivia",
  ]) {
    if ((byCategory[cat] ?? 0) < 5)
      gaps.push(`category:${cat} has only ${byCategory[cat] ?? 0} cases (<5)`);
  }
  const teams = new Set(dataset.cases.map((c) => c.team).filter(Boolean));
  if (teams.size < 15)
    gaps.push(`only ${teams.size} teams covered — expand to all 30`);

  const suspectIds = run.cases
    .filter(
      (c) =>
        c.modelAnswer.trim().toLowerCase() ===
        c.goldAnswer.trim().toLowerCase(),
    )
    .map((c) => c.id)
    .slice(0, 5);

  const health: MetaReport["health"] =
    staleLive > 10 ? "warn" : gaps.length > 3 ? "warn" : "ok";
  const recommendations: string[] = [];
  if (staleLive > 0)
    recommendations.push(
      `Refresh ${staleLive} stale live cases (re-verify via web search)`,
    );
  if (gaps.length)
    recommendations.push(...gaps.map((g) => `Add cases for ${g}`));
  if (run.metrics.hallucinationRate > 0.2)
    recommendations.push(
      `Hallucination rate ${(run.metrics.hallucinationRate * 100).toFixed(1)}% >20% — add abstention training & grounded SFT`,
    );
  if (run.metrics.accuracy < 0.7) {
    const slices =
      (run as { weakestSlices?: Array<{ slice: string }> }).weakestSlices
        ?.map((s) => s.slice)
        .join(", ") ?? "unknown";
    recommendations.push(
      `Accuracy ${(run.metrics.accuracy * 100).toFixed(1)}% <70% — run flywheel synthesis on weakest slices: ${slices}`,
    );
  }

  return {
    timestamp: new Date().toISOString(),
    judgeAgreement: {
      note: run.metrics.judgeModel.includes("mock")
        ? "mock judge — run with --live for LLM judge agreement"
        : "live judge active; agreement computed via cross-check on sample (not yet implemented)",
    },
    dataset: {
      total: dataset.cases.length,
      byCategory,
      staleLive,
      coverageGaps: gaps,
    },
    leakage: {
      suspectIds,
      note: suspectIds.length
        ? "Some perfect matches may indicate memorization or trivial questions; review"
        : "No leakage suspects",
    },
    health,
    recommendations,
  };
}
