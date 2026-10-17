import type { ConfidenceLevel } from '@/domain/model'
import { tCritical } from '@/domain/stats/tCritical'

/** Power of two closest below |m| (exact scaling: dividing by it never rounds); 1 for 0/non-finite. */
export function powerOfTwoScale(m: number): number {
  if (!(m > 0) || !Number.isFinite(m)) return 1
  const k = Math.floor(Math.log2(m))
  return 2 ** Math.max(-1074, Math.min(1023, k))
}

/**
 * Accurate mean: sum of power-of-two pre-scaled values (no overflow near the double range, no
 * underflow for tiny values), then the classic two-pass correction Σ(vᵢ − v̄)/n.
 */
export function accurateMean(v: ArrayLike<number>): number {
  const n = v.length
  if (n === 0) return NaN
  let maxAbs = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(v[i])
    if (a > maxAbs) maxAbs = a
  }
  const sc = powerOfTwoScale(maxAbs)
  let sum = 0
  for (let i = 0; i < n; i++) sum += v[i] / sc
  const mean = (sum / n) * sc
  let corr = 0
  for (let i = 0; i < n; i++) corr += (v[i] - mean) / sc
  return mean + (corr / n) * sc
}

/** Result of the closed-form simple linear regression y = b₀ + b₁·x (unweighted OLS). */
export interface LinearCore {
  n: number
  /** n − 2. */
  df: number
  b0: number
  b1: number
  se0: number
  se1: number
  cov01: number
  var0: number
  var1: number
  xbar: number
  ybar: number
  /** max|x − x̄|: the centred x values are divided by it before squaring. */
  xScale: number
  /** Σ((x − x̄)/xScale)². */
  suu: number
  /** Sxx = xScale²·suu (may under/overflow for extreme magnitudes; use xScale and suu instead). */
  sxx: number
  /** Residual standard error √(RSS/df) and residual sum of squares, in y units. */
  s: number
  rss: number
  /** eᵢ = (yᵢ − ȳ) − b₁(xᵢ − x̄), aligned with the inputs. */
  residuals: Float64Array
  /** hᵢᵢ = 1/n + (xᵢ − x̄)²/Sxx. */
  leverage: Float64Array
  tCritical: number
  ci0: readonly [number, number]
  ci1: readonly [number, number]
  rowIds: Int32Array
}

/**
 * Simple linear OLS in closed form with centred two-pass sums:
 * x̄, ȳ accurate means; uᵢ = (xᵢ − x̄)/dx, vᵢ = (yᵢ − ȳ)/dy with dx = max|x − x̄|, dy = max|y − ȳ|;
 * b₁ = (dy/dx)·Σuv/Σu², b₀ = ȳ − b₁x̄; s = √(RSS/(n − 2)); SE(b₁) = s/√Sxx; SE(b₀) = s·√(1/n + x̄²/Sxx);
 * cov(b₀, b₁) = −x̄·s²/Sxx; CI = b ± t(conf, n − 2)·SE. The pre-scaling keeps every square in range.
 * Inputs must have passed fitPreconditions (finite, x not constant); otherwise results are NaN.
 */
export function fitLinear(
  x: Float64Array,
  y: Float64Array,
  rowIds: Int32Array,
  confidence: ConfidenceLevel,
): LinearCore {
  const n = Math.min(x.length, y.length)
  const xbar = accurateMean(x.subarray(0, n))
  const ybar = accurateMean(y.subarray(0, n))
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(x[i] - xbar)
    const ay = Math.abs(y[i] - ybar)
    if (ax > dx) dx = ax
    if (ay > dy) dy = ay
  }
  const xs = dx > 0 ? dx : 1
  const ys = dy > 0 ? dy : 1
  let suu = 0
  let suv = 0
  for (let i = 0; i < n; i++) {
    const u = (x[i] - xbar) / xs
    const v = (y[i] - ybar) / ys
    suu += u * u
    suv += u * v
  }
  const beta = suv / suu
  const b1 = (beta * ys) / xs
  const b0 = ybar - b1 * xbar

  const residuals = new Float64Array(n)
  const leverage = new Float64Array(n)
  let rssScaled = 0
  for (let i = 0; i < n; i++) {
    const u = (x[i] - xbar) / xs
    const r = (y[i] - ybar) / ys - beta * u
    residuals[i] = r * ys
    rssScaled += r * r
    leverage[i] = 1 / n + (u * u) / suu
  }
  const df = n - 2
  const sScaled = df >= 1 ? Math.sqrt(rssScaled / df) : NaN
  const s = sScaled * ys
  const rss = rssScaled * ys * ys
  // SE(b₁) = s/√Sxx = s/(dx·√Σu²), written so that neither Sxx nor s² is formed.
  const se1 = s / xs / Math.sqrt(suu)
  const xbarU = xbar / xs
  const se0 = s * Math.sqrt(1 / n + (xbarU * xbarU) / suu)
  const var0 = se0 * se0
  const var1 = se1 * se1
  const cov01 = -xbarU * se1 * (s / Math.sqrt(suu))
  const t = df >= 1 ? tCritical(confidence, df) : NaN
  return {
    n,
    df,
    b0,
    b1,
    se0,
    se1,
    cov01,
    var0,
    var1,
    xbar,
    ybar,
    xScale: xs,
    suu,
    sxx: xs * xs * suu,
    s,
    rss,
    residuals,
    leverage,
    tCritical: t,
    ci0: [b0 - t * se0, b0 + t * se0],
    ci1: [b1 - t * se1, b1 + t * se1],
    rowIds: rowIds.subarray(0, n),
  }
}
