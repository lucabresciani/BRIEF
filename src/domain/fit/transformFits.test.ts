import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatasetId, FitId, FitModel, FitSpec, SeriesId } from '@/domain/model'
import type { FitOk, FitResult, SeriesData } from '@/domain/derive/types'
import { lre } from '@/test/nist'
import { band, predict } from './band'
import { runFit } from './runFit'
import { fitLogLinear, type LogLinearCore } from './transformFits'

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
  show: { curve: true, confidenceBand: true, predictionBand: false, residuals: true },
  curveRange: { mode: 'data' },
  style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
  perGroup: false,
})
const ok = (r: FitResult): FitOk => {
  if (r.status !== 'ok') throw new Error(r.error.code)
  return r
}

const T = Array.from({ length: 16 }, (_, i) => 2 * i)
const DT = [63.2, 58.3, 53.6, 49.7, 45.6, 42.3, 39.1, 36.0, 33.5, 30.6, 28.3, 26.2, 24.3, 22.1, 20.6, 18.8]
const ref = JSON.parse(
  readFileSync(resolve('tests/fixtures/reference/cooling.json'), 'utf8'),
).exponentialDeltaT

describe('exponential (least squares on ln y) — cooling ΔT', () => {
  const fit = ok(runFit(spec({ type: 'exponential' }), series(T, DT), { xUnit: 'min', yUnit: 'K' }))
  const p = Object.fromEntries(fit.params.map((q) => [q.symbol, q]))

  it('ln a, b and their SEs match the exact oracle; R² refers to ln y', () => {
    expect(fit.params.map((q) => q.symbol)).toEqual(['a', 'b', 'ln a'])
    expect(lre(p['ln a'].value, Number(ref.lnA))).toBeGreaterThan(11)
    expect(lre(p['ln a'].se as number, Number(ref.seLnA))).toBeGreaterThan(11)
    expect(lre(p.b.value, Number(ref.b))).toBeGreaterThan(11)
    expect(lre(p.b.se as number, Number(ref.seB))).toBeGreaterThan(11)
    expect(lre(p.b.ci![0], Number(ref.bCI95[0]))).toBeGreaterThan(11)
    expect(lre(p.b.ci![1], Number(ref.bCI95[1]))).toBeGreaterThan(11)
    expect(lre(fit.s, Number(ref.s))).toBeGreaterThan(11)
    expect(lre(fit.r2 as number, Number(ref.r2LnY))).toBeGreaterThan(12)
    expect(fit.r2Of).toBe('lnY')
    expect(fit.df).toBe(14)
    expect(fit.provenance.algorithm).toBe('ols-loglinear@1')
    expect(fit.basis).toMatchObject({ kind: 'logLinear', x: 'identity' })
  })

  it('a = exp(ln a) with the asymmetric CI exp(CI of ln a), never a symmetric ± for a', () => {
    expect(lre(p.a.value, Number(ref.a))).toBeGreaterThan(11)
    expect(p.a.se).toBeNull()
    expect(p.a.note).toBe('asymmetric-ci')
    expect(lre(p.a.ci![0], Number(ref.aCI95[0]))).toBeGreaterThan(10)
    expect(lre(p.a.ci![1], Number(ref.aCI95[1]))).toBeGreaterThan(10)
    expect(p.a.ci![1] - p.a.value).toBeGreaterThan(p.a.value - p.a.ci![0])
    expect(p.a.unit).toBe('K')
    expect(p.b.unit).toBe('1/min')
    expect(p['ln a'].unit).toBeNull()
    // No symmetric covariance for a; (b, ln a) block is the linear-fit covariance.
    expect(fit.covariance[0].every(Number.isNaN)).toBe(true)
    expect(Math.sqrt(fit.covariance[1][1])).toBeCloseTo(p.b.se as number, 15)
    expect(Math.sqrt(fit.covariance[2][2])).toBeCloseTo(p['ln a'].se as number, 15)
  })

  it('residuals are ln y − ln ŷ; the curve is exp(ln a + b·x)', () => {
    fit.residuals.forEach((r, i) => expect(r).toBeCloseTo(Math.log(DT[i]) - Math.log(predict(fit, T[i])), 13))
    expect(predict(fit, 0)).toBeCloseTo(p.a.value, 11)
    expect(fit.uComparison).toBeNull()
  })

  it('bands are computed in ln space and exponentiated: asymmetric in y', () => {
    const b = band(fit, [0, 15, 30], 'confidence')
    for (let i = 0; i < 3; i++) {
      expect(b.upper[i] - b.yhat[i]).toBeGreaterThan(b.yhat[i] - b.lower[i])
      // Symmetric in ln y.
      expect(Math.log(b.upper[i]) - Math.log(b.yhat[i])).toBeCloseTo(
        Math.log(b.yhat[i]) - Math.log(b.lower[i]),
        13,
      )
    }
    // At x = 0 the ln-space band is exactly the CI of ln a.
    expect(b.lower[0]).toBeCloseTo(p.a.ci![0], 10)
    expect(b.upper[0]).toBeCloseTo(p.a.ci![1], 10)
  })
})

describe('power law (least squares on ln y vs ln x)', () => {
  it('recovers a and b of y = a·x^b under multiplicative scatter', () => {
    const x = [0.5, 1, 2, 4, 8, 16]
    const f = [1.01, 0.99, 1.02, 0.98, 1.01, 0.99]
    const fit = ok(
      runFit(
        spec({ type: 'power' }),
        series(
          x,
          x.map((v, i) => 2.5 * v ** -0.5 * f[i]),
        ),
        { xUnit: 'm', yUnit: 's' },
      ),
    )
    expect(fit.params[0].value).toBeCloseTo(2.5, 1)
    expect(fit.params[1].value).toBeCloseTo(-0.5, 2)
    expect(fit.basis).toMatchObject({ kind: 'logLinear', x: 'ln' })
    expect(fit.params[0].unit).toBe('s/m^b')
    expect(fit.params[1].unit).toBeNull()
  })

  it('domain: x ≤ 0 or y ≤ 0 → E_LOG_DOMAIN_FIT listing the rows', () => {
    const r = runFit(spec({ type: 'power' }), series([0, 1, 2, 3], [1, 2, -3, 4]), {
      xUnit: null,
      yUnit: null,
    })
    expect(r.status === 'error' && r.error.code).toBe('E_LOG_DOMAIN_FIT')
    expect(r.status === 'error' && r.error.rows).toEqual([0, 2])
    const e = runFit(spec({ type: 'exponential' }), series([0, 1, 2, 3], [1, 0, 3, 4]), {
      xUnit: null,
      yUnit: null,
    })
    expect(e.status === 'error' && e.error.rows).toEqual([1])
  })
})

describe('fitLogLinear', () => {
  it('a must be representable: |ln a| beyond the double range → E_OVERFLOW (change units/origin)', () => {
    // Exponential growth measured in calendar years: ln a = ln y − b·x̄ ≈ −1000.
    const x = Float64Array.from([2000, 2001, 2002, 2003, 2004])
    const y = Float64Array.from([1, 1.65, 2.7, 4.5, 7.4])
    const r = fitLogLinear('exponential', x, y, Int32Array.from([0, 1, 2, 3, 4]), 0.95)
    expect('code' in r && r.code).toBe('E_OVERFLOW')
    const shifted = fitLogLinear(
      'exponential',
      x.map((v) => v - 2000),
      y,
      Int32Array.from([0, 1, 2, 3, 4]),
      0.95,
    )
    expect('code' in shifted).toBe(false)
    expect((shifted as LogLinearCore).b).toBeCloseTo(0.5, 1)
  })
})
