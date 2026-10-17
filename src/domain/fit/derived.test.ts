import { describe, expect, it } from 'vitest'
import type { DatasetId, FitId, FitModel, FitSpec, SeriesId } from '@/domain/model'
import type { FitOk, FitResult, SeriesData } from '@/domain/derive/types'
import { formatWithUncertainty } from '@/domain/format/number'
import { lre } from '@/test/nist'
import { derivedParameter, linearCombination } from './derived'
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
  show: { curve: true, confidenceBand: false, predictionBand: false, residuals: false },
  curveRange: { mode: 'data' },
  style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
  perGroup: false,
})
const ok = (r: FitResult): FitOk => {
  if (r.status !== 'ok') throw new Error(r.error.code)
  return r
}

const t = Array.from({ length: 15 }, (_, i) => Number((0.04 * i).toFixed(2)))
const y = [
  0.014, 0.03, 0.062, 0.112, 0.175, 0.257, 0.351, 0.467, 0.593, 0.737, 0.906, 1.074, 1.256, 1.468, 1.694,
]
const quad = ok(runFit(spec({ type: 'polynomial', degree: 2 }), series(t, y), { xUnit: 's', yUnit: 'm' }))

describe('linearCombination', () => {
  it('free fall: g = 2·a₂ = 9.85869828701 ± 0.0711117206008, SE exactly 2·SE(a₂)', () => {
    const g = linearCombination(quad, [0, 0, 2])
    expect(lre(g.value, Number('9.8586982870071105366'))).toBeGreaterThan(11)
    expect(lre(g.se as number, Number('0.071111720600792765898'))).toBeGreaterThan(11)
    expect((g.se as number) / (quad.params[2].se as number)).toBeCloseTo(2, 14)
    expect(formatWithUncertainty(g.value, g.se as number, { decimal: '.' }).text).toBe('9.86 ± 0.07')
  })

  it('uses the covariance: Var(a₀ + a₁) includes 2·Cov(a₀, a₁)', () => {
    const q = linearCombination(quad, [1, 1, 0])
    const c = quad.covariance
    expect(q.se).toBeCloseTo(Math.sqrt(c[0][0] + c[1][1] + 2 * c[0][1]), 15)
    expect(q.se as number).not.toBeCloseTo(
      Math.hypot(quad.params[0].se as number, quad.params[1].se as number),
      6,
    )
  })

  it('exact fits and log-linear a have no SE; ln a and b do', () => {
    const exact = ok(
      runFit(spec({ type: 'linear' }), series([0, 1, 2, 3], [1, 3, 5, 7]), { xUnit: null, yUnit: null }),
    )
    expect(linearCombination(exact, [0, 2])).toEqual({ value: 4, se: null })
    const exp = ok(
      runFit(spec({ type: 'exponential' }), series([0, 1, 2, 3, 4], [10, 6.1, 3.6, 2.25, 1.3]), {
        xUnit: null,
        yUnit: null,
      }),
    )
    expect(linearCombination(exp, [1, 0, 0]).se).toBeNull()
    expect(linearCombination(exp, [0, 1, 0]).se).toBeCloseTo(exp.params[1].se as number, 15)
    expect(() => linearCombination(quad, [1, 2])).toThrow(RangeError)
  })
})

describe('derivedParameter', () => {
  it('a FitParameter with a t-interval at the fit confidence and df', () => {
    const g = derivedParameter(quad, [0, 0, 2], { symbol: 'g', unit: 'm/s²' })
    expect(g.symbol).toBe('g')
    expect(g.unit).toBe('m/s²')
    const [lo, hi] = g.ci as [number, number]
    expect((hi - lo) / 2).toBeCloseTo((quad.provenance.tCritical as number) * (g.se as number), 14)
    expect(lo).toBeCloseTo(2 * Number('4.8518795789111959389'), 9)
    expect(hi).toBeCloseTo(2 * Number('5.0068187080959145976'), 9)
  })
})
