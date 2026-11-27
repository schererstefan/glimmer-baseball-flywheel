import { wilsonCI } from "@/src/utils/stats.ts";

export function isSignificant(
  prevAcc: number,
  prevN: number,
  nextAcc: number,
  nextN: number,
): { promoted: boolean; reason: string } {
  const delta = nextAcc - prevAcc;
  // Simple rule: +2pp or Wilson CI non-overlap
  const prevCI = wilsonCI(Math.round(prevAcc * prevN), prevN);
  const nextCI = wilsonCI(Math.round(nextAcc * nextN), nextN);
  const nonOverlap = nextCI[0] > prevCI[1];
  const threshold = parseFloat(process.env.FLYWHEEL_PROMOTION_P ?? "0.02");
  if (nonOverlap && delta > 0)
    return {
      promoted: true,
      reason: `Wilson CI non-overlap: prev [${(prevCI[0] * 100).toFixed(1)}-${(prevCI[1] * 100).toFixed(1)}%] vs next [${(nextCI[0] * 100).toFixed(1)}-${(nextCI[1] * 100).toFixed(1)}%] delta +${(delta * 100).toFixed(1)}pp`,
    };
  if (delta >= threshold)
    return {
      promoted: true,
      reason: `delta +${(delta * 100).toFixed(1)}pp >= threshold ${(threshold * 100).toFixed(1)}pp`,
    };
  if (delta > 0)
    return {
      promoted: false,
      reason: `improvement +${(delta * 100).toFixed(1)}pp but below promotion threshold; keeping candidate as data`,
    };
  return {
    promoted: false,
    reason: `no improvement: delta ${(delta * 100).toFixed(1)}pp`,
  };
}
