import type { FitOk } from '@/domain/derive/types'
import { coefficientText } from '@/domain/fit/equation'
import { centredVariable } from '@/domain/figure/caption'
import { superscript, type NumberFormatLocale } from '@/domain/format/number'

const MINUS = '−'

/** A power-law exponent as written after "^": compound or negative values get parentheses, x^(−0.50). */
const exponentText = (b: string) => (b.startsWith(MINUS) || b.includes('×') ? `(${b})` : b)

/**
 * The fitted equation with each coefficient as a complete number at its PDG place
 * (coefficientText: "3.4000×10⁻⁶", "1.01×10³", "47.15"), e.g. "V = −0.009 + 47.15·I" or, centred,
 * "y = 0.5278 + 3.197·(t − 0.3) + 4.93·(t − 0.3)²".
 */
export function equationText(fit: FitOk, xName: string, yName: string, loc: NumberFormatLocale): string {
  if (fit.model.type === 'exponential' || fit.model.type === 'power') {
    const a = fit.params.find((p) => p.symbol === 'a')
    const b = fit.params.find((p) => p.symbol === 'b')
    if (!a || !b) return ''
    const at = coefficientText(a, loc)
    const bt = coefficientText(b, loc)
    return fit.model.type === 'exponential'
      ? `${yName} = ${at} · e^(${bt} · ${xName})`
      : `${yName} = ${at} · ${xName}^${exponentText(bt)}`
  }
  const x0 = fit.equation.form === 'centred' ? fit.equation.x0 : null
  const x = x0 !== null ? centredVariable(xName, x0, loc) : xName
  const parts = fit.equation.terms.map(({ coef, power }, i) => {
    // The whole number, ×10ⁿ included: only its leading sign moves into the operator between terms.
    const c = coefficientText(coef, loc)
    const neg = c.startsWith(MINUS)
    const abs = neg ? c.slice(MINUS.length) : c
    const term = power === 0 ? abs : power === 1 ? `${abs}·${x}` : `${abs}·${x}${superscript(power)}`
    return i === 0 ? (neg ? `${MINUS}${term}` : term) : `${neg ? MINUS : '+'} ${term}`
  })
  return `${yName} = ${parts.join(' ')}`
}
