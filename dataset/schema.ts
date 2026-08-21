/**
 * Baseball QA dataset schema — Zod + TypeScript source of truth.
 *
 * Stored at `dataset/schema.ts` (canonical) and re-exported from `src/dataset/schema.ts`
 * so both `dataset/*` tooling and `src/*` runtime share one validation gate.
 *
 * Design: every case is grounded — answer must be verifiable via `web_search` /
 * `baseball_lookup` evidence. Freshness drives judge strictness and time-decay.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const MLB_TEAMS = [
  "ARI",
  "ATL",
  "BAL",
  "BOS",
  "CHC",
  "CHW",
  "CIN",
  "CLE",
  "COL",
  "DET",
  "HOU",
  "KC",
  "LAA",
  "LAD",
  "MIA",
  "MIL",
  "MIN",
  "NYM",
  "NYY",
  "OAK",
  "PHI",
  "PIT",
  "SD",
  "SEA",
  "SF",
  "STL",
  "TB",
  "TEX",
  "TOR",
  "WSH",
] as const;
export type MlbTeam = (typeof MLB_TEAMS)[number];
/** Alias map so CWS (common fan shorthand) is accepted and normalized to CHW. */
export const TEAM_ALIASES: Record<string, MlbTeam> = {
  CWS: "CHW",
  ATH: "OAK",
  OAK: "OAK",
};

export const CATEGORIES = [
  "roster",
  "stats",
  "history",
  "rules",
  "transactions",
  "ballpark",
  "live_season",
  "trivia",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const FRESHNESS = ["static", "seasonal", "live"] as const;
export type Freshness = (typeof FRESHNESS)[number];

// ---------------------------------------------------------------------------
// BaseballCase
// ---------------------------------------------------------------------------

export const BaseballCaseSchema = z.object({
  /** Stable id — `bb_<slug>` lower_snake. Kept stable for flywheel joins. */
  id: z
    .string()
    .regex(
      /^bb_[a-z0-9_]+$/,
      "id must match /^bb_[a-z0-9_]+$/ e.g. bb_roster_judge_001",
    ),
  /** Natural-language question presented to the model (single turn). */
  question: z.string().min(10).max(600),
  /** Canonical gold answer — concise, judge-friendly. */
  answer: z.string().min(1).max(1000),
  /** Acceptable alternates (normalized via rubric). */
  alternates: z.array(z.string().min(1)).default([]),
  /** Task taxonomy — determines prompt templates + judge thresholds. */
  category: z.enum(CATEGORIES),
  /** Primary team affiliation or null for league-wide rules/history. */
  team: z.enum(MLB_TEAMS).nullable(),
  difficulty: z.enum(DIFFICULTIES),
  freshness: z.enum(FRESHNESS),
  /** At least one verifiable source URL (mlb.com, baseball-reference, wikipedia, ...). */
  gold_sources: z.array(z.string().url()).min(1),
  /** Required citation substrings the judge should find in evidence (case-sensitive contains). */
  must_cite: z.array(z.string()).default([]),
  /** Optional numeric gold for tolerance-based scoring (ERA, avg, HR totals...). */
  numeric_answer: z.number().nullable().default(null),
  tolerance: z.number().nonnegative().nullable().default(null),
  /** Free-form tags for slicing / training curriculum. */
  tags: z.array(z.string().min(1)).default([]),
  /** ISO date (YYYY-MM-DD) when a human last verified gold against gold_sources. */
  verified_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "verified_at must be YYYY-MM-DD")
    .or(z.string().datetime()),
  /** Expected tools for tool-aware eval. Empty = no tool required. */
  expected_tools: z.array(z.string().min(1)).default([]),
  /** Human explanation — used as SFT target reasoning. */
  explanation: z.string().default(""),
});

export type BaseballCase = z.infer<typeof BaseballCaseSchema>;

// ---------------------------------------------------------------------------
// DatasetManifest — versioned bundle written to `dataset/v1/baseball.json` etc.
// ---------------------------------------------------------------------------

export const DatasetManifestSchema = z.object({
  version: z.string().min(1),
  created_at: z.string().datetime().or(z.string().min(1)),
  total: z.number().int().nonnegative(),
  by_category: z.record(z.number().int().nonnegative()),
  by_team: z.record(z.number().int().nonnegative()),
  by_difficulty: z.record(z.number().int().nonnegative()),
  by_freshness: z.record(z.number().int().nonnegative()),
  source: z.string().min(1),
  cases: z.array(BaseballCaseSchema),
});
export type DatasetManifest = z.infer<typeof DatasetManifestSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function validateCase(data: unknown): BaseballCase {
  return BaseballCaseSchema.parse(data);
}

export function validateCases(data: unknown): BaseballCase[] {
  return z.array(BaseballCaseSchema).parse(data);
}

export function validateDataset(data: unknown): DatasetManifest {
  const m = DatasetManifestSchema.parse(data);
  // cross-check total
  if (m.total !== m.cases.length) {
    throw new Error(
      `manifest total ${m.total} != cases.length ${m.cases.length}`,
    );
  }
  return m;
}

/** Normalize CHW/CWS/ATH aliases — idempotent. */
export function normalizeTeam(t: string | null): MlbTeam | null {
  if (t === null) return null;
  const upper = t.trim().toUpperCase();
  if ((MLB_TEAMS as readonly string[]).includes(upper)) return upper as MlbTeam;
  return TEAM_ALIASES[upper] ?? null;
}

export function caseKey(c: BaseballCase): string {
  return `${c.category}:${c.team ?? "MLB"}:${c.difficulty}:${c.id}`;
}

export function manifestStats(
  cases: BaseballCase[],
): Omit<DatasetManifest, "cases" | "version" | "created_at" | "source"> {
  const by_category: Record<string, number> = {};
  const by_team: Record<string, number> = {};
  const by_difficulty: Record<string, number> = {};
  const by_freshness: Record<string, number> = {};
  for (const c of cases) {
    by_category[c.category] = (by_category[c.category] ?? 0) + 1;
    by_team[c.team ?? "null"] = (by_team[c.team ?? "null"] ?? 0) + 1;
    by_difficulty[c.difficulty] = (by_difficulty[c.difficulty] ?? 0) + 1;
    by_freshness[c.freshness] = (by_freshness[c.freshness] ?? 0) + 1;
  }
  return {
    total: cases.length,
    by_category,
    by_team,
    by_difficulty,
    by_freshness,
  };
}

export function buildManifest(
  cases: BaseballCase[],
  opts: { version?: string; source?: string; created_at?: string } = {},
): DatasetManifest {
  const stats = manifestStats(cases);
  return {
    version: opts.version ?? "v1.0.0",
    created_at: opts.created_at ?? new Date().toISOString(),
    source:
      opts.source ??
      "curated + synthetic grounded (mock) — every answer verifiable via web_search",
    ...stats,
    cases,
  };
}
