import { describe, expect, it } from "vitest";
import { getFlag } from "@/src/utils/args.ts";

describe("getFlag space form", () => {
  it("resolves --provider spark (non-default)", () => {
    expect(getFlag(["--provider", "spark"], "--provider")).toBe("spark");
  });

  it("resolves --limit 5 (non-default)", () => {
    expect(getFlag(["--limit", "5"], "--limit")).toBe("5");
    expect(Number(getFlag(["--limit", "5"], "--limit"))).toBe(5);
  });

  it("resolves --max-iters 7 (non-default)", () => {
    expect(getFlag(["--max-iters", "7"], "--max-iters")).toBe("7");
    expect(Number(getFlag(["--max-iters", "7"], "--max-iters"))).toBe(7);
  });

  it("resolves --n 20 (non-default)", () => {
    expect(getFlag(["--n", "20"], "--n")).toBe("20");
    expect(Number(getFlag(["--n", "20"], "--n"))).toBe(20);
  });

  it("resolves other valued flags in space form", () => {
    expect(getFlag(["--dataset", "data/x.json"], "--dataset")).toBe(
      "data/x.json",
    );
    expect(getFlag(["--model", "muse-glimmer"], "--model")).toBe(
      "muse-glimmer",
    );
    expect(getFlag(["--synthetic-n", "42"], "--synthetic-n")).toBe("42");
    expect(getFlag(["--out", "out.json"], "--out")).toBe("out.json");
  });
});

describe("getFlag = form", () => {
  it("still resolves --provider=spark", () => {
    expect(getFlag(["--provider=spark"], "--provider")).toBe("spark");
  });

  it("still resolves --limit=5, --max-iters=7, --n=20", () => {
    expect(getFlag(["--limit=5"], "--limit")).toBe("5");
    expect(getFlag(["--max-iters=7"], "--max-iters")).toBe("7");
    expect(getFlag(["--n=20"], "--n")).toBe("20");
  });

  it("preserves values containing =", () => {
    expect(getFlag(["--model=a=b"], "--model")).toBe("a=b");
  });
});

describe("getFlag absent", () => {
  it("returns undefined when flag is absent", () => {
    expect(getFlag([], "--provider")).toBeUndefined();
    expect(getFlag(["--mock", "--json"], "--provider")).toBeUndefined();
    expect(getFlag(["--mock"], "--limit")).toBeUndefined();
  });

  it("returns undefined when flag has no value", () => {
    expect(getFlag(["--provider"], "--provider")).toBeUndefined();
    expect(getFlag(["--provider", "--json"], "--provider")).toBeUndefined();
  });
});
