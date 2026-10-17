import type { FitParameter } from '@/domain/derive/types'
import { coefficientText } from '@/domain/fit/equation'
import {
  formatInterval,
  formatNumber,
  formatWithUncertainty,
  roundUncertainty,
  superscript,
  type NumberFormatLocale,
} from '@/domain/format/number'

export interface ParameterCells {
  /** "47.15 ± 0.08", "(47.15 ± 0.08)" before a unit, "(3.4000 ± 0.0019)×10⁻⁶", or the value alone. */
  value: string
  /** "[46.97; 47.32]", "[0.90; 1.12]×10³"; null when there is no interval. */
  ci: string | null
}

const hasSe = (se: number | null): se is number => se !== null && se > 0 && Number.isFinite(se)
const finiteCi = (ci: FitParameter['ci']): ci is readonly [number, number] =>
  ci !== null && ci.every(Number.isFinite)

/**
 * The two cells of a parameter row, never more precise than the uncertainty supports:
 * - with an SE: value ± SE by the PDG rule, and the CI bounds at the same decimal place. When the value
 *   uses a shared power of ten the bounds share it too: (1.01 ± 0.05)×10³ → [0.90; 1.12]×10³.
 * - the a of log-linear models (asymmetric interval, no SE): value and bounds as formatInterval rounds
 *   them, so the value matches the equation (coefficientText).
 * - otherwise (exact fit) the value to 6 significant figures, as in the equation.
 */
export function parameterCells(
  p: FitParameter,
  loc: NumberFormatLocale,
  opts: { withUnit: boolean },
): ParameterCells {
  if (hasSe(p.se)) {
    const f = formatWithUncertainty(p.value, p.se, loc)
    // "(47.15 ± 0.08) V/A": the unit applies to both numbers. "(…)×10ⁿ" is already enclosed.
    const value = opts.withUnit && f.sharedExponent === null ? `(${f.text})` : f.text
    if (!finiteCi(p.ci)) return { value, ci: null }
    const dec = roundUncertainty(p.se).decimals
    const n = f.sharedExponent
    if (n === null) {
      const b = (v: number) => formatNumber(v, { decimals: dec, loc })
      return { value, ci: `[${b(p.ci[0])}; ${b(p.ci[1])}]` }
    }
    // Mantissas at the value's decimal place: scaling by an exact power of ten (one rounding, far below
    // the 15 significant figures the formatter reads), the rounding itself left to formatNumber.
    const scaled = (v: number) => (n >= 0 ? v / 10 ** n : v * 10 ** -n)
    const b = (v: number) => formatNumber(scaled(v), { decimals: dec + n, loc })
    return { value, ci: `[${b(p.ci[0])}; ${b(p.ci[1])}]×10${superscript(n)}` }
  }
  if (p.note === 'asymmetric-ci' && finiteCi(p.ci)) {
    const f = formatInterval(p.value, p.ci[0], p.ci[1], loc)
    return { value: f.value, ci: `[${f.lower}; ${f.upper}]` }
  }
  const value = coefficientText(p, loc)
  if (!finiteCi(p.ci)) return { value, ci: null }
  const b = (v: number) => formatNumber(v, { sig: 6, loc })
  return { value, ci: `[${b(p.ci[0])}; ${b(p.ci[1])}]` }
}
