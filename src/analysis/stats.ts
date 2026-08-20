/** Small, dependency-free statistics. Every function ignores nulls and reports its own n. */

export function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? Number.NaN;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Sample standard deviation (n-1). Returns NaN below two observations. */
export function sampleSd(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const m = mean(values);
  let sum = 0;
  for (const v of values) sum += (v - m) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

export function pooledSd(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return Number.NaN;
  const sa = sampleSd(a);
  const sb = sampleSd(b);
  const num = (a.length - 1) * sa ** 2 + (b.length - 1) * sb ** 2;
  return Math.sqrt(num / (a.length + b.length - 2));
}

/**
 * Cohen's d. Positive means `a` is higher than `b`.
 * Convention for reading it: 0.2 small, 0.5 medium, 0.8 large.
 */
export function cohensD(a: number[], b: number[]): number {
  const sd = pooledSd(a, b);
  if (!Number.isFinite(sd) || sd === 0) return Number.NaN;
  return (mean(a) - mean(b)) / sd;
}

/**
 * Where `value` falls inside `population`, 0..100.
 * Uses the midpoint definition so ties do not inflate the result.
 */
export function percentileOf(value: number, population: number[]): number {
  if (population.length === 0) return Number.NaN;
  let below = 0;
  let equal = 0;
  for (const v of population) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return ((below + equal / 2) / population.length) * 100;
}

/** Linear-interpolated quantile, q in 0..1. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const loVal = sorted[lo] ?? Number.NaN;
  if (lo === hi) return loVal;
  const hiVal = sorted[hi] ?? Number.NaN;
  return loVal + (hiVal - loVal) * (pos - lo);
}

/**
 * True when a sample carries no magnitude at all: every value is 0 or 1.
 *
 * The point is that a DECLARATION about Riot's data cannot be checked by the type system, so
 * `benchmark()` checks it against the sample it actually has. A metric declared `magnitude`
 * whose observations are all 0/1 is a flag whatever the catalogue says, and a percentile over
 * it is the number G-009 was written about.
 *
 * Deliberately narrow. It answers "is there any spacing here to take a mean of", not "what
 * kind of variable is this" — a heuristic that guessed at ordinals would fire on turret plates
 * and solo kills, which ARE counts, and a check nobody trusts gets switched off.
 */
export function looksBinary(values: number[]): boolean {
  if (values.length === 0) return false;
  return values.every((v) => v === 0 || v === 1);
}

export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
