import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatasetId, FitId, FitModel, FitSpec, SeriesId } from '@/domain/model'
import { CELL, type ErrorBarArrays, type FitOk, type FitResult, type SeriesData } from '@/domain/derive/types'
import { lre, readNistLLS } from '@/test/nist'
import {
  EXACT_FIT_ULPS,
  fewDofIssue,
  highLeverageIssue,
  isExactFit,
  leverageSummary,
  residualSignRuns,
  roundingNoiseScale,
  rSquared,
  uComparison,
} from './diagnostics'
import { runFit } from './runFit'

const json = (name: string) =>
  JSON.parse(readFileSync(resolve(`tests/fixtures/reference/${name}.json`), 'utf8'))

function series(x: readonly number[], y: readonly number[], rowIds?: readonly number[]): SeriesData {
  const n = x.length
  const ids = Int32Array.from(rowIds ?? Array.from({ length: n }, (_, i) => i))
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
  show: { curve: true, confidenceBand: false, predictionBand: false, residuals: true },
  curveRange: { mode: 'data' },
  style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
  perGroup: false,
})
const ok = (r: FitResult): FitOk => {
  if (r.status !== 'ok') throw new Error(r.error.code)
  return r
}
const fitOf = (model: FitModel, x: readonly number[], y: readonly number[], rowIds?: readonly number[]) =>
  ok(runFit(spec(model), series(x, y, rowIds), { xUnit: null, yUnit: null }))

/** Deterministic permutation (same seed → same order). */
function shuffled(n: number, seed: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  let s = seed
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648
    const j = s % (i + 1)
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

const FALL_T = Array.from({ length: 15 }, (_, i) => Number((0.04 * i).toFixed(2)))
const FALL_Y = [
  0.014, 0.03, 0.062, 0.112, 0.175, 0.257, 0.351, 0.467, 0.593, 0.737, 0.906, 1.074, 1.256, 1.468, 1.694,
]
const COOL_T = Array.from({ length: 16 }, (_, i) => 2 * i)
const COOL_TEMP = [
  85.2, 80.3, 75.6, 71.7, 67.6, 64.3, 61.1, 58.0, 55.5, 52.6, 50.3, 48.2, 46.3, 44.1, 42.6, 40.8,
]

describe('high R² with a wrong model: the residual pattern tells', () => {
  it('free fall fitted with a line: R² 0.940132395553, signs "+++---------+++"', () => {
    const ref = json('freeFall').linear
    const fit = fitOf({ type: 'linear' }, FALL_T, FALL_Y)
    expect(lre(fit.r2 as number, Number(ref.r2))).toBeGreaterThan(12)
    expect(lre(fit.r2 as number, 0.940132395553)).toBeGreaterThan(11)
    expect(lre(fit.adjR2 as number, Number(ref.adjR2))).toBeGreaterThan(12)
    expect(fit.residualSignRuns).toBe('+++---------+++')
  })

  it('cooling fitted with a line: slope −1.444852941, R² 0.974483595433, signs "+++---------++++"', () => {
    const ref = json('cooling').linearTvsT
    const fit = fitOf({ type: 'linear' }, COOL_T, COOL_TEMP)
    expect(lre(fit.params[1].value, Number(ref.coefficients[1]))).toBeGreaterThan(12)
    expect(lre(fit.r2 as number, Number(ref.r2))).toBeGreaterThan(12)
    expect(fit.residualSignRuns).toBe('+++---------++++')
  })

  it('shuffled rows give the identical sign string (ordered by x, not by row)', () => {
    for (const seed of [1, 7, 42]) {
      const p = shuffled(FALL_T.length, seed)
      const fit = fitOf(
        { type: 'linear' },
        p.map((i) => FALL_T[i]),
        p.map((i) => FALL_Y[i]),
        p,
      )
      expect(fit.residualSignRuns).toBe('+++---------+++')
    }
  })
})

describe('residualSignRuns', () => {
  it('breaks ties in x by RowId and skips |r| ≤ 1e-12·s', () => {
    expect(residualSignRuns([1, -1, 2], [5, 5, 1], [9, 3, 4], 1)).toBe('+-+')
    expect(residualSignRuns([0.5, 1e-13, -0.5], [1, 2, 3], [0, 1, 2], 1)).toBe('+-')
    expect(residualSignRuns([0.5, -0.5], [1, 2], [0, 1], 1, true)).toBe('')
  })
})

describe('rSquared', () => {
  it('centred TSS; adjusted R² can be negative and is not clamped', () => {
    const y = [2.1, 1.2, 2.9, 1.1, 2.6, 1.8]
    const res = y.map((v) => v - y.reduce((a, b) => a + b) / y.length).map((v) => 0.99 * v)
    const r = rSquared(y, res, 2)
    expect(r.r2).toBeCloseTo(1 - 0.99 * 0.99, 14)
    expect(r.adjR2 as number).toBeLessThan(0)
    expect(r.adjR2).toBeCloseTo(1 - ((1 - (r.r2 as number)) * 5) / 4, 14)
  })

  it('undefined (null) for constant y, even with rounding-level residuals', () => {
    expect(rSquared([3, 3, 3], [1e-17, -1e-17, 0], 2)).toEqual({
      r2: null,
      adjR2: null,
      responseConstant: true,
    })
  })

  it('does not overflow for 1e200 data', () => {
    const y = [1e200, 2e200, 3e200, 4.5e200]
    const r = rSquared(y, [0.1e200, -0.2e200, 0.05e200, 0.05e200], 2)
    expect(Number.isFinite(r.r2 as number)).toBe(true)
    expect(r.r2 as number).toBeGreaterThan(0.9)
  })
})

describe('leverage', () => {
  it('Anscombe IV: h = 1 for the x = 19 point → W_HIGH_LEVERAGE listing that row', () => {
    const set = json('anscombe').sets.IV
    const fit = fitOf({ type: 'linear' }, (set.x as string[]).map(Number), (set.y as string[]).map(Number))
    expect(fit.maxLeverage.h).toBeCloseTo(1, 13)
    expect(fit.maxLeverage.rows).toEqual([7])
    const w = fit.warnings.find((i) => i.code === 'W_HIGH_LEVERAGE')
    expect(w?.rows).toEqual([7])
    expect(w?.params).toEqual({ count: 1, h: 1 })
    // The h = 1 point has a zero residual: skipped in the sign runs (10 signs for 11 points).
    expect(fit.residualSignRuns).toHaveLength(10)
  })

  it('no warning for a balanced design; the maximum row is still reported', () => {
    const s = leverageSummary([0.2, 0.5, 0.3], [4, 5, 6])
    expect(s).toEqual({ h: 0.5, rows: [5] })
    expect(highLeverageIssue(s)).toBeNull()
    expect(leverageSummary([], [])).toEqual({ h: NaN, rows: [] })
  })
})

describe('W_FEW_DOF', () => {
  it('df ≤ 3 or degree ≥ n/2, with the t multiplier', () => {
    expect(fewDofIssue(1, 1, 3, 0.95)?.params).toEqual({ df: 1, t: 12.71 })
    expect(fewDofIssue(3, 1, 5, 0.95)?.params).toEqual({ df: 3, t: 3.182 })
    expect(fewDofIssue(4, 5, 10, 0.95)?.code).toBe('W_FEW_DOF')
    expect(fewDofIssue(4, 1, 6, 0.95)).toBeNull()
    const fit = fitOf({ type: 'polynomial', degree: 2 }, [1, 2, 3, 4], [1, 4.2, 8.8, 16.1])
    expect(fit.warnings.map((w) => w.code)).toContain('W_FEW_DOF')
  })
})

describe('isExactFit — tied to the rounding-noise floor, not to 1e-12', () => {
  const EPS = 2 ** -52
  const lin = (b1: number, xbar: number) =>
    ({ kind: 'linear', b0: 0, b1, xbar, sxx: 1, xScale: 1, suu: 1 }) as const

  it('s ≤ 64·ε·scale, with scale ≈ max|y| for ordinary data', () => {
    expect(EXACT_FIT_ULPS).toBe(64)
    expect(roundingNoiseScale(lin(0, 0), [0, 1, 2], [1, -3, 2])).toBe(3)
    expect(isExactFit(64 * EPS * 3, 3)).toBe(true)
    expect(isExactFit(65 * EPS * 3, 3)).toBe(false)
    // The former threshold 1e-12·max|y| (≈ 4500·ε) declared real scatter exact.
    expect(isExactFit(2.9e-12, 3)).toBe(false)
    expect(isExactFit(0, 0)).toBe(true)
    expect(isExactFit(NaN, 3)).toBe(false)
  })

  it('linear: |y| only; ln y adds 1 (a relative rounding of y moves ln y by ε), power laws |b·ln x|', () => {
    // The binary representation of x is information in the data, not algorithmic noise.
    expect(roundingNoiseScale(lin(2, 1e6), [1e6], [5])).toBe(5)
    const log = { kind: 'logLinear', lnA: 0, b: 0.5, x: 'identity', xbar: 2, xScale: 1, suu: 1 } as const
    expect(roundingNoiseScale(log, [4], [1e-4])).toBe(1 + 1e-4)
    const pow = { ...log, x: 'ln' } as const
    expect(roundingNoiseScale(pow, [Math.E ** 2], [3])).toBeCloseTo(1 + 3 + 0.5 * 2, 14)
    // NaN propagates (→ not exact); an overflow never becomes ∞ (which would make any fit exact).
    expect(roundingNoiseScale(lin(1, 0), [0], [NaN])).toBeNaN()
    const huge = { kind: 'scaledPoly', m: 0, h: 1, sy: 1e308, c: [1, 1e10], r: [] } as const
    expect(roundingNoiseScale(huge, [1], [1])).toBe(Number.MAX_VALUE)
  })

  it('polynomial basis: Horner terms Σ|cₖ||t|ᵏ (cancelling coefficients) and |p′(t)||t| for the rounding of t', () => {
    // T₂(t) = 2t² − 1 on x ∈ [0, 2] (m = 1, h = 1), sy = 1: at t = ±1 terms 3 and |p′(±1)|·1 = 4.
    const poly = { kind: 'scaledPoly', m: 1, h: 1, sy: 1, c: [-1, 0, 2], r: [] } as const
    expect(roundingNoiseScale(poly, [0, 1, 2], [1, 1, 1])).toBe(1 + 3 + 4)
  })

  it('Wampler1/2 and other exact fits stay exact (Wampler with a margin > 100 below the threshold)', () => {
    const margin = (fit: FitOk, y: readonly number[]) => fit.s / (EPS * Math.max(...y.map(Math.abs)))
    for (const name of ['Wampler1', 'Wampler2']) {
      const d = readNistLLS(name)
      const fit = fitOf({ type: 'polynomial', degree: 5 }, d.x, d.y)
      expect(fit.exactFit).toBe(true)
      expect(margin(fit, d.y)).toBeLessThan(EXACT_FIT_ULPS / 100)
    }
    // An exact degree-10 Chebyshev shape: Horner in the t basis cancels terms ~3000× larger than |y|.
    const t = Array.from({ length: 50 }, (_, i) => i / 49)
    const cheb = t.map((v) => {
      const z = 2 * v - 1
      let a = 1
      let b = z
      for (let k = 2; k <= 10; k++) [a, b] = [b, 2 * z * b - a]
      return b
    })
    expect(fitOf({ type: 'polynomial', degree: 10 }, t, cheb).exactFit).toBe(true)
    // Calendar-year quadratic far from the origin, exact integers.
    const yrs = Array.from({ length: 31 }, (_, i) => 1990 + i)
    expect(
      fitOf(
        { type: 'polynomial', degree: 2 },
        yrs,
        yrs.map((v) => 2 * v * v - 3 * v + 1),
      ).exactFit,
    ).toBe(true)
    // ln y ≈ 1e-4: y = 1.0001·e^(1e-6·x) is exact up to the rounding of y (ε in ln y).
    const x = Array.from({ length: 21 }, (_, i) => i)
    expect(
      fitOf(
        { type: 'exponential' },
        x,
        x.map((v) => 1.0001 * Math.exp(1e-6 * v)),
      ).exactFit,
    ).toBe(true)
  })

  it('x stored in binary is data, not noise: decimal x = 1.7e9 + i/10 (ulp 2.4e-7) gives a tiny but real SE', () => {
    const xs = Array.from({ length: 21 }, (_, i) => 1.7e9 + i / 10)
    const fit = fitOf(
      { type: 'linear' },
      xs,
      xs.map((_, i) => 5 + 0.2 * i),
    )
    expect(fit.exactFit).toBe(false)
    expect(fit.params[1].value).toBeCloseTo(2, 5)
    expect(fit.params[1].se as number).toBeGreaterThan(0)
    expect(fit.params[1].se as number).toBeLessThan(1e-5)
  })

  it('regression: a high-offset response with REAL scatter keeps its SEs, CIs and bands', () => {
    // Caesium frequency + 1 mHz-scale scatter: s ≈ 8.3e-4 Hz is ≈ 400 ε·max|y| (was declared exact).
    const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const e = [0.3, -1.1, 0.8, 0.2, -0.5, 1.4, -0.9, 0.1, -0.6, 0.4]
    const fit = fitOf(
      { type: 'linear' },
      x,
      e.map((v) => 9192631770 + 1e-3 * v),
    )
    expect(fit.exactFit).toBe(false)
    expect(fit.warnings.map((w) => w.code)).not.toContain('I_EXACT_FIT')
    expect(fit.s).toBeGreaterThan(8.2e-4)
    expect(fit.s).toBeLessThan(8.45e-4)
    expect(fit.params[1].se).not.toBeNull()
    // SE(b₁) = s/√Sxx with Sxx = 82.5 → ≈ 9.2e-5 Hz/s; the slope (≈ −3e-6) is pure noise and says so.
    expect(fit.params[1].se as number).toBeCloseTo(fit.s / Math.sqrt(82.5), 9)
    expect(Math.abs(fit.params[1].value)).toBeLessThan(fit.params[1].se as number)
    expect(fit.params.every((p) => p.ci !== null)).toBe(true)
    expect(fit.covariance.flat().every(Number.isFinite)).toBe(true)
  })
})

describe('uComparison', () => {
  const base = (plus: number[], status?: number[], minus?: number[] | null): ErrorBarArrays => ({
    plus: Float64Array.from(plus),
    minus: minus ? Float64Array.from(minus) : null,
    status: Uint8Array.from(status ?? plus.map(() => CELL.ok)),
    descriptor: { kind: 'measurement', labelKey: 'uncertainty.label.measurement.standard', params: {} },
    issues: [],
  })
  it('median of valid u over the fitted rows only', () => {
    const bars = base([0.1, 0.2, 0.3, 9, NaN], [CELL.ok, CELL.ok, CELL.ok, CELL.ok, CELL.missing])
    expect(uComparison(bars, [0, 1, 2, 4], 0.5)).toEqual({ s: 0.5, medianU: 0.2 })
    expect(uComparison(bars, [0, 1], 0.5)?.medianU).toBeCloseTo(0.15, 15)
    expect(uComparison(bars, [4], 0.5)).toBeNull()
  })
  it('asymmetric bars use (u₊ + u₋)/2; replicate bars and missing bars give null', () => {
    expect(uComparison(base([0.2, 0.4], undefined, [0.4, 0.6]), [0, 1], 1)?.medianU).toBeCloseTo(0.4, 15)
    const sd = {
      ...base([0.1]),
      descriptor: { kind: 'sd' as const, labelKey: 'uncertainty.label.sd', params: {} },
    }
    expect(uComparison(sd, [0], 1)).toBeNull()
    expect(uComparison(null, [0], 1)).toBeNull()
  })
  it('expanded U = k·u is divided by k; an uncertainty of UNSTATED meaning is not compared (it could be U)', () => {
    const withKey = (labelKey: string, params: Record<string, number> = {}): ErrorBarArrays => ({
      ...base([0.2, 0.2, 0.2]),
      descriptor: { kind: 'measurement', labelKey, params },
    })
    expect(
      uComparison(withKey('uncertainty.label.measurement.expanded', { k: 2 }), [0, 1, 2], 0.1)?.medianU,
    ).toBeCloseTo(0.1, 15)
    expect(uComparison(withKey('uncertainty.label.measurement.unspecified'), [0, 1, 2], 0.1)).toBeNull()
  })
})
