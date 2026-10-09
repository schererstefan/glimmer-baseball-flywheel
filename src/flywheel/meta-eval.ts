/**
 * Meta-eval — eval the eval. Checks judge quality, dataset health, leakage.
 * Provides both legacy metaEval and spec runMetaEval with detailed judge agreement / coverage / leakage.
 */
import fs from "node:fs";
import path from "node:path";
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

// ---------------------------------------------------------------------------
// Rich meta-eval — for spec (judge agreement, coverage, leakage detection)
// ---------------------------------------------------------------------------

export type JudgeAgreementInput = {
  mockVerdicts: Array<{ id: string; verdict: string; confidence?: number }>;
  llmVerdicts: Array<{ id: string; verdict: string; confidence?: number }>;
};

export type CoverageInput = {
  cases: Array<{
    id: string;
    category?: string;
    team?: string;
    difficulty?: string;
  }>;
  expectedCategories?: string[];
  expectedTeams?: string[];
  expectedDifficulties?: string[];
};

export type LeakageInput = {
  evalCases: Array<{ id: string; question: string; answer?: string }>;
  trainCases: Array<{ id: string; question: string; answer?: string }>;
  ngram?: number;
  threshold?: number;
};

export type MetaEvalReport = {
  timestamp: string;
  judgeAgreement: {
    total: number;
    agree: number;
    disagree: number;
    agreementRate: number;
    cohenKappa: number;
    confusion: Record<string, Record<string, number>>;
    disagreements: Array<{ id: string; mock: string; llm: string }>;
  };
  coverage: {
    total: number;
    categories: Record<string, number>;
    teams: Record<string, number>;
    difficulties: Record<string, number>;
    missingCategories: string[];
    missingTeams: string[];
    missingDifficulties: string[];
    giniCategory: number;
    isBalanced: boolean;
  };
  leakage: {
    evalCount: number;
    trainCount: number;
    ngram: number;
    threshold: number;
    leaks: Array<{
      evalId: string;
      trainId: string;
      overlap: number;
      ngramOverlap: number;
    }>;
    leakRate: number;
    hasLeakage: boolean;
  };
  summary: {
    ok: boolean;
    warnings: string[];
  };
};

function normalizeVerdict(v: string): string {
  const n = v.toLowerCase().trim();
  if (n === "pass" || n === "correct") return "correct";
  if (n === "fail" || n === "incorrect" || n === "wrong") return "incorrect";
  if (n === "partial") return "partial";
  return n;
}

export function computeJudgeAgreement(
  input: JudgeAgreementInput,
): MetaEvalReport["judgeAgreement"] {
  const mockMap = new Map(
    input.mockVerdicts.map((v) => [v.id, normalizeVerdict(v.verdict)]),
  );
  const llmMap = new Map(
    input.llmVerdicts.map((v) => [v.id, normalizeVerdict(v.verdict)]),
  );
  const ids = new Set([...mockMap.keys(), ...llmMap.keys()]);
  let agree = 0;
  let disagree = 0;
  const confusion: Record<string, Record<string, number>> = {};
  const disagreements: Array<{ id: string; mock: string; llm: string }> = [];
  const labels = ["correct", "incorrect", "partial"];
  for (const l of labels) {
    confusion[l] = {};
    for (const r of labels) confusion[l]![r] = 0;
  }
  for (const id of ids) {
    const m = mockMap.get(id);
    const l = llmMap.get(id);
    if (m === undefined || l === undefined) continue;
    if (m === l) agree++;
    else {
      disagree++;
      disagreements.push({ id, mock: m, llm: l });
    }
    if (confusion[m] && confusion[m]![l] !== undefined) confusion[m]![l]!++;
    else {
      if (!confusion[m!]) confusion[m!] = {};
      confusion[m!]![l] = (confusion[m!]![l] ?? 0) + 1;
    }
  }
  const total = agree + disagree;
  const agreementRate = total ? Number((agree / total).toFixed(4)) : 1;
  let kappa = 1;
  if (total > 0) {
    const mockCounts: Record<string, number> = {};
    const llmCounts: Record<string, number> = {};
    for (const v of mockMap.values()) mockCounts[v] = (mockCounts[v] ?? 0) + 1;
    for (const v of llmMap.values()) llmCounts[v] = (llmCounts[v] ?? 0) + 1;
    let pExpected = 0;
    for (const label of labels)
      pExpected +=
        ((mockCounts[label] ?? 0) / total) * ((llmCounts[label] ?? 0) / total);
    const pObserved = agreementRate;
    kappa =
      pExpected === 1
        ? 1
        : Number(((pObserved - pExpected) / (1 - pExpected)).toFixed(4));
    if (!isFinite(kappa)) kappa = 0;
  }
  return {
    total,
    agree,
    disagree,
    agreementRate,
    cohenKappa: kappa,
    confusion,
    disagreements: disagreements.slice(0, 20),
  };
}

function mockVerdictForCase(c: { question: string; answer?: string }): string {
  const q = (c.question ?? "").toLowerCase();
  const a = (c.answer ?? "").toLowerCase();
  if (!q || !a) return "incorrect";
  if (a.length < 3) return "incorrect";
  if (q.includes("who") && a.length > 5) return "correct";
  if (q.length > 15 && a.length > 10) return "correct";
  return "partial";
}

export function mockJudgeAgreementForDataset(
  cases: Array<{ id: string; question: string; answer?: string }>,
  llmVerdicts?: Array<{ id: string; verdict: string }>,
): MetaEvalReport["judgeAgreement"] {
  const mockVerdicts = cases.map((c) => ({
    id: c.id,
    verdict: mockVerdictForCase(c),
  }));
  const llm = llmVerdicts ?? mockVerdicts.map((v) => ({ ...v }));
  return computeJudgeAgreement({ mockVerdicts, llmVerdicts: llm });
}

function gini(counts: number[]): number {
  if (!counts.length) return 0;
  const n = counts.length;
  const sorted = [...counts].sort((a, b) => a - b);
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let cum = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    cum += sorted[i]!;
    sum += cum;
  }
  return Number(((n + 1 - (2 * sum) / total) / n).toFixed(4));
}

export function computeCoverage(
  input: CoverageInput,
): MetaEvalReport["coverage"] {
  const cats: Record<string, number> = {};
  const teams: Record<string, number> = {};
  const diffs: Record<string, number> = {};
  for (const c of input.cases) {
    const cat = c.category ?? "unknown";
    const team = c.team ?? "unknown";
    const diff = c.difficulty ?? "unknown";
    cats[cat] = (cats[cat] ?? 0) + 1;
    teams[team] = (teams[team] ?? 0) + 1;
    diffs[diff] = (diffs[diff] ?? 0) + 1;
  }
  const total = input.cases.length;
  const defCats = input.expectedCategories ?? [
    "team",
    "stats",
    "postseason",
    "history",
    "awards",
    "ballpark",
  ];
  const defTeams = input.expectedTeams ?? [];
  const defDiffs = input.expectedDifficulties ?? ["easy", "medium", "hard"];
  const missingCategories = defCats.filter((c) => !(c in cats));
  const missingTeams = defTeams.filter((t) => !(t in teams));
  const missingDifficulties = defDiffs.filter((d) => !(d in diffs));
  const giniCategory = gini(Object.values(cats));
  const isBalanced = giniCategory < 0.4 && missingCategories.length === 0;
  return {
    total,
    categories: cats,
    teams,
    difficulties: diffs,
    missingCategories,
    missingTeams,
    missingDifficulties,
    giniCategory,
    isBalanced,
  };
}

function ngrams(text: string, n: number): Set<string> {
  const norm = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const toks = norm.split(" ").filter(Boolean);
  const set = new Set<string>();
  if (toks.length < n) {
    if (toks.length) set.add(toks.join(" "));
    return set;
  }
  for (let i = 0; i <= toks.length - n; i++)
    set.add(toks.slice(i, i + n).join(" "));
  return set;
}

function jaccardSets<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function detectLeakage(input: LeakageInput): MetaEvalReport["leakage"] {
  const n = input.ngram ?? 8;
  const threshold = input.threshold ?? 0.7;
  const trainIndex = input.trainCases.map((t) => ({
    id: t.id,
    grams: ngrams(`${t.question} ${t.answer ?? ""}`, n),
    norm: `${t.question} ${t.answer ?? ""}`
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim(),
  }));
  const leaks: MetaEvalReport["leakage"]["leaks"] = [];
  for (const e of input.evalCases) {
    const eText = `${e.question} ${e.answer ?? ""}`;
    const eNorm = eText.toLowerCase().replace(/\s+/g, " ").trim();
    const eGrams = ngrams(eText, n);
    for (const t of trainIndex) {
      if (eNorm && t.norm && eNorm === t.norm) {
        leaks.push({
          evalId: e.id,
          trainId: t.id,
          overlap: 1,
          ngramOverlap: 1,
        });
        break;
      }
      if (
        e.question &&
        t.norm.includes(e.question.toLowerCase().replace(/\s+/g, " ").trim()) &&
        e.question.trim().length > 20
      ) {
        leaks.push({
          evalId: e.id,
          trainId: t.id,
          overlap: 0.95,
          ngramOverlap: 0.95,
        });
        break;
      }
      const overlap = jaccardSets(eGrams, t.grams);
      if (overlap >= threshold) {
        leaks.push({
          evalId: e.id,
          trainId: t.id,
          overlap: Number(overlap.toFixed(4)),
          ngramOverlap: Number(overlap.toFixed(4)),
        });
        break;
      }
    }
  }
  const leakRate = input.evalCases.length
    ? Number((leaks.length / input.evalCases.length).toFixed(4))
    : 0;
  return {
    evalCount: input.evalCases.length,
    trainCount: input.trainCases.length,
    ngram: n,
    threshold,
    leaks: leaks.slice(0, 50),
    leakRate,
    hasLeakage: leaks.length > 0,
  };
}

export type MetaEvalOpts = {
  datasetPath?: string;
  evalPath?: string;
  trainPath?: string;
  outPath?: string;
  ngram?: number;
  threshold?: number;
};

export function runMetaEval(
  datasetCases: Array<{
    id: string;
    question: string;
    answer?: string;
    category?: string;
    team?: string;
    difficulty?: string;
  }>,
  opts: {
    llmVerdicts?: Array<{ id: string; verdict: string }>;
    trainCases?: Array<{ id: string; question: string; answer?: string }>;
    expectedCategories?: string[];
    ngram?: number;
    threshold?: number;
  } = {},
): MetaEvalReport {
  const judgeAgreement = mockJudgeAgreementForDataset(
    datasetCases,
    opts.llmVerdicts,
  );
  const coverage = computeCoverage({
    cases: datasetCases,
    expectedCategories: opts.expectedCategories,
  });
  const leakage = detectLeakage({
    evalCases: datasetCases,
    trainCases: opts.trainCases ?? [],
    ngram: opts.ngram ?? 8,
    threshold: opts.threshold ?? 0.7,
  });
  const warnings: string[] = [];
  if (judgeAgreement.agreementRate < 0.8)
    warnings.push(`low judge agreement: ${judgeAgreement.agreementRate}`);
  if (judgeAgreement.cohenKappa < 0.6)
    warnings.push(`low kappa: ${judgeAgreement.cohenKappa}`);
  if (!coverage.isBalanced)
    warnings.push(
      `imbalanced coverage gini=${coverage.giniCategory} missing=${coverage.missingCategories.join(",") || "none"}`,
    );
  if (coverage.missingCategories.length)
    warnings.push(
      `missing categories: ${coverage.missingCategories.join(",")}`,
    );
  if (leakage.hasLeakage)
    warnings.push(
      `leakage detected: ${leakage.leaks.length}/${leakage.evalCount} (${leakage.leakRate})`,
    );
  const ok = warnings.length === 0;
  return {
    timestamp: new Date().toISOString(),
    judgeAgreement,
    coverage,
    leakage,
    summary: { ok, warnings },
  };
}

export const runMetaEvalAlias = runMetaEval;

export function loadCases(filePath: string): Array<{
  id: string;
  question: string;
  answer?: string;
  category?: string;
  team?: string;
  difficulty?: string;
}> {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed as ReturnType<typeof loadCases>;
  if (parsed && Array.isArray(parsed.cases))
    return parsed.cases as ReturnType<typeof loadCases>;
  if (parsed && Array.isArray(parsed.data))
    return parsed.data as ReturnType<typeof loadCases>;
  return [];
}

// CLI for rich meta-eval
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx !== -1) return args[idx + 1];
    const pref = args.find((a) => a.startsWith(`${flag}=`));
    if (pref) return pref.split("=").slice(1).join("=");
    return undefined;
  };
  // If --rich or spec flags, use rich path; else default to legacy metaEval via orchestrator
  if (args.includes("--rich") || get("--dataset") || get("--out")) {
    const datasetPath = get("--dataset") ?? "dataset/v1/baseball.json";
    const cases = fs.existsSync(path.resolve(datasetPath))
      ? loadCases(path.resolve(datasetPath))
      : [];
    const outPath = path.resolve(
      get("--out") ?? "flywheel/reports/meta-eval.json",
    );
    const report = runMetaEval(cases, {});
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(
      `[meta-eval] cases=${cases.length} agreement=${report.judgeAgreement.agreementRate} kappa=${report.judgeAgreement.cohenKappa} wrote ${path.relative(process.cwd(), outPath)}`,
    );
  }
}
