import { describe, expect, it } from 'vitest'
import type { DatasetId, FitId, FitModel, FitSpec, SeriesId } from '@/domain/model'
import type { EquationTokens, FitOk, FitResult, SeriesData } from '@/domain/derive/types'
import { roundToDecimals, roundUncertainty } from '@/domain/format/number'
import { predict } from './band'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { coefficientText, polynomialEquation, REPRODUCE_FRACTION, subscripted } from './equation'
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
const fitOf = (model: FitModel, x: readonly number[], y: readonly number[]) =>
  ok(runFit(spec(model), series(x, y), { xUnit: 'yr', yUnit: 'K' }))

/** What the user reads: each coefficient PDG-rounded on its SE, evaluated in powers of (x − x0). */
function displayedValue(eq: EquationTokens, x: number): number {
  const x0 = eq.x0 ?? 0
  let acc = 0
  for (const { coef, power } of eq.terms) {
    const v = coef.se ? roundToDecimals(coef.value, roundUncertainty(coef.se).decimals) : coef.value
    acc += v * (x - x0) ** power
  }
  return acc
}
const maxDisplayedDeviation = (fit: FitOk, xs: readonly number[]) =>
  Math.max(...xs.map((x) => Math.abs(displayedValue(fit.equation, x) - predict(fit, x))))

/** Deterministic N(0, σ) noise (mulberry32 + Box–Muller). */
function noise(n: number, sigma: number, seed: number): number[] {
  let a = seed
  const u = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from(
    { length: n },
    () => sigma * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()),
  )
}

describe('equation — quadratic over x = 1990…2020', () => {
  const years = Array.from({ length: 31 }, (_, i) => 1990 + i)
  const e = noise(31, 0.37, 7)
  const y = years.map((x, i) => 12 + 0.31 * (x - 2005) + 0.0121 * (x - 2005) ** 2 + e[i])
  const fit = fitOf({ type: 'polynomial', degree: 2 }, years, y)

  it('the rounded ORIGINAL-form coefficients would mispredict by far more than s', () => {
    const original: EquationTokens = {
      form: 'original',
      x0: null,
      terms: fit.params.map((coef, power) => ({ coef, power })),
    }
    const dev = Math.max(...years.map((x) => Math.abs(displayedValue(original, x) - predict(fit, x))))
    console.log(
      `[equation] years quadratic: rounded original form off by ${dev.toPrecision(3)} (s = ${fit.s.toPrecision(3)})`,
    )
    expect(dev).toBeGreaterThan(10 * fit.s)
  })

  it('is shown in centred form about a round x0, and the displayed equation stays within REPRODUCE_FRACTION·s', () => {
    expect(fit.equation.form).toBe('centred')
    expect(fit.equation.x0).toBe(2000)
    expect(fit.warnings.find((w) => w.code === 'I_EQUATION_CENTRED')?.params).toEqual({
      x0: 2000,
      reason: 'rounding',
    })
    expect(maxDisplayedDeviation(fit, years)).toBeLessThanOrEqual(REPRODUCE_FRACTION * fit.s)
  })

  it('centred terms: primes on changed coefficients, the leading one is unchanged, units kept', () => {
    const terms = fit.equation.terms
    expect(terms.map((t) => t.coef.symbol)).toEqual(['a₀′', 'a₁′', 'a₂'])
    expect(terms.map((t) => t.power)).toEqual([0, 1, 2])
    expect(terms[2].coef.value).toBeCloseTo(fit.params[2].value, 12)
    expect(terms[2].coef.se as number).toBeCloseTo(fit.params[2].se as number, 14)
    expect(terms[1].coef.unit).toBe('K/yr')
    // The centred intercept is the fitted value at x0, with its own (much smaller) SE.
    expect(terms[0].coef.value).toBeCloseTo(predict(fit, 2000), 9)
    expect(terms[0].coef.se as number).toBeLessThan((fit.params[0].se as number) / 100)
    const [lo, hi] = terms[0].coef.ci as [number, number]
    expect((hi - lo) / 2 / (terms[0].coef.se as number)).toBeCloseTo(fit.provenance.tCritical as number, 12)
  })

  it('a straight line far from the origin (|x̄|/half-range > 3) is centred too', () => {
    const lin = fitOf(
      { type: 'linear' },
      years,
      y.map((v, i) => v - 0.0121 * (years[i] - 2005) ** 2),
    )
    expect(lin.equation.form).toBe('centred')
    expect(lin.equation.terms.map((t) => t.coef.symbol)).toEqual(['b₀′', 'b₁'])
    expect(maxDisplayedDeviation(lin, years)).toBeLessThanOrEqual(0.1 * lin.s)
  })
})

describe('equation — data near the origin keep the original form', () => {
  it('Ohm: y = b₀ + b₁x, displayed coefficients reproduce the curve', () => {
    const I = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]
    const V = [0.464, 0.941, 1.402, 1.882, 2.339, 2.808, 3.294, 3.764, 4.241, 4.706]
    const fit = fitOf({ type: 'linear' }, I, V)
    expect(fit.equation).toEqual({
      form: 'original',
      x0: null,
      terms: fit.params.map((coef, power) => ({ coef, power })),
    })
    expect(maxDisplayedDeviation(fit, I)).toBeLessThanOrEqual(0.1 * fit.s)
    expect(fit.warnings.map((w) => w.code)).not.toContain('I_EQUATION_CENTRED')
  })

  it('the displayed equation must reproduce the curve within 0.1·s', () => {
    expect(REPRODUCE_FRACTION).toBe(0.1)
  })

  it('free fall quadratic: rounded original coefficients miss by 0.115·s > 0.1·s → centred (reason "rounding")', () => {
    const t = Array.from({ length: 15 }, (_, i) => Number((0.04 * i).toFixed(2)))
    const y = [
      0.014, 0.03, 0.062, 0.112, 0.175, 0.257, 0.351, 0.467, 0.593, 0.737, 0.906, 1.074, 1.256, 1.468, 1.694,
    ]
    const fit = fitOf({ type: 'polynomial', degree: 2 }, t, y)
    const original: EquationTokens = {
      form: 'original',
      x0: null,
      terms: fit.params.map((coef, power) => ({ coef, power })),
    }
    const dev = Math.max(...t.map((v) => Math.abs(displayedValue(original, v) - predict(fit, v))))
    // PDG-rounded original coefficients (0.0123, 0.240, 4.93) deviate by 0.115·s at t = 0.56.
    expect(dev / fit.s).toBeGreaterThan(0.11)
    expect(dev / fit.s).toBeLessThan(0.12)
    expect(fit.equation.form).toBe('centred')
    expect(fit.warnings.find((w) => w.code === 'I_EQUATION_CENTRED')?.params?.reason).toBe('rounding')
    expect(maxDisplayedDeviation(fit, t)).toBeLessThanOrEqual(0.1 * fit.s)
    // The leading coefficient a₂ = g/2 is unchanged by centring.
    expect(fit.equation.terms[2].coef.value).toBeCloseTo(4.9293491435, 9)
  })

  it('a line at x = 100…110 is centred for the offset only (reason "offset"): its rounded original form reproduces', () => {
    // Scatter d·(u² − 10), u = x − 105, is orthogonal to 1 and x: b₀ = 2, b₁ = 0.5 exactly, and their
    // PDG-rounded forms (2.0, 0.500) reproduce the curve, yet |x̄|/half-range = 21 > 3.
    const x = Array.from({ length: 11 }, (_, i) => 100 + i)
    const fit = fitOf(
      { type: 'linear' },
      x,
      x.map((v) => 2 + 0.5 * v + 0.01 * ((v - 105) ** 2 - 10)),
    )
    expect(fit.params[0].value).toBeCloseTo(2, 9)
    expect(fit.params[1].value).toBeCloseTo(0.5, 12)
    const original: EquationTokens = {
      form: 'original',
      x0: null,
      terms: fit.params.map((coef, power) => ({ coef, power })),
    }
    const dev = Math.max(...x.map((v) => Math.abs(displayedValue(original, v) - predict(fit, v))))
    expect(dev).toBeLessThanOrEqual(0.1 * fit.s)
    expect(fit.equation.form).toBe('centred')
    expect(fit.warnings.find((w) => w.code === 'I_EQUATION_CENTRED')?.params?.reason).toBe('offset')
  })

  it('exact fits skip the rounding check (no SE) and use only the offset criterion', () => {
    const near = fitOf({ type: 'linear' }, [0, 1, 2, 3], [1, 3, 5, 7])
    expect(near.equation.form).toBe('original')
    const far = fitOf({ type: 'linear' }, [1000, 1001, 1002, 1003], [1, 3, 5, 7])
    expect(far.equation.form).toBe('centred')
    expect(far.equation.terms.every((t) => t.coef.se === null && t.coef.ci === null)).toBe(true)
  })
})

describe('equation — log-linear and helpers', () => {
  it('exponential: natural form with [a, b]', () => {
    const x = [0, 1, 2, 3, 4]
    const fit = fitOf({ type: 'exponential' }, x, [10, 6.1, 3.6, 2.25, 1.3])
    expect(fit.equation.form).toBe('original')
    expect(fit.equation.terms.map((t) => [t.coef.symbol, t.power])).toEqual([
      ['a', 0],
      ['b', 1],
    ])
  })

  it('terminates when x spans the whole double range (xmax − xmin overflows)', () => {
    const x = Float64Array.from([-1.7e308, -1e308, 0, 1e308, 1.7e308])
    const r = polynomialEquation({
      params: [
        { symbol: 'b₀', value: 1, se: 0.5, ci: null, unit: null },
        { symbol: 'b₁', value: 1e-308, se: 1e-309, ci: null, unit: null },
      ],
      coefficientsAt: () => ({ values: [1, 1e-308], se: [0.5, 1e-309] }),
      curve: () => 1e9,
      x,
      s: 1,
      exactFit: false,
      tCritical: 2,
    })
    expect(['original', 'centred']).toContain(r.tokens.form)
    const fit = runFit(
      spec({ type: 'linear' }),
      series(Array.from(x), [1e300, -2e300, 3e300, 1e300, -1e300]),
      {
        xUnit: null,
        yUnit: null,
      },
    )
    expect(['ok', 'error']).toContain(fit.status)
  })

  it('subscripted', () => {
    expect(subscripted('a', 10)).toBe('a₁₀')
  })
})

describe('coefficientText — a coefficient shown on its own is a complete number at its PDG place', () => {
  const dot = { decimal: '.' } as const
  const fitUnits = (model: FitModel, x: readonly number[], y: readonly number[]) =>
    ok(runFit(spec(model), series(x, y), { xUnit: null, yUnit: null }))

  it('a very small slope keeps its ×10⁻⁶ (formatWithUncertainty().value is only the mantissa)', () => {
    const p = Array.from({ length: 13 }, (_, i) => 500 * i)
    const e = noise(13, 1e-6, 11)
    const fit = fitUnits(
      { type: 'linear' },
      p,
      p.map((v, i) => 0.0021 + 3.4e-6 * v + e[i]),
    )
    const b1 = fit.params[1]
    const text = coefficientText(b1, dot)
    expect(text).toMatch(/^3\.\d+×10⁻⁶$/)
    // Read back, the text is the coefficient to within its rounding (never off by powers of ten).
    const [mant, exp] = text.split('×10')
    const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹'
    const e10 = -Number(
      exp
        .slice(1)
        .split('')
        .map((c) => sup.indexOf(c))
        .join(''),
    )
    expect(Math.abs(Number(mant) * 10 ** e10 - b1.value)).toBeLessThanOrEqual(b1.se as number)
  })

  it('a large-SE intercept keeps its ×10³; small values and plain values', () => {
    expect(coefficientText({ symbol: 'b₀', value: 1006.5, se: 50.35, ci: null, unit: 'Ω' }, dot)).toBe(
      '1.01×10³',
    )
    expect(coefficientText({ symbol: 'b₀', value: -1006.5, se: 50.35, ci: null, unit: null }, dot)).toBe(
      '−1.01×10³',
    )
    expect(
      coefficientText({ symbol: 'b₁', value: 47.1472727273, se: 0.0750720498733, ci: null, unit: null }, dot),
    ).toBe('47.15')
    expect(
      coefficientText({ symbol: 'b₁', value: 123456.7, se: 23, ci: null, unit: null }, { decimal: ',' }),
    ).toBe('1,23457×10⁵')
  })

  it('the a of a log-linear fit is rounded like its asymmetric CI (cooling: 63.17, not 63.1732)', () => {
    const rows = readFileSync(resolve('src/examples/cooling.csv'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.split(',').map(Number))
    const fit = fitUnits(
      { type: 'exponential' },
      rows.map((r) => r[0]),
      rows.map((r) => r[2]),
    )
    const a = fit.params[0]
    expect(a.note).toBe('asymmetric-ci')
    expect(a.se).toBeNull()
    expect(coefficientText(a, dot)).toBe('63.17')
  })

  it('without any uncertainty (exact fit) 6 significant figures', () => {
    const fit = fitUnits({ type: 'linear' }, [0, 1, 2, 3], [1, 3, 5, 7])
    expect(fit.exactFit).toBe(true)
    expect(coefficientText(fit.params[1], dot)).toBe('2.00000')
  })
})
