/**
 * Student-t critical values for confidence intervals.
 *
 * tCritical(c, ν) returns the t > 0 such that P(|T| < t) = c for T ~ Student-t with ν (integer)
 * degrees of freedom; e.g. tCritical(0.95, 10) = t_{0.975, 10} ≈ 2.2281388519862747.
 *
 * Method: the exact finite-series form of A(t|ν) = P(|T| < t) for integer ν
 * (Abramowitz & Stegun 26.7.3 / 26.7.4), written in θ = atan(t/√ν). Every series term is positive,
 * so there is no cancellation. A(θ) is strictly increasing on (0, π/2); we bisect θ until the
 * interval stops shrinking, then return t = √ν·tan θ.
 *
 * Verified in tests against an independent oracle (scripts/oracle/reference_values.py: regularised
 * incomplete beta by continued fraction in 50-digit Decimal arithmetic).
 *
 * In this app ν = n − p is always a positive integer. (We do not use @stdlib here: its feature
 * detection calls eval(), which our Content-Security-Policy forbids.)
 */
export function tCritical(confidence: number, df: number): number {
  if (!(confidence > 0 && confidence < 1))
    throw new RangeError(`confidence must be in (0, 1), got ${confidence}`)
  if (!Number.isInteger(df) || df < 1) throw new RangeError(`df must be a positive integer, got ${df}`)
  const key = `${confidence}|${df}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  let lo = 0
  let hi = Math.PI / 2
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (mid <= lo || mid >= hi) break
    if (twoSidedProbability(mid, df) < confidence) lo = mid
    else hi = mid
  }
  const theta = 0.5 * (lo + hi)
  const t = Math.sqrt(df) * Math.tan(theta)
  cache.set(key, t)
  return t
}

const cache = new Map<string, number>()

/** A(t|ν) = P(|T| < t) written as a function of θ = atan(t/√ν), for integer ν ≥ 1. */
export function twoSidedProbability(theta: number, df: number): number {
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  const c2 = c * c
  if (df % 2 === 1) {
    // ν odd: A = (2/π)[θ + sinθ·(cosθ + (2/3)cos³θ + … + (2·4…(ν−3))/(1·3…(ν−2))·cos^(ν−2)θ)]
    if (df === 1) return (2 * theta) / Math.PI
    let term = c
    let sum = c
    for (let k = 3; k <= df - 2; k += 2) {
      term *= ((k - 1) / k) * c2
      sum += term
    }
    return (2 / Math.PI) * (theta + s * sum)
  }
  // ν even: A = sinθ·[1 + (1/2)cos²θ + (1·3)/(2·4)cos⁴θ + … + (1·3…(ν−3))/(2·4…(ν−2))·cos^(ν−2)θ]
  let term = 1
  let sum = 1
  for (let k = 2; k <= df - 2; k += 2) {
    term *= ((k - 1) / k) * c2
    sum += term
  }
  return s * sum
}

/** Two-sided p-value-free helper used by tests: P(|T| < t). */
export function studentTwoSided(t: number, df: number): number {
  return twoSidedProbability(Math.atan(Math.abs(t) / Math.sqrt(df)), df)
}
