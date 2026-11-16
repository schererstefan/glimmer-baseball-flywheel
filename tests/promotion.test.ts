import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSignificant } from "@/src/flywheel/promotion.ts";

const ORIGINAL_PROMOTION_P = process.env.FLYWHEEL_PROMOTION_P;

beforeEach(() => {
  delete process.env.FLYWHEEL_PROMOTION_P;
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (ORIGINAL_PROMOTION_P === undefined) {
    delete process.env.FLYWHEEL_PROMOTION_P;
  } else {
    process.env.FLYWHEEL_PROMOTION_P = ORIGINAL_PROMOTION_P;
  }
});

describe("isSignificant (flywheel promotion gate)", () => {
  it("promotes on Wilson CI non-overlap at large N (0.45 -> 0.55, N=1000)", () => {
    // wilsonCI(450, 1000) = [0.4194, 0.4810];
    // wilsonCI(550, 1000) = [0.5190, 0.5806]; 0.5190 > 0.4810, so disjoint.
    const result = isSignificant(0.45, 1000, 0.55, 1000);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe(
      "Wilson CI non-overlap: prev [41.9-48.1%] vs next [51.9-58.1%] delta +10.0pp",
    );
  });

  it("promotes on delta >= threshold when CIs overlap (0.45 -> 0.48, N=100)", () => {
    // wilsonCI(45, 100) = [0.3561, 0.5476];
    // wilsonCI(48, 100) = [0.3846, 0.5768]; intervals overlap, so the
    // threshold rule (not CI non-overlap) must decide this promotion.
    const result = isSignificant(0.45, 100, 0.48, 100);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("delta +3.0pp >= threshold 2.0pp");
  });

  it("promotes at the exact 0.02 boundary (0.50 -> 0.52, N=100)", () => {
    // Decimal delta is exactly 0.02 and 0.52 - 0.50 >= 0.02 in binary
    // floating point, so this pins the >= (not >) comparison.
    // wilsonCI(50, 100) = [0.4038, 0.5962];
    // wilsonCI(52, 100) = [0.4232, 0.6154]; intervals overlap.
    const result = isSignificant(0.5, 100, 0.52, 100);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("delta +2.0pp >= threshold 2.0pp");
  });

  it("holds a small positive delta below threshold (0.45 -> 0.46, N=100)", () => {
    // wilsonCI(45, 100) = [0.3561, 0.5476];
    // wilsonCI(46, 100) = [0.3656, 0.5574]; intervals overlap, delta +1pp.
    const result = isSignificant(0.45, 100, 0.46, 100);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe(
      "improvement +1.0pp but below promotion threshold; keeping candidate as data",
    );
    expect(result.reason).toContain("below promotion threshold");
    expect(result.reason).toContain("keeping candidate as data");
  });

  it("holds on zero delta (0.45 -> 0.45, N=100)", () => {
    const result = isSignificant(0.45, 100, 0.45, 100);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("no improvement: delta 0.0pp");
  });

  it("holds on negative delta (0.47 -> 0.45, N=100)", () => {
    const result = isSignificant(0.47, 100, 0.45, 100);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("no improvement: delta -2.0pp");
  });

  it("edge prevN=0: collapses prev CI to [0,0] and promotes via CI (0.45/0 -> 0.47/100)", () => {
    // wilsonCI returns [0, 0] at total 0, so nextCI[0] (0.3751) > prevCI[1] (0).
    const result = isSignificant(0.45, 0, 0.47, 100);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe(
      "Wilson CI non-overlap: prev [0.0-0.0%] vs next [37.5-56.7%] delta +2.0pp",
    );
  });

  it("edge prevN=0: promotes even a +1pp delta via CI (0.45/0 -> 0.46/100)", () => {
    // Delta is below the 0.02 threshold, but prevCI [0, 0] makes any
    // positive nextCI lower bound count as non-overlap.
    const result = isSignificant(0.45, 0, 0.46, 100);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe(
      "Wilson CI non-overlap: prev [0.0-0.0%] vs next [36.6-55.7%] delta +1.0pp",
    );
  });

  it("edge nextN=0: collapses next CI to [0,0] but threshold promotes (0.45/100 -> 0.99/0)", () => {
    // nextCI [0, 0] cannot non-overlap, yet delta +54pp still clears 0.02.
    const result = isSignificant(0.45, 100, 0.99, 0);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("delta +54.0pp >= threshold 2.0pp");
  });

  it("edge prevN=0 and nextN=0: holds a nominal +2pp (0.45 -> 0.47, both N=0)", () => {
    // Both CIs are [0, 0], so 0 > 0 is false. The binary delta
    // 0.47 - 0.45 = 0.019999... is also below 0.02 even though the
    // formatted reason rounds it to +2.0pp; the unmodified logic holds.
    const result = isSignificant(0.45, 0, 0.47, 0);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe(
      "improvement +2.0pp but below promotion threshold; keeping candidate as data",
    );
  });

  it("edge prevN=0 and nextN=0: promotes a +3pp delta via threshold (0.45 -> 0.48, both N=0)", () => {
    const result = isSignificant(0.45, 0, 0.48, 0);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("delta +3.0pp >= threshold 2.0pp");
  });

  it("edge N=1: rounds both accuracies to 0 successes and holds (0.45 -> 0.47, N=1)", () => {
    // Math.round(0.45 * 1) = 0 and Math.round(0.47 * 1) = 0, so both sides
    // use wilsonCI(0, 1) = [0, 0.7935] and cannot non-overlap.
    const result = isSignificant(0.45, 1, 0.47, 1);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe(
      "improvement +2.0pp but below promotion threshold; keeping candidate as data",
    );
  });

  it("edge N=1: promotes 0 -> 1 via threshold (N=1)", () => {
    // wilsonCI(0, 1) = [0, 0.7935]; wilsonCI(1, 1) = [0.2065, 1].
    // Intervals overlap, so the +100pp threshold rule decides.
    const result = isSignificant(0, 1, 1, 1);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("delta +100.0pp >= threshold 2.0pp");
  });

  it("edge N=1: holds 0 -> 0 with no improvement (N=1)", () => {
    const result = isSignificant(0, 1, 0, 1);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("no improvement: delta 0.0pp");
  });

  it("holds +3pp when FLYWHEEL_PROMOTION_P=0.05 raises the threshold (0.45 -> 0.48, N=100)", () => {
    // CIs overlap at N=100, so only the threshold decides. The env var is
    // read at call time: the same inputs promote by default, then hold.
    expect(isSignificant(0.45, 100, 0.48, 100).promoted).toBe(true);
    vi.stubEnv("FLYWHEEL_PROMOTION_P", "0.05");
    const result = isSignificant(0.45, 100, 0.48, 100);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe(
      "improvement +3.0pp but below promotion threshold; keeping candidate as data",
    );
  });

  it("promotes +1pp when FLYWHEEL_PROMOTION_P=0.005 lowers the threshold (0.45 -> 0.46, N=100)", () => {
    // CIs overlap at N=100, so only the threshold decides.
    expect(isSignificant(0.45, 100, 0.46, 100).promoted).toBe(false);
    vi.stubEnv("FLYWHEEL_PROMOTION_P", "0.005");
    const result = isSignificant(0.45, 100, 0.46, 100);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("delta +1.0pp >= threshold 0.5pp");
  });

  // prevN semantics pin: the caller-supplied prevN alone decides these
  // outcomes. Note the call site in orchestrator.ts:179-182 (marked
  // "approx"): prevN is manifest.cases.length when state.history is
  // non-empty, else run.metrics.total. Changing that call site changes
  // which of the pinned outcomes below the flywheel would produce.
  it("prevN decides promotion: same accuracies hold with small prevN but promote via CI with large prevN (0.45 -> 0.468, nextN=50000)", () => {
    // Identical accuracies and identical nextN; only prevN differs.
    // Small prevN: prevCI [0.3561, 0.5476] overlaps nextCI [0.4636, 0.4724].
    // Large prevN: prevCI [0.4456, 0.4544]; 0.4636 > 0.4544, so disjoint.
    // Delta +1.8pp is below 0.02, so CI non-overlap alone flips the result.
    const smallPrevN = isSignificant(0.45, 100, 0.468, 50000);
    expect(smallPrevN.promoted).toBe(false);
    expect(smallPrevN.reason).toBe(
      "improvement +1.8pp but below promotion threshold; keeping candidate as data",
    );
    const largePrevN = isSignificant(0.45, 50000, 0.468, 50000);
    expect(largePrevN.promoted).toBe(true);
    expect(largePrevN.reason).toBe(
      "Wilson CI non-overlap: prev [44.6-45.4%] vs next [46.4-47.2%] delta +1.8pp",
    );
  });

  it("prevN decides the promotion reason: threshold-only with tiny prevN vs CI non-overlap with large prevN (0.45 -> 0.55, nextN=1000)", () => {
    // Math.round(0.45 * 10) = 5, so prevCI is wilsonCI(5, 10) =
    // [0.2366, 0.7634], which overlaps nextCI [0.5190, 0.5806]; only the
    // threshold can promote. With prevN=1000 the CIs are disjoint.
    const smallPrevN = isSignificant(0.45, 10, 0.55, 1000);
    expect(smallPrevN.promoted).toBe(true);
    expect(smallPrevN.reason).toBe("delta +10.0pp >= threshold 2.0pp");
    const largePrevN = isSignificant(0.45, 1000, 0.55, 1000);
    expect(largePrevN.promoted).toBe(true);
    expect(largePrevN.reason).toBe(
      "Wilson CI non-overlap: prev [41.9-48.1%] vs next [51.9-58.1%] delta +10.0pp",
    );
  });
});
