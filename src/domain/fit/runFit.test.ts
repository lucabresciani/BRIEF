import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatasetId, FitId, FitModel, FitSpec, SeriesId } from '@/domain/model'
import { INACTIVE } from '@/domain/model'
import { CELL, type ErrorBarArrays, type FitOk, type FitResult, type SeriesData } from '@/domain/derive/types'
import { lre } from '@/test/nist'
import { describeUncertainty } from '@/domain/uncertainty/describe'
import { predict } from './band'
import { coefficientUnit, runFit } from './runFit'

/** SeriesData by hand: reasons per row (0 = active), counts derived from them. */
function series(
  x: readonly number[],
  y: readonly number[],
  reasons?: readonly number[],
  rowIds?: readonly number[],
): SeriesData {
  const n = x.length
  const reason = Uint8Array.from(reasons ?? new Array<number>(n).fill(INACTIVE.active))
  const counts = { missing: 0, invalid: 0, excluded: 0, filtered: 0 }
  const names = ['missing', 'invalid', 'excluded', 'filtered'] as const
  reason.forEach((r) => {
    if (r > 0) counts[names[r - 1]]++
  })
  const ids = Int32Array.from(rowIds ?? Array.from({ length: n }, (_, i) => i))
  return {
    seriesId: 'ser_test' as SeriesId,
    datasetId: 'ds_test' as DatasetId,
    rowIds: ids,
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    sample: { rowIds: ids, reason, nTotal: n, nActive: n - reason.filter((r) => r > 0).length, counts },
    render: new Uint8Array(n),
  }
}
const spec = (model: FitModel, confidence: 0.9 | 0.95 | 0.99 = 0.95): FitSpec => ({
  id: 'fit_test' as FitId,
  seriesId: 'ser_test' as SeriesId,
  model,
  confidence,
  show: { curve: true, confidenceBand: false, predictionBand: false, residuals: true },
  curveRange: { mode: 'data' },
  style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
  perGroup: false,
})
const asOk = (r: FitResult): FitOk => {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.error.code}`)
  return r
}

const OHM_I = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]
const OHM_V = [0.464, 0.941, 1.402, 1.882, 2.339, 2.808, 3.294, 3.764, 4.241, 4.706]
const ohmRef = JSON.parse(readFileSync(resolve('tests/fixtures/reference/ohm.json'), 'utf8')).linear

describe('runFit — linear (Ohm)', () => {
  const fit = asOk(runFit(spec({ type: 'linear' }), series(OHM_I, OHM_V), { xUnit: 'A', yUnit: 'V' }))

  it('reports the closed-form OLS with symbols, units and SE source', () => {
    expect(fit.params.map((p) => p.symbol)).toEqual(['b₀', 'b₁'])
    expect(fit.params.map((p) => p.unit)).toEqual(['V', 'V/A'])
    expect(lre(fit.params[1].value, Number(ohmRef.coefficients[1]))).toBeGreaterThan(12)
    expect(lre(fit.params[1].se as number, Number(ohmRef.se[1]))).toBeGreaterThan(12)
    expect(lre(fit.params[0].se as number, Number(ohmRef.se[0]))).toBeGreaterThan(12)
    expect(lre(fit.params[1].ci![0], Number(ohmRef.ci95[1][0]))).toBeGreaterThan(12)
    expect(lre(fit.params[1].ci![1], Number(ohmRef.ci95[1][1]))).toBeGreaterThan(12)
    expect(lre(fit.s, Number(ohmRef.s))).toBeGreaterThan(12)
    expect(lre(fit.r2 as number, Number(ohmRef.r2))).toBeGreaterThan(12)
    expect(lre(fit.adjR2 as number, Number(ohmRef.adjR2))).toBeGreaterThan(12)
    expect(fit.df).toBe(8)
    expect(fit.r2Of).toBe('y')
    expect(fit.seSource).toBe('residual-scatter')
    expect(fit.exactFit).toBe(false)
    expect(fit.residualSignRuns).toBe(ohmRef.residualSigns)
    expect(fit.equation.form).toBe('original')
    expect(fit.warnings).toEqual([])
    expect(fit.uComparison).toBeNull()
  })

  it('records provenance: algorithm, rows used, n, t, never group means', () => {
    expect(fit.provenance.algorithm).toBe('ols-linear-centred@1')
    expect(fit.provenance.rowIdsUsed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(fit.provenance.nUsed).toBe(10)
    expect(fit.provenance.nTotal).toBe(10)
    expect(fit.provenance.usesGroupMeans).toBe(false)
    expect(fit.provenance.confidence).toBe(0.95)
    expect(lre(fit.provenance.tCritical as number, Number(ohmRef.tCritical))).toBeGreaterThan(13)
    expect(Array.from(fit.residualX)).toEqual(OHM_I)
    expect(fit.basis.kind).toBe('linear')
    expect(predict(fit, 0.055)).toBeCloseTo(2.5841, 13)
  })

  it('uses only active rows: excluding row 3 changes n and coefficients as expected', () => {
    const reasons = OHM_I.map((_, i) => (i === 2 ? INACTIVE.excluded : INACTIVE.active))
    const ex = asOk(
      runFit(spec({ type: 'linear' }), series(OHM_I, OHM_V, reasons), { xUnit: 'A', yUnit: 'V' }),
    )
    expect(ex.provenance.nUsed).toBe(9)
    expect(ex.provenance.nTotal).toBe(10)
    expect(ex.provenance.inactive.excluded).toBe(1)
    expect(ex.provenance.rowIdsUsed).not.toContain(2)
    expect(ex.df).toBe(7)
    const without = asOk(
      runFit(
        spec({ type: 'linear' }),
        series(
          OHM_I.filter((_, i) => i !== 2),
          OHM_V.filter((_, i) => i !== 2),
        ),
        {
          xUnit: 'A',
          yUnit: 'V',
        },
      ),
    )
    expect(ex.params[1].value).toBe(without.params[1].value)
    expect(ex.params[1].value).not.toBe(fit.params[1].value)
  })

  it('compares s with the supplied u(y) without using it as a weight', () => {
    const n = OHM_I.length
    const bars: ErrorBarArrays = {
      plus: Float64Array.from({ length: n }, (_, i) => (i === 0 ? NaN : 0.05)),
      minus: null,
      status: Uint8Array.from({ length: n }, (_, i) => (i === 0 ? CELL.missing : CELL.ok)),
      descriptor: { kind: 'measurement', labelKey: 'uncertainty.label.measurement.standard', params: {} },
      issues: [],
    }
    const withU = asOk(
      runFit(spec({ type: 'linear' }), series(OHM_I, OHM_V), { xUnit: 'A', yUnit: 'V', yUncertainty: bars }),
    )
    expect(withU.uComparison).toEqual({ s: withU.s, medianU: 0.05 })
    expect(withU.params[1].value).toBe(fit.params[1].value)
    expect(withU.params[1].se).toBe(fit.params[1].se)
    const expanded = {
      ...bars,
      descriptor: {
        kind: 'measurement' as const,
        labelKey: 'uncertainty.label.measurement.expanded',
        params: { k: 2 },
      },
    }
    const withU2 = asOk(
      runFit(spec({ type: 'linear' }), series(OHM_I, OHM_V), {
        xUnit: 'A',
        yUnit: 'V',
        yUncertainty: expanded,
      }),
    )
    expect(withU2.uComparison?.medianU).toBe(0.025)
    // Meaning not declared: no s–u comparison, the column could hold U with k = 2.
    const unspecified: ErrorBarArrays = {
      ...bars,
      descriptor: describeUncertainty({
        kind: 'measurement',
        origin: 'user',
        source: { type: 'absolute', value: 0.05 },
        meaning: { type: 'unspecified' },
      }),
    }
    const withU3 = asOk(
      runFit(spec({ type: 'linear' }), series(OHM_I, OHM_V), {
        xUnit: 'A',
        yUnit: 'V',
        yUncertainty: unspecified,
      }),
    )
    expect(withU3.uComparison).toBeNull()
  })

  it('confidence level changes only the intervals', () => {
    const f99 = asOk(runFit(spec({ type: 'linear' }, 0.99), series(OHM_I, OHM_V), { xUnit: 'A', yUnit: 'V' }))
    expect(f99.params[1].value).toBe(fit.params[1].value)
    expect(f99.params[1].ci![1] - f99.params[1].ci![0]).toBeGreaterThan(
      fit.params[1].ci![1] - fit.params[1].ci![0],
    )
    expect(f99.provenance.confidence).toBe(0.99)
  })
})

describe('runFit — polynomial (free fall)', () => {
  const t = Array.from({ length: 15 }, (_, i) => Number((0.04 * i).toFixed(2)))
  const y = [
    0.014, 0.03, 0.062, 0.112, 0.175, 0.257, 0.351, 0.467, 0.593, 0.737, 0.906, 1.074, 1.256, 1.468, 1.694,
  ]
  const ref = JSON.parse(readFileSync(resolve('tests/fixtures/reference/freeFall.json'), 'utf8')).quadratic

  it('a₀…a₂ with units y/xᵏ and the Householder provenance', () => {
    const fit = asOk(
      runFit(spec({ type: 'polynomial', degree: 2 }), series(t, y), { xUnit: 's', yUnit: 'm' }),
    )
    expect(fit.params.map((p) => p.symbol)).toEqual(['a₀', 'a₁', 'a₂'])
    expect(fit.params.map((p) => p.unit)).toEqual(['m', 'm/s', 'm/s²'])
    expect(lre(fit.params[2].value, Number('4.9293491435035552683'))).toBeGreaterThan(11)
    expect(lre(fit.params[2].se as number, Number('0.035555860300396382949'))).toBeGreaterThan(11)
    expect(lre(fit.r2 as number, Number(ref.r2))).toBeGreaterThan(12)
    expect(lre(fit.adjR2 as number, Number(ref.adjR2))).toBeGreaterThan(12)
    expect(fit.provenance.algorithm).toBe('ols-householder-scaled@1')
    expect(fit.basis.kind).toBe('scaledPoly')
    expect(fit.residualSignRuns).toBe(ref.residualSigns)
    expect(fit.covariance).toHaveLength(3)
  })
})

describe('runFit — robustness', () => {
  it('exact fit: SE, CI and covariance not estimable (null / NaN), R² = 1, I_EXACT_FIT', () => {
    const x = [0, 1, 2, 3, 4, 5]
    const fit = asOk(
      runFit(
        spec({ type: 'linear' }),
        series(
          x,
          x.map((v) => 3 + 2 * v),
        ),
        { xUnit: null, yUnit: null },
      ),
    )
    expect(fit.exactFit).toBe(true)
    expect(fit.params.every((p) => p.se === null && p.ci === null)).toBe(true)
    expect(fit.covariance.flat().every(Number.isNaN)).toBe(true)
    expect(fit.warnings.map((w) => w.code)).toContain('I_EXACT_FIT')
    expect(fit.r2).toBe(1)
    expect(fit.residualSignRuns).toBe('')
  })

  it('constant y: the fit is valid (slope 0) but R² is undefined', () => {
    const fit = asOk(
      runFit(spec({ type: 'linear' }), series([1, 2, 3, 4], [5, 5, 5, 5]), { xUnit: null, yUnit: null }),
    )
    expect(fit.params[1].value).toBe(0)
    expect(fit.r2).toBeNull()
    expect(fit.adjR2).toBeNull()
    expect(fit.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['I_R2_UNDEFINED', 'I_EXACT_FIT']))
  })

  it('adjusted R² can be negative and is not clamped', () => {
    const x = [1, 2, 3, 4, 5, 6]
    const y = [2.1, 1.2, 2.9, 1.1, 2.6, 1.8]
    const fit = asOk(runFit(spec({ type: 'linear' }), series(x, y), { xUnit: null, yUnit: null }))
    expect(fit.r2 as number).toBeGreaterThanOrEqual(0)
    expect(fit.adjR2 as number).toBeLessThan(0)
    expect(fit.adjR2 as number).toBeCloseTo(1 - (1 - (fit.r2 as number)) * (5 / 4), 14)
  })

  it('±Infinity in an active row → E_OVERFLOW listing the rows; NaN is skipped defensively', () => {
    const inf = runFit(spec({ type: 'linear' }), series([1, 2, 3, 4], [1, Infinity, 3, 4]), {
      xUnit: null,
      yUnit: null,
    })
    expect(inf.status === 'error' && inf.error.code).toBe('E_OVERFLOW')
    expect(inf.status === 'error' && inf.error.rows).toEqual([1])
    const nan = asOk(
      runFit(spec({ type: 'linear' }), series([1, 2, 3, 4, 5], [1, NaN, 3, 4, 5.5]), {
        xUnit: null,
        yUnit: null,
      }),
    )
    expect(nan.provenance.nUsed).toBe(4)
    expect(nan.provenance.rowIdsUsed).toEqual([0, 2, 3, 4])
  })

  it('inactive rows never enter the fit, whatever their values', () => {
    const reasons = [0, 0, 1, 2, 4, 0, 0]
    const fit = asOk(
      runFit(
        spec({ type: 'linear' }),
        series([1, 2, 3, 4, 5, 6, 7], [1, 2, 1e9, NaN, -50, 6, 7.2], reasons),
        {
          xUnit: null,
          yUnit: null,
        },
      ),
    )
    expect(fit.provenance.rowIdsUsed).toEqual([0, 1, 5, 6])
    expect(fit.provenance.inactive).toEqual({ missing: 1, invalid: 1, excluded: 0, filtered: 1 })
  })

  it('errors carry the partial provenance', () => {
    const r = runFit(spec({ type: 'polynomial', degree: 3 }), series([1, 2, 3, 4], [1, 2, 3, 5]), {
      xUnit: null,
      yUnit: null,
    })
    expect(r.status).toBe('error')
    if (r.status === 'error') {
      expect(r.error.code).toBe('E_TOO_FEW_POINTS')
      expect(r.error.params).toMatchObject({ needed: 5, n: 4 })
      expect(r.provenance.nUsed).toBe(4)
      expect(r.provenance.algorithm).toBe('ols-householder-scaled@1')
    }
  })

  it('throws only for misaligned arrays (programmer error)', () => {
    const s = series([1, 2, 3], [1, 2, 3])
    expect(() =>
      runFit(spec({ type: 'linear' }), { ...s, y: new Float64Array(2) }, { xUnit: null, yUnit: null }),
    ).toThrow(RangeError)
  })
})

describe('coefficientUnit', () => {
  it('writes y/xᵏ literally, with parentheses for compound units, null when unknown', () => {
    expect(coefficientUnit('V', 'A', 0)).toBe('V')
    expect(coefficientUnit('V', 'A', 1)).toBe('V/A')
    expect(coefficientUnit('m', 's', 2)).toBe('m/s²')
    expect(coefficientUnit('m/s', 's', 1)).toBe('(m/s)/s')
    expect(coefficientUnit('AU', 'mg/L', 1)).toBe('AU/(mg/L)')
    expect(coefficientUnit(null, 's', 1)).toBeNull()
    expect(coefficientUnit('m', null, 1)).toBeNull()
    expect(coefficientUnit('m', null, 0)).toBe('m')
  })
})
