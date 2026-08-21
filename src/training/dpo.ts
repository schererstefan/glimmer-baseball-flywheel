#!/usr/bin/env tsx
/**
 * DPO builder — mines judge failures into preference pairs (chosen vs rejected).
 * Chosen = gold answer + explanation + citations; rejected = model answer.
 * Includes margin scoring, token counting, and decontamination.
 *
 * Supports both EvalCaseResult (harness) and generic EvalResult with verdict=incorrect.
 */
import fs from "node:fs";
import path from "node:path";
import type { EvalCaseResult } from "@/src/eval/harness.ts";
import { estimateTokens } from "./sft.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GenericEvalResult = {
  id: string;
  question?: string;
  prompt?: string;
  modelAnswer?: string;
  answer?: string;
  verdict?: string;
  judgeVerdict?: string;
  finalVerdict?: string;
  status?: string;
  correctedAnswer?: string;
  judgeCorrected?: string;
  groundTruth?: string;
  expectedAnswer?: string;
  goldAnswer?: string;
  confidence?: number;
  judgeConfidence?: number;
  category?: string;
  team?: string | null;
  difficulty?: string;
};

export type DPOPair = {
  id: string;
  prompt: string;
  chosen: string;
  rejected: string;
  margin?: number;
  metadata: {
    category: string;
    team: string | null;
    difficulty: string;
    verdict: string;
    scoreDelta: number;
    judgeModel: string;
    margin?: number;
    tokenCountChosen?: number;
    tokenCountRejected?: number;
    jaccard?: number;
  };
};

export type BuildDPOOpts = {
  includePartial?: boolean;
  minRejectedLength?: number;
  // Extended (task spec)
  maxTokens?: number;
  minTokens?: number;
  dedupe?: boolean;
  decontaminateThreshold?: number;
  goldTexts?: string[];
  minMargin?: number;
  limit?: number;
  seed?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(Boolean));
}

function jaccard(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function isFailureVerdict(v: string): boolean {
  const n = v.toLowerCase();
  return n === "incorrect" || n === "fail" || n === "wrong" || n === "false" || n === "incorrect";
}

function isGenericResult(r: unknown): r is GenericEvalResult {
  return typeof (r as GenericEvalResult)?.id === "string" && !("verdict" in (r as EvalCaseResult) && typeof (r as EvalCaseResult).verdict === "object");
}

function resolveGeneric(r: GenericEvalResult): { prompt: string; rejected: string; chosen: string; verdict: string; confidence?: number; category: string; team: string | null; difficulty: string } | null {
  const verdict = r.verdict ?? r.judgeVerdict ?? r.finalVerdict ?? r.status ?? "";
  if (!isFailureVerdict(verdict)) return null;
  const prompt = (r.question ?? r.prompt ?? "").trim();
  const rejected = (r.modelAnswer ?? r.answer ?? "").trim();
  const chosen = (r.correctedAnswer ?? r.judgeCorrected ?? r.groundTruth ?? r.expectedAnswer ?? r.goldAnswer ?? "").trim();
  if (!prompt || !chosen || !rejected) return null;
  return {
    prompt,
    rejected,
    chosen,
    verdict,
    confidence: r.confidence ?? r.judgeConfidence,
    category: r.category ?? "unknown",
    team: r.team ?? null,
    difficulty: r.difficulty ?? "medium",
  };
}

function computeMargin(chosen: string, rejected: string, confidence?: number): number {
  const jac = jaccard(chosen, rejected);
  const distance = 1 - jac;
  const lenChosen = chosen.length;
  const lenRejected = rejected.length;
  const lenRatio = Math.min(lenChosen, lenRejected) / Math.max(lenChosen, lenRejected || 1);
  const conf = typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0.7;
  const raw = 0.5 * distance + 0.3 * conf + 0.2 * lenRatio;
  return Math.max(0, Math.min(1, Number(raw.toFixed(4))));
}

function containsGoldOverlap(text: string, goldTexts: string[], threshold = 0.92): boolean {
  const n = norm(text);
  for (const g of goldTexts) {
    const gn = norm(g);
    if (!gn) continue;
    if (n === gn) return true;
    if (n.length > 20 && gn.includes(n)) return true;
    if (gn.length > 20 && n.includes(gn)) return true;
    if (jaccard(n, gn) >= threshold) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core builder — handles both EvalCaseResult and generic shapes
// ---------------------------------------------------------------------------

export function buildDPO(
  evalResults: Array<EvalCaseResult | GenericEvalResult>,
  opts: BuildDPOOpts = {},
): DPOPair[] {
  const maxTokens = opts.maxTokens ?? 2048;
  const minTokens = opts.minTokens ?? 4;
  const doDedupe = opts.dedupe ?? true;
  const decontamThreshold = opts.decontaminateThreshold ?? 0.92;
  const minMargin = opts.minMargin ?? 0;
  const goldTexts = opts.goldTexts ?? [];
  const minRejected = opts.minRejectedLength ?? 5;

  const seen = new Set<string>();
  const out: DPOPair[] = [];

  for (const r of evalResults) {
    // Try generic first if it looks like generic
    const generic = r as GenericEvalResult;
    const hasGenericVerdict = typeof generic.verdict === "string" || typeof generic.judgeVerdict === "string";
    const isEvalCase = (r as EvalCaseResult).verdict !== undefined && typeof (r as EvalCaseResult).verdict === "object";

    if (isEvalCase) {
      const ec = r as EvalCaseResult;
      const verdict = ec.verdict.verdict;
      if (verdict === "correct" || verdict === "abstain") continue;
      if (verdict === "partial" && !opts.includePartial) continue;
      if (ec.modelAnswer.trim().length < minRejected) continue;
      const goldNorm = ec.goldAnswer.toLowerCase();
      const rejNorm = ec.modelAnswer.toLowerCase();
      if (rejNorm.includes(goldNorm) && goldNorm.length > 20) continue;

      const chosen = `${ec.goldAnswer}${ec.verdict.citations[0] ? `\n\nSource: ${ec.verdict.citations[0]}` : ""}`;
      const rejected = ec.modelAnswer;
      const jac = jaccard(chosen, rejected);
      if (jac >= decontamThreshold) continue;
      const tChosen = estimateTokens(ec.question + " " + chosen);
      const tRejected = estimateTokens(ec.question + " " + rejected);
      if (tChosen > maxTokens || tRejected > maxTokens) continue;
      if (tChosen < minTokens || tRejected < minTokens) continue;
      if (goldTexts.length && containsGoldOverlap(chosen, goldTexts, 0.92)) continue;
      const margin = computeMargin(chosen, rejected, ec.verdict.confidence);
      if (margin < minMargin) continue;

      const dedupeKey = `${norm(ec.question)}::${norm(chosen)}`;
      if (doDedupe && seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push({
        id: `${ec.id}_dpo`,
        prompt: ec.question,
        chosen,
        rejected,
        margin,
        metadata: {
          category: ec.category,
          team: ec.team,
          difficulty: ec.difficulty,
          verdict,
          scoreDelta: ec.verdict.score === 0 ? 1 : 0.5,
          judgeModel: (ec.verdict as unknown as { judgeModel?: string; model?: string }).judgeModel ?? (ec.verdict as unknown as { model?: string }).model ?? "unknown",
          margin,
          tokenCountChosen: tChosen,
          tokenCountRejected: tRejected,
          jaccard: Number(jac.toFixed(4)),
        },
      });
    } else if (hasGenericVerdict || isGenericResult(r)) {
      const resolved = resolveGeneric(generic);
      if (!resolved) continue;
      if (resolved.rejected.length < minRejected) continue;
      const jac = jaccard(resolved.chosen, resolved.rejected);
      if (jac >= decontamThreshold) continue;
      const tChosen = estimateTokens(resolved.prompt + " " + resolved.chosen);
      const tRejected = estimateTokens(resolved.prompt + " " + resolved.rejected);
      if (tChosen > maxTokens || tRejected > maxTokens) continue;
      if (tChosen < minTokens || tRejected < minTokens) continue;
      if (goldTexts.length && containsGoldOverlap(resolved.chosen, goldTexts, 0.92)) continue;
      const margin = computeMargin(resolved.chosen, resolved.rejected, resolved.confidence);
      if (margin < minMargin) continue;
      const dedupeKey = `${norm(resolved.prompt)}::${norm(resolved.chosen)}`;
      if (doDedupe && seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push({
        id: `${generic.id}_dpo`,
        prompt: resolved.prompt,
        chosen: resolved.chosen,
        rejected: resolved.rejected,
        margin,
        metadata: {
          category: resolved.category,
          team: resolved.team,
          difficulty: resolved.difficulty,
          verdict: resolved.verdict,
          scoreDelta: 1,
          judgeModel: "generic",
          margin,
          tokenCountChosen: tChosen,
          tokenCountRejected: tRejected,
          jaccard: Number(jac.toFixed(4)),
        },
      });
    }

    if (opts.limit && out.length >= opts.limit) break;
  }

  // Sort by margin descending for strongest signal first
  out.sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));

  return opts.limit ? out.slice(0, opts.limit) : out;
}

// Aliases for task spec compatibility
export const buildDpo = buildDPO;

export function toDpoJsonl(pairs: DPOPair[]): string {
  return pairs.map((p) => JSON.stringify(p)).join("\n") + (pairs.length ? "\n" : "");
}

export function fromDpoJsonl(jsonl: string): DPOPair[] {
  const out: DPOPair[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as DPOPair);
    } catch {}
  }
  return out;
}

export function writeDPOJsonl(pairs: DPOPair[], outPath: string): string {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pairs.map((p) => JSON.stringify(p)).join("\n") + (pairs.length ? "\n" : ""));
  return outPath;
}

// Keep old name for pipeline compatibility
export const writeDpoJsonl = writeDPOJsonl;

export function loadEvalResults(filePath: string): Array<EvalCaseResult | GenericEvalResult> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed as GenericEvalResult[];
  if (parsed && Array.isArray(parsed.results)) return parsed.results as GenericEvalResult[];
  if (parsed && Array.isArray(parsed.cases)) return parsed.cases as EvalCaseResult[];
  if (parsed && parsed.providers && Array.isArray(parsed.providers)) {
    const all: EvalCaseResult[] = [];
    for (const p of parsed.providers as Array<{ cases: EvalCaseResult[] }>) if (Array.isArray(p.cases)) all.push(...p.cases);
    return all;
  }
  if (parsed && parsed.cases && Array.isArray(parsed.cases)) return parsed.cases as EvalCaseResult[];
  return [];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { evalPath: string; out: string; includePartial: boolean; minMargin: number } {
  const args = argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx !== -1) return args[idx + 1];
    const pref = args.find((a) => a.startsWith(`${flag}=`));
    if (pref) return pref.split("=").slice(1).join("=");
    return undefined;
  };
  return {
    evalPath: get("--eval") ?? get("--in") ?? "evals/results/latest.json",
    out: get("--out") ?? "training/datasets/dpo.jsonl",
    includePartial: args.includes("--include-partial"),
    minMargin: get("--min-margin") ? Number(get("--min-margin")) : 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv);
  const evalPath = path.resolve(opts.evalPath);
  if (!fs.existsSync(evalPath)) {
    console.error(`[dpo] eval results not found: ${evalPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(evalPath, "utf-8");
  const parsed = JSON.parse(raw);
  const cases: Array<EvalCaseResult | GenericEvalResult> = Array.isArray(parsed)
    ? parsed
    : parsed.cases ?? parsed.results ?? [];
  const pairs = buildDPO(cases as EvalCaseResult[], { includePartial: opts.includePartial, minMargin: opts.minMargin });
  const outPath = path.resolve(opts.out);
  writeDPOJsonl(pairs, outPath);
  const avgMargin = pairs.length ? (pairs.reduce((s, p) => s + (p.margin ?? 0), 0) / pairs.length).toFixed(3) : "0";
  console.log(`[dpo] ${cases.length} eval -> ${pairs.length} pairs (avg margin=${avgMargin})`);
  console.log(`[dpo] wrote ${path.relative(process.cwd(), outPath)}`);
}
