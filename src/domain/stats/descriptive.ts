/**
 * Descriptive statistics of one column over the analysed sample.
 *
 * Conventions:
 * - mean: plain left-to-right sum plus one refinement pass m + Σ(x − m)/n;
 * - SD: SAMPLE standard deviation (divisor n − 1), corrected two-pass formula
 *   √((Σd² − (Σd)²/n)/(n − 1)) with d = x − m, power-of-two scaling against overflow/underflow;
 * - SEM = SD/√n; CI of the mean = mean ± t(conf, n − 1)·SEM (t-interval: approximately normal,
 *   independent observations);
 * - quartiles of type 7, Tukey fences 1.5·IQR, whiskers = adjacent observed values.
 * A spread of exactly zero (n ≥ 2 identical values) keeps SD = SEM = 0 and a zero-width CI, the values
 * computed, and is always reported (I_ZERO_SPREAD): it is not an uncertainty of zero.
 */
import { CELL, isMissingStatus } from '@/domain/derive/types'
import type { AnalysisSample, ColumnSummary, DatasetView } from '@/domain/derive/types'
import { INACTIVE, issue } from '@/domain/model'
import type { ColumnId, ConfidenceLevel, Issue, RowId } from '@/domain/model'
import { quantile7, sortedCopy, tukey } from './quantile'
import { tCritical } from './tCritical'

/** Arithmetic mean; NaN for n = 0. */
export function mean(v: ArrayLike<number>): number {
  const n = v.length
  if (n === 0) return NaN
  let s = 0
  for (let i = 0; i < n; i++) s += v[i]
  let m = s / n
  if (Number.isNaN(m)) return m
  if (!Number.isFinite(m)) {
    // The running sum overflowed although the terms may be finite: average the pre-divided terms.
    let t = 0
    for (let i = 0; i < n; i++) t += v[i] / n
    m = t
    if (!Number.isFinite(m)) return m
  }
  let c = 0
  for (let i = 0; i < n; i++) c += v[i] - m
  const refined = m + c / n
  return Number.isFinite(refined) ? refined : m
}

/** Power of two that brings `maxAbs` near 1 when its square could overflow or underflow; else 1. */
function scaleFor(maxAbs: number): number {
  if (maxAbs === 0 || (maxAbs <= 1e150 && maxAbs >= 1e-150)) return 1
  const e = Math.max(-1000, Math.min(1000, -Math.floor(Math.log2(maxAbs))))
  return 2 ** e
}

/** Sample standard deviation (n − 1), two-pass; NaN for n < 2 or non-finite input. */
export function sampleSD(v: ArrayLike<number>): number {
  const n = v.length
  if (n < 2) return NaN
  let maxAbs = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(v[i])
    if (!Number.isFinite(a)) return NaN
    if (a > maxAbs) maxAbs = a
  }
  const s1 = scaleFor(maxAbs)
  let x: ArrayLike<number> = v
  if (s1 !== 1) {
    const scaled = new Float64Array(n)
    for (let i = 0; i < n; i++) scaled[i] = v[i] * s1
    x = scaled
  }
  const m = mean(x)
  let maxDev = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(x[i] - m)
    if (d > maxDev) maxDev = d
  }
  if (maxDev === 0) return 0
  const s2 = scaleFor(maxDev)
  let ss = 0
  let sd = 0
  for (let i = 0; i < n; i++) {
    const d = (x[i] - m) * s2
    ss += d * d
    sd += d
  }
  const variance = (ss - (sd * sd) / n) / (n - 1)
  return Math.sqrt(Math.max(0, variance)) / s2 / s1
}

/** Standard error of the mean SD/√n; NaN when the SD is not defined. */
export function standardError(sd: number, n: number): number {
  return n >= 1 ? sd / Math.sqrt(n) : NaN
}

/** Relative uncertainty of a sample SD, ≈ 1/√(2(n − 1)) under normality, as a rounded percentage. */
export function sdRelativeUncertaintyPct(n: number): number {
  return Math.round(100 / Math.sqrt(2 * (n - 1)))
}

/**
 * I_ZERO_SPREAD for a column: n ≥ 2 values, all identical (SD = 0 exactly; sampleSD is 0 only then).
 * {scope: 'column', n, count: 1}: the message is shared with replicate groups (scope 'groups').
 */
function zeroSpreadColumnIssue(n: number, columnId: ColumnId): Issue {
  return issue('I_ZERO_SPREAD', { scope: 'column', n, count: 1 }, { columnId })
}

/**
 * Summary of one column. Uses the rows with sample.reason === active AND a valid value in this column;
 * the caller computes `sample` for this column alone (column-wise sample, not the pairwise one).
 * Every row is counted exactly once: n + nMissing + nInvalid + nExcluded + nFiltered = sample.nTotal.
 */
export function summarizeColumn(
  view: DatasetView,
  columnId: ColumnId,
  sample: AnalysisSample,
  confidence: ConfidenceLevel = 0.95,
): ColumnSummary {
  const col = view.columns.get(columnId)
  const nRows = sample.reason.length
  const usedIdx: number[] = []
  let nMissing = 0
  let nInvalid = 0
  let nExcluded = 0
  let nFiltered = 0
  for (let i = 0; i < nRows; i++) {
    const status = col ? col.status[i] : CELL.missing
    const reason = sample.reason[i]
    if (isMissingStatus(status)) nMissing++
    else if (status !== CELL.ok || !Number.isFinite(col!.values[i])) nInvalid++
    else if (reason === INACTIVE.active) usedIdx.push(i)
    else if (reason === INACTIVE.missing) nMissing++
    else if (reason === INACTIVE.invalid) nInvalid++
    else if (reason === INACTIVE.excluded) nExcluded++
    else nFiltered++
  }

  const n = usedIdx.length
  const warnings: Issue[] = []
  const base: ColumnSummary = {
    columnId,
    n,
    nMissing,
    nInvalid,
    nExcluded,
    nFiltered,
    mean: null,
    median: null,
    sd: null,
    sem: null,
    ci: null,
    tCritical: null,
    min: null,
    max: null,
    range: null,
    q1: null,
    q3: null,
    iqr: null,
    fences: null,
    whiskers: null,
    outlierCandidates: [],
    warnings,
  }
  if (n === 0 || !col) return base

  const values = new Float64Array(n)
  for (let k = 0; k < n; k++) values[k] = col.values[usedIdx[k]]
  const sorted = sortedCopy(values)
  const m = mean(values)
  base.mean = m
  base.median = quantile7(sorted, 0.5)
  base.min = sorted[0]
  base.max = sorted[n - 1]
  base.range = sorted[n - 1] - sorted[0]

  if (n === 1) {
    warnings.push(issue('I_SINGLE_OBSERVATION', { n }, { columnId }))
  } else {
    const sd = sampleSD(values)
    const sem = standardError(sd, n)
    const t = tCritical(confidence, n - 1)
    base.sd = sd
    base.sem = sem
    base.tCritical = t
    base.ci = [m - t * sem, m + t * sem]
    // A zero SD has no relative uncertainty to quote: I_ZERO_SPREAD replaces W_SMALL_SAMPLE then.
    if (sd === 0) warnings.push(zeroSpreadColumnIssue(n, columnId))
    else if (n < 5)
      warnings.push(issue('W_SMALL_SAMPLE', { pct: sdRelativeUncertaintyPct(n), n }, { columnId }))
  }

  const box = tukey(sorted)
  if (!box) {
    warnings.push(issue('I_QUARTILES_NEED_4', { n }, { columnId }))
    return base
  }
  base.q1 = box.q1
  base.q3 = box.q3
  base.iqr = box.iqr
  base.fences = box.fences
  base.whiskers = box.whiskers
  const outliers: RowId[] = []
  for (let k = 0; k < n; k++) {
    const v = values[k]
    if (v < box.fences[0] || v > box.fences[1]) outliers.push(view.rowIds[usedIdx[k]] as RowId)
  }
  base.outlierCandidates = outliers
  return base
}
