/**
 * Baseball rubric — category-specific tolerances and scoring.
 */
export type RubricResult = { pass: boolean; score: number; reason: string };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsAll(hay: string, needles: string[]): boolean {
  const h = norm(hay);
  return needles.every((n) => h.includes(norm(n)));
}

export function scoreNumeric(
  gold: number,
  pred: number | null,
  tol: number,
): RubricResult {
  if (pred === null || Number.isNaN(pred))
    return {
      pass: false,
      score: 0,
      reason: `numeric gold=${gold} but pred missing/NaN`,
    };
  const diff = Math.abs(gold - pred);
  if (diff <= tol)
    return {
      pass: true,
      score: 1,
      reason: `numeric within tol ${tol}: diff=${diff}`,
    };
  if (diff <= tol * 3)
    return {
      pass: false,
      score: 0.5,
      reason: `numeric close but outside tol: diff=${diff} tol=${tol}`,
    };
  return {
    pass: false,
    score: 0,
    reason: `numeric far: gold=${gold} pred=${pred} diff=${diff}`,
  };
}

export function extractNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function extractAllNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function scoreByCategory(
  category: string,
  gold: string,
  pred: string,
  alternates: string[] = [],
  numericGold?: number | null,
  tolerance?: number | null,
  mustCite?: string[],
): RubricResult {
  const lc = norm(pred);
  if (
    lc.includes("i don't know") ||
    lc.includes("i do not know") ||
    lc.includes("as an ai") ||
    pred.trim() === ""
  ) {
    return { pass: false, score: 0, reason: "abstain detected" };
  }
  if (typeof numericGold === "number" && typeof tolerance === "number") {
    // For baseball stats, search all numbers in pred for a match within tolerance (ignore years 1900-2100 unless gold is a year)
    const predNums = extractAllNumbers(pred);
    // filter out year-like numbers if gold is not year-scale
    const isYearGold =
      numericGold >= 1900 &&
      numericGold <= 2100 &&
      Number.isInteger(numericGold);
    const candidates = isYearGold
      ? predNums
      : predNums.filter(
          (n) => !(n >= 1900 && n <= 2100 && Number.isInteger(n)),
        );
    const hay = candidates.length ? candidates : predNums;
    let best: number | null = null;
    let bestDiff = Infinity;
    for (const n of hay) {
      const diff = Math.abs(n - numericGold);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = n;
      }
    }
    // also consider semantic containment fallback: if gold token present, pass even if numeric mismatch (handles cases like .322/58/144 where gold is one of multiple numbers)
    if (best === null) return scoreNumeric(numericGold, null, tolerance);
    if (bestDiff <= tolerance)
      return {
        pass: true,
        score: 1,
        reason: `numeric within tol ${tolerance}: gold=${numericGold} pred=${best} diff=${bestDiff}`,
      };
    // If tolerance is strict0 but gold appears as substring in pred, treat as pass (handles 58 in "58 HR")
    const predNormLocal = norm(pred);
    const goldStr = String(numericGold);
    if (predNormLocal.includes(goldStr))
      return {
        pass: true,
        score: 1,
        reason: `numeric ${goldStr} found verbatim in pred`,
      };
    // fallback to token recall check
    return scoreNumeric(numericGold, best, tolerance);
  }
  const goldNorm = norm(gold);
  const predNorm = norm(pred);
  if (category === "history") {
    const yearMatch = gold.match(/\b(19|20)\d{2}\b/);
    if (yearMatch && !pred.includes(yearMatch[0]))
      return {
        pass: false,
        score: 0,
        reason: `history year ${yearMatch[0]} missing`,
      };
  }
  if (predNorm.includes(goldNorm) || goldNorm.includes(predNorm)) {
    if (
      mustCite &&
      mustCite.length > 0 &&
      !containsAll(pred, mustCite.slice(0, 2))
    ) {
      return {
        pass: true,
        score: 0.8,
        reason: "contains gold but missing must_cite",
      };
    }
    return { pass: true, score: 1, reason: "exact/contains gold" };
  }
  for (const alt of alternates) {
    if (predNorm.includes(norm(alt)) || norm(alt).includes(predNorm)) {
      return { pass: true, score: 1, reason: `matches alternate: ${alt}` };
    }
  }
  const goldTokens = new Set(goldNorm.split(" "));
  const predTokens = new Set(predNorm.split(" "));
  let overlap = 0;
  for (const t of goldTokens) if (predTokens.has(t)) overlap++;
  const recall = overlap / Math.max(1, goldTokens.size);
  if (recall >= 0.8)
    return {
      pass: true,
      score: 0.7,
      reason: `high token recall ${recall.toFixed(2)} — partial`,
    };
  if (recall >= 0.5)
    return {
      pass: false,
      score: 0.4,
      reason: `mid token recall ${recall.toFixed(2)}`,
    };
  return { pass: false, score: 0, reason: "no containment or alternate match" };
}

export const CATEGORY_WEIGHTS: Record<string, number> = {
  roster: 1.0,
  stats: 1.3,
  history: 1.0,
  rules: 0.7,
  transactions: 1.1,
  ballpark: 0.8,
  live_season: 1.4,
  trivia: 0.9,
};

export const DIFFICULTY_WEIGHTS: Record<string, number> = {
  easy: 0.7,
  medium: 1.0,
  hard: 1.3,
  expert: 1.6,
};

export function weightedScore(
  base: number,
  category: string,
  difficulty: string,
): number {
  const cw = CATEGORY_WEIGHTS[category] ?? 1;
  const dw = DIFFICULTY_WEIGHTS[difficulty] ?? 1;
  const avg = 1.05;
  return base * ((cw * dw) / avg);
}

// Compatibility alias — older metrics imports DIFFICULTY_MULTIPLIER
export const DIFFICULTY_MULTIPLIER = DIFFICULTY_WEIGHTS;

// ---------------------------------------------------------------------------
// Spec-required additional exports — production-grade rubric details
// ---------------------------------------------------------------------------
export type Tolerance = { abs?: number; rel?: number; note: string };

export const STAT_TOLERANCES: Array<{ pattern: RegExp; tolerance: Tolerance }> =
  [
    {
      pattern: /\bbatting average\b|\b ba \b/i,
      tolerance: { abs: 0.001, note: "BA ±0.001" },
    },
    { pattern: /\bera\b/i, tolerance: { abs: 0.01, note: "ERA ±0.01" } },
    { pattern: /\bwhip\b/i, tolerance: { abs: 0.01, note: "WHIP ±0.01" } },
    { pattern: /\bops\b/i, tolerance: { abs: 0.005, note: "OPS ±0.005" } },
    { pattern: /\bwar\b/i, tolerance: { abs: 0.2, note: "WAR ±0.2" } },
    {
      pattern: /\bhr\b|\bhome runs?\b|\brbi\b/i,
      tolerance: { abs: 0, note: "counting stats exact" },
    },
  ];

export function toleranceForQuestion(q: string): Tolerance {
  for (const { pattern, tolerance } of STAT_TOLERANCES)
    if (pattern.test(q)) return tolerance;
  return { abs: 0, note: "exact" };
}

export type CategoryRule = {
  requiresGrounding: boolean;
  requiresNumericMatch: boolean;
  requiresExactYearTeam: boolean;
  requiresPlayerExists: boolean;
  description: string;
};

export const CATEGORY_RULES: Record<string, CategoryRule> = {
  roster: {
    requiresGrounding: true,
    requiresNumericMatch: false,
    requiresExactYearTeam: false,
    requiresPlayerExists: true,
    description: "Roster: player must exist",
  },
  stats: {
    requiresGrounding: true,
    requiresNumericMatch: true,
    requiresExactYearTeam: false,
    requiresPlayerExists: false,
    description: "Stats: numeric within tolerance",
  },
  history: {
    requiresGrounding: true,
    requiresNumericMatch: false,
    requiresExactYearTeam: true,
    requiresPlayerExists: false,
    description: "History: year/champion exact",
  },
  awards: {
    requiresGrounding: true,
    requiresNumericMatch: false,
    requiresExactYearTeam: true,
    requiresPlayerExists: true,
    description: "Awards: winner+year must match",
  },
  transactions: {
    requiresGrounding: true,
    requiresNumericMatch: false,
    requiresExactYearTeam: true,
    requiresPlayerExists: true,
    description: "Transactions",
  },
  rules: {
    requiresGrounding: false,
    requiresNumericMatch: false,
    requiresExactYearTeam: false,
    requiresPlayerExists: false,
    description: "Rules",
  },
  culture: {
    requiresGrounding: false,
    requiresNumericMatch: false,
    requiresExactYearTeam: false,
    requiresPlayerExists: false,
    description: "Culture",
  },
  general: {
    requiresGrounding: false,
    requiresNumericMatch: false,
    requiresExactYearTeam: false,
    requiresPlayerExists: false,
    description: "General",
  },
  ballpark: {
    requiresGrounding: true,
    requiresNumericMatch: false,
    requiresExactYearTeam: false,
    requiresPlayerExists: false,
    description: "Ballpark",
  },
  trivia: {
    requiresGrounding: false,
    requiresNumericMatch: false,
    requiresExactYearTeam: false,
    requiresPlayerExists: false,
    description: "Trivia",
  },
};

export function ruleFor(input: { category?: string }): CategoryRule {
  const cat = (input.category ?? "general").toLowerCase();
  return CATEGORY_RULES[cat] ?? CATEGORY_RULES["general"]!;
}

export function extractNumbers(s: string): number[] {
  const re = /-?\d+(?:\.\d+)?/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(Number(m[0]));
  return out.filter((n) => Number.isFinite(n));
}

export function numbersWithinTolerance(
  gold: string,
  answer: string,
  tol: Tolerance,
): { ok: boolean; detail: string } {
  const goldNums = extractNumbers(gold);
  const ansNums = extractNumbers(answer);
  if (goldNums.length === 0) return { ok: true, detail: "no numbers" };
  const used = new Array(ansNums.length).fill(false);
  for (const g of goldNums) {
    let bestIdx = -1,
      bestDiff = Infinity;
    for (let i = 0; i < ansNums.length; i++)
      if (!used[i]) {
        const d = Math.abs((ansNums[i] ?? 0) - g);
        if (d < bestDiff) {
          bestDiff = d;
          bestIdx = i;
        }
      }
    if (bestIdx === -1) return { ok: false, detail: `gold ${g} no match` };
    const within =
      tol.abs !== undefined ? bestDiff <= tol.abs + 1e-12 : bestDiff === 0;
    if (!within)
      return {
        ok: false,
        detail: `gold ${g} diff ${bestDiff} exceeds ${tol.note}`,
      };
    used[bestIdx] = true;
  }
  return {
    ok: true,
    detail: `all ${goldNums.length} matched within ${tol.note}`,
  };
}

export const withinTolerance = numbersWithinTolerance;

export function weightFor(input: {
  category?: string;
  difficulty?: string;
}): number {
  const cw = CATEGORY_WEIGHTS[input.category ?? "general"] ?? 1;
  const dw = DIFFICULTY_WEIGHTS[input.difficulty ?? "medium"] ?? 1;
  return cw * dw;
}

export function verdictToWeightedScore(
  verdict: string,
  input: { category?: string; difficulty?: string },
): number {
  void weightFor(input);
  return verdict === "correct" ? 1 : verdict === "partial" ? 0.5 : 0;
}

export function rubricSummary(input: {
  question: string;
  category?: string;
}): string {
  const rule = ruleFor(input as { category?: string });
  const tol = toleranceForQuestion(input.question);
  return `${rule.description} tolerance ${tol.note}`;
}

export function isWithinPartialThreshold(
  question: string,
  goldAnswer: string,
  answer: string,
): boolean {
  const tol = toleranceForQuestion(question);
  if (tol.abs === 0) {
    const goldNums = extractNumbers(goldAnswer);
    const ansNums = extractNumbers(answer);
    if (goldNums.length && ansNums.length) {
      let oneOff = 0;
      for (const g of goldNums) {
        const closest = Math.min(...ansNums.map((n) => Math.abs(n - g)));
        if (closest === 1) oneOff++;
        else if (closest !== 0) return false;
      }
      return oneOff === 1;
    }
  }
  return false;
}

export function rubricScore(
  input: { goldSources?: string[] },
  v: {
    verdict: string;
    grounded: boolean;
    hallucinationDetected: boolean;
    score: number;
  },
): number {
  if (
    v.verdict === "correct" &&
    !v.grounded &&
    ruleFor(input as { category?: string }).requiresGrounding
  )
    return 0.5;
  if (v.verdict === "abstain")
    return input.goldSources && input.goldSources.length > 0 ? 0 : 0.25;
  return v.score;
}
