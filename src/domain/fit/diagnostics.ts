import { issue, type ConfidenceLevel, type Issue, type RowId } from '@/domain/model'
import { CELL, type ErrorBarArrays, type FitBasis } from '@/domain/derive/types'
import { tCritical } from '@/domain/stats/tCritical'
import { accurateMean } from './linear'

const EPS = 2 ** -52
/**
 * Exact-fit threshold in units of ε·(rounding-noise scale): s ≤ 64·ε·scale. Measured residual noise of
 * true exact fits in this code is below 1·ε·scale (Wampler1/2, decimal lines, exact polynomials and
 * Chebyshev shapes up to degree 10, exponential and power laws, n = 5000; at most 0.75), so 64 leaves a
 * margin > 80, while real scatter above ≈ 1.4e-14 of max|y| (clock frequencies, epoch timestamps as y)
 * keeps its uncertainties. The former rule s ≤ 1e-12·max|y| (≈ 4500·ε) declared such data exact.
 */
export const EXACT_FIT_ULPS = 64
/** Residuals with |r| ≤ 1e-12·s are skipped in the sign runs (exact zeros such as Anscombe IV's h = 1). */
const SIGN_SKIP_RELATIVE = 1e-12
/** Leverage above which a single observation determines the fit (Anscombe IV: h = 1). */
export const HIGH_LEVERAGE = 0.9
/** |R²| below this is rounding noise and shown as 0. */
const R2_NOISE = 1e-12

/**
 * R² = 1 − RSS/TSS with the CENTRED total sum of squares (all models have an intercept), and
 * adjusted R² = 1 − (RSS/(n − p))/(TSS/(n − 1)), never clamped (it can be negative).
 * Both are null when every response value is identical (checked on the values, min = max, not on a
 * rounded TSS). Sums are taken on values divided by a common scale, so 1e200 data do not overflow.
 * `response` is what was fitted: y, or ln y for log-linear models.
 */
export function rSquared(
  response: ArrayLike<number>,
  residuals: ArrayLike<number>,
  p: number,
): { r2: number | null; adjR2: number | null; responseConstant: boolean } {
  const n = Math.min(response.length, residuals.length)
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    if (response[i] < lo) lo = response[i]
    if (response[i] > hi) hi = response[i]
  }
  if (n === 0 || lo === hi) return { r2: null, adjR2: null, responseConstant: n > 0 }
  const ybar = accurateMean(Array.from({ length: n }, (_, i) => response[i]))
  let d = 0
  for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(response[i] - ybar), Math.abs(residuals[i]))
  let tss = 0
  let rss = 0
  for (let i = 0; i < n; i++) {
    const a = (response[i] - ybar) / d
    const e = residuals[i] / d
    tss += a * a
    rss += e * e
  }
  let r2 = 1 - rss / tss
  if (Math.abs(r2) < R2_NOISE) r2 = 0
  const adjR2 = n - p >= 1 ? 1 - rss / (n - p) / (tss / (n - 1)) : null
  return { r2, adjR2, responseConstant: false }
}

/**
 * Magnitude whose rounding by the ALGORITHM sets the residual noise of an exact fit (max over the
 * observations), so that ε·scale is the size of residuals that are "zero to machine precision":
 * - linear: |y| (the centred residual (y − ȳ) − b₁(x − x̄));
 * - polynomial: |y| + sy·(Σ|cₖ||t|ᵏ + |p′(t)||t|): Horner in the scaled basis adds the rounding of
 *   every term, which for cancelling coefficients of a high degree (Chebyshev-like shapes) is ~10³·|y|,
 *   and t = (x − m)/h is rounded relatively;
 * - log-linear: 1 + |ln y| (a relative rounding of y moves ln y by ε), plus |b|·|ln x| for power laws
 *   (rounding of ln x).
 * The binary representation of x itself is not included: residuals it causes are information about
 * the stored data and are reported as (tiny) uncertainties, never hidden as an exact fit.
 */
export function roundingNoiseScale(
  basis: FitBasis,
  x: ArrayLike<number>,
  response: ArrayLike<number>,
): number {
  const n = Math.min(x.length, response.length)
  let scale = 0
  for (let i = 0; i < n; i++) {
    const y = Math.abs(response[i])
    let v: number
    switch (basis.kind) {
      case 'linear':
        v = y
        break
      case 'logLinear':
        v = 1 + y + (basis.x === 'ln' ? Math.abs(basis.b * Math.log(x[i])) : 0)
        break
      case 'scaledPoly': {
        const c = basis.c
        const t = (x[i] - basis.m) / basis.h
        const at = Math.abs(t)
        let terms = 0
        let deriv = 0
        for (let k = c.length - 1; k >= 0; k--) {
          terms = terms * at + Math.abs(c[k])
          if (k >= 1) deriv = deriv * t + k * c[k]
        }
        v = y + basis.sy * (terms + Math.abs(deriv) * at)
        break
      }
    }
    if (v > scale || Number.isNaN(v)) scale = v
  }
  // Terms near the double range may overflow: the floor is then ≈ the largest double, never ∞ (which
  // would declare any fit exact).
  return scale === Infinity ? Number.MAX_VALUE : scale
}

/**
 * Exact fit: s ≤ EXACT_FIT_ULPS·ε·scale, with scale = roundingNoiseScale(…) (≈ max|y|): the residuals
 * are rounding noise, so parameter uncertainties cannot be estimated (Wampler1/2). NaN s → false.
 */
export function isExactFit(s: number, scale: number): boolean {
  return s <= EXACT_FIT_ULPS * EPS * scale
}

/**
 * Residual signs ordered by x (ties broken by RowId), e.g. "+++---------+++". Residuals with
 * |r| ≤ 1e-12·s are skipped (exact zeros such as the h = 1 point of Anscombe IV). An exact fit has
 * only rounding noise, so it yields "". Descriptive only: a long same-sign stretch suggests the model
 * misses curvature; it never proves that a model is adequate.
 */
export function residualSignRuns(
  residuals: ArrayLike<number>,
  x: ArrayLike<number>,
  rowIds: ArrayLike<number>,
  s: number,
  exactFit = false,
): string {
  if (exactFit) return ''
  const n = Math.min(residuals.length, x.length, rowIds.length)
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b] || rowIds[a] - rowIds[b])
  const tol = SIGN_SKIP_RELATIVE * s
  let out = ''
  for (const i of order) {
    const r = residuals[i]
    if (r > tol) out += '+'
    else if (r < -tol) out += '-'
  }
  return out
}

/** Largest leverage and the rows above HIGH_LEVERAGE (or the row attaining the maximum). */
export function leverageSummary(
  leverage: ArrayLike<number>,
  rowIds: ArrayLike<number>,
): { h: number; rows: RowId[] } {
  let h = -Infinity
  let arg = -1
  const high: RowId[] = []
  for (let i = 0; i < leverage.length; i++) {
    if (leverage[i] > h) {
      h = leverage[i]
      arg = i
    }
    if (leverage[i] > HIGH_LEVERAGE) high.push(rowIds[i] as RowId)
  }
  if (arg < 0) return { h: NaN, rows: [] }
  return { h, rows: high.length ? high : [rowIds[arg] as RowId] }
}

/** W_HIGH_LEVERAGE {count, h} with the rows, when max hᵢᵢ > 0.9. */
export function highLeverageIssue(summary: { h: number; rows: readonly RowId[] }): Issue | null {
  if (!(summary.h > HIGH_LEVERAGE)) return null
  return issue(
    'W_HIGH_LEVERAGE',
    { count: summary.rows.length, h: Number(summary.h.toPrecision(3)) },
    { rows: summary.rows },
  )
}

/** W_FEW_DOF {df, t} when df ≤ 3 or degree ≥ n/2: the t multiplier is large and intervals are wide. */
export function fewDofIssue(
  df: number,
  degree: number,
  n: number,
  confidence: ConfidenceLevel,
): Issue | null {
  if (!(df >= 1) || !(df <= 3 || degree >= n / 2)) return null
  return issue('W_FEW_DOF', { df, t: Number(tCritical(confidence, df).toPrecision(4)) })
}

/**
 * Neutral comparison of the residual SD s with the typical supplied measurement uncertainty u(y)
 * over the rows used in the fit (no χ², no weighting). Expanded uncertainties U = k·u are divided by k
 * so both are standard uncertainties; asymmetric bars use (u₊ + u₋)/2. Only for 'measurement' bars
 * aligned with the series rows whose meaning is DECLARED (standard u, or U with its k): an uncertainty
 * of unstated meaning could be U with k = 2, and comparing it with s as if it were u would suggest
 * stated uncertainties twice the scatter, so a meaning is never assumed until the user declares it.
 * Null otherwise, and when no valid u(y) exists.
 */
export function uComparison(
  bars: ErrorBarArrays | null | undefined,
  seriesIndices: ArrayLike<number>,
  s: number,
): { s: number; medianU: number } | null {
  if (!bars || bars.descriptor.kind !== 'measurement') return null
  const key = bars.descriptor.labelKey
  const expanded = key === 'uncertainty.label.measurement.expanded'
  if (!expanded && key !== 'uncertainty.label.measurement.standard') return null
  const k = expanded ? Number(bars.descriptor.params.k) : 1
  if (!(k > 0)) return null
  const us: number[] = []
  for (let j = 0; j < seriesIndices.length; j++) {
    const i = seriesIndices[j]
    if (i >= bars.plus.length || bars.status[i] !== CELL.ok) continue
    const plus = bars.plus[i]
    const u = bars.minus ? (plus + bars.minus[i]) / 2 : plus
    if (Number.isFinite(u) && u >= 0) us.push(u / k)
  }
  if (us.length === 0) return null
  us.sort((a, b) => a - b)
  const mid = us.length >> 1
  const medianU = us.length % 2 ? us[mid] : (us[mid - 1] + us[mid]) / 2
  return { s, medianU }
}
