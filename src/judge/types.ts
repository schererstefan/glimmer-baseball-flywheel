export type JudgeInput = {
  id: string;
  question: string;
  // Spec uses `answer`, legacy uses `modelAnswer` — support both (answer is canonical)
  answer?: string;
  goldAnswer: string;
  alternates?: string[];
  modelAnswer: string;
  category: string;
  team?: string | null;
  difficulty?: string;
  numericGold?: number | null;
  tolerance?: number | null;
  goldSources?: string[];
  mustCite?: string[];
};

export type Evidence = {
  url: string;
  title: string;
  snippet: string;
  extracted?: string;
  fetchedAt: string;
  source: "tavily" | "brave" | "serp" | "mock" | "cache" | string;
  score?: number;
};

export type VerdictLabel = "correct" | "partial" | "incorrect" | "abstain";

export type JudgeVerdict = {
  id: string;
  verdict: VerdictLabel;
  score: number;
  confidence: number;
  grounded: boolean;
  hallucinationDetected: boolean;
  reasoning: string;
  evidence: Evidence[];
  citations: string[];
  latencyMs: number;
  judgeModel: string;
  abstained: boolean;
};

export type JudgeOptions = {
  useLLM?: boolean;
  maxEvidence?: number;
  extract?: boolean;
  mock?: boolean;
  // Spec aliases
  retriever?: unknown;
  forceHeuristic?: boolean;
  timeoutMs?: number;
  concurrency?: number;
};
