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
  while (true) {
    m = re.exec(text);
    if (m === null) break;
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

// Compatibility alias — older metrics imports DIFFICULTY_MULTIPLIER
export const DIFFICULTY_MULTIPLIER = DIFFICULTY_WEIGHTS;
