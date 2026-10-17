import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatasetId, FitId, FitModel, FitSpec, SeriesId } from '@/domain/model'
import type { FitOk, FitResult, SeriesData } from '@/domain/derive/types'
import { lre } from '@/test/nist'
import { band, EXP_MAX, predict } from './band'
import { runFit } from './runFit'

function series(x: readonly number[], y: readonly number[]): SeriesData {
  const n = x.length
  const ids = Int32Array.from({ length: n }, (_, i) => i)
  return {
    seriesId: 'ser' as SeriesId,
    datasetId: 'ds' as DatasetId,
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
const spec = (model: FitModel): FitSpec => ({
  id: 'fit' as FitId,
  seriesId: 'ser' as SeriesId,
  model,
  confidence: 0.95,
  show: { curve: true, confidenceBand: true, predictionBand: true, residuals: false },
  curveRange: { mode: 'data' },
  style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
  perGroup: false,
})
const ok = (r: FitResult): FitOk => {
  if (r.status !== 'ok') throw new Error(r.error.code)
  return r
}
const fitOf = (model: FitModel, x: readonly number[], y: readonly number[]) =>
  ok(runFit(spec(model), series(x, y), { xUnit: null, yUnit: null }))

const OHM_I = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]
const OHM_V = [0.464, 0.941, 1.402, 1.882, 2.339, 2.808, 3.294, 3.764, 4.241, 4.706]
const ref = JSON.parse(readFileSync(resolve('tests/fixtures/reference/ohm.json'), 'utf8')).linear as {
  bands: { x: string; yhat: string; confidenceHalfWidth: string; predictionHalfWidth: string }[]
}

describe('band — Ohm (exact oracle)', () => {
  const lin = fitOf({ type: 'linear' }, OHM_I, OHM_V)
  const poly = fitOf({ type: 'polynomial', degree: 1 }, OHM_I, OHM_V)
  const xs = ref.bands.map((b) => Number(b.x))

  it.each([
    ['linear closed form', lin],
    ['polyQR degree 1 (Rᵀw = v₀)', poly],
  ])('%s: pointwise confidence and prediction half-widths', (_name, fit) => {
    const conf = band(fit, xs, 'confidence')
    const pred = band(fit, xs, 'prediction')
    ref.bands.forEach((b, i) => {
      expect(conf.yhat[i]).toBeCloseTo(Number(b.yhat), 13)
      expect(conf.upper[i] - conf.yhat[i]).toBeCloseTo(conf.yhat[i] - conf.lower[i], 14)
      expect(lre((conf.upper[i] - conf.lower[i]) / 2, Number(b.confidenceHalfWidth))).toBeGreaterThan(10)
      expect(lre((pred.upper[i] - pred.lower[i]) / 2, Number(b.predictionHalfWidth))).toBeGreaterThan(10)
    })
  })

  it('Ohm example: reference half-widths inside and beyond the measured range', () => {
    const conf = band(lin, [0, 0.055, 0.1, 0.15], 'confidence')
    const half = conf.upper.map((u, i) => (u - conf.lower[i]) / 2)
    expect(half[0]).toBeCloseTo(0.0107415937, 10)
    expect(half[1]).toBeCloseTo(0.004972391675, 12)
    expect(half[2]).toBeCloseTo(0.009241889814, 12)
    expect(half[3]).toBeCloseTo(0.01718131783, 11)
    const pred = band(lin, [0.055], 'prediction')
    expect((pred.upper[0] - pred.lower[0]) / 2).toBeCloseTo(0.0164915575, 10)
    expect(predict(lin, 0.055)).toBeCloseTo(2.5841, 13)
  })

  it('band at an observation equals t·s·√hᵢᵢ (polynomial basis)', () => {
    const t = Array.from({ length: 15 }, (_, i) => Number((0.04 * i).toFixed(2)))
    const y = [
      0.014, 0.03, 0.062, 0.112, 0.175, 0.257, 0.351, 0.467, 0.593, 0.737, 0.906, 1.074, 1.256, 1.468, 1.694,
    ]
    const quad = fitOf({ type: 'polynomial', degree: 2 }, t, y)
    const b = band(quad, t, 'confidence')
    // hᵢᵢ is the leverage; recompute it from the band: (half/(t·s))² must sum to p = 3.
    let sumH = 0
    for (let i = 0; i < t.length; i++) {
      const half = (b.upper[i] - b.lower[i]) / 2
      sumH += (half / ((quad.provenance.tCritical as number) * quad.s)) ** 2
      expect(b.yhat[i]).toBeCloseTo(y[i] - quad.residuals[i], 14)
    }
    expect(sumH).toBeCloseTo(3, 12)
  })
})

describe('band — no fake bands', () => {
  it('exact fit: no estimable scatter → NaN bounds, the curve is still there', () => {
    const fit = fitOf({ type: 'linear' }, [0, 1, 2, 3], [1, 3, 5, 7])
    const b = band(fit, [0.5, 1.5], 'confidence')
    expect(b.yhat).toEqual([2, 4])
    expect(b.lower.every(Number.isNaN)).toBe(true)
    expect(b.upper.every(Number.isNaN)).toBe(true)
  })
})

describe('predict — log-linear curves stay in log space', () => {
  it('exponential: exp overflow → NaN (curve stops), underflow → 0', () => {
    const x = [0, 1, 2, 3, 4]
    const y = x.map((v, i) => Math.exp(1 + 2 * v) * (1 + (i % 2 ? 0.01 : -0.01)))
    const fit = fitOf({ type: 'exponential' }, x, y)
    expect(predict(fit, 2)).toBeCloseTo(Math.exp(1 + 4), 0)
    const xOver = (EXP_MAX + 1 - (fit.basis.kind === 'logLinear' ? fit.basis.lnA : 0)) / 2
    expect(predict(fit, xOver)).toBeNaN()
    expect(predict(fit, -500)).toBe(0)
  })

  it('power law: x ≤ 0 has no prediction', () => {
    const x = [1, 2, 3, 4, 5]
    const fit = fitOf(
      { type: 'power' },
      x,
      x.map((v, i) => 3 * v ** 1.5 * (1 + (i % 2 ? 0.01 : -0.01))),
    )
    expect(predict(fit, 0)).toBeNaN()
    expect(predict(fit, -1)).toBeNaN()
    expect(predict(fit, 4)).toBeCloseTo(24, 0)
  })
})
