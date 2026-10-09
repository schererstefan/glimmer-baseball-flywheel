#!/usr/bin/env tsx
import { extractAll, extractBatch } from "./extractor.ts";
import { CachedRetriever, createRetriever, getRetriever } from "./retriever.ts";
import { scoreByCategory } from "./rubric.ts";
import type {
  Evidence,
  JudgeInput,
  JudgeOptions,
  JudgeVerdict,
} from "./types.ts";

export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-sonnet-4-6";

export const JUDGE_SYSTEM_PROMPT =
  "You are a strict baseball fact judge. You receive: question, gold answer, model answer, and web-search evidence.\n\n" +
  "Score:\n" +
  "- correct: gold answer is semantically entailed by model answer AND supported by evidence.\n" +
  "- partial: partially correct but missing a key detail or a minor numeric error within tolerance.\n" +
  "- incorrect: contradicts gold or evidence, or hallucinates unsupported claims.\n" +
  "- abstain: model refused or said 'I don't know' (not incorrect, but not correct).\n\n" +
  "Be strict about:\n" +
  "- Roster: player must exist on the named team/season.\n" +
  "- Stats: numeric within tolerance (±0.001 for BA, ±0.01 for ERA/WHIP, ±0.005 for OPS, exact for counting stats).\n" +
  "- History: year and champion must match.\n" +
  "- Provide reasoning and cite evidence URLs.\n" +
  "Output JSON only: {verdict, confidence, score, reasoning, hallucinationDetected, citations}";

export const BASEBALL_JUDGE_PROMPT = JUDGE_SYSTEM_PROMPT;

export const BASEBALL_FACT_GUIDANCE = `
Baseball judging nuances:
- Roster claims need player on team/season in evidence.
- Counting stats exact, rate stats have tolerances.
- History needs exact year+team.
- Ungrounded correct-looking answers are partial at best.
`.trim();

export function buildJudgePrompt(
  input: JudgeInput,
  evidence: Evidence[],
): string {
  const lines: string[] = [];
  // Support both answer/modelAnswer for spec compat
  const modelAnswer =
    (input as unknown as { modelAnswer?: string; answer?: string })
      .modelAnswer ??
    (input as unknown as { answer?: string }).answer ??
    "";
  lines.push(`Question: ${input.question}`);
  lines.push(
    `Gold answer: ${input.goldAnswer ?? "(no gold — judge against evidence only)"}`,
  );
  lines.push(`Model answer: ${modelAnswer}`);
  lines.push(`Category: ${input.category ?? "general"}`);
  lines.push("");
  if (evidence.length === 0) lines.push("Evidence: (none)");
  else {
    lines.push(`Evidence (${evidence.length} items):`);
    for (let i = 0; i < evidence.length; i++) {
      const e = evidence[i]!;
      const body = (e.extracted ?? e.snippet ?? "")
        .slice(0, 1200)
        .replace(/\s+/g, " ")
        .trim();
      lines.push(`[${i + 1}] ${e.title} — ${e.url}`);
      lines.push(`    ${body}`);
    }
  }
  lines.push("");
  lines.push(
    "Task: Decide correct|partial|incorrect|abstain. Return JSON only.",
  );
  return lines.join("\n");
}

function normalizeInput(inp: JudgeInput): JudgeInput {
  const raw = inp as unknown as Record<string, unknown>;
  // If caller used spec `answer` but not legacy `modelAnswer`, copy over
  if (!raw["modelAnswer"] && raw["answer"]) raw["modelAnswer"] = raw["answer"];
  if (!raw["answer"] && raw["modelAnswer"]) raw["answer"] = raw["modelAnswer"];
  return inp;
}

function isAbstain(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.length < 5 ||
    t.includes("i don't know") ||
    t.includes("i do not know") ||
    t.includes("i'm not sure") ||
    t.includes("cannot answer")
  );
}

async function llmAdjudicate(
  inp: JudgeInput,
  evidence: Evidence[],
): Promise<{
  verdict: JudgeVerdict["verdict"];
  confidence: number;
  reasoning: string;
  hallucination: boolean;
} | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const evBlock = evidence
      .slice(0, 5)
      .map(
        (e, i) =>
          `[${i + 1}] ${e.title} — ${e.url}\n${(e.extracted ?? e.snippet).slice(0, 600)}`,
      )
      .join("\n\n");
    const prompt = `You are a strict baseball fact judge. Evidence has been retrieved via web search.

QUESTION: ${inp.question}
GOLD ANSWER: ${inp.goldAnswer}
ALTERNATES: ${(inp.alternates ?? []).join(" | ")}
MODEL ANSWER: ${inp.modelAnswer}
CATEGORY: ${inp.category}
EVIDENCE:
${evBlock}

Task: Decide verdict = correct|partial|incorrect|abstain. Check if model answer is entailed by gold and supported by evidence. Numeric tolerance: ${inp.tolerance ?? "exact"}.

Return JSON only: {"verdict":"correct|partial|incorrect|abstain","confidence":0-1,"reasoning":"...","hallucinationDetected":true|false}`;
    const msg = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 600,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as any)?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const j = JSON.parse(jsonMatch[0]);
    const v = j.verdict as JudgeVerdict["verdict"];
    if (!["correct", "partial", "incorrect", "abstain"].includes(v))
      return null;
    return {
      verdict: v,
      confidence: Number(j.confidence ?? 0.8),
      reasoning: String(j.reasoning ?? text).slice(0, 800),
      hallucination: Boolean(j.hallucinationDetected),
    };
  } catch {
    return null;
  }
}

export async function judgeAnswer(
  inp: JudgeInput,
  opts: JudgeOptions = {},
): Promise<JudgeVerdict> {
  inp = normalizeInput(inp);
  const t0 = Date.now();
  const useMock = opts.mock ?? process.env.MOCK_JUDGE === "1";
  // Spec: retriever can be overridden via opts.retriever; use createRetriever when mock not forced
  const baseRetriever = (opts as unknown as { retriever?: unknown })
    .retriever as unknown as
    | { search: (q: string, c?: number) => Promise<Evidence[]> }
    | undefined;
  const retriever = new CachedRetriever(
    (baseRetriever as any) ??
      ((useMock ? getRetriever() : createRetriever()) as any),
  );
  const query = inp.question;
  let evidence: Evidence[] = [];
  try {
    evidence = await retriever.search(query, opts.maxEvidence ?? 5);
    if (opts.extract !== false) evidence = await extractAll(evidence);
  } catch (e) {
    evidence = [
      {
        url: `mock://fallback?q=${encodeURIComponent(query)}`,
        title: "fallback",
        snippet: `fallback: ${e instanceof Error ? e.message : String(e)}`,
        fetchedAt: new Date().toISOString(),
        source: "mock",
      },
    ];
  }
  const abstained = isAbstain(inp.modelAnswer);
  if (abstained) {
    return {
      id: inp.id,
      verdict: "abstain",
      score: 0,
      confidence: 0.95,
      grounded: false,
      hallucinationDetected: false,
      reasoning: "Model abstained (I don't know / empty)",
      evidence,
      citations: [],
      latencyMs: Date.now() - t0,
      judgeModel: "rule/abstain",
      abstained: true,
    };
  }
  const rubric = scoreByCategory(
    inp.category,
    inp.goldAnswer,
    inp.modelAnswer,
    inp.alternates,
    inp.numericGold ?? null,
    inp.tolerance ?? null,
    inp.mustCite,
  );
  let verdict: JudgeVerdict["verdict"] = rubric.pass
    ? rubric.score >= 0.9
      ? "correct"
      : "partial"
    : "incorrect";
  let confidence = rubric.pass ? 0.85 : 0.75;
  let reasoning = `[rubric] ${rubric.reason} score=${rubric.score}`;
  let hallucination = !rubric.pass && inp.modelAnswer.length > 20;
  if (!useMock && opts.useLLM !== false) {
    const llm = await llmAdjudicate(inp, evidence);
    if (llm) {
      verdict = llm.verdict;
      confidence = llm.confidence;
      reasoning = `[llm:${JUDGE_MODEL}] ${llm.reasoning} | [rubric] ${rubric.reason}`;
      hallucination = llm.hallucination;
    }
  }
  const evText = evidence
    .map((e) => `${e.title} ${e.snippet} ${e.extracted ?? ""}`.toLowerCase())
    .join(" || ");
  const goldTokens = inp.goldAnswer
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean)
    .slice(0, 6);
  const grounded =
    goldTokens.filter((t) => t.length > 2).every((t) => evText.includes(t)) ||
    evidence.some((e) => e.source === "tavily" || e.source === "brave");
  const citations = evidence.map((e) => e.url);
  const score = verdict === "correct" ? 1 : verdict === "partial" ? 0.5 : 0;
  return {
    id: inp.id,
    verdict,
    score,
    confidence,
    grounded,
    hallucinationDetected: hallucination,
    reasoning,
    evidence,
    citations,
    latencyMs: Date.now() - t0,
    judgeModel: useMock
      ? "mock/rubric"
      : process.env.ANTHROPIC_API_KEY
        ? JUDGE_MODEL
        : "rubric",
    abstained: false,
  };
}

export async function batchJudge(
  inputs: JudgeInput[],
  opts: JudgeOptions & { concurrency?: number } = {},
  concurrencyOrOpts?: number | JudgeOptions,
): Promise<JudgeVerdict[]> {
  // Handle legacy harness call: batchJudge(inputs, {mock:true}, 4) — third arg is concurrency
  let concurrency =
    (opts as unknown as { concurrency?: number }).concurrency ?? 4;
  if (typeof concurrencyOrOpts === "number") concurrency = concurrencyOrOpts;
  else if (
    typeof concurrencyOrOpts === "object" &&
    concurrencyOrOpts !== null
  ) {
    concurrency =
      (concurrencyOrOpts as unknown as { concurrency?: number }).concurrency ??
      concurrency;
  }
  // Also respect opts param being overloaded
  if (
    typeof (opts as unknown as { concurrency?: number }).concurrency ===
    "number"
  ) {
    concurrency = (opts as unknown as { concurrency?: number }).concurrency!;
  }
  const normalized = inputs.map(normalizeInput);
  const out: JudgeVerdict[] = [];
  for (let i = 0; i < normalized.length; i += concurrency) {
    const chunk = normalized.slice(i, i + concurrency);
    const res = await Promise.all(chunk.map((inp) => judgeAnswer(inp, opts)));
    out.push(...res);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      `judge — web-search grounded verifier\n  pnpm judge --question "Where do Yankees play?" --answer "Yankee Stadium" --gold "Yankee Stadium in the Bronx"\n  MOCK_JUDGE=1 pnpm judge ...`,
    );
    process.exit(0);
  }
  const getArg = (k: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const q = getArg("question") ?? "Where do the Yankees play?";
  const a = getArg("answer") ?? "Yankee Stadium in the Bronx";
  const g = getArg("gold") ?? "Yankee Stadium in the Bronx, New York City";
  judgeAnswer({
    id: "cli_001",
    question: q,
    goldAnswer: g,
    modelAnswer: a,
    category: getArg("category") ?? "ballpark",
  }).then((v) => {
    console.log(JSON.stringify(v, null, 2));
  });
}
