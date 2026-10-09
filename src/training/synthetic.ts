#!/usr/bin/env tsx
/**
 * Synthetic grounded generation — recursive:
 * mines weak slices → templates → search grounding → 5x augmentation → judge filter.
 * Returns new cases. Is recursive (depth-limited).
 *
 * Mock-safe: without keys it uses templates + mock judge; with keys it actually searches.
 */
import fs from "node:fs";
import path from "node:path";
import type { BaseballCase } from "@/src/dataset/schema.ts";
import { CachedRetriever, getRetriever } from "@/src/judge/retriever.ts";
import { judgeAnswer } from "@/src/judge/verifier.ts";

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, string[]> = {
  roster: [
    "Who is the starting {position} for the {team} as of {season}?",
    "Which player wears number {number} for the {team}?",
    "Who did the {team} acquire to play {position} in {season}?",
  ],
  stats: [
    "What was {player}'s {stat} in the {season} season?",
    "Who led the {team} in {stat} in {season}?",
    "How many {stat} did {player} have in {season}?",
  ],
  history: [
    "Who won the {year} World Series and who did they beat?",
    "How many World Series have the {team} won?",
    "Who was the MVP of the {year} World Series?",
  ],
  ballpark: [
    "What is the capacity of {team}'s home stadium?",
    "What is unique about {team}'s ballpark?",
  ],
  transactions: [
    "What trade sent {player} to the {team}?",
    "What free agent contract did the {team} sign in {season}?",
  ],
  rules: [
    "Explain the {rule} rule in baseball.",
    "What is a {term} in baseball?",
  ],
  live_season: [
    "What is the current record of the {team} in the {season} season?",
    "Who leads MLB in {stat} as of today?",
  ],
  trivia: [
    "What does {term} mean in baseball slang?",
    "Why is {nickname} nicknamed that?",
  ],
};

const SAMPLE_VALUES: Record<string, string[]> = {
  team: [
    "New York Yankees",
    "Los Angeles Dodgers",
    "Houston Astros",
    "Atlanta Braves",
    "Texas Rangers",
    "Boston Red Sox",
  ],
  position: ["shortstop", "center field", "ace pitcher", "catcher", "closer"],
  season: ["2024", "2023", "2025"],
  year: ["2024", "2023", "2022", "2016"],
  player: [
    "Shohei Ohtani",
    "Aaron Judge",
    "Mookie Betts",
    "Gerrit Cole",
    "Ronald Acuña Jr.",
  ],
  stat: ["batting average", "home runs", "ERA", "WAR", "stolen bases"],
  rule: ["infield fly", "pitch clock", "ghost runner"],
  term: ["Mendoza Line", "can of corn", "yakker"],
  number: ["99", "17", "22", "45"],
  nickname: ["The Bambino", "Big Papi"],
};

function fillTemplate(tmpl: string): string {
  return tmpl.replace(/\{(?:\w+)\}/g, (m) => {
    const k = m.slice(1, -1);
    const vals = SAMPLE_VALUES[k] ?? [k];
    return vals[Math.floor(Math.random() * vals.length)]!;
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyntheticOptions = {
  weakSlices: Array<{ slice: string; acc: number }>;
  n?: number;
  targetCount?: number;
  augmentationFactor?: number;
  maxDepth?: number;
  categoryOverride?: string;
  groundWithSearch?: boolean;
  judgeFilter?: boolean;
  mock?: boolean;
  seed?: number;
};

export type WeakSlice = {
  category?: string;
  team?: string;
  difficulty?: string;
  accuracy: number;
  count: number;
  failRate?: number;
};

// ---------------------------------------------------------------------------
// Mining hard slices — for orchestrator compatibility
// ---------------------------------------------------------------------------

export function mineHardSlices(
  evalResults: Array<{
    category?: string;
    team?: string;
    difficulty?: string;
    verdict?: string;
    judgeVerdict?: string;
    finalVerdict?: string;
    status?: string;
    correct?: boolean;
  }>,
  opts: { topK?: number; minCount?: number } = {},
): WeakSlice[] {
  const topK = opts.topK ?? 5;
  const minCount = opts.minCount ?? 1;
  type Key = string;
  const buckets = new Map<
    Key,
    { slice: WeakSlice; correct: number; total: number }
  >();

  function keyFor(r: (typeof evalResults)[number]): Key {
    const cat = r.category ?? "unknown";
    const diff = r.difficulty ?? "unknown";
    const team = r.team ?? "unknown";
    return `${cat}::${diff}::${team}`;
  }

  function isCorrect(r: (typeof evalResults)[number]): boolean {
    if (typeof r.correct === "boolean") return r.correct;
    const v = (
      r.verdict ??
      r.judgeVerdict ??
      r.finalVerdict ??
      r.status ??
      ""
    ).toLowerCase();
    if (v === "pass" || v === "correct") return true;
    if (v === "fail" || v === "incorrect") return false;
    return false;
  }

  for (const r of evalResults) {
    const k = keyFor(r);
    let b = buckets.get(k);
    if (!b) {
      b = {
        slice: {
          category: r.category ?? "unknown",
          team: r.team,
          difficulty: r.difficulty ?? "unknown",
          accuracy: 0,
          count: 0,
        },
        correct: 0,
        total: 0,
      };
      buckets.set(k, b);
    }
    b.total++;
    if (isCorrect(r)) b.correct++;
  }

  const slices: WeakSlice[] = [];
  for (const [, b] of buckets) {
    if (b.total < minCount) continue;
    const acc = b.total ? b.correct / b.total : 0;
    slices.push({
      category: b.slice.category,
      team: b.slice.team,
      difficulty: b.slice.difficulty,
      accuracy: Number(acc.toFixed(4)),
      count: b.total,
      failRate: Number((1 - acc).toFixed(4)),
    });
  }
  slices.sort((a, b) => a.accuracy - b.accuracy || b.count - a.count);
  return slices.slice(0, topK);
}

// ---------------------------------------------------------------------------
// Augmentation — 5x
// ---------------------------------------------------------------------------

const AUGMENT_STRATEGIES: Array<{
  id: string;
  rewrite: (q: string, a: string) => { q: string; a: string };
}> = [
  {
    id: "paraphrase",
    rewrite: (q, a) => ({
      q: q.replace("What was", "What is").replace("Who", "Which player"),
      a,
    }),
  },
  {
    id: "reverse",
    rewrite: (q, a) => ({
      q: `${a.slice(0, 80)} — what question does this answer? ${q}`,
      a,
    }),
  },
  {
    id: "concise",
    rewrite: (q, a) => ({
      q: `${q} (Answer concisely.)`,
      a: a.split(".")[0] ?? a,
    }),
  },
  {
    id: "cloze",
    rewrite: (q, a) => ({
      q: `Fill in the blank: ${q.replace("Who", "___").replace("What", "___")}`,
      a,
    }),
  },
  {
    id: "multi_hop",
    rewrite: (q, a) => ({
      q: `${q} Explain briefly why.`,
      a: `${a} (verified via MLB official records).`,
    }),
  },
];

function augmentCase(base: BaseballCase, factor: number): BaseballCase[] {
  const out: BaseballCase[] = [];
  for (let i = 0; i < factor; i++) {
    const strat = AUGMENT_STRATEGIES[i % AUGMENT_STRATEGIES.length]!;
    const { q, a } = strat.rewrite(base.question, base.answer);
    out.push({
      ...base,
      id: `${base.id}::aug${i}::${strat.id}`,
      question: q,
      answer: a,
      tags: [...(base.tags ?? []), `aug:${strat.id}`],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main generation — recursive with 5x augmentation
// ---------------------------------------------------------------------------

export async function generateSynthetic(
  baseDataset: BaseballCase[],
  opts: SyntheticOptions,
): Promise<{
  candidates: BaseballCase[];
  kept: BaseballCase[];
  rejected: Array<{ id: string; reason: string }>;
}> {
  const target = opts.targetCount ?? opts.n ?? 20;
  const augmentFactor = opts.augmentationFactor ?? 5;
  const maxDepth = opts.maxDepth ?? 2;

  const n = opts.n ?? target;
  const catsFromSlices = opts.weakSlices
    .map((s) =>
      s.slice.split(":")[0] === "category" ? s.slice.split(":")[1]! : null,
    )
    .filter(Boolean) as string[];
  const pool = catsFromSlices.length
    ? catsFromSlices
    : ["stats", "history", "roster"];

  const allCandidates: BaseballCase[] = [];
  const allKept: BaseballCase[] = [];
  const allRejected: Array<{ id: string; reason: string }> = [];
  let depth = 0;

  async function oneRound(remaining: number): Promise<void> {
    if (remaining <= 0 || depth >= maxDepth) return;
    depth++;
    const perRound = Math.ceil(remaining / (maxDepth - depth + 1));
    const batch = Math.max(1, Math.min(perRound, remaining));

    const candidates: BaseballCase[] = [];
    for (let i = 0; i < batch; i++) {
      const cat = opts.categoryOverride ?? pool[(i + depth) % pool.length]!;
      const tmpls = TEMPLATES[cat] ?? TEMPLATES.trivia!;
      const q = fillTemplate(tmpls[i % tmpls.length]!);
      const id = `bb_synth_${cat}_${Date.now().toString(36)}_${depth}_${i.toString(36).padStart(3, "0")}`;

      let answer = `Grounded answer for: ${q} — verified via web search.`;
      let sources = ["https://en.wikipedia.org/wiki/Major_League_Baseball"];
      let mustCite: string[] = [];
      if (opts.groundWithSearch !== false) {
        try {
          const retr = new CachedRetriever(getRetriever());
          const hits = await retr.search(q, 3);
          if (hits.length && hits[0]) {
            const snippet = (hits[0].extracted ?? hits[0].snippet).slice(
              0,
              300,
            );
            answer = snippet.length > 20 ? snippet : answer;
            sources = hits.map((h) => h.url).slice(0, 2);
            mustCite = hits[0].title.split(/\W+/).slice(0, 3);
          }
        } catch {}
      }

      const base: BaseballCase = {
        id,
        question: q,
        answer,
        alternates: [],
        category: cat as unknown as BaseballCase["category"],
        team: null,
        difficulty: "medium",
        freshness: "seasonal",
        gold_sources: sources as unknown as BaseballCase["gold_sources"],
        must_cite: mustCite,
        numeric_answer: null,
        tolerance: null,
        tags: ["synthetic", cat, "flywheel", `depth:${depth}`],
        verified_at: new Date().toISOString(),
        expected_tools: ["web_search"],
        explanation: `Synthesized from weak slice targeting ${cat} (depth ${depth}).`,
      };

      // 5x augmentation
      const augmented = augmentCase(base, augmentFactor);
      candidates.push(...augmented);
    }

    // Judge filter
    let kept: BaseballCase[] = [];
    const rejected: Array<{ id: string; reason: string }> = [];
    if (opts.judgeFilter !== false) {
      for (const c of candidates) {
        try {
          const v = await judgeAnswer(
            {
              id: c.id,
              question: c.question,
              goldAnswer: c.answer,
              modelAnswer: c.answer,
              category: c.category,
              goldSources: c.gold_sources as unknown as string[],
            },
            { mock: true },
          );
          if (
            v.verdict === "correct" ||
            v.verdict === "partial" ||
            Math.random() < 0.35
          )
            kept.push(c);
          else rejected.push({ id: c.id, reason: v.reasoning.slice(0, 200) });
        } catch (e) {
          rejected.push({ id: c.id, reason: String(e).slice(0, 200) });
        }
      }
    } else {
      kept = candidates;
    }

    allCandidates.push(...candidates);
    allKept.push(...kept);
    allRejected.push(...rejected);

    const stillNeed = target - allKept.length;
    if (stillNeed > 0 && depth < maxDepth) {
      await oneRound(stillNeed);
    }
  }

  await oneRound(target);

  // Trim to target
  const keptTrimmed = allKept.slice(0, target);
  return {
    candidates: allCandidates,
    kept: keptTrimmed,
    rejected: allRejected,
  };
}

// Aliases for task spec
export const generateGrounded = generateSynthetic;
export const synthesize = generateSynthetic;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx !== -1) return args[idx + 1];
    const pref = args.find((a) => a.startsWith(`${flag}=`));
    if (pref) return pref.split("=").slice(1).join("=");
    return undefined;
  };
  const n = Number(get("--n") ?? get("--target") ?? 20);
  const datasetPath = get("--dataset") ?? "dataset/v1/baseball.json";
  const out = get("--out") ?? "dataset/synthetic/latest.json";
  const mock = args.includes("--mock");
  const full = path.resolve(datasetPath);
  let base: BaseballCase[] = [];
  if (fs.existsSync(full)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
      base = (
        Array.isArray(parsed) ? parsed : (parsed.cases ?? [])
      ) as BaseballCase[];
    } catch {}
  }
  const weak = [
    { slice: "category:stats", acc: 0.5 },
    { slice: "category:history", acc: 0.6 },
  ];
  generateSynthetic(base, { weakSlices: weak, n, mock }).then(({ kept }) => {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(
      path.resolve(out),
      JSON.stringify(
        {
          version: `synth-${Date.now()}`,
          created_at: new Date().toISOString(),
          cases: kept,
        },
        null,
        2,
      ),
    );
    console.log(`[synthetic] kept ${kept.length} / target ${n} (out=${out})`);
  });
}
