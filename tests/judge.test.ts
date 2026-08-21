import { describe, it, expect } from "vitest";
import { MockRetriever, CachedRetriever } from "@/src/judge/retriever.ts";
import { judgeAnswer } from "@/src/judge/verifier.ts";
import { scoreByCategory, scoreNumeric } from "@/src/judge/rubric.ts";

describe("retriever (mock)", () => {
  it("returns canned evidence for known query", async () => {
    const r = new MockRetriever();
    const hits = await r.search("Where do the Yankees play?");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.url).toContain("Yankee");
  });
  it("cached retriever dedupes and caches", async () => {
    const inner = new MockRetriever();
    const cached = new CachedRetriever(inner, 60000);
    const a = await cached.search("2024 world series");
    const b = await cached.search("2024 world series");
    expect(a).toEqual(b);
  });
});

describe("rubric", () => {
  it("numeric exact pass", () => {
    const r = scoreNumeric(27, 27, 0);
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });
  it("numeric tolerance half pass", () => {
    const r = scoreNumeric(2.39, 2.40, 0.02);
    expect(r.pass).toBe(true);
  });
  it("category history year missing fails", () => {
    const r = scoreByCategory("history", "Dodgers beat Yankees 2024", "Dodgers beat Yankees", [], null, null);
    // strict rubric: missing year is incorrect
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
  });
  it("abstain returns fail", () => {
    const r = scoreByCategory("trivia", "Mendoza Line .200", "I don't know", []);
    expect(r.pass).toBe(false);
  });
});

describe("judgeAnswer (mock)", () => {
  it("judges correct yankee stadium", async () => {
    const v = await judgeAnswer({
      id: "test_001", question: "Where do the Yankees play?", goldAnswer: "Yankee Stadium in the Bronx",
      modelAnswer: "They play at Yankee Stadium in the Bronx, New York.", category: "ballpark",
    }, { mock: true });
    expect(["correct","partial"]).toContain(v.verdict);
    expect(v.evidence.length).toBeGreaterThan(0);
    expect(v.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("detects incorrect world series", async () => {
    const v = await judgeAnswer({
      id: "test_002", question: "Who won 2024 World Series?", goldAnswer: "Los Angeles Dodgers beat Yankees 4-1",
      modelAnswer: "The Yankees won the 2024 World Series", category: "history",
    }, { mock: true });
    expect(v.verdict).toBe("incorrect");
    expect(v.hallucinationDetected).toBe(true);
  });

  it("handles abstain", async () => {
    const v = await judgeAnswer({
      id: "test_003", question: "What was X's WAR in 2024?", goldAnswer: "5.2 WAR",
      modelAnswer: "I don't know", category: "stats",
    }, { mock: true });
    expect(v.verdict).toBe("abstain");
    expect(v.abstained).toBe(true);
  });
});
