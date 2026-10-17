/**
 * Test fixtures for the fit display (imported only by *.test.ts[x] files of this folder): real fits of
 * the bundled examples through runFit, and hand-written parameters for the magnitudes the examples do
 * not cover (tiny, large, negative coefficients).
 */
import type { DatasetId, FitId, FitModel, FitSpec, SeriesId } from '@/domain/model'
import type { FitOk, FitParameter, FitResult, SeriesData } from '@/domain/derive/types'
import { runFit } from '@/domain/fit/runFit'

export function seriesData(x: readonly number[], y: readonly number[]): SeriesData {
  const n = x.length
  const ids = Int32Array.from({ length: n }, (_, i) => i)
  return {
    seriesId: 'ser_fixture' as SeriesId,
    datasetId: 'ds_fixture' as DatasetId,
    rowIds: ids,
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    sample: {
      rowIds: ids,
      reason: new Uint8Array(n),
      nTotal: n,
      nActive: n,
      counts: { missing: 0, invalid: 0, excluded: 0, filtered: 0 },
    },
    render: new Uint8Array(n),
  }
}

export const fitSpec = (model: FitModel, seriesId = 'ser_fixture'): FitSpec => ({
  id: 'fit_fixture' as FitId,
  seriesId: seriesId as SeriesId,
  model,
  confidence: 0.95,
  show: { curve: true, confidenceBand: false, predictionBand: false, residuals: false },
  curveRange: { mode: 'data' },
  style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
  perGroup: false,
})

export function asOk(r: FitResult | null): FitOk {
  if (!r || r.status !== 'ok') throw new Error(`expected a fit, got ${r ? r.error.code : 'none'}`)
  return r
}

export function fitOf(
  model: FitModel,
  x: readonly number[],
  y: readonly number[],
  units: { xUnit: string | null; yUnit: string | null } = { xUnit: null, yUnit: null },
): FitOk {
  return asOk(runFit(fitSpec(model), seriesData(x, y), units))
}

/** The data of the bundled examples (src/examples). */
export const OHM_I = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]
export const OHM_V = [0.464, 0.941, 1.402, 1.882, 2.339, 2.808, 3.294, 3.764, 4.241, 4.706]
export const FREE_FALL_T = Array.from({ length: 15 }, (_, i) => Number((0.04 * i).toFixed(2)))
export const FREE_FALL_Y = [
  0.014, 0.03, 0.062, 0.112, 0.175, 0.257, 0.351, 0.467, 0.593, 0.737, 0.906, 1.074, 1.256, 1.468, 1.694,
]
export const COOLING_T = Array.from({ length: 16 }, (_, i) => 2 * i)
export const COOLING_DT = [
  85.2, 80.3, 75.6, 71.7, 67.6, 64.3, 61.1, 58.0, 55.5, 52.6, 50.3, 48.2, 46.3, 44.1, 42.6, 40.8,
].map((T) => Number((T - 22).toFixed(1)))

/** A parameter with a symmetric t-interval (t = 2.2, like df ≈ 11). */
export const param = (
  symbol: string,
  value: number,
  se: number,
  unit: string | null = null,
): FitParameter => ({
  symbol,
  value,
  se,
  ci: [value - 2.2 * se, value + 2.2 * se],
  unit,
})

/** `base` with other parameters, shown in the original form (only params and equation are read). */
export function withParams(base: FitOk, params: FitParameter[], model: FitModel = base.model): FitOk {
  return {
    ...base,
    model,
    params,
    equation: { form: 'original', x0: null, terms: params.map((coef, power) => ({ coef, power })) },
  }
}
