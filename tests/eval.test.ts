import { describe, expect, it } from "vitest";
import { computeMetrics } from "@/src/eval/metrics.ts";
import type { JudgeVerdict } from "@/src/judge/types.ts";
import { buildDPO } from "@/src/training/dpo.ts";
import { buildSFT } from "@/src/training/sft.ts";

function fakeVerdict(
  id: string,
  verdict: JudgeVerdict["verdict"],
  score: number,
): JudgeVerdict {
  return {
    id,
    verdict,
    score,
    confidence: 0.9,
    grounded: verdict !== "incorrect",
    hallucinationDetected: verdict === "incorrect",
    reasoning: `fake ${verdict}`,
    evidence: [
      {
        url: "https://example.com",
        title: "ex",
        snippet: "ex",
        fetchedAt: new Date().toISOString(),
        source: "mock",
      },
    ],
    citations: ["https://example.com"],
    latencyMs: 123,
    judgeModel: "mock/rubric",
    abstained: verdict === "abstain",
  };
}

describe("computeMetrics", () => {
  it("computes accuracy and slices", () => {
    const verdicts = [
      fakeVerdict("a", "correct", 1),
      fakeVerdict("b", "correct", 1),
      fakeVerdict("c", "incorrect", 0),
      fakeVerdict("d", "partial", 0.5),
    ];
    const cases = [
      {
        category: "stats",
        team: "NYY",
        difficulty: "easy",
        freshness: "static",
      },
      {
        category: "stats",
        team: "LAD",
        difficulty: "hard",
        freshness: "seasonal",
      },
      {
        category: "history",
        team: null,
        difficulty: "easy",
        freshness: "static",
      },
      {
        category: "history",
        team: null,
        difficulty: "easy",
        freshness: "static",
      },
    ];
    const m = computeMetrics(verdicts, cases as any);
    expect(m.total).toBe(4);
    expect(m.correct).toBe(2);
    expect(m.accuracy).toBeCloseTo(0.5);
    expect(m.byCategory.stats).toBeDefined();
    expect(m.byDifficulty.easy).toBeDefined();
    expect(m.accuracyCI.length).toBe(2);
  });
});

describe("SFT", () => {
  it("builds records with citations", () => {
    const cases: any[] = [
      {
        id: "bb_test_001",
        question: "Where do Yankees play?",
        answer: "Yankee Stadium",
        alternates: [],
        category: "ballpark",
        team: "NYY",
        difficulty: "easy",
        freshness: "static",
        gold_sources: ["https://en.wikipedia.org/wiki/Yankee_Stadium"],
        must_cite: [],
        numeric_answer: null,
        tolerance: null,
        tags: [],
        verified_at: "2026-08-16",
        expected_tools: [],
        explanation: "In the Bronx",
      },
    ];
    const sft = buildSFT(cases, { augment: 1 });
    expect(sft.length).toBe(2);
    expect(sft[0]!.messages[2]!.content).toContain("Yankee Stadium");
  });
});

describe("DPO", () => {
  it("mines failures into pairs", () => {
    const evalCases: any[] = [
      {
        id: "bb_test_001",
        question: "Who won 2024 WS?",
        goldAnswer: "Dodgers 4-1",
        category: "history",
        team: null,
        difficulty: "easy",
        freshness: "static",
        modelAnswer: "Yankees won",
        verdict: fakeVerdict("bb_test_001", "incorrect", 0),
        gold_sources: [],
      },
    ];
    const pairs = buildDPO(evalCases);
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.chosen).toContain("Dodgers");
    expect(pairs[0]!.rejected).toContain("Yankees");
  });
});
