import {
  CATEGORY_WEIGHTS,
  DIFFICULTY_MULTIPLIER as DIFFICULTY_WEIGHTS,
} from "@/src/judge/rubric.ts";
import type { JudgeVerdict } from "@/src/judge/types.ts";
import { bootstrapCI, mean, percentile, wilsonCI } from "@/src/utils/stats.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SliceStats = {
  total: number;
  correct: number;
  partial: number;
  acc: number;
  partialAcc: number;
};

export type EvalMetrics = {
  total: number;
  correct: number;
  partial: number;
  incorrect: number;
  abstain: number;
  accuracy: number; // correct / total
  partialCreditAccuracy: number; // (correct + 0.5*partial)/total
  hallucinationRate: number;
  abstentionRate: number;
  groundedRate: number;
  citationRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  // Confidence intervals for mean score / accuracy
  accuracyCI: [number, number]; // Wilson
  accuracyBootstrapCI: [number, number];
  scoreBootstrapCI: [number, number];
  // Slices
  byCategory: Record<string, SliceStats>;
  byTeam: Record<string, SliceStats>;
  byDifficulty: Record<string, SliceStats>;
  byFreshness: Record<string, SliceStats>;
  // Weighted + time-decayed
  weightedAccuracy: number;
  timeDecayedAccuracy: number;
  timeDecayedScore: number;
  // Meta
  avgScore: number;
  judgeModel: string;
};

// ---------------------------------------------------------------------------
// Helpers: time decay
// ---------------------------------------------------------------------------

function daysSince(isoDate: string, refMs = Date.now()): number {
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (refMs - t) / (1000 * 60 * 60 * 24));
}

/** Exponential decay weight: 1 at age 0, 0.5 at halfLifeDays. */
export function timeDecayWeight(
  verifiedAt: string,
  halfLifeDays = 180,
  refMs = Date.now(),
): number {
  const age = daysSince(verifiedAt, refMs);
  return 0.5 ** (age / halfLifeDays);
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export function computeMetrics(
  verdicts: JudgeVerdict[],
  cases: Array<{
    category: string;
    team: string | null;
    difficulty: string;
    freshness: string;
    verified_at?: string;
  }>,
  latencies?: (number | undefined)[],
  opts: { halfLifeDays?: number; refDateMs?: number } = {},
): EvalMetrics {
  const total = verdicts.length;
  const correct = verdicts.filter((v) => v.verdict === "correct").length;
  const partial = verdicts.filter((v) => v.verdict === "partial").length;
  const abstain = verdicts.filter((v) => v.verdict === "abstain").length;
  const incorrect = verdicts.filter((v) => v.verdict === "incorrect").length;

  const accuracy = total ? correct / total : 0;
  const partialCreditAccuracy = total ? (correct + 0.5 * partial) / total : 0;
  const hallucinationRate = total
    ? verdicts.filter((v) => v.hallucinationDetected).length / total
    : 0;
  const abstentionRate = total ? abstain / total : 0;
  const groundedRate = total
    ? verdicts.filter((v) => v.grounded).length / total
    : 0;
  const citationRate = total
    ? verdicts.filter(
        (v) => (v.citations?.length ?? 0) > 0 || (v.evidence?.length ?? 0) > 0,
      ).length / total
    : 0;

  // Latency — filter undefined (some judges don't emit latencyMs)
  const rawLats = latencies ?? verdicts.map((v) => v.latencyMs);
  const lats = rawLats.filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n),
  );
  const avgLatencyMs = lats.length ? Math.round(mean(lats)) : 0;
  const p50LatencyMs = lats.length ? percentile(lats, 50) : 0;
  const p95LatencyMs = lats.length ? percentile(lats, 95) : 0;

  const accuracyCI = wilsonCI(correct, total);
  const scores = verdicts.map((v) => v.score);
  const accuracyBootstrapCI = bootstrapCI(
    scores.map((s) => (s >= 1 ? 1 : 0)),
    800,
  );
  const scoreBootstrapCI = bootstrapCI(scores, 800);
  const avgScore = total ? mean(scores) : 0;

  // Slices — generic helper
  const byCategory: Record<string, SliceStats> = {};
  const byTeam: Record<string, SliceStats> = {};
  const byDifficulty: Record<string, SliceStats> = {};
  const byFreshness: Record<string, SliceStats> = {};

  function buildSlices(
    key: keyof (typeof cases)[number],
    out: Record<string, SliceStats>,
  ) {
    const map = new Map<string, JudgeVerdict[]>();
    for (let i = 0; i < verdicts.length; i++) {
      const k = String((cases[i] as Record<string, unknown>)[key] ?? "unknown");
      const list = map.get(k);
      if (list) list.push(verdicts[i]!);
      else map.set(k, [verdicts[i]!]);
    }
    for (const [k, vs] of map) {
      const tot = vs.length;
      const cor = vs.filter((v) => v.verdict === "correct").length;
      const par = vs.filter((v) => v.verdict === "partial").length;
      out[k] = {
        total: tot,
        correct: cor,
        partial: par,
        acc: tot ? cor / tot : 0,
        partialAcc: tot ? (cor + 0.5 * par) / tot : 0,
      };
    }
  }
  buildSlices("category", byCategory);
  buildSlices("team", byTeam);
  buildSlices("difficulty", byDifficulty);
  buildSlices("freshness", byFreshness);

  // Weighted accuracy (category * difficulty)
  let wSum = 0;
  let wTot = 0;
  for (let i = 0; i < verdicts.length; i++) {
    const c = cases[i]!;
    const cw = CATEGORY_WEIGHTS[c.category] ?? 1;
    const dw =
      (DIFFICULTY_WEIGHTS as Record<string, number>)[c.difficulty] ??
      (c.difficulty === "expert" ? 1.4 : 1);
    const w = cw * dw;
    wSum += verdicts[i]!.score * w;
    wTot += w;
  }
  const weightedAccuracy = wTot ? wSum / wTot : accuracy;

  // Time-decayed accuracy/score — recent cases (freshness live/seasonal) weigh higher
  const halfLife = opts.halfLifeDays ?? 180;
  const refMs = opts.refDateMs ?? Date.now();
  let tdCorrect = 0;
  let tdTotal = 0;
  let tdScoreSum = 0;
  let tdWeightSum = 0;
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i]!;
    const c = cases[i]!;
    const decay = timeDecayWeight(
      c.verified_at ?? new Date().toISOString().slice(0, 10),
      halfLife,
      refMs,
    );
    // Freshness live is inherently heavier: multiply live×1.2, seasonal×1.0, static×0.9
    const freshnessMult =
      c.freshness === "live" ? 1.2 : c.freshness === "seasonal" ? 1.0 : 0.9;
    const w = decay * freshnessMult;
    tdCorrect += (v.verdict === "correct" ? 1 : 0) * w;
    tdScoreSum += v.score * w;
    tdTotal += w;
    tdWeightSum += w;
  }
  const timeDecayedAccuracy = tdTotal ? tdCorrect / tdTotal : accuracy;
  const timeDecayedScore = tdWeightSum ? tdScoreSum / tdWeightSum : avgScore;

  const judgeModel = verdicts[0]
    ? (((verdicts[0] as unknown as Record<string, unknown>).model as string) ??
      "unknown")
    : "unknown";

  return {
    total,
    correct,
    partial,
    incorrect,
    abstain,
    accuracy,
    partialCreditAccuracy,
    hallucinationRate,
    abstentionRate,
    groundedRate,
    citationRate,
    avgLatencyMs,
    p50LatencyMs,
    p95LatencyMs,
    accuracyCI,
    accuracyBootstrapCI,
    scoreBootstrapCI,
    byCategory,
    byTeam,
    byDifficulty,
    byFreshness,
    weightedAccuracy,
    timeDecayedAccuracy,
    timeDecayedScore,
    avgScore,
    judgeModel,
  };
}

export function weakestSlices(
  metrics: EvalMetrics,
  topN = 5,
): Array<{ slice: string; acc: number; total: number }> {
  const all: Array<{ slice: string; acc: number; total: number }> = [];
  for (const [k, v] of Object.entries(metrics.byCategory))
    all.push({ slice: `category:${k}`, acc: v.acc, total: v.total });
  for (const [k, v] of Object.entries(metrics.byTeam))
    if (k !== "null" && v.total >= 2)
      all.push({ slice: `team:${k}`, acc: v.acc, total: v.total });
  for (const [k, v] of Object.entries(metrics.byDifficulty))
    all.push({ slice: `difficulty:${k}`, acc: v.acc, total: v.total });
  for (const [k, v] of Object.entries(metrics.byFreshness))
    all.push({ slice: `freshness:${k}`, acc: v.acc, total: v.total });
  return all.sort((a, b) => a.acc - b.acc).slice(0, topN);
}
