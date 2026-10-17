/**
 * Quantiles and Tukey box statistics.
 *
 * Convention: R type 7 (= R's default, NumPy 'linear', Excel QUARTILE.INC / PERCENTILE.INC):
 * h = (n − 1)·p (0-based), Q(p) = x₍⌊h⌋₎ + (h − ⌊h⌋)·(x₍⌊h⌋+1₎ − x₍⌊h⌋₎).
 * Box plots in Excel or TI calculators may use other definitions and can differ slightly.
 */

/** Ascending numeric copy (Float64Array sorts numerically; never the default lexicographic sort). */
export function sortedCopy(values: ArrayLike<number>): Float64Array {
  return Float64Array.from(values).sort()
}

/**
 * Type-7 quantile of ALREADY SORTED (ascending) finite values. NaN for an empty input.
 * `p` outside [0, 1] is a programmer error.
 */
export function quantile7(sorted: ArrayLike<number>, p: number): number {
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantile probability must be in [0, 1], got ${p}`)
  const n = sorted.length
  if (n === 0) return NaN
  if (n === 1) return sorted[0]
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const frac = h - lo
  if (lo >= n - 1) return sorted[n - 1]
  const a = sorted[lo]
  const b = sorted[lo + 1]
  return frac === 0 || a === b ? a : a + frac * (b - a)
}

export interface TukeyStats {
  q1: number
  median: number
  q3: number
  iqr: number
  /** Tukey fences [Q1 − 1.5·IQR, Q3 + 1.5·IQR]: points strictly outside are outlier CANDIDATES. */
  fences: [number, number]
  /** Adjacent values: the most extreme OBSERVED values inside the fences (whisker ends, never a fence). */
  whiskers: [number, number]
}

/**
 * A computed fence read to 15 significant figures, the reading the number formatter shows. Binary noise
 * of q1 − 1.5·IQR (1.1 − 1.5·0.2 = 0.8000000000000002) would otherwise put an observed 0.8 lying ON the
 * fence strictly outside it, although exact decimal arithmetic gives 0.8 and the panel shows "0.80".
 */
function cleanFence(f: number): number {
  return Number.isFinite(f) ? Number(f.toPrecision(15)) : f
}

/**
 * Tukey box statistics of sorted finite values; null when n < 4 (quartiles are not meaningful).
 * The fences are read to 15 significant figures (cleanFence) before classifying observations, so a
 * value on a fence is inside it whatever the binary noise of the subtraction.
 */
export function tukey(sorted: ArrayLike<number>): TukeyStats | null {
  const n = sorted.length
  if (n < 4) return null
  const q1 = quantile7(sorted, 0.25)
  const median = quantile7(sorted, 0.5)
  const q3 = quantile7(sorted, 0.75)
  const iqr = q3 - q1
  const lower = cleanFence(q1 - 1.5 * iqr)
  const upper = cleanFence(q3 + 1.5 * iqr)
  let lo = 0
  while (lo < n - 1 && sorted[lo] < lower) lo++
  let hi = n - 1
  while (hi > 0 && sorted[hi] > upper) hi--
  return { q1, median, q3, iqr, fences: [lower, upper], whiskers: [sorted[lo], sorted[hi]] }
}

/** True when v lies strictly outside the fences. */
export function isOutsideFences(v: number, fences: readonly [number, number]): boolean {
  return v < fences[0] || v > fences[1]
}
