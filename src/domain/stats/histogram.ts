/**
 * Histogram binning computed by us (never by Plotly, whose own binning drops a maximum that falls on
 * the last edge). Conventions, documented in Methods:
 * - bins are [a, b) except the LAST one, which is [a, b]: the maximum is always counted;
 * - Σ counts = number of finite values given (nothing is dropped; a start above the minimum is
 *   extended downwards by whole bin widths);
 * - auto = max(Sturges, Freedman–Diaconis) bins; Sturges alone when IQR = 0;
 * - auto on quantised data (every value a multiple of a resolution r, e.g. readings to 0.01 s):
 *   the width is snapped to k·r and the edges are offset by r/2, so no observation sits on an edge.
 */
import type { HistogramOptions } from '@/domain/model'
import { quantile7, sortedCopy } from './quantile'

/** Hard cap on the number of bins (a too-small width is widened by whole multiples). */
export const MAX_HISTOGRAM_BINS = 10_000

export interface HistogramResult {
  /** k + 1 increasing edges. */
  edges: number[]
  counts: number[]
  /** Row ids of the observations in each bin (selection mapping). */
  members: number[][]
  /** Nominal bin width (the last edge may absorb floating-point slack). */
  binWidth: number
}

const clean = (v: number) => Number(v.toPrecision(15))

/**
 * Resolution of quantised data: the largest r such that every value is an integer multiple of r
 * (r = g·10^−d, with d ≤ 10 the fewest decimals that represent every value and g the GCD of the
 * integer steps). null when the values are not quantised at ≤ 10 decimals.
 */
export function detectResolution(values: ArrayLike<number>): number | null {
  const n = values.length
  if (n === 0) return null
  for (let d = 0; d <= 10; d++) {
    const p = 10 ** d
    const ints = new Float64Array(n)
    let ok = true
    for (let i = 0; i < n; i++) {
      const s = values[i] * p
      const m = Math.round(s)
      if (!Number.isFinite(s) || Math.abs(m) > Number.MAX_SAFE_INTEGER) return null
      if (Math.abs(s - m) > 1e-9 + 1e-14 * Math.abs(s)) {
        ok = false
        break
      }
      ints[i] = m
    }
    if (!ok) continue
    let lo = ints[0]
    for (let i = 1; i < n; i++) if (ints[i] < lo) lo = ints[i]
    let g = 0
    for (let i = 0; i < n; i++) g = gcd(g, ints[i] - lo)
    return (g === 0 ? 1 : g) / p
  }
  return null
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b > 0) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

/** Sturges' rule: ⌈log₂ n⌉ + 1 bins. */
export function sturgesBins(n: number): number {
  return n <= 1 ? 1 : Math.ceil(Math.log2(n)) + 1
}

interface Layout {
  start: number
  width: number
  k: number
  /** Force the last edge to exactly this value (equal-width bins from min to max). */
  last: number | null
}

/**
 * Bins finite `values` (aligned with `rowIds`; non-finite values are skipped defensively).
 * An empty input gives empty arrays (the caller reports E_HISTOGRAM_NO_DATA).
 */
export function histogram(
  values: ArrayLike<number>,
  rowIds: ArrayLike<number>,
  bins: HistogramOptions['bins'],
): HistogramResult {
  const v: number[] = []
  const ids: number[] = []
  const len = Math.min(values.length, rowIds.length)
  for (let i = 0; i < len; i++) {
    if (Number.isFinite(values[i])) {
      v.push(values[i])
      ids.push(rowIds[i])
    }
  }
  const n = v.length
  if (n === 0) return { edges: [], counts: [], members: [], binWidth: NaN }

  let min = v[0]
  let max = v[0]
  for (let i = 1; i < n; i++) {
    if (v[i] < min) min = v[i]
    if (v[i] > max) max = v[i]
  }

  const layout = chooseLayout(v, min, max, bins)
  const { start, width, k } = layout
  const edges = new Array<number>(k + 1)
  for (let j = 0; j <= k; j++) edges[j] = j === 0 ? start : clean(start + j * width)
  if (layout.last !== null) edges[k] = layout.last
  if (edges[0] > min) edges[0] = min
  if (edges[k] < max) edges[k] = max

  const counts = new Array<number>(k).fill(0)
  const members: number[][] = Array.from({ length: k }, () => [])
  for (let i = 0; i < n; i++) {
    const x = v[i]
    let j = Math.floor((x - start) / width)
    if (!(j >= 0)) j = 0
    if (j > k - 1) j = k - 1
    while (j > 0 && x < edges[j]) j--
    while (j < k - 1 && x >= edges[j + 1]) j++
    counts[j]++
    members[j].push(ids[i])
  }
  return { edges, counts, members, binWidth: width }
}

function chooseLayout(v: number[], min: number, max: number, bins: HistogramOptions['bins']): Layout {
  const range = max - min
  if (bins.mode === 'width' && Number.isFinite(bins.width) && bins.width > 0) {
    return widthLayout(min, max, bins.width, bins.start)
  }
  const r = bins.mode !== 'count' || range === 0 ? detectResolution(v) : null
  if (range === 0) {
    // All values equal: one bin centred on the value.
    const w = r ?? (min !== 0 ? Math.abs(min) * 0.1 : 1)
    return { start: min - w / 2, width: w, k: 1, last: null }
  }
  if (bins.mode === 'count' && Number.isFinite(bins.count)) {
    const k = Math.max(1, Math.min(MAX_HISTOGRAM_BINS, Math.round(bins.count)))
    return { start: min, width: range / k, k, last: max }
  }
  // auto (also the fallback for an invalid count or width)
  const n = v.length
  const sorted = sortedCopy(v)
  const iqr = quantile7(sorted, 0.75) - quantile7(sorted, 0.25)
  let k = sturgesBins(n)
  if (iqr > 0) {
    const hFD = (2 * iqr) / Math.cbrt(n)
    k = Math.max(k, Math.ceil(range / hFD))
  }
  k = Math.min(k, MAX_HISTOGRAM_BINS)
  if (r !== null && r > 0) {
    const width = Math.max(1, Math.round(range / k / r)) * r
    const start = min - r / 2
    let kq = Math.max(1, Math.ceil((max - start) / width))
    if (kq > MAX_HISTOGRAM_BINS) kq = MAX_HISTOGRAM_BINS
    return { start, width: clean(width), k: kq, last: null }
  }
  return { start: min, width: range / k, k, last: max }
}

function widthLayout(min: number, max: number, w: number, start0: number | null): Layout {
  let start = start0 !== null && Number.isFinite(start0) ? start0 : min
  if (start > min) start = start - Math.ceil((start - min) / w) * w
  let width = w
  let k = countFor(max - start, width)
  if (k > MAX_HISTOGRAM_BINS) {
    width = w * Math.ceil(k / MAX_HISTOGRAM_BINS)
    k = countFor(max - start, width)
  }
  return { start, width, k, last: null }
}

/** Bins needed to cover a span; a maximum exactly on an edge closes the last bin (no extra bin). */
function countFor(span: number, width: number): number {
  const q = span / width
  const nearest = Math.round(q)
  if (nearest >= 1 && Math.abs(q - nearest) <= 1e-9 * Math.max(1, q)) return nearest
  return Math.max(1, Math.ceil(q))
}
