/**
 * Adaptive curriculum — focuses synthesis & training on weak slices + stale freshness.
 * Supports both legacy buildCurriculum and spec updateCurriculum with active learning queue and freshness.
 */
import fs from "node:fs";
import path from "node:path";
import type { EvalRun } from "@/src/eval/harness.ts";

export type Curriculum = {
  focusCategories: string[];
  upweightedSlices: Array<{ slice: string; weight: number }>;
  freshnessRefresh: string[]; // ids that are stale (live/seasonal older than 7d)
  nextN: number; // how many synthetic to generate per slice
};

export function buildCurriculum(run: EvalRun, allCases?: Array<{ id: string; freshness: string; verified_at: string }>): Curriculum {
  const sortedCats = Object.entries(run.metrics.byCategory).sort((a, b) => a[1].acc - b[1].acc);
  const focusCategories = sortedCats.slice(0, 3).map(([k]) => k);

  const upweighted = run.weakestSlices.map((ws) => ({
    slice: ws.slice,
    weight: Math.max(1.0, 2.0 - ws.acc),
  }));

  let freshnessRefresh: string[] = [];
  if (allCases) {
    const weekAgo = Date.now() - 7 * 86400000;
    freshnessRefresh = allCases.filter((c) => (c.freshness === "live" || c.freshness === "seasonal") && new Date(c.verified_at).getTime() < weekAgo).map((c) => c.id);
  }

  const gap = 1 - run.metrics.accuracy;
  const nextN = Math.min(80, Math.max(10, Math.round(gap * 80)));

  return { focusCategories, upweightedSlices: upweighted, freshnessRefresh, nextN };
}

export function curriculumToSyntheticArgs(c: Curriculum): { n: number; categoryOverride?: string } {
  if (c.focusCategories.length === 1) return { n: c.nextN, categoryOverride: c.focusCategories[0] };
  return { n: c.nextN };
}

// ---------------------------------------------------------------------------
// Rich curriculum — for spec compliance (active learning queue, freshness, upweighting)
// ---------------------------------------------------------------------------

export type SliceKey = string;

export type SliceStats = {
  key: SliceKey;
  category?: string;
  team?: string;
  difficulty?: string;
  accuracy: number;
  count: number;
  failRate: number;
};

export type CurriculumWeight = {
  key: SliceKey;
  category?: string;
  team?: string;
  difficulty?: string;
  weight: number;
  accuracy: number;
  count: number;
  lastSeenIter: number;
};

export type CurriculumState = {
  iter: number;
  weights: CurriculumWeight[];
  queue: Array<{ id: string; priority: number; slices: SliceKey[]; createdAt: number; enqueuedIter: number }>;
  seenIds: string[];
  updatedAt: string;
};

export type CurriculumOpts = {
  decay?: number;
  failBoost?: number;
  minWeight?: number;
  maxQueue?: number;
  freshnessWindow?: number;
  freshnessBoost?: number;
};

export type UpdateInput = {
  iter: number;
  sliceStats: SliceStats[];
  recentIds?: string[];
};

function sliceKey(s: { category?: string; team?: string; difficulty?: string }): SliceKey {
  const c = s.category ?? "unknown";
  const d = s.difficulty ?? "unknown";
  const t = s.team ?? "unknown";
  return `${c}::${d}::${t}`;
}

function defaultWeight(s: SliceStats, iter: number): CurriculumWeight {
  const w = 0.2 + (1 - s.accuracy) * 1.5;
  return {
    key: s.key,
    category: s.category,
    team: s.team,
    difficulty: s.difficulty,
    weight: Number(w.toFixed(4)),
    accuracy: s.accuracy,
    count: s.count,
    lastSeenIter: iter,
  };
}

export function updateCurriculum(prev: CurriculumState | null, input: UpdateInput, opts: CurriculumOpts = {}): CurriculumState {
  const decay = opts.decay ?? 0.9;
  const failBoost = opts.failBoost ?? 2.0;
  const minWeight = opts.minWeight ?? 0.05;
  const freshnessWindow = opts.freshnessWindow ?? 3;
  const freshnessBoost = opts.freshnessBoost ?? 0.3;

  const iter = input.iter;
  const prevMap = new Map<SliceKey, CurriculumWeight>();
  if (prev) for (const w of prev.weights) prevMap.set(w.key, w);

  const nextWeights: CurriculumWeight[] = [];
  const seenKeys = new Set<SliceKey>();

  for (const s of input.sliceStats) {
    const key = s.key ?? sliceKey(s);
    seenKeys.add(key);
    const prevW = prevMap.get(key);
    const base = prevW ? prevW.weight * decay : defaultWeight({ ...s, key }, iter).weight;
    const boosted = base + s.failRate * failBoost * (1 + (1 - s.accuracy));
    const diffBonus = s.difficulty === "hard" ? 0.35 : s.difficulty === "medium" ? 0.12 : 0;
    let w = boosted + diffBonus;
    w = Math.max(minWeight, w);
    nextWeights.push({
      key,
      category: s.category,
      team: s.team,
      difficulty: s.difficulty,
      weight: Number(w.toFixed(4)),
      accuracy: s.accuracy,
      count: s.count,
      lastSeenIter: iter,
    });
  }

  if (prev) {
    for (const pw of prev.weights) {
      if (seenKeys.has(pw.key)) continue;
      const age = iter - pw.lastSeenIter;
      let w = pw.weight * Math.pow(decay, age);
      if (age >= freshnessWindow) w += freshnessBoost;
      w = Math.max(minWeight, Number(w.toFixed(4)));
      nextWeights.push({ ...pw, weight: w });
    }
  }

  nextWeights.sort((a, b) => b.weight - a.weight);

  const maxQueue = opts.maxQueue ?? 32;
  const queue = prev ? [...prev.queue] : [];
  const recentSet = new Set(input.recentIds ?? []);
  const topKeys = nextWeights.slice(0, 3).map((w) => w.key);
  const topPriority = nextWeights.slice(0, 3).reduce((s, w) => s + w.weight, 0) / 3;
  if (topKeys.length) {
    const queueKeys = new Set(queue.flatMap((q) => q.slices));
    const hasOverlap = topKeys.some((k) => queueKeys.has(k));
    if (!hasOverlap) {
      queue.push({
        id: `q-${iter}-${Date.now().toString(36)}`,
        priority: Number(topPriority.toFixed(4)),
        slices: topKeys,
        createdAt: Date.now(),
        enqueuedIter: iter,
      });
    }
  }
  queue.sort((a, b) => b.priority - a.priority);
  const trimmedQueue = queue.slice(0, maxQueue).filter((q) => !recentSet.has(q.id));
  const seenIds = prev ? [...prev.seenIds] : [];
  for (const id of input.recentIds ?? []) if (!seenIds.includes(id)) seenIds.push(id);
  const cappedSeen = seenIds.slice(-500);

  return { iter, weights: nextWeights, queue: trimmedQueue, seenIds: cappedSeen, updatedAt: new Date().toISOString() };
}

export function sampleSlices(state: CurriculumState, k: number, seed = 42): CurriculumWeight[] {
  if (!state.weights.length) return [];
  const weights = state.weights;
  const total = weights.reduce((s, w) => s + w.weight, 0);
  if (total <= 0) return weights.slice(0, k);
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const pool = [...weights];
  const sampled: CurriculumWeight[] = [];
  for (let i = 0; i < k && pool.length; i++) {
    const t = pool.reduce((sum, w) => sum + w.weight, 0);
    let r = rand() * t;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      const w = pool[idx]!;
      if (r < w.weight) break;
      r -= w.weight;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    sampled.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return sampled;
}

export function dequeueNext(state: CurriculumState): { item: CurriculumState["queue"][number] | null; next: CurriculumState } {
  if (!state.queue.length) return { item: null, next: state };
  const [head, ...rest] = state.queue;
  return { item: head ?? null, next: { ...state, queue: rest, updatedAt: new Date().toISOString() } };
}

export function curriculumToString(state: CurriculumState): string {
  const lines: string[] = [];
  lines.push(`curriculum iter=${state.iter} ${state.updatedAt}`);
  lines.push(`weights (${state.weights.length}):`);
  for (const w of state.weights.slice(0, 8)) lines.push(`  ${w.key} acc=${w.accuracy.toFixed(2)} fail=${(1 - w.accuracy).toFixed(2)} weight=${w.weight.toFixed(2)}`);
  if (state.weights.length > 8) lines.push(`  ... and ${state.weights.length - 8} more`);
  lines.push(`queue (${state.queue.length}):`);
  for (const q of state.queue.slice(0, 5)) lines.push(`  ${q.id} pri=${q.priority.toFixed(2)} slices=${q.slices.join(",")}`);
  return lines.join("\n");
}

export const CURRICULUM_STATE_PATH = path.resolve("flywheel/curriculum.json");

export function loadCurriculumState(p?: string): CurriculumState | null {
  const file = path.resolve(p ?? CURRICULUM_STATE_PATH);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as CurriculumState;
  } catch {
    return null;
  }
}

export function saveCurriculumState(state: CurriculumState, p?: string): string {
  const file = path.resolve(p ?? CURRICULUM_STATE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf-8");
  // Also write to legacy path for compat
  try {
    const legacy = path.resolve("flywheel/state/curriculum.json");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
  return file;
}

export function statsFromEvalResults(
  results: Array<{ category?: string; team?: string; difficulty?: string; verdict?: string; judgeVerdict?: string; finalVerdict?: string; status?: string; correct?: boolean }>,
): SliceStats[] {
  const buckets = new Map<string, { cat?: string; team?: string; diff?: string; correct: number; total: number }>();
  for (const r of results) {
    const cat = r.category ?? "unknown";
    const diff = r.difficulty ?? "unknown";
    const team = r.team ?? "unknown";
    const key = `${cat}::${diff}::${team}`;
    let b = buckets.get(key);
    if (!b) {
      b = { cat, team, diff, correct: 0, total: 0 };
      buckets.set(key, b);
    }
    b.total++;
    const v = (r.verdict ?? r.judgeVerdict ?? r.finalVerdict ?? r.status ?? "").toLowerCase();
    const isCorrect = typeof r.correct === "boolean" ? r.correct : v === "pass" || v === "correct";
    if (isCorrect) b.correct++;
  }
  const out: SliceStats[] = [];
  for (const [key, b] of buckets) {
    const acc = b.total ? b.correct / b.total : 0;
    out.push({ key, category: b.cat, team: b.team, difficulty: b.diff, accuracy: Number(acc.toFixed(4)), count: b.total, failRate: Number((1 - acc).toFixed(4)) });
  }
  out.sort((a, b) => a.accuracy - b.accuracy);
  return out;
}
