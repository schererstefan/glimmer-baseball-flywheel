/**
 * Adaptive curriculum — focuses synthesis & training on weak slices + stale freshness.
 * Supports both legacy buildCurriculum and spec updateCurriculum with active learning queue and freshness.
 */
import type { EvalRun } from "@/src/eval/harness.ts";

export type Curriculum = {
  focusCategories: string[];
  upweightedSlices: Array<{ slice: string; weight: number }>;
  freshnessRefresh: string[]; // ids that are stale (live/seasonal older than 7d)
  nextN: number; // how many synthetic to generate per slice
};

export function buildCurriculum(
  run: EvalRun,
  allCases?: Array<{ id: string; freshness: string; verified_at: string }>,
): Curriculum {
  const sortedCats = Object.entries(run.metrics.byCategory).sort(
    (a, b) => a[1].acc - b[1].acc,
  );
  const focusCategories = sortedCats.slice(0, 3).map(([k]) => k);

  const upweighted = run.weakestSlices.map((ws) => ({
    slice: ws.slice,
    weight: Math.max(1.0, 2.0 - ws.acc),
  }));

  let freshnessRefresh: string[] = [];
  if (allCases) {
    const weekAgo = Date.now() - 7 * 86400000;
    freshnessRefresh = allCases
      .filter(
        (c) =>
          (c.freshness === "live" || c.freshness === "seasonal") &&
          new Date(c.verified_at).getTime() < weekAgo,
      )
      .map((c) => c.id);
  }

  const gap = 1 - run.metrics.accuracy;
  const nextN = Math.min(80, Math.max(10, Math.round(gap * 80)));

  return {
    focusCategories,
    upweightedSlices: upweighted,
    freshnessRefresh,
    nextN,
  };
}

export function curriculumToSyntheticArgs(c: Curriculum): {
  n: number;
  categoryOverride?: string;
} {
  if (c.focusCategories.length === 1)
    return { n: c.nextN, categoryOverride: c.focusCategories[0] };
  return { n: c.nextN };
}
