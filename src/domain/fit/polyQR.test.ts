import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lre, readNistLLS } from '@/test/nist'
import { rSquared } from './diagnostics'
import { fitPolynomial, horner, polyCoefficientsAt, type PolyCore } from './polyQR'

const ids = (n: number) => Int32Array.from({ length: n }, (_, i) => i)

function fitNist(name: string): { core: PolyCore; nist: ReturnType<typeof readNistLLS> } {
  const nist = readNistLLS(name)
  const degree = nist.coefficients.length - 1
  const res = fitPolynomial(
    Float64Array.from(nist.x),
    Float64Array.from(nist.y),
    ids(nist.x.length),
    degree,
    0.95,
  )
  if ('code' in res) throw new Error(`${name}: ${res.code}`)
  return { core: res, nist }
}

/** Minimum LRE over coefficients and SEs, plus s and R², printed for the record. */
function lres(name: string) {
  const { core, nist } = fitNist(name)
  const coef = Math.min(...core.coefficients.map((b, k) => lre(b, nist.coefficients[k])))
  const se = Math.min(...core.se.map((v, k) => lre(v, nist.se[k])))
  const s = lre(core.s, nist.residualSD)
  const r2v = rSquared(Float64Array.from(nist.y), core.residuals, core.p).r2 as number
  const r2 = lre(r2v, nist.r2)
  console.log(
    `[NIST ${name}] LRE coef ${coef.toFixed(1)} · SE ${se.toFixed(1)} · s ${s.toFixed(1)} · R² ${r2.toFixed(1)} · κ₁ ${core.kappa1.toPrecision(3)}`,
  )
  return { core, nist, coef, se, s, r2, r2v }
}

describe('fitPolynomial — NIST StRD', () => {
  it('Norris through degree 1: coefficients ≥ 11, SE/s/R² ≥ 12', () => {
    const r = lres('Norris')
    expect(r.coef).toBeGreaterThanOrEqual(11)
    expect(r.se).toBeGreaterThanOrEqual(12)
    expect(r.s).toBeGreaterThanOrEqual(12)
    expect(r.r2).toBeGreaterThanOrEqual(12)
  })

  it('Pontius (quadratic): coefficients ≥ 11, SE/s/R² ≥ 12', () => {
    const r = lres('Pontius')
    expect(r.coef).toBeGreaterThanOrEqual(11)
    expect(r.se).toBeGreaterThanOrEqual(12)
    expect(r.s).toBeGreaterThanOrEqual(12)
    expect(r.r2).toBeGreaterThanOrEqual(12)
  })

  it('Filip (degree 10): coefficients ≥ 10, SE/s/R² ≥ 12, κ₁ in [1e3, 3e4] (scaling applied)', () => {
    const r = lres('Filip')
    expect(r.coef).toBeGreaterThanOrEqual(10)
    expect(r.se).toBeGreaterThanOrEqual(12)
    expect(r.s).toBeGreaterThanOrEqual(12)
    expect(r.r2).toBeGreaterThanOrEqual(12)
    expect(r.core.kappa1).toBeGreaterThanOrEqual(1e3)
    expect(r.core.kappa1).toBeLessThanOrEqual(3e4)
    expect(r.core.warnings).toEqual([])
  })

  it('Wampler1 (exact degree-5 fit): |bₖ − 1| ≤ 1e-8, residuals at machine precision, R² = 1', () => {
    const { core, nist } = fitNist('Wampler1')
    const worst = Math.max(...core.coefficients.map((b) => Math.abs(b - 1)))
    console.log(
      `[NIST Wampler1] max|b − 1| = ${worst.toExponential(2)} · s/max|y| = ${(core.s / Math.max(...nist.y)).toExponential(2)}`,
    )
    expect(worst).toBeLessThanOrEqual(1e-8)
    expect(core.s).toBeLessThanOrEqual(1e-12 * Math.max(...nist.y))
    const r2 = rSquared(Float64Array.from(nist.y), core.residuals, core.p).r2 as number
    expect(Math.abs(r2 - 1)).toBeLessThanOrEqual(1e-12)
  })

  it('Wampler2 (exact fit): coefficients ≥ 11', () => {
    const { core, nist } = fitNist('Wampler2')
    const coef = Math.min(...core.coefficients.map((b, k) => lre(b, nist.coefficients[k])))
    console.log(`[NIST Wampler2] LRE coef ${coef.toFixed(1)}`)
    expect(coef).toBeGreaterThanOrEqual(11)
    expect(core.s).toBeLessThanOrEqual(1e-12 * Math.max(...nist.y.map(Math.abs)))
  })

  it.each(['Wampler3', 'Wampler4'])('%s: coefficients ≥ 8, SE/s/R² ≥ 12', (name) => {
    const r = lres(name)
    expect(r.coef).toBeGreaterThanOrEqual(8)
    expect(r.se).toBeGreaterThanOrEqual(12)
    expect(r.s).toBeGreaterThanOrEqual(12)
    expect(r.r2).toBeGreaterThanOrEqual(12)
  })

  it('Wampler5: coefficients ≥ 6.5, SE/s ≥ 12, R² ≥ 11', () => {
    const r = lres('Wampler5')
    expect(r.coef).toBeGreaterThanOrEqual(6.5)
    expect(r.se).toBeGreaterThanOrEqual(12)
    expect(r.s).toBeGreaterThanOrEqual(12)
    expect(r.r2).toBeGreaterThanOrEqual(11)
  })
})

describe('fitPolynomial — free fall quadratic (bundled example)', () => {
  const ref = JSON.parse(readFileSync(resolve('tests/fixtures/reference/freeFall.json'), 'utf8')).quadratic
  const t = Float64Array.from({ length: 15 }, (_, i) => Number((0.04 * i).toFixed(2)))
  const yv = [
    0.014, 0.03, 0.062, 0.112, 0.175, 0.257, 0.351, 0.467, 0.593, 0.737, 0.906, 1.074, 1.256, 1.468, 1.694,
  ]
  const res = fitPolynomial(t, Float64Array.from(yv), ids(15), 2, 0.95) as PolyCore

  it('matches the exact oracle to 1e-10 relative', () => {
    expect('code' in res).toBe(false)
    expect(res.df).toBe(12)
    for (let k = 0; k < 3; k++) {
      expect(res.coefficients[k]).toBeCloseTo(Number(ref.coefficients[k]), 10)
      expect(lre(res.coefficients[k], Number(ref.coefficients[k]))).toBeGreaterThan(10)
      expect(lre(res.se[k], Number(ref.se[k]))).toBeGreaterThan(10)
      expect(lre(res.ci[k][0], Number(ref.ci95[k][0]))).toBeGreaterThan(10)
      expect(lre(res.ci[k][1], Number(ref.ci95[k][1]))).toBeGreaterThan(10)
    }
    expect(lre(res.coefficients[2], Number('4.9293491435035552683'))).toBeGreaterThan(11)
    expect(lre(res.se[2], Number('0.035555860300396382949'))).toBeGreaterThan(11)
    expect(lre(res.s, Number(ref.s))).toBeGreaterThan(11)
    expect(lre(res.rss, Number(ref.rss))).toBeGreaterThan(10)
    expect(lre(res.tCritical, Number(ref.tCritical))).toBeGreaterThan(12)
    res.residuals.forEach((e, i) => expect(e).toBeCloseTo(Number(ref.residuals[i]), 12))
  })

  it('stores the scaled basis: m = midpoint, h = half-range, sy a power of two', () => {
    expect(res.m).toBeCloseTo(0.28, 15)
    expect(res.h).toBeCloseTo(0.28, 15)
    expect(Math.log2(res.sy) % 1).toBe(0)
    // Horner in t reproduces the fitted values.
    for (let i = 0; i < 15; i++) {
      expect(res.sy * horner(res.c, (t[i] - res.m) / res.h)).toBeCloseTo(yv[i] - res.residuals[i], 14)
    }
  })

  it('back-transform at x0 = 0 is the original basis; at other x0 the curve is unchanged', () => {
    const at0 = polyCoefficientsAt(res, 0)
    at0.values.forEach((v, k) => expect(v).toBe(res.coefficients[k]))
    const at = polyCoefficientsAt(res, 0.3)
    for (const x of [0, 0.17, 0.56]) {
      const u = x - 0.3
      const centred = at.values[0] + at.values[1] * u + at.values[2] * u * u
      expect(centred).toBeCloseTo(res.sy * horner(res.c, (x - res.m) / res.h), 13)
    }
    // Leading coefficient and its SE are invariant under a shift of origin.
    expect(at.values[2]).toBeCloseTo(res.coefficients[2], 12)
    expect(at.se[2]).toBeCloseTo(res.se[2], 14)
  })

  it('covariance diagonal equals SE² and leverages sum to p', () => {
    for (let k = 0; k < 3; k++) expect(Math.sqrt(res.covariance[k][k]) / res.se[k]).toBeCloseTo(1, 13)
    expect(res.covariance[0][1]).toBeCloseTo(res.covariance[1][0], 18)
    expect(res.leverage.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 12)
  })
})

describe('fitPolynomial — conditioning and errors', () => {
  it('near-duplicate design: κ₁ grows like 1/ε, warned and then refused', () => {
    const design = (eps: number) => Float64Array.from([0, 0, 0, 1, 1, 1, 1 + eps, 1 + eps, 1 + eps])
    const y = Float64Array.from([1, 1.1, 0.9, 2, 2.1, 1.9, 2.05, 1.95, 2.0])
    const k4 = fitPolynomial(design(1e-4), y, ids(9), 2, 0.95) as PolyCore
    expect(k4.warnings).toEqual([])
    expect(k4.kappa1).toBeGreaterThan(1e3)
    const k8 = fitPolynomial(design(1e-8), y, ids(9), 2, 0.95) as PolyCore
    expect(k8.warnings.map((w) => w.code)).toEqual(['W_ILL_CONDITIONED'])
    const k12 = fitPolynomial(design(1e-12), y, ids(9), 2, 0.95)
    expect('code' in k12 && k12.code).toBe('E_ILL_CONDITIONED')
    console.log(
      `[κ₁ near-duplicate] ε=1e-4: ${k4.kappa1.toPrecision(2)} · ε=1e-8: ${k8.kappa1.toPrecision(2)}`,
    )
  })

  it('runs the gates itself and rejects invalid degrees as programmer errors', () => {
    const x = Float64Array.from([1, 1, 1, 1])
    const y = Float64Array.from([1, 2, 3, 4])
    const r = fitPolynomial(x, y, ids(4), 1, 0.95)
    expect('code' in r && r.code).toBe('E_CONSTANT_X')
    expect(() => fitPolynomial(x, y, ids(4), 0, 0.95)).toThrow(RangeError)
    expect(() => fitPolynomial(x, y, ids(4), 11, 0.95)).toThrow(RangeError)
  })
})
