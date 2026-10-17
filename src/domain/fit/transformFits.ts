import { issue, type ConfidenceLevel, type Issue } from '@/domain/model'
import type { FitErrorCode } from '@/domain/derive/types'
import { fitPreconditions } from './gates'
import { fitLinear, type LinearCore } from './linear'

const MIN_NORMAL = 2.2250738585072014e-308
type FitIssue = Issue & { code: FitErrorCode }

/**
 * Log-linearised least squares, honestly labelled "least squares on ln y":
 * - exponential y = a·e^(b·x): ordinary least squares of Y = ln y on X = x;
 * - power law y = a·x^b: ordinary least squares of Y = ln y on X = ln x.
 * This is the maximum-likelihood fit under multiplicative (log-normal) scatter with constant σ of ln y;
 * exp(ln a + b·X) is the geometric-mean (median) curve, not the mean. Reported: b ± SE (symmetric),
 * ln a ± SE, and a = exp(ln a) with the ASYMMETRIC interval exp(CI of ln a), never a ± for a.
 * R² refers to ln y; residuals are ln y − ln ŷ.
 */
export interface LogLinearCore {
  model: 'exponential' | 'power'
  /** Regressor X (x or ln x) and response Y = ln y, aligned with the inputs. */
  X: Float64Array
  Y: Float64Array
  /** The linear fit of Y on X (b₀ = ln a, b₁ = b; residuals in ln y). */
  linear: LinearCore
  lnA: number
  b: number
  a: number
  /** exp of the CI of ln a: asymmetric around a. */
  aCI: readonly [number, number]
}

/**
 * Fits an exponential or power-law model on the log scale. Domain violations are an error listing the
 * rows (E_LOG_DOMAIN_FIT); rows are never dropped silently. a must be representable as a normal double
 * (|ln a| ≲ 708), otherwise E_OVERFLOW asks for a change of units/origin.
 */
export function fitLogLinear(
  model: 'exponential' | 'power',
  x: Float64Array,
  y: Float64Array,
  rowIds: Int32Array,
  confidence: ConfidenceLevel,
): LogLinearCore | FitIssue {
  const gate = fitPreconditions({ type: model }, x, y, rowIds)
  if (gate) return gate
  const n = Math.min(x.length, y.length)
  const X = new Float64Array(n)
  const Y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    X[i] = model === 'power' ? Math.log(x[i]) : x[i]
    Y[i] = Math.log(y[i])
  }
  const linear = fitLinear(X, Y, rowIds, confidence)
  const a = Math.exp(linear.b0)
  const aCI: [number, number] = [Math.exp(linear.ci0[0]), Math.exp(linear.ci0[1])]
  if (!(a >= MIN_NORMAL && Number.isFinite(a)))
    return issue('E_OVERFLOW', { stage: 'exp', lnA: Number(linear.b0.toPrecision(4)) }) as FitIssue
  return { model, X, Y, linear, lnA: linear.b0, b: linear.b1, a, aCI }
}
