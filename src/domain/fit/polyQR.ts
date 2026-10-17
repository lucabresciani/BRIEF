import { issue, type ConfidenceLevel, type Issue } from '@/domain/model'
import type { FitErrorCode } from '@/domain/derive/types'
import { tCritical } from '@/domain/stats/tCritical'
import { fitPreconditions } from './gates'
import { powerOfTwoScale } from './linear'

/** Highest degree supported by the core (NIST Filip); the UI caps it lower. */
export const MAX_DEGREE = 10
/** Thresholds on κ₁, the 1-norm condition number of R: warn above 1e6, refuse above 1e10. */
export const KAPPA_WARN = 1e6
export const KAPPA_REFUSE = 1e10
const EPS = 2.220446049250313e-16
const MIN_NORMAL = 2.2250738585072014e-308

type FitIssue = Issue & { code: FitErrorCode }

/** Unweighted polynomial OLS solved by Householder QR in the scaled basis t = (x − m)/h. */
export interface PolyCore {
  n: number
  degree: number
  /** degree + 1. */
  p: number
  /** n − p. */
  df: number
  /** Midpoint and half-range of x. */
  m: number
  h: number
  /** Power-of-two scale of y. */
  sy: number
  /** Coefficients in the t basis, in units of y/sy (predictions: sy·Σ cⱼtʲ by Horner). */
  c: number[]
  /** Upper-triangular R (p×p) of the QR of the scaled Vandermonde matrix (unitless). */
  r: number[][]
  /** R⁻¹ (upper triangular). */
  rInv: number[][]
  /** Coefficients in the ORIGINAL parameterisation y = Σ bₖxᵏ (y units). */
  coefficients: number[]
  se: number[]
  ci: [number, number][]
  covariance: number[][]
  s: number
  rss: number
  residuals: Float64Array
  leverage: Float64Array
  kappa1: number
  tCritical: number
  warnings: Issue[]
  rowIds: Int32Array
}

const fitIssue = (code: FitErrorCode, params?: Issue['params']): FitIssue => issue(code, params) as FitIssue

/** Binomial coefficients C(j, k) for j, k ≤ n (exact integers). */
function binomials(n: number): number[][] {
  const C: number[][] = []
  for (let j = 0; j <= n; j++) {
    C.push(new Array<number>(n + 1).fill(0))
    C[j][0] = 1
    for (let k = 1; k <= j; k++) C[j][k] = C[j - 1][k - 1] + (k <= j - 1 ? C[j - 1][k] : 0)
  }
  return C
}

/** Euclidean norm with max-abs scaling (no overflow/underflow; plain loops, never Math.hypot(...a)). */
export function scaledNorm(v: ArrayLike<number>): number {
  let mx = 0
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i])
    if (a > mx) mx = a
  }
  if (mx === 0 || !Number.isFinite(mx)) return mx
  let ss = 0
  for (let i = 0; i < v.length; i++) {
    const q = v[i] / mx
    ss += q * q
  }
  return mx * Math.sqrt(ss)
}

/** Horner evaluation of Σ cⱼtʲ. */
export function horner(c: readonly number[], t: number): number {
  let acc = 0
  for (let j = c.length - 1; j >= 0; j--) acc = acc * t + c[j]
  return acc
}

/** Solves Rᵀw = v (forward substitution; R upper triangular). */
export function solveRTranspose(r: readonly (readonly number[])[], v: readonly number[]): number[] {
  const p = v.length
  const w = new Array<number>(p).fill(0)
  for (let i = 0; i < p; i++) {
    let acc = v[i]
    for (let k = 0; k < i; k++) acc -= r[k][i] * w[k]
    w[i] = acc / r[i][i]
  }
  return w
}

/** 1-norm (max column absolute sum) of a square matrix. */
function norm1(a: readonly (readonly number[])[]): number {
  let best = 0
  for (let j = 0; j < a.length; j++) {
    let col = 0
    for (let i = 0; i < a.length; i++) col += Math.abs(a[i][j])
    if (col > best) best = col
  }
  return best
}

/**
 * Coefficients and standard errors of the fitted polynomial in powers of (x − x0):
 * y = Σ dₖ(x − x0)ᵏ. With δ = m − x0, t = ((x − x0) − δ)/h, so d = sy·T·c with
 * T[k][j] = C(j,k)·(−δ/h)^(j−k)·(1/h)^k (j ≥ k), and Cov_d = s²·(T R⁻¹)(T R⁻¹)ᵀ.
 * x0 = 0 gives the original monomial coefficients b. Powers by repeated multiplication.
 */
export function polyCoefficientsAt(
  core: Pick<PolyCore, 'm' | 'h' | 'sy' | 'c' | 'rInv' | 's'>,
  x0: number,
): { values: number[]; se: number[]; covariance: number[][] } {
  const p = core.c.length
  const C = binomials(p - 1)
  const ratio = -(core.m - x0) / core.h
  const g = 1 / core.h
  const T: number[][] = []
  for (let k = 0; k < p; k++) {
    const row = new Array<number>(p).fill(0)
    let gk = 1
    for (let q = 0; q < k; q++) gk *= g
    let rp = 1
    for (let j = k; j < p; j++) {
      row[j] = C[j][k] * rp * gk
      rp *= ratio
    }
    T.push(row)
  }
  const values: number[] = []
  const A: number[][] = []
  for (let k = 0; k < p; k++) {
    let acc = 0
    for (let j = k; j < p; j++) acc += T[k][j] * core.c[j]
    values.push(acc * core.sy)
    const ak = new Array<number>(p).fill(0)
    for (let j = 0; j < p; j++) {
      let s = 0
      // (T R⁻¹)[k][j] = Σ_{q=k..j} T[k][q]·R⁻¹[q][j] (both upper triangular).
      for (let q = k; q <= j; q++) s += T[k][q] * core.rInv[q][j]
      ak[j] = s
    }
    A.push(ak)
  }
  const se = A.map((row) => core.s * scaledNorm(row))
  const covariance: number[][] = []
  for (let k = 0; k < p; k++) {
    const row: number[] = []
    for (let l = 0; l < p; l++) {
      let acc = 0
      for (let j = 0; j < p; j++) acc += core.s * A[k][j] * (core.s * A[l][j])
      row.push(acc)
    }
    covariance.push(row)
  }
  return { values, se, covariance }
}

/**
 * Polynomial OLS of degree k ≤ 10:
 * t = (x − m)/h with m = midpoint, h = half-range (t ∈ [−1, 1]); y divided by a power of two;
 * V[i][j] = tᵢʲ by repeated multiplication; unpivoted Householder QR (LAPACK dgeqr2 style) applied to
 * V and y; rank test |R_jj| ≤ n·ε·max|R_ii| → E_ILL_CONDITIONED; κ₁ = ‖R‖₁‖R⁻¹‖₁ (> 1e10 → refused,
 * > 1e6 → W_ILL_CONDITIONED); back-substitution R c = Qᵀy; residuals computed directly as
 * y − Horner_t(c, t); s² = RSS/(n − p); Cov_c = s²R⁻¹R⁻ᵀ; back-transform b = T c, Cov_b = T Cov_c Tᵀ.
 * Predictions, curves and bands always use c in the t basis, never b.
 */
export function fitPolynomial(
  x: Float64Array,
  y: Float64Array,
  rowIds: Int32Array,
  degree: number,
  confidence: ConfidenceLevel,
): PolyCore | FitIssue {
  if (!Number.isInteger(degree) || degree < 1 || degree > MAX_DEGREE)
    throw new RangeError(`degree must be an integer in [1, ${MAX_DEGREE}], got ${degree}`)
  const gate = fitPreconditions({ type: 'polynomial', degree }, x, y, rowIds)
  if (gate) return gate
  const n = Math.min(x.length, y.length)
  const p = degree + 1

  let xmin = Infinity
  let xmax = -Infinity
  let ymaxAbs = 0
  for (let i = 0; i < n; i++) {
    if (x[i] < xmin) xmin = x[i]
    if (x[i] > xmax) xmax = x[i]
    const a = Math.abs(y[i])
    if (a > ymaxAbs) ymaxAbs = a
  }
  const m = xmin / 2 + xmax / 2
  const h = xmax / 2 - xmin / 2
  const sy = powerOfTwoScale(ymaxAbs)

  const t = new Float64Array(n)
  for (let i = 0; i < n; i++) t[i] = (x[i] - m) / h
  // Column-major Vandermonde in t.
  const V = new Float64Array(n * p)
  for (let i = 0; i < n; i++) {
    let pw = 1
    for (let j = 0; j < p; j++) {
      V[j * n + i] = pw
      pw *= t[i]
    }
  }
  const z = new Float64Array(n)
  for (let i = 0; i < n; i++) z[i] = y[i] / sy

  const diag = new Array<number>(p).fill(0)
  const v = new Float64Array(n)
  for (let k = 0; k < p; k++) {
    const col = k * n
    let ss = 0
    for (let i = k; i < n; i++) ss += V[col + i] * V[col + i]
    const norm = Math.sqrt(ss)
    if (norm === 0) {
      diag[k] = 0
      continue
    }
    const x1 = V[col + k]
    const alpha = x1 >= 0 ? -norm : norm
    for (let i = k; i < n; i++) v[i] = V[col + i]
    v[k] = x1 - alpha
    // vᵀv = 2‖x‖(‖x‖ + |x₁|), exact algebra without cancellation.
    const vtv = 2 * norm * (norm + Math.abs(x1))
    for (let j = k + 1; j < p; j++) {
      const cj = j * n
      let dot = 0
      for (let i = k; i < n; i++) dot += v[i] * V[cj + i]
      const f = (2 * dot) / vtv
      for (let i = k; i < n; i++) V[cj + i] -= f * v[i]
    }
    let dz = 0
    for (let i = k; i < n; i++) dz += v[i] * z[i]
    const fz = (2 * dz) / vtv
    for (let i = k; i < n; i++) z[i] -= fz * v[i]
    diag[k] = alpha
  }

  const r: number[][] = []
  for (let i = 0; i < p; i++) {
    const row = new Array<number>(p).fill(0)
    row[i] = diag[i]
    for (let j = i + 1; j < p; j++) row[j] = V[j * n + i]
    r.push(row)
  }
  let maxDiag = 0
  for (let i = 0; i < p; i++) maxDiag = Math.max(maxDiag, Math.abs(diag[i]))
  for (let i = 0; i < p; i++) {
    if (!(Math.abs(diag[i]) > n * EPS * maxDiag))
      return fitIssue('E_ILL_CONDITIONED', { reason: 'rank', degree })
  }

  const rInv: number[][] = []
  for (let i = 0; i < p; i++) rInv.push(new Array<number>(p).fill(0))
  for (let j = 0; j < p; j++) {
    rInv[j][j] = 1 / r[j][j]
    for (let i = j - 1; i >= 0; i--) {
      let acc = 0
      for (let q = i + 1; q <= j; q++) acc += r[i][q] * rInv[q][j]
      rInv[i][j] = -acc / r[i][i]
    }
  }
  const kappa1 = norm1(r) * norm1(rInv)
  if (!(kappa1 <= KAPPA_REFUSE))
    return fitIssue('E_ILL_CONDITIONED', { reason: 'kappa', degree, kappa: Number(kappa1.toPrecision(2)) })
  const warnings: Issue[] = []
  if (kappa1 > KAPPA_WARN) warnings.push(issue('W_ILL_CONDITIONED', { kappa: Number(kappa1.toPrecision(2)) }))

  const c = new Array<number>(p).fill(0)
  for (let i = p - 1; i >= 0; i--) {
    let acc = z[i]
    for (let j = i + 1; j < p; j++) acc -= r[i][j] * c[j]
    c[i] = acc / r[i][i]
  }

  const residuals = new Float64Array(n)
  let rssScaled = 0
  for (let i = 0; i < n; i++) {
    const e = y[i] / sy - horner(c, t[i])
    residuals[i] = e * sy
    rssScaled += e * e
  }
  const df = n - p
  const sScaled = Math.sqrt(rssScaled / df)
  const s = sScaled * sy
  const rss = rssScaled * sy * sy

  // Leverage hᵢᵢ = ‖R⁻ᵀvᵢ‖² with vᵢ = [1, tᵢ, …, tᵢᵏ].
  const leverage = new Float64Array(n)
  const vi = new Array<number>(p).fill(0)
  for (let i = 0; i < n; i++) {
    let pw = 1
    for (let j = 0; j < p; j++) {
      vi[j] = pw
      pw *= t[i]
    }
    const w = solveRTranspose(r, vi)
    let q = 0
    for (let j = 0; j < p; j++) q += w[j] * w[j]
    leverage[i] = q
  }

  const original = polyCoefficientsAt({ m, h, sy, c, rInv, s }, 0)
  const tc = tCritical(confidence, df)
  const ci = original.values.map((b, k): [number, number] => [
    b - tc * original.se[k],
    b + tc * original.se[k],
  ])
  for (const se of original.se) {
    // A standard error that underflowed (or overflowed) cannot be represented: change units.
    if (s > 0 && !(se >= MIN_NORMAL && Number.isFinite(se)))
      return fitIssue('E_OVERFLOW', { stage: 'back-transform' })
  }
  return {
    n,
    degree,
    p,
    df,
    m,
    h,
    sy,
    c,
    r,
    rInv,
    coefficients: original.values,
    se: original.se,
    ci,
    covariance: original.covariance,
    s,
    rss,
    residuals,
    leverage,
    kappa1,
    tCritical: tc,
    warnings,
    rowIds: rowIds.subarray(0, n),
  }
}
