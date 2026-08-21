#!/usr/bin/env tsx
/**
 * SFT builder — converts grounded baseball cases into instruction-tuning JSONL.
 * Chat format: supports both Glimmer (Ollama) and OpenAI messages.
 * Includes token counting, filtering, and dedupe.
 *
 * Compatible with BaseballCase (dataset/schema) and generic GoldRecord shapes.
 * Runnable offline.
 */
import fs from "node:fs";
import path from "node:path";
import type { BaseballCase } from "@/src/dataset/schema.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SFTRecord = {
  id: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  metadata: { category: string; team: string | null; difficulty: string; freshness: string; source: string };
  // Extended fields for training backends and generic compatibility
  format?: "glimmer" | "openai";
  prompt?: string;
  completion?: string;
  tokenCount?: number;
};

export type GoldRecordLike = {
  id: string;
  question: string;
  answer: string;
  category?: string;
  team?: string | null;
  difficulty?: string;
  freshness?: string;
  gold_sources?: string[];
  sourceUrl?: string;
  grounding?: string;
  explanation?: string;
  tags?: string[];
};

export type BuildSFTOpts = {
  // Legacy
  augment?: number;
  filterFreshness?: string[];
  // Extended (task spec)
  format?: "glimmer" | "openai" | "both";
  systemPrompt?: string;
  maxTokens?: number;
  minTokens?: number;
  dedupe?: boolean;
  shuffle?: boolean;
  seed?: number;
  limit?: number;
  templates?: string[];
};

const SYS = `You are a baseball-knowledgeable assistant. Answer accurately and cite sources when possible. If you don't know, say you don't know.`;

// ---------------------------------------------------------------------------
// Instruction templates — baseball grounded
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPLATES: Array<{ id: string; build: (q: string) => string }> = [
  { id: "qa_v1", build: (q) => q },
  { id: "instruct_v1", build: (q) => `Answer the following baseball question accurately and concisely.\n\nQuestion: ${q}` },
  { id: "instruct_v2", build: (q) => `You are a knowledgeable MLB assistant. Use only verified baseball facts.\n\nQuestion: ${q}\n\nAnswer:` },
  { id: "grounded_v1", build: (q) => `Given the question about Major League Baseball, provide a grounded answer. If unsure, say you do not know.\n\nQuestion: ${q}` },
  { id: "short_v1", build: (q) => `Q: ${q}\nA:` },
];

// ---------------------------------------------------------------------------
// Token counting (offline heuristic)
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const byChars = Math.ceil(text.length / 4);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const byWords = Math.ceil(words * 1.3);
  return Math.max(1, Math.round((byChars + byWords) / 2));
}

export function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content) + 3;
  total += 3;
  return total;
}

function hashNorm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], seed: number): void {
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function pseudoRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function normalizeCase(c: BaseballCase | GoldRecordLike): {
  id: string;
  question: string;
  answer: string;
  category: string;
  team: string | null;
  difficulty: string;
  freshness: string;
  sources: string[];
  explanation: string;
} {
  const isBaseball = (c as BaseballCase).gold_sources !== undefined;
  if (isBaseball) {
    const b = c as BaseballCase;
    return {
      id: b.id,
      question: b.question,
      answer: b.answer,
      category: b.category,
      team: b.team,
      difficulty: b.difficulty,
      freshness: b.freshness,
      sources: b.gold_sources ?? [],
      explanation: b.explanation ?? "",
    };
  }
  const g = c as GoldRecordLike;
  return {
    id: g.id,
    question: g.question,
    answer: g.answer,
    category: g.category ?? "unknown",
    team: g.team ?? null,
    difficulty: g.difficulty ?? "medium",
    freshness: g.freshness ?? "static",
    sources: g.gold_sources ?? (g.sourceUrl ? [g.sourceUrl] : []),
    explanation: g.explanation ?? g.grounding ?? "",
  };
}

function caseToSFT(
  c: BaseballCase | GoldRecordLike,
  variant: number,
  opts: BuildSFTOpts,
  templateId?: string,
): SFTRecord {
  const n = normalizeCase(c);
  const sys = opts.systemPrompt ?? SYS;

  // Template selection
  let qBase = n.question;
  let tplId = "qa_v1";
  if (opts.templates && opts.templates.length) {
    const t = DEFAULT_TEMPLATES.find((x) => opts.templates!.includes(x.id));
    if (t) {
      qBase = t.build(n.question);
      tplId = t.id;
    }
  } else if (templateId) {
    const t = DEFAULT_TEMPLATES.find((x) => x.id === templateId);
    if (t) {
      qBase = t.build(n.question);
      tplId = t.id;
    }
  } else if (variant > 0) {
    // Legacy variant behavior (3 question rephrases)
    const questions = [
      n.question,
      `Baseball question: ${n.question}`,
      `${n.question} Be concise and cite a source.`,
    ];
    qBase = questions[variant % questions.length]!;
    tplId = `legacy_v${variant}`;
  }

  const answerRaw = n.explanation ? `${n.answer}\n\n${n.explanation}` : n.answer;
  const cited = n.sources.length ? `${answerRaw}\n\nSources: ${n.sources.join(", ")}` : answerRaw;

  const messages: SFTRecord["messages"] = [
    { role: "system", content: sys },
    { role: "user", content: qBase },
    { role: "assistant", content: cited },
  ];

  const tokenCount = estimateMessagesTokens(messages);

  const id = variant === 0 && !templateId ? n.id : `${n.id}_v${variant}${templateId ? `_${tplId}` : ""}`;

  return {
    id,
    messages,
    metadata: {
      category: n.category,
      team: n.team,
      difficulty: n.difficulty,
      freshness: n.freshness,
      source: n.sources[0] ?? "unknown",
    },
    prompt: qBase,
    completion: cited,
    tokenCount,
    format: (opts.format === "openai" ? "openai" : "glimmer") as SFTRecord["format"],
  };
}

// ---------------------------------------------------------------------------
// Main builder — supports both legacy augment and extended filtering/dedupe/dual format
// ---------------------------------------------------------------------------

export function buildSFT(
  cases: Array<BaseballCase | GoldRecordLike>,
  opts: BuildSFTOpts = {},
): SFTRecord[] {
  const format = opts.format ?? "glimmer";
  const maxTokens = opts.maxTokens ?? 2048;
  const minTokens = opts.minTokens ?? 4;
  const doDedupe = opts.dedupe ?? true;
  const seed = opts.seed ?? 42;
  const shuffle = opts.shuffle ?? false;

  let filtered: Array<BaseballCase | GoldRecordLike> = [...cases];
  if (opts.filterFreshness) filtered = filtered.filter((c) => opts.filterFreshness!.includes(normalizeCase(c).freshness));

  const rand = pseudoRandom(seed);
  const out: SFTRecord[] = [];
  const seenIds = new Set<string>();
  const seenMessages = new Set<string>();

  // For "both" format we emit two records per case (glimmer + openai)
  const formats: Array<"glimmer" | "openai"> = format === "both" ? ["glimmer", "openai"] : [format as "glimmer" | "openai"];

  for (const c of filtered) {
    const n = normalizeCase(c);
    if (!n.question.trim() || !n.answer.trim()) continue;
    if (n.question.length < 10) continue;

    const aug = opts.augment ?? 0;
    // Determine templates to use
    const activeTemplates = opts.templates?.length
      ? DEFAULT_TEMPLATES.filter((t) => opts.templates!.includes(t.id))
      : null;

    // Emit base + augment variants, each for each format
    for (const fmt of formats) {
      const fmtOpts = { ...opts, format: fmt } as BuildSFTOpts;
      // Base
      const baseRec = caseToSFT(c, 0, fmtOpts, activeTemplates ? activeTemplates[0]?.id : undefined);
      // Token filter
      if (baseRec.tokenCount! > maxTokens || baseRec.tokenCount! < minTokens) {
        // skip if out of budget
      } else {
        // Dedupe (include format so glimmer/openai both kept)
        const msgKey = `${fmt}::${hashNorm(JSON.stringify(baseRec.messages))}`;
        const idKey = `${fmt}::${baseRec.id}`;
        if (doDedupe && (seenIds.has(idKey) || seenMessages.has(msgKey))) {
          // skip
        } else {
          seenIds.add(idKey);
          seenMessages.add(msgKey);
          out.push({ ...baseRec, format: fmt });
          if (opts.limit && out.length >= opts.limit) break;
        }
      }
      if (opts.limit && out.length >= opts.limit) break;

      // Augment variants
      for (let v = 1; v <= aug; v++) {
        let tplId: string | undefined;
        if (activeTemplates) {
          const idx = Math.floor(rand() * activeTemplates.length);
          tplId = activeTemplates[idx]?.id;
        }
        const rec = caseToSFT(c, v, fmtOpts, tplId);
        if (rec.tokenCount! > maxTokens || rec.tokenCount! < minTokens) continue;
        const msgKey2 = `${fmt}::${hashNorm(JSON.stringify(rec.messages))}`;
        const idKey2 = `${fmt}::${rec.id}`;
        if (doDedupe && (seenIds.has(idKey2) || seenMessages.has(msgKey2))) continue;
        seenIds.add(idKey2);
        seenMessages.add(msgKey2);
        out.push({ ...rec, format: fmt });
        if (opts.limit && out.length >= opts.limit) break;
      }
      if (opts.limit && out.length >= opts.limit) break;
    }
    if (opts.limit && out.length >= opts.limit) break;
  }

  if (shuffle) shuffleInPlace(out, seed);

  return opts.limit ? out.slice(0, opts.limit) : out;
}

// Backwards compat alias for generic datasets
export const buildSFTFromGold = buildSFT;

export function toJsonl(records: SFTRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
}

export function fromJsonl(jsonl: string): SFTRecord[] {
  const out: SFTRecord[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as SFTRecord);
    } catch {}
  }
  return out;
}

export function writeSFTJsonl(records: SFTRecord[], outPath: string): string {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(outPath, lines + (records.length ? "\n" : ""));
  return outPath;
}

export function loadGoldDataset(filePath: string): Array<BaseballCase | GoldRecordLike> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed as GoldRecordLike[];
  if (parsed && Array.isArray(parsed.cases)) return parsed.cases as BaseballCase[];
  if (parsed && Array.isArray(parsed.data)) return parsed.data as GoldRecordLike[];
  throw new Error(`Unsupported gold dataset shape in ${filePath}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): BuildSFTOpts & { dataset: string; out: string } {
  const args = argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx !== -1) return args[idx + 1];
    const pref = args.find((a) => a.startsWith(`${flag}=`));
    if (pref) return pref.split("=").slice(1).join("=");
    return undefined;
  };
  return {
    dataset: get("--dataset") ?? "dataset/v1/baseball.json",
    out: get("--out") ?? "training/datasets/sft.jsonl",
    augment: get("--augment") ? Number(get("--augment")) : get("--aug") ? Number(get("--aug")) : 0,
    format: (get("--format") as BuildSFTOpts["format"]) ?? "glimmer",
    maxTokens: get("--max-tokens") ? Number(get("--max-tokens")) : 2048,
    minTokens: get("--min-tokens") ? Number(get("--min-tokens")) : 4,
    dedupe: get("--dedupe") ? get("--dedupe") !== "false" : true,
    shuffle: args.includes("--shuffle"),
    seed: get("--seed") ? Number(get("--seed")) : 42,
    limit: get("--limit") ? Number(get("--limit")) : undefined,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseCliArgs(process.argv);
  const datasetPath = path.resolve(opts.dataset);
  if (!fs.existsSync(datasetPath)) {
    console.error(`[sft] dataset not found: ${datasetPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(datasetPath, "utf-8");
  const parsed = JSON.parse(raw);
  const cases: Array<BaseballCase | GoldRecordLike> = Array.isArray(parsed) ? parsed : parsed.cases ?? parsed.data ?? [];
  const sft = buildSFT(cases, opts);
  const outPath = path.resolve(opts.out);
  writeSFTJsonl(sft, outPath);
  const glimmer = sft.filter((r) => r.format === "glimmer").length;
  const openai = sft.filter((r) => r.format === "openai").length;
  const avgTok = sft.length ? Math.round(sft.reduce((s, r) => s + (r.tokenCount ?? 0), 0) / sft.length) : 0;
  console.log(`[sft] read ${cases.length} cases -> ${sft.length} records (glimmer=${glimmer} openai=${openai} avgTok=${avgTok})`);
  console.log(`[sft] wrote ${path.relative(process.cwd(), outPath)}`);
}
