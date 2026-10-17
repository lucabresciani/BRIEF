/**
 * XY series data: the pairwise analysis sample (x AND y valid, row active) — the only input
 * of fits and replicate bars — plus a figure-only render mask.
 * INVARIANT: the axis scales never change `sample` (same object for the same view, columns, exclusions
 * and filters); a log axis only marks points ≤ 0 as RENDER.logDomain (hidden in the drawing, still
 * analysed, reported as W_LOG_AXIS_HIDDEN by the figure builder).
 */
import { INACTIVE } from '@/domain/model'
import type { ColumnId, Exclusion, Filter, XYSeriesSpec } from '@/domain/model'
import { analysisSample } from './analysisSample'
import { KeyedWeakCache } from './memo'
import { RENDER } from './types'
import type { AnalysisSample, DatasetView, SeriesData } from './types'

const sampleCache = new KeyedWeakCache<
  DatasetView,
  { exclusions: readonly Exclusion[]; filters: readonly Filter[]; sample: AnalysisSample }
>()

/**
 * analysisSample over [x, y]; an active row whose x or y is not a finite number (e.g. a label column
 * mapped to an axis) is invalid. Memoised on the identity of the view, exclusions and filters.
 */
export function pairwiseSample(
  view: DatasetView,
  x: ColumnId,
  y: ColumnId,
  exclusions: readonly Exclusion[],
  filters: readonly Filter[],
): AnalysisSample {
  const hash = `${x}\u0000${y}`
  const hit = sampleCache.get(view, hash)
  if (hit && hit.exclusions === exclusions && hit.filters === filters) return hit.sample
  const base = analysisSample(view, [x, y], exclusions, filters)
  const xv = view.columns.get(x)?.values
  const yv = view.columns.get(y)?.values
  let sample = base
  if (xv && yv) {
    let reason: Uint8Array | null = null
    let moved = 0
    for (let i = 0; i < base.reason.length; i++) {
      if (base.reason[i] === INACTIVE.active && !(Number.isFinite(xv[i]) && Number.isFinite(yv[i]))) {
        reason ??= base.reason.slice()
        reason[i] = INACTIVE.invalid
        moved++
      }
    }
    if (reason)
      sample = {
        rowIds: base.rowIds,
        reason,
        nTotal: base.nTotal,
        nActive: base.nActive - moved,
        counts: { ...base.counts, invalid: base.counts.invalid + moved },
      }
  }
  sampleCache.set(view, hash, { exclusions, filters, sample })
  return sample
}

/** Series arrays aligned with view.rowIds; x and y reuse the parsed columns' arrays by reference. */
export function seriesData(
  spec: XYSeriesSpec,
  view: DatasetView,
  exclusions: readonly Exclusion[],
  filters: readonly Filter[],
  scales: { x: 'linear' | 'log'; y: 'linear' | 'log' },
): SeriesData {
  const n = view.rowIds.length
  const x = view.columns.get(spec.x)?.values ?? new Float64Array(n).fill(NaN)
  const y = view.columns.get(spec.y)?.values ?? new Float64Array(n).fill(NaN)
  const sample = pairwiseSample(view, spec.x, spec.y, exclusions, filters)
  const render = new Uint8Array(n)
  if (scales.x === 'log' || scales.y === 'log') {
    for (let i = 0; i < n; i++) {
      const hideX = scales.x === 'log' && Number.isFinite(x[i]) && x[i] <= 0
      const hideY = scales.y === 'log' && Number.isFinite(y[i]) && y[i] <= 0
      if (hideX || hideY) render[i] = RENDER.logDomain
    }
  }
  return { seriesId: spec.id, datasetId: spec.datasetId, rowIds: view.rowIds, x, y, sample, render }
}
