import type { FitOk, FitParameter } from '@/domain/derive/types'

/**
 * A quantity that is a LINEAR combination of fit parameters, q = Σ wₖpₖ (e.g. g = 2·a₂ for free fall),
 * with its exact standard error from the full covariance: SE(q) = √(wᵀ Cov w). No linearisation is
 * involved, so the SE is exact under the fit's assumptions. `weights` are aligned with fit.params.
 * se is null for exact fits, or when a weighted parameter has no symmetric covariance (the `a` of a
 * log-linear model: use ln a instead).
 */
export function linearCombination(
  fit: FitOk,
  weights: readonly number[],
): { value: number; se: number | null } {
  if (weights.length !== fit.params.length)
    throw new RangeError(`expected ${fit.params.length} weights, got ${weights.length}`)
  let value = 0
  for (let k = 0; k < weights.length; k++) if (weights[k] !== 0) value += weights[k] * fit.params[k].value
  if (fit.exactFit) return { value, se: null }
  let variance = 0
  for (let k = 0; k < weights.length; k++) {
    if (weights[k] === 0) continue
    for (let l = 0; l < weights.length; l++) {
      if (weights[l] === 0) continue
      variance += weights[k] * weights[l] * fit.covariance[k][l]
    }
  }
  if (!Number.isFinite(variance)) return { value, se: null }
  return { value, se: Math.sqrt(Math.max(0, variance)) }
}

/**
 * The derived quantity as a FitParameter (value, exact SE, t-interval at the fit's confidence with the
 * fit's df), ready for the parameter table, e.g. derivedParameter(fit, [0, 0, 2], { symbol: 'g', unit }).
 */
export function derivedParameter(
  fit: FitOk,
  weights: readonly number[],
  meta: { symbol: string; unit: string | null },
): FitParameter {
  const { value, se } = linearCombination(fit, weights)
  const t = fit.provenance.tCritical
  return {
    symbol: meta.symbol,
    value,
    se,
    ci: se !== null && t !== null && Number.isFinite(t) ? [value - t * se, value + t * se] : null,
    unit: meta.unit,
  }
}
