import { issue, type Issue } from '@/domain/model'
import type { EquationTokens, FitParameter } from '@/domain/derive/types'
import {
  formatInterval,
  formatNumber,
  formatValueAtUncertainty,
  roundToDecimals,
  roundUncertainty,
  type NumberFormatLocale,
} from '@/domain/format/number'
import { accurateMean } from './linear'

/** |x̄|/half-range above which the original monomial form is replaced by the centred form. */
export const CENTRING_OFFSET_RATIO = 3
/**
 * The displayed (rounded) equation must reproduce the fitted curve within this fraction of s at every
 * observed x, otherwise the centred form is used. A quadratic over x = 1990…2020
 * rounded in the original form is off by > 10·s; the free-fall quadratic y = a₀ + a₁t + a₂t² rounded
 * (0.0123, 0.240, 4.93) misses by 0.115·s and is therefore also shown centred.
 */
export const REPRODUCE_FRACTION = 0.1

/** Why the centred form was chosen (I_EQUATION_CENTRED {reason}). */
export type CentringReason = 'rounding' | 'offset'

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'
/** "a" + 12 → "a₁₂". */
export function subscripted(base: string, k: number): string {
  return (
    base +
    String(k)
      .split('')
      .map((d) => SUBSCRIPT[Number(d)])
      .join('')
  )
}

export interface PolynomialEquationInput {
  /** Original-form parameters ordered by power 0…k (linear: b₀, b₁; polynomial: a₀…aₖ). */
  params: readonly FitParameter[]
  /** Coefficients and SEs in powers of (x − x0); x0 = 0 must reproduce `params`. */
  coefficientsAt: (x0: number) => { values: readonly number[]; se: readonly number[] }
  /** The fitted curve, evaluated stably (Horner in the scaled basis). */
  curve: (x: number) => number
  /** x of the observations used in the fit. */
  x: ArrayLike<number>
  s: number
  exactFit: boolean
  tCritical: number | null
}

/** Rounds each coefficient the way the UI shows it: PDG on its SE (no SE → unrounded). */
function displayed(values: readonly number[], se: readonly (number | null)[]): number[] {
  return values.map((v, k) => {
    const u = se[k]
    if (u === null || !(u > 0) || !Number.isFinite(u)) return v
    return roundToDecimals(v, roundUncertainty(u).decimals)
  })
}

/** Max |Σ rₖ(x − x0)ᵏ − curve(x)| over the observed x. */
function maxDeviation(
  rounded: readonly number[],
  x0: number,
  xs: ArrayLike<number>,
  curve: (x: number) => number,
) {
  let worst = 0
  for (let i = 0; i < xs.length; i++) {
    const u = xs[i] - x0
    let acc = 0
    for (let k = rounded.length - 1; k >= 0; k--) acc = acc * u + rounded[k]
    const d = Math.abs(acc - curve(xs[i]))
    if (!(d <= worst)) worst = d
  }
  return worst
}

/** Round candidates for x0 near the midpoint: coarsest power of ten first, within half a half-range. */
function centreCandidates(xmin: number, xmax: number): number[] {
  const m = xmin / 2 + xmax / 2
  const h = xmax / 2 - xmin / 2
  const out: number[] = []
  if (!(h > 0) || !Number.isFinite(h) || !Number.isFinite(m)) return out
  // log10(xmax − xmin) written as log10(2h): xmax − xmin itself may overflow near the double range.
  const top = Math.ceil(Math.log10(h) + Math.log10(2))
  for (let i = 0; i <= 6; i++) {
    const step = 10 ** (top - i)
    const x0 = Number((Math.round(m / step) * step).toPrecision(12))
    if (Number.isFinite(x0) && x0 !== 0 && Math.abs(x0 - m) <= h / 2 && !out.includes(x0)) out.push(x0)
  }
  const mid = Number(m.toPrecision(12))
  if (mid !== 0 && !out.includes(mid)) out.push(mid)
  return out
}

/**
 * Equation tokens for linear and polynomial fits. The original form y = Σ bₖxᵏ is kept unless
 * |x̄|/half-range > 3, or the PDG-rounded coefficients (as displayed) fail to reproduce the fitted curve
 * within REPRODUCE_FRACTION·s at the observed x (coefficients are strongly correlated far from the
 * origin: a rounded quadratic over x = 1990…2020 can be off by ~1000). Then the centred form
 * y = Σ dₖ(x − x0)ᵏ is used, with x0 a round number near the middle of the data
 * (I_EQUATION_CENTRED {x0, reason}: 'rounding' when the rounded original form would not reproduce the
 * curve, 'offset' when only |x̄|/half-range > 3 applies). Centred coefficients get a prime (b₀′, a₁′…);
 * the leading one is unchanged. Exact fits (no SE) skip the rounding check.
 */
export function polynomialEquation(input: PolynomialEquationInput): {
  tokens: EquationTokens
  issue: Issue | null
} {
  const { params, x, s } = input
  const original: EquationTokens = {
    form: 'original',
    x0: null,
    terms: params.map((coef, power) => ({ coef, power })),
  }
  const n = x.length
  if (n === 0) return { tokens: original, issue: null }
  let xmin = Infinity
  let xmax = -Infinity
  for (let i = 0; i < n; i++) {
    if (x[i] < xmin) xmin = x[i]
    if (x[i] > xmax) xmax = x[i]
  }
  if (!(xmax > xmin)) return { tokens: original, issue: null }
  const h = xmax / 2 - xmin / 2
  const xbar = accurateMean(Array.from({ length: n }, (_, i) => x[i]))
  const tol = REPRODUCE_FRACTION * s
  const checkRounding = !input.exactFit && s > 0
  const reproduces = (values: readonly number[], se: readonly (number | null)[], x0: number) =>
    !checkRounding || maxDeviation(displayed(values, se), x0, x, input.curve) <= tol

  const offset = Math.abs(xbar) / h > CENTRING_OFFSET_RATIO
  const origOk = reproduces(
    params.map((p) => p.value),
    params.map((p) => p.se),
    0,
  )
  if (!offset && origOk) return { tokens: original, issue: null }

  const candidates = centreCandidates(xmin, xmax)
  if (candidates.length === 0) return { tokens: original, issue: null }
  let chosen = candidates[0]
  let chosenCoefs = input.coefficientsAt(chosen)
  for (const x0 of candidates) {
    const coefs = input.coefficientsAt(x0)
    if (reproduces(coefs.values, coefs.se, x0)) {
      chosen = x0
      chosenCoefs = coefs
      break
    }
  }
  const last = params.length - 1
  const t = input.tCritical
  const terms = params.map((p, k) => {
    const value = chosenCoefs.values[k]
    const se = input.exactFit ? null : chosenCoefs.se[k]
    const coef: FitParameter = {
      symbol: k === last ? p.symbol : `${p.symbol}′`,
      value,
      se,
      ci: se !== null && t !== null && Number.isFinite(t) ? [value - t * se, value + t * se] : null,
      unit: p.unit,
    }
    return { coef, power: k }
  })
  const reason: CentringReason = origOk ? 'offset' : 'rounding'
  return {
    tokens: { form: 'centred', x0: chosen, terms },
    issue: issue('I_EQUATION_CENTRED', { x0: chosen, reason }),
  }
}

/**
 * Log-linear models keep their natural form: exponential y = a·e^(b·x), power y = a·x^b.
 * Terms are [a (power 0), b (power 1)]; the renderer chooses the formula from the model type.
 */
export function logLinearEquation(a: FitParameter, b: FitParameter): EquationTokens {
  return {
    form: 'original',
    x0: null,
    terms: [
      { coef: a, power: 0 },
      { coef: b, power: 1 },
    ],
  }
}

/**
 * A coefficient's value as shown on its own (equation, parameter table), never more precise than its
 * uncertainty supports, and always a complete number:
 * - with an SE: the PDG place of the SE, the shared power of ten written out ("3.4000×10⁻⁶", "1.01×10³");
 * - the a of log-linear models (no SE, asymmetric CI): the place formatInterval gives it ("63.17");
 * - otherwise (exact fit: no uncertainty) 6 significant figures.
 */
export function coefficientText(coef: FitParameter, loc: NumberFormatLocale): string {
  if (coef.se !== null && coef.se > 0 && Number.isFinite(coef.se))
    return formatValueAtUncertainty(coef.value, coef.se, loc)
  if (coef.note === 'asymmetric-ci' && coef.ci && coef.ci.every(Number.isFinite))
    return formatInterval(coef.value, coef.ci[0], coef.ci[1], loc).value
  return formatNumber(coef.value, { sig: 6, loc })
}
