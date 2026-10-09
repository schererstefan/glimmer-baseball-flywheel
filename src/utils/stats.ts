export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.max(0, idx)]!;
}

export function wilsonCI(
  successes: number,
  total: number,
  z = 1.96,
): [number, number] {
  if (total === 0) return [0, 0];
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const delta = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return [(centre - delta) / denom, (centre + delta) / denom];
}

export function bootstrapCI(
  scores: number[],
  nBoot = 1000,
  alpha = 0.05,
): [number, number] {
  if (scores.length === 0) return [0, 0];
  const m = mean(scores);
  const boots: number[] = [];
  for (let i = 0; i < nBoot; i++) {
    let s = 0;
    for (let j = 0; j < scores.length; j++)
      s += scores[Math.floor(Math.random() * scores.length)]!;
    boots.push(s / scores.length);
  }
  boots.sort((a, b) => a - b);
  const lo = boots[Math.floor((alpha / 2) * boots.length)] ?? m;
  const hi = boots[Math.floor((1 - alpha / 2) * boots.length)] ?? m;
  return [lo, hi];
}

export function pValueMcNemar(b: number, c: number): number {
  // b = A correct B wrong, c = A wrong B correct
  const n = b + c;
  if (n === 0) return 1;
  // Exact binomial two-sided
  const k = Math.min(b, c);
  let p = 0;
  for (let i = 0; i <= k; i++) p += binom(n, i) * 0.5 ** n;
  return Math.min(1, p * 2);
}

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i;
  return r;
}
