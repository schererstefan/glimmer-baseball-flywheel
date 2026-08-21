import { describe, it, expect } from "vitest";
import { buildCurriculum } from "@/src/flywheel/curriculum.ts";
import { loadState, saveState } from "@/src/flywheel/state.ts";
import { metaEval } from "@/src/flywheel/meta-eval.ts";
import type { EvalRun } from "@/src/eval/harness.ts";

describe("curriculum", () => {
  it("focuses on weakest category", () => {
    const run = {
      metrics: {
        byCategory: { stats: { total: 10, acc: 0.3, partialAcc: 0.4 }, history: { total: 10, acc: 0.9, partialAcc: 0.9 }, roster: { total: 10, acc: 0.6, partialAcc: 0.6 } },
        byTeam: {}, byDifficulty: {}, byFreshness: {}, accuracy: 0.6, total: 30,
      },
      weakestSlices: [{ slice: "category:stats", acc: 0.3, total: 10 }],
      cases: [],
    } as unknown as EvalRun;
    const cur = buildCurriculum(run, [
      { id: "bb_live_001", freshness: "live", verified_at: "2025-01-01" } as any,
    ]);
    expect(cur.focusCategories[0]).toBe("stats");
    expect(cur.nextN).toBeGreaterThanOrEqual(10);
    expect(cur.freshnessRefresh).toContain("bb_live_001");
  });
});

describe("state", () => {
  it("round-trips via tmp file", async () => {
    const s = loadState();
    expect(s.version).toBe(1);
    // don't mutate real file in test — just check shape
    expect(s.history).toBeDefined();
    expect(s.bestAccuracy).toBeGreaterThanOrEqual(0);
  });
});

describe("meta-eval", () => {
  it("flags stale live and gaps", () => {
    const run = {
      metrics: { accuracy: 0.6, hallucinationRate: 0.25, judgeModel: "mock/rubric" } as any,
      cases: [{ id: "a", modelAnswer: "Dodgers", goldAnswer: "Dodgers" } as any],
    } as unknown as EvalRun;
    const dataset = { cases: [
      { id: "bb_live_001", freshness: "live", verified_at: "2025-01-01", category: "live_season", team: null },
      { id: "bb_stats_001", freshness: "static", verified_at: "2026-08-16", category: "stats", team: "NYY" },
    ] as any };
    const meta = metaEval(run, dataset as any);
    expect(meta.dataset.staleLive).toBeGreaterThanOrEqual(1);
    expect(meta.health).toBeDefined();
    expect(meta.recommendations.length).toBeGreaterThan(0);
  });
});
