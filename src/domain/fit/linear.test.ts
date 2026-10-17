import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lre, readNistLLS } from '@/test/nist'
import { rSquared } from './diagnostics'
import { accurateMean, fitLinear, powerOfTwoScale } from './linear'
import { fitPolynomial, type PolyCore } from './polyQR'

const ids = (n: number) => Int32Array.from({ length: n }, (_, i) => i)
const f64 = (a: readonly (number | string)[]) => Float64Array.from(a, Number)
const json = (name: string) =>
  JSON.parse(readFileSync(resolve(`tests/fixtures/reference/${name}.json`), 'utf8'))

const OHM_I = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]
const OHM_V = [0.464, 0.941, 1.402, 1.882, 2.339, 2.808, 3.294, 3.764, 4.241, 4.706]

describe('fitLinear — NIST Norris', () => {
  it('coefficients ≥ 11, SE/s/R² ≥ 12', () => {
    const nist = readNistLLS('Norris')
    const L = fitLinear(f64(nist.x), f64(nist.y), ids(nist.x.length), 0.95)
    const coef = Math.min(lre(L.b0, nist.coefficients[0]), lre(L.b1, nist.coefficients[1]))
    const se = Math.min(lre(L.se0, nist.se[0]), lre(L.se1, nist.se[1]))
    const s = lre(L.s, nist.residualSD)
    const r2 = lre(rSquared(f64(nist.y), L.residuals, 2).r2 as number, nist.r2)
    console.log(
      `[NIST Norris closed form] LRE b₀ ${lre(L.b0, nist.coefficients[0]).toFixed(1)} · b₁ ${lre(L.b1, nist.coefficients[1]).toFixed(1)} · SE ${se.toFixed(1)} · s ${s.toFixed(1)} · R² ${r2.toFixed(1)}`,
    )
    expect(coef).toBeGreaterThanOrEqual(11)
    expect(se).toBeGreaterThanOrEqual(12)
    expect(s).toBeGreaterThanOrEqual(12)
    expect(r2).toBeGreaterThanOrEqual(12)
    expect(L.df).toBe(34)
  })
})

describe('fitLinear — Ohm example (exact oracle)', () => {
  const ref = json('ohm').linear
  const L = fitLinear(f64(OHM_I), f64(OHM_V), ids(10), 0.95)
  it('coefficients, SEs, CIs, s, RSS, t and residuals', () => {
    expect(L.df).toBe(8)
    expect(Math.abs(L.b0 - -0.009)).toBeLessThan(1e-14)
    expect(lre(L.b1, Number(ref.coefficients[1]))).toBeGreaterThan(12)
    expect(lre(L.se0, Number(ref.se[0]))).toBeGreaterThan(12)
    expect(lre(L.se1, Number(ref.se[1]))).toBeGreaterThan(12)
    expect(lre(L.s, Number(ref.s))).toBeGreaterThan(12)
    expect(lre(L.rss, Number(ref.rss))).toBeGreaterThan(11)
    expect(lre(L.tCritical, Number(ref.tCritical))).toBeGreaterThan(13)
    expect(lre(L.ci1[0], Number(ref.ci95[1][0]))).toBeGreaterThan(12)
    expect(lre(L.ci1[1], Number(ref.ci95[1][1]))).toBeGreaterThan(12)
    expect(lre(L.ci0[0], Number(ref.ci95[0][0]))).toBeGreaterThan(11)
    expect(lre(L.ci0[1], Number(ref.ci95[0][1]))).toBeGreaterThan(10)
    L.residuals.forEach((e, i) => expect(e).toBeCloseTo(Number(ref.residuals[i]), 14))
    const { r2, adjR2 } = rSquared(f64(OHM_V), L.residuals, 2)
    expect(lre(r2 as number, Number(ref.r2))).toBeGreaterThan(12)
    expect(lre(adjR2 as number, Number(ref.adjR2))).toBeGreaterThan(12)
  })

  it('closed-form covariance identities', () => {
    // x̄ = 0.055, Sxx = 0.00825 exactly in rationals.
    expect(L.xbar).toBeCloseTo(0.055, 15)
    expect(L.sxx).toBeCloseTo(0.00825, 15)
    expect(L.cov01).toBeCloseTo((-L.xbar * L.s * L.s) / L.sxx, 18)
    expect(Math.sqrt(L.var1)).toBeCloseTo(L.se1, 15)
    expect(L.leverage.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 13)
  })
})

describe('fitLinear — Anscombe I–IV', () => {
  const sets = json('anscombe').sets as Record<
    string,
    { x: string[]; y: string[]; linear: Record<string, unknown> }
  >
  it.each(['I', 'II', 'III', 'IV'])('set %s matches the exact oracle', (k) => {
    const set = sets[k]
    const ref = set.linear as { coefficients: string[]; se: string[]; s: string; r2: string; adjR2: string }
    const L = fitLinear(f64(set.x), f64(set.y), ids(11), 0.95)
    expect(lre(L.b0, Number(ref.coefficients[0]))).toBeGreaterThan(12)
    expect(lre(L.b1, Number(ref.coefficients[1]))).toBeGreaterThan(12)
    expect(lre(L.se0, Number(ref.se[0]))).toBeGreaterThan(12)
    expect(lre(L.se1, Number(ref.se[1]))).toBeGreaterThan(12)
    expect(lre(L.s, Number(ref.s))).toBeGreaterThan(12)
    const { r2, adjR2 } = rSquared(f64(set.y), L.residuals, 2)
    expect(lre(r2 as number, Number(ref.r2))).toBeGreaterThan(12)
    expect(lre(adjR2 as number, Number(ref.adjR2))).toBeGreaterThan(12)
    expect(L.xbar).toBe(9)
    expect(L.sxx / 10).toBeCloseTo(11, 13)
  })

  it('Anscombe IV: the x = 19 point has leverage 1', () => {
    const L = fitLinear(f64(sets.IV.x), f64(sets.IV.y), ids(11), 0.95)
    expect(L.leverage[7]).toBeCloseTo(1, 14)
    expect(Math.abs(L.residuals[7])).toBeLessThan(1e-12)
  })
})

describe('closed form vs polyQR(1)', () => {
  /** |Δb_k| ≤ 1e-12·(|ȳ| + |b₁x̄|) or ≤ 1e-9·SE_k (a scale-aware tolerance). */
  function agree(x: Float64Array, y: Float64Array) {
    const L = fitLinear(x, y, ids(x.length), 0.95)
    const P = fitPolynomial(x, y, ids(x.length), 1, 0.95) as PolyCore
    expect('code' in P).toBe(false)
    const scale = Math.abs(L.ybar) + Math.abs(L.b1 * L.xbar)
    const tol = (k: number) => Math.max(1e-12 * scale, 1e-9 * [L.se0, L.se1][k])
    expect(Math.abs(L.b0 - P.coefficients[0])).toBeLessThanOrEqual(tol(0))
    expect(Math.abs(L.b1 - P.coefficients[1])).toBeLessThanOrEqual(
      Math.max(1e-12 * Math.abs(L.b1), 1e-9 * L.se1),
    )
    expect(lre(P.se[0], L.se0)).toBeGreaterThan(11)
    expect(lre(P.se[1], L.se1)).toBeGreaterThan(11)
    expect(lre(P.s, L.s)).toBeGreaterThan(11)
  }

  it('agrees on Norris, Ohm, Anscombe and the example datasets', () => {
    const norris = readNistLLS('Norris')
    agree(f64(norris.x), f64(norris.y))
    agree(f64(OHM_I), f64(OHM_V))
    const sets = json('anscombe').sets as Record<string, { x: string[]; y: string[] }>
    for (const k of ['I', 'II', 'III', 'IV']) agree(f64(sets[k].x), f64(sets[k].y))
    const c = Array.from({ length: 18 }, (_, i) => 2 * Math.floor(i / 3))
    const A = [
      0.001, 0.001, 0.003, 0.195, 0.194, 0.186, 0.378, 0.384, 0.378, 0.576, 0.575, 0.583, 0.76, 0.761, 0.76,
      0.947, 0.95, 0.949,
    ]
    agree(f64(c), f64(A))
  })

  it('agrees for an intercept 100× closer to zero than Ohm (line through the origin)', () => {
    const v = OHM_V.map((vi, i) => vi + 0.009 - 0.00009 + (i % 2 ? 1e-5 : -1e-5))
    agree(f64(OHM_I), f64(v))
  })
})

describe('fitLinear — extreme magnitudes', () => {
  it('|x| ≈ 1e-170 does not underflow: the slope and its SE are correct', () => {
    const x = f64(OHM_I.map((v) => v * 1e-168))
    const y = f64(OHM_V)
    const L = fitLinear(x, y, ids(10), 0.95)
    const ref = fitLinear(f64(OHM_I), f64(OHM_V), ids(10), 0.95)
    expect(L.suu).toBeGreaterThan(0)
    expect(lre(L.b1, ref.b1 * 1e168)).toBeGreaterThan(12)
    expect(lre(L.se1, ref.se1 * 1e168)).toBeGreaterThan(12)
    expect(lre(L.b0, ref.b0)).toBeGreaterThan(11)
    expect(lre(L.s, ref.s)).toBeGreaterThan(12)
  })

  it('values near 1e200 are pre-scaled (no overflow in the sums)', () => {
    const x = f64(OHM_I.map((v) => v * 1e200))
    const y = f64(OHM_V.map((v) => v * 1e200))
    const L = fitLinear(x, y, ids(10), 0.95)
    const ref = fitLinear(f64(OHM_I), f64(OHM_V), ids(10), 0.95)
    expect(lre(L.b1, ref.b1)).toBeGreaterThan(12)
    expect(lre(L.se1, ref.se1)).toBeGreaterThan(12)
    expect(lre(L.s, ref.s * 1e200)).toBeGreaterThan(12)
    expect(L.rss).toBe(Infinity) // ~1e396: not representable; runFit turns this into E_OVERFLOW
  })

  it('accurateMean and powerOfTwoScale', () => {
    expect(accurateMean([1e308, 1e308, 1e308])).toBe(1e308)
    expect(accurateMean([1e-320, 3e-320])).toBe(2e-320)
    expect(accurateMean([])).toBeNaN()
    expect(powerOfTwoScale(3)).toBe(2)
    expect(powerOfTwoScale(0)).toBe(1)
    expect(powerOfTwoScale(1.7e308)).toBe(2 ** 1023)
  })
})
