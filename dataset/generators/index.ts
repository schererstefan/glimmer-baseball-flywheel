/**
 * Synthetic dataset generators — template + web-search-grounded facts.
 *
 * Production: FactProvider calls web_search / Brave/Tavily and grounds
 * every synthetic answer in retrieved evidence. For CI (no API keys)
 * the provider falls back to deterministic in-memory stubs so buildDataset
 * is hermetic and offline.
 *
 * Exports: generateRosterCases, generateStatsCases, generateHistoryCases,
 *          generateRulesCases, generateTransactionsCases, generateBallparkCases,
 *          generateLiveSeasonCases, generateTriviaCases, buildDataset
 */
import {
  type BaseballCase,
  BaseballCaseSchema,
  type Category,
  type MlbTeam,
} from "../schema.ts";

// ---------------------------------------------------------------------------
// FactProvider
// ---------------------------------------------------------------------------

export type GroundingFact = {
  snippet: string;
  source: string;
  numeric?: number;
  team?: MlbTeam | null;
};

export type FactKind =
  | "roster"
  | "stats"
  | "history"
  | "rules"
  | "transactions"
  | "ballpark"
  | "live_season"
  | "trivia";

export interface FactProvider {
  readonly kind: string;
  getFacts(kind: FactKind, count: number): Promise<GroundingFact[]>;
  getFact(kind: FactKind, key: string): Promise<GroundingFact | null>;
}

// ---------------------------------------------------------------------------
// MockFactProvider — deterministic, zero-network
// ---------------------------------------------------------------------------

const MOCK_SNIPPETS: Record<FactKind, GroundingFact[]> = {
  roster: [
    {
      snippet: "Gunnar Henderson — SS, Baltimore Orioles, #2",
      source: "https://www.mlb.com/orioles/player/gunnar-henderson-680704",
      team: "BAL",
    },
    {
      snippet: "Aaron Judge — RF, New York Yankees, Captain #99",
      source: "https://www.mlb.com/yankees/player/aaron-judge-592450",
      team: "NYY",
    },
    {
      snippet: "Elly De La Cruz — SS, Cincinnati Reds, #44, 67 SB in 2024",
      source: "https://www.mlb.com/reds/player/elly-de-la-cruz-682829",
      team: "CIN",
    },
    {
      snippet: "Bobby Witt Jr. — SS, Kansas City Royals, #7, .332 in 2024",
      source: "https://www.baseball-reference.com/players/w/wittbo02.shtml",
      team: "KC",
    },
    {
      snippet: "José Ramírez — 3B, Cleveland Guardians, #11",
      source: "https://www.mlb.com/guardians/player/jose-ramirez-608070",
      team: "CLE",
    },
    {
      snippet: "Mike Trout — CF, Los Angeles Angels, #27, 3x AL MVP",
      source: "https://www.baseball-reference.com/players/t/troutmi01.shtml",
      team: "LAA",
    },
    {
      snippet: "Ronald Acuña Jr. — RF, Atlanta Braves, #13",
      source: "https://www.mlb.com/braves/player/ronald-acuna-jr-660670",
      team: "ATL",
    },
    {
      snippet: "Vladimir Guerrero Jr. — 1B, Toronto Blue Jays, #27",
      source: "https://www.mlb.com/bluejays/player/vladimir-guerrero-jr-665489",
      team: "TOR",
    },
  ],
  stats: [
    {
      snippet: "Barry Bonds — 73 HR in 2001 (SF Giants) single-season record",
      source: "https://www.baseball-reference.com/leaders/HR_season.shtml",
      numeric: 73,
      team: "SF",
    },
    {
      snippet:
        "Ichiro Suzuki — 262 hits in 2004 (SEA Mariners) single-season record",
      source: "https://www.baseball-reference.com/players/s/suzukic01.shtml",
      numeric: 262,
      team: "SEA",
    },
    {
      snippet:
        "Tarik Skubal — 2.39 ERA in 2024 (DET) led qualified starters, AL Cy Young",
      source: "https://www.baseball-reference.com/players/s/skubata01.shtml",
      numeric: 2.39,
      team: "DET",
    },
    {
      snippet: "Ronald Acuña Jr. — 41 HR, 73 SB in 2023 (ATL) first 40/70",
      source: "https://www.baseball-reference.com/players/a/acunaro01.shtml",
      numeric: 41,
      team: "ATL",
    },
    {
      snippet: "Aaron Judge — 58 HR, 144 RBI, .322 AVG in 2024 (NYY) AL MVP",
      source: "https://www.baseball-reference.com/players/j/judgeaa01.shtml",
      numeric: 58,
      team: "NYY",
    },
    {
      snippet: "Paul Skenes — 11-3, 1.96 ERA in 2024 (PIT) NL Rookie of Year",
      source: "https://www.baseball-reference.com/players/s/skenepa01.shtml",
      numeric: 1.96,
      team: "PIT",
    },
    {
      snippet: "Bobby Witt Jr. — .332 AVG, 32 HR in 2024 (KC)",
      source: "https://www.baseball-reference.com/players/w/wittbo02.shtml",
      numeric: 0.332,
      team: "KC",
    },
    {
      snippet: "Luis Arraez — .354 AVG in 2023 (MIA) NL batting title",
      source: "https://www.baseball-reference.com/players/a/arraelu01.shtml",
      numeric: 0.354,
      team: "MIA",
    },
  ],
  history: [
    {
      snippet: "2024 World Series: Dodgers defeated Yankees 4-1",
      source: "https://en.wikipedia.org/wiki/2024_World_Series",
      team: "LAD",
    },
    {
      snippet:
        "Chicago Cubs beat Cleveland Indians 4-3 in 2016 World Series, ending 108-year drought",
      source: "https://en.wikipedia.org/wiki/2016_World_Series",
      team: "CHC",
    },
    {
      snippet:
        "Washington Nationals beat Houston Astros 4-3 in 2019 World Series (road team won every game)",
      source: "https://en.wikipedia.org/wiki/2019_World_Series",
      team: "WSH",
    },
    {
      snippet:
        "Chicago White Sox swept Houston Astros 4-0 in 2005 World Series",
      source: "https://en.wikipedia.org/wiki/2005_World_Series",
      team: "CHW",
    },
    {
      snippet:
        "St. Louis Cardinals have 11 World Series titles, second to Yankees 27",
      source: "https://en.wikipedia.org/wiki/List_of_World_Series_champions",
      team: "STL",
    },
    {
      snippet:
        "Jackie Robinson broke color barrier April 15, 1947 with Brooklyn Dodgers",
      source: "https://en.wikipedia.org/wiki/Jackie_Robinson",
      team: "LAD",
    },
  ],
  rules: [
    {
      snippet:
        "MLB pitch clock: 15 seconds bases empty, 18 seconds with runners on (2024)",
      source: "https://www.mlb.com/news/mlb-rules-changes-2024-pitch-clock",
      team: null,
    },
    {
      snippet: "Pitcher's rubber to home plate is 60 feet, 6 inches",
      source: "https://www.mlb.com/glossary/rules/pitchers-mound",
      team: null,
    },
    {
      snippet:
        "3 strikes is a strikeout; 4 balls is a walk; 3 outs per half-inning",
      source: "https://www.mlb.com/glossary/rules/strikeout",
      team: null,
    },
    {
      snippet:
        "Automatic runner (ghost runner / Manfred Man) starts on second base each extra inning since 2020 (permanent 2023)",
      source: "https://www.mlb.com/news/mlb-extra-inning-ghost-runner-rule",
      team: null,
    },
  ],
  transactions: [
    {
      snippet:
        "Juan Soto signed 15yr/$765M with Mets Dec 2024 (largest in sports)",
      source: "https://www.mlb.com/news/juan-soto-mets-contract",
      team: "NYM",
    },
    {
      snippet:
        "Shohei Ohtani signed 10yr/$700M with Dodgers Dec 2023 ($680M deferred)",
      source: "https://www.mlb.com/news/shohei-ohtani-dodgers-contract-700m",
      team: "LAD",
    },
    {
      snippet: "Corbin Burnes traded from Brewers to Orioles Feb 1, 2024",
      source: "https://www.mlb.com/news/corbin-burnes-trade-orioles-brewers",
      team: "MIL",
    },
    {
      snippet: "Josh Hader traded from Brewers to Padres Aug 1, 2022",
      source: "https://www.mlb.com/news/josh-hader-trade-padres-brewers-2022",
      team: "SD",
    },
    {
      snippet: "Justin Verlander traded from Mets to Astros Aug 1, 2023",
      source:
        "https://www.mlb.com/news/justin-verlander-trade-mets-astros-2023",
      team: "HOU",
    },
  ],
  ballpark: [
    {
      snippet:
        "Coors Field, Colorado Rockies — mile high (5,280 ft), most hitter-friendly",
      source: "https://en.wikipedia.org/wiki/Coors_Field",
      team: "COL",
    },
    {
      snippet: "PNC Park, Pittsburgh Pirates — on Allegheny River, opened 2001",
      source: "https://en.wikipedia.org/wiki/PNC_Park",
      team: "PIT",
    },
    {
      snippet: "Fenway Park, Boston Red Sox — Green Monster 37' left wall",
      source: "https://en.wikipedia.org/wiki/Fenway_Park",
      team: "BOS",
    },
    {
      snippet:
        "Chase Field, Arizona Diamondbacks — retractable roof + pool in RF",
      source: "https://en.wikipedia.org/wiki/Chase_Field",
      team: "ARI",
    },
    {
      snippet:
        "Tropicana Field, Tampa Bay Rays — fixed dome with catwalks, opened 1990",
      source: "https://en.wikipedia.org/wiki/Tropicana_Field",
      team: "TB",
    },
    {
      snippet: "Oracle Park, San Francisco Giants — McCovey Cove splash hits",
      source: "https://en.wikipedia.org/wiki/Oracle_Park",
      team: "SF",
    },
    {
      snippet: "Target Field, Minnesota Twins — open-air, opened 2010",
      source: "https://en.wikipedia.org/wiki/Target_Field",
      team: "MIN",
    },
  ],
  live_season: [
    {
      snippet: "Philadelphia Phillies won NL East 2024 at 95-67",
      source: "https://www.mlb.com/standings/2024/regular-season",
      team: "PHI",
    },
    {
      snippet:
        "Detroit Tigers went 86-76 in 2024, swept Astros 2-0 in AL Wild Card",
      source: "https://en.wikipedia.org/wiki/2024_Detroit_Tigers_season",
      team: "DET",
    },
    {
      snippet: "Mason Miller was Athletics' lone 2024 AL All-Star (closer)",
      source: "https://www.mlb.com/news/2024-all-star-rosters",
      team: "OAK",
    },
    {
      snippet: "Carlos Correa was Twins' All-Star SS in 2024",
      source: "https://www.mlb.com/news/2024-all-star-rosters-twins",
      team: "MIN",
    },
    {
      snippet: "Vladimir Guerrero Jr. was Blue Jays' 2024 All-Star 1B (30 HR)",
      source: "https://www.mlb.com/bluejays/player/vladimir-guerrero-jr-665489",
      team: "TOR",
    },
  ],
  trivia: [
    {
      snippet: "Rickey Henderson holds career SB record 1,406",
      source:
        "https://en.wikipedia.org/wiki/List_of_Major_League_Baseball_career_stolen_bases_leaders",
      numeric: 1406,
      team: "OAK",
    },
    {
      snippet: "Nolan Ryan holds 7 no-hitters and 5,714 strikeouts",
      source: "https://en.wikipedia.org/wiki/Nolan_Ryan",
      numeric: 7,
      team: "TEX",
    },
    {
      snippet: "Mendoza Line is .200 batting average, named for Mario Mendoza",
      source: "https://en.wikipedia.org/wiki/Mendoza_Line",
      numeric: 0.2,
      team: null,
    },
    {
      snippet:
        "Wyatt Langford hit for cycle June 30, 2024 vs Orioles (first Rangers rookie)",
      source: "https://www.mlb.com/news/wyatt-langford-hits-for-cycle-2024",
      team: "TEX",
    },
    {
      snippet: "Cal Ripken Jr. played 2,632 consecutive games (Iron Man)",
      source: "https://en.wikipedia.org/wiki/Cal_Ripken_Jr.",
      numeric: 2632,
      team: "BAL",
    },
  ],
};

export class MockFactProvider implements FactProvider {
  readonly kind = "mock";
  private idx: Record<FactKind, number> = {
    roster: 0,
    stats: 0,
    history: 0,
    rules: 0,
    transactions: 0,
    ballpark: 0,
    live_season: 0,
    trivia: 0,
  };
  async getFacts(kind: FactKind, count: number): Promise<GroundingFact[]> {
    const pool = MOCK_SNIPPETS[kind] ?? [];
    const out: GroundingFact[] = [];
    for (let i = 0; i < count; i++) {
      const entry = pool[(this.idx[kind] + i) % pool.length];
      if (!entry) continue;
      out.push({ ...entry });
    }
    this.idx[kind] = (this.idx[kind] + count) % Math.max(1, pool.length);
    return out;
  }
  async getFact(kind: FactKind, key: string): Promise<GroundingFact | null> {
    const pool = MOCK_SNIPPETS[kind] ?? [];
    const lower = key.toLowerCase();
    const hit = pool.find(
      (p) =>
        p.snippet.toLowerCase().includes(lower) ||
        p.team?.toLowerCase() === lower,
    );
    if (hit) return { ...hit };
    return pool[0] ? { ...pool[0] } : null;
  }
}

// ---------------------------------------------------------------------------
// RNG — deterministic xor-shift
// ---------------------------------------------------------------------------

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

type Template = {
  category: Category;
  difficulty: "easy" | "medium" | "hard" | "expert";
  freshness: "static" | "seasonal" | "live";
  tags: string[];
  expected_tools: string[];
  question: (f: GroundingFact) => string;
  answer: (f: GroundingFact) => string;
  alternates?: (f: GroundingFact) => string[];
};

const ROSTER_TEMPLATES: Template[] = [
  {
    category: "roster",
    difficulty: "easy",
    freshness: "seasonal",
    tags: ["roster", "position"],
    expected_tools: ["web_search", "baseball_lookup"],
    question: (f) =>
      `Which team does ${f.snippet.split(" — ")[0] ?? f.snippet} play for and what position does he play?`,
    answer: (f) => f.snippet,
  },
  {
    category: "roster",
    difficulty: "medium",
    freshness: "seasonal",
    tags: ["roster", "number"],
    expected_tools: ["baseball_lookup"],
    question: (f) =>
      `What jersey number is associated with the player described as "${f.snippet}"?`,
    answer: (f) => f.snippet,
  },
];

const STATS_TEMPLATES: Template[] = [
  {
    category: "stats",
    difficulty: "hard",
    freshness: "seasonal",
    tags: ["stats", "record"],
    expected_tools: ["web_search"],
    question: (f) =>
      `What MLB statistic is described here: "${f.snippet}"? Provide player, value and team/year.`,
    answer: (f) => f.snippet,
  },
  {
    category: "stats",
    difficulty: "medium",
    freshness: "static",
    tags: ["stats", "leader"],
    expected_tools: ["web_search", "baseball_lookup"],
    question: (f) =>
      `Who holds the record described in "${f.snippet}" and what is the numeric value?`,
    answer: (f) => f.snippet,
  },
];

const HISTORY_TEMPLATES: Template[] = [
  {
    category: "history",
    difficulty: "medium",
    freshness: "static",
    tags: ["history", "world_series"],
    expected_tools: ["web_search"],
    question: (f) =>
      `Describe this World Series outcome: "${f.snippet}". Include teams, score and note.`,
    answer: (f) => f.snippet,
  },
  {
    category: "history",
    difficulty: "easy",
    freshness: "static",
    tags: ["history"],
    expected_tools: ["web_search"],
    question: (f) =>
      `What historical MLB event is described by: "${f.snippet}"?`,
    answer: (f) => f.snippet,
  },
];

const RULES_TEMPLATES: Template[] = [
  {
    category: "rules",
    difficulty: "easy",
    freshness: "static",
    tags: ["rules", "basics"],
    expected_tools: [],
    question: (f) =>
      `What MLB rule is stated here: "${f.snippet}"? Restate concisely.`,
    answer: (f) => f.snippet,
  },
];

const TRANSACTIONS_TEMPLATES: Template[] = [
  {
    category: "transactions",
    difficulty: "medium",
    freshness: "static",
    tags: ["transactions", "trade"],
    expected_tools: ["web_search"],
    question: (f) =>
      `What MLB transaction is described here: "${f.snippet}"? Include teams, player and date/terms.`,
    answer: (f) => f.snippet,
  },
];

const BALLPARK_TEMPLATES: Template[] = [
  {
    category: "ballpark",
    difficulty: "easy",
    freshness: "static",
    tags: ["ballpark", "stadium"],
    expected_tools: ["web_search"],
    question: (f) => `Which ballpark is described: "${f.snippet}"?`,
    answer: (f) => f.snippet,
  },
];

const LIVE_TEMPLATES: Template[] = [
  {
    category: "live_season",
    difficulty: "medium",
    freshness: "live",
    tags: ["live", "standings"],
    expected_tools: ["web_search"],
    question: (f) =>
      `As of the most recent completed season, what fact is given here: "${f.snippet}"? Cite the source.`,
    answer: (f) => f.snippet,
  },
];

const TRIVIA_TEMPLATES: Template[] = [
  {
    category: "trivia",
    difficulty: "hard",
    freshness: "static",
    tags: ["trivia", "records"],
    expected_tools: ["web_search"],
    question: (f) =>
      `Answer this baseball trivia: ${f.snippet.split(" — ")[0] ?? f.snippet}. Provide the record/definition and value.`,
    answer: (f) => f.snippet,
  },
];

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

function buildFromTemplates(
  facts: GroundingFact[],
  templates: Template[],
  rng: () => number,
  startIdx: number,
  count: number,
): BaseballCase[] {
  const out: BaseballCase[] = [];
  for (let i = 0; i < count; i++) {
    const fact = facts[i % facts.length];
    if (!fact) continue;
    const tpl = pick(templates, rng);
    const q = tpl.question(fact);
    const a = tpl.answer(fact);
    const idBase = `bb_${tpl.category}_${slug(fact.snippet).slice(0, 24)}_${String(startIdx + i).padStart(3, "0")}`;
    const must = fact.snippet.split(" ").slice(0, 2).join(" ").trim()
      ? [fact.snippet.split(" ").slice(0, 2).join(" ")]
      : [];
    const raw: BaseballCase = {
      id: idBase.replace(/[^a-z0-9_]/g, "_").slice(0, 48),
      question: q,
      answer: a,
      alternates: tpl.alternates ? tpl.alternates(fact) : [],
      category: tpl.category,
      team: (fact.team as MlbTeam | null) ?? null,
      difficulty: tpl.difficulty as unknown as BaseballCase["difficulty"],
      freshness: tpl.freshness as unknown as BaseballCase["freshness"],
      gold_sources: [fact.source],
      must_cite: must,
      numeric_answer: typeof fact.numeric === "number" ? fact.numeric : null,
      tolerance:
        typeof fact.numeric === "number"
          ? fact.numeric < 1
            ? 0.005
            : 0
          : null,
      tags: tpl.tags,
      verified_at: new Date().toISOString().slice(0, 10),
      expected_tools: tpl.expected_tools,
      explanation: `Grounded in: ${fact.snippet} — source: ${fact.source}`,
    };
    const parsed = BaseballCaseSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public generators
// ---------------------------------------------------------------------------

export async function generateRosterCases(
  count: number,
  opts: { provider?: FactProvider; rng?: () => number; startIdx?: number } = {},
): Promise<BaseballCase[]> {
  const provider = opts.provider ?? new MockFactProvider();
  const rng = opts.rng ?? makeRng(0xc0ffee);
  const facts = await provider.getFacts("roster", Math.max(count, 8));
  return buildFromTemplates(
    facts,
    ROSTER_TEMPLATES,
    rng,
    opts.startIdx ?? 100,
    count,
  );
}

export async function generateStatsCases(
  count: number,
  opts: { provider?: FactProvider; rng?: () => number; startIdx?: number } = {},
): Promise<BaseballCase[]> {
  const provider = opts.provider ?? new MockFactProvider();
  const rng = opts.rng ?? makeRng(0x5157a75);
  const facts = await provider.getFacts("stats", Math.max(count, 8));
  return buildFromTemplates(
    facts,
    STATS_TEMPLATES,
    rng,
    opts.startIdx ?? 200,
    count,
  );
}

export async function generateHistoryCases(
  count: number,
  opts: { provider?: FactProvider; rng?: () => number; startIdx?: number } = {},
): Promise<BaseballCase[]> {
  const provider = opts.provider ?? new MockFactProvider();
  const rng = opts.rng ?? makeRng(0xb1057);
  const facts = await provider.getFacts("history", Math.max(count, 8));
  return buildFromTemplates(
    facts,
    HISTORY_TEMPLATES,
    rng,
    opts.startIdx ?? 300,
    count,
  );
}

export async function generateRulesCases(
  count: number,
  opts: { provider?: FactProvider; rng?: () => number; startIdx?: number } = {},
): Promise<BaseballCase[]> {
  const provider = opts.provider ?? new MockFactProvider();
  const rng = opts.rng ?? makeRng(0x1337);
  const facts = await provider.getFacts("rules", Math.max(count, 4));
  return buildFromTemplates(
    facts,
    RULES_TEMPLATES,
    rng,
    opts.startIdx ?? 400,
    count,
  );
}

export async function generateTransactionsCases(
  count: number,
  opts: { provider?: FactProvider; rng?: () => number; startIdx?: number } = {},
): Promise<BaseballCase[]> {
  const provider = opts.provider ?? new MockFactProvider();
  const rng = opts.rng ?? makeRng(0x7a5);
  const facts = await provider.getFacts("transactions", Math.max(count, 5));
  return buildFromTemplates(
    facts,
    TRANSACTIONS_TEMPLATES,
    rng,
    opts.startIdx ?? 500,
    count,
  );
}

export async function generateBallparkCases(
  count: number,
  opts: { provider?: FactProvider; rng?: () => number; startIdx?: number } = {},
): Promise<BaseballCase[]> {
  const provider = opts.provider ?? new MockFactProvider();
  const rng = opts.rng ?? makeRng(0xba11);
  const facts = await provider.getFacts("ballpark", Math.max(count, 6));
  return buildFromTemplates(
    facts,
    BALLPARK_TEMPLATES,
    rng,
    opts.startIdx ?? 600,
    count,
  );
}

export async function generateLiveSeasonCases(
  count: number,
  opts: { provider?: FactProvider; rng?: () => number; startIdx?: number } = {},
): Promise<BaseballCase[]> {
  const provider = opts.provider ?? new MockFactProvider();
  const rng = opts.rng ?? makeRng(0x11fe);
  const facts = await provider.getFacts("live_season", Math.max(count, 5));
  return buildFromTemplates(
    facts,
    LIVE_TEMPLATES,
    rng,
    opts.startIdx ?? 700,
    count,
  );
}

export async function generateTriviaCases(
  count: number,
  opts: { provider?: FactProvider; rng?: () => number; startIdx?: number } = {},
): Promise<BaseballCase[]> {
  const provider = opts.provider ?? new MockFactProvider();
  const rng = opts.rng ?? makeRng(0x71a);
  const facts = await provider.getFacts("trivia", Math.max(count, 5));
  return buildFromTemplates(
    facts,
    TRIVIA_TEMPLATES,
    rng,
    opts.startIdx ?? 800,
    count,
  );
}

export const generateLiveCases = generateLiveSeasonCases;

// ---------------------------------------------------------------------------
// buildDataset
// ---------------------------------------------------------------------------

export type BuildDatasetOpts = {
  syntheticPerCategory?: Partial<Record<Category, number>>;
  syntheticTotal?: number;
  provider?: FactProvider;
  seed?: number;
  version?: string;
  source?: string;
  dedupe?: boolean;
  shuffle?: boolean;
};

export async function buildDataset(
  seed: BaseballCase[],
  opts: BuildDatasetOpts = {},
): Promise<{
  manifest: import("../schema.ts").DatasetManifest;
  synthetic: BaseballCase[];
}> {
  seed.forEach((c) => {
    BaseballCaseSchema.parse(c);
  });
  const rng = makeRng(opts.seed ?? 42);
  const provider = opts.provider ?? new MockFactProvider();
  const defaults: Record<Category, number> = {
    roster: 5,
    stats: 5,
    history: 5,
    rules: 2,
    transactions: 4,
    ballpark: 4,
    live_season: 3,
    trivia: 4,
  };
  const perCat: Record<Category, number> = {
    ...defaults,
    ...(opts.syntheticPerCategory ?? {}),
  };
  if (typeof opts.syntheticTotal === "number") {
    const sum = Object.values(defaults).reduce((a, b) => a + b, 0);
    for (const k of Object.keys(perCat) as Category[])
      perCat[k] = Math.max(
        0,
        Math.round((perCat[k] / sum) * opts.syntheticTotal),
      );
  }
  const allSynth: BaseballCase[] = [];
  allSynth.push(
    ...(await generateRosterCases(perCat.roster, {
      provider,
      rng,
      startIdx: 1000,
    })),
  );
  allSynth.push(
    ...(await generateStatsCases(perCat.stats, {
      provider,
      rng,
      startIdx: 2000,
    })),
  );
  allSynth.push(
    ...(await generateHistoryCases(perCat.history, {
      provider,
      rng,
      startIdx: 3000,
    })),
  );
  allSynth.push(
    ...(await generateRulesCases(perCat.rules, {
      provider,
      rng,
      startIdx: 4000,
    })),
  );
  allSynth.push(
    ...(await generateTransactionsCases(perCat.transactions, {
      provider,
      rng,
      startIdx: 5000,
    })),
  );
  allSynth.push(
    ...(await generateBallparkCases(perCat.ballpark, {
      provider,
      rng,
      startIdx: 6000,
    })),
  );
  allSynth.push(
    ...(await generateLiveSeasonCases(perCat.live_season, {
      provider,
      rng,
      startIdx: 7000,
    })),
  );
  allSynth.push(
    ...(await generateTriviaCases(perCat.trivia, {
      provider,
      rng,
      startIdx: 8000,
    })),
  );

  let combined = [...seed, ...allSynth];
  if (opts.dedupe !== false) {
    const seen = new Set<string>();
    const deduped: BaseballCase[] = [];
    for (const c of combined) {
      const key = `${c.question}::${c.answer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (deduped.some((d) => d.id === c.id)) continue;
      deduped.push(c);
    }
    combined = deduped;
  }
  if (opts.shuffle !== false) {
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = combined[i]!;
      combined[i] = combined[j]!;
      combined[j] = tmp;
    }
  }
  const { buildManifest, DatasetManifestSchema } = await import("../schema.ts");
  const manifest = buildManifest(combined, {
    version: opts.version ?? "v1.0.0",
    source: opts.source ?? "curated seed + synthetic (mock-grounded)",
  });
  DatasetManifestSchema.parse(manifest);
  return { manifest, synthetic: allSynth };
}
