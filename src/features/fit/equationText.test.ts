import { describe, expect, it } from 'vitest'
import { equationText } from './equationText'
import {
  COOLING_DT,
  COOLING_T,
  FREE_FALL_T,
  FREE_FALL_Y,
  OHM_I,
  OHM_V,
  fitOf,
  param,
  withParams,
} from './fitFixtures'

const dot = { decimal: '.' } as const
const comma = { decimal: ',' } as const

describe('equationText — every coefficient is a complete number at its PDG place', () => {
  const ohm = fitOf({ type: 'linear' }, OHM_I, OHM_V, { xUnit: 'A', yUnit: 'V' })

  it('Ohm: V = −0.009 + 47.15·I (47.15 ± 0.08), with a decimal comma in Italian', () => {
    expect(equationText(ohm, 'I', 'V', dot)).toBe('V = −0.009 + 47.15·I')
    expect(equationText(ohm, 'I', 'V', comma)).toBe('V = −0,009 + 47,15·I')
  })

  it('a tiny slope keeps its ×10⁻⁶ (3.4000357e-6 ± 1.89e-9 is not "3.4000")', () => {
    const fit = withParams(ohm, [param('b₀', 0.0021004, 0.0000123), param('b₁', 3.4000357e-6, 1.89e-9)])
    expect(equationText(fit, 'p', 'L', dot)).toBe('L = 0.002100 + 3.4000×10⁻⁶·p')
    expect(equationText(fit, 'p', 'L', comma)).toBe('L = 0,002100 + 3,4000×10⁻⁶·p')
  })

  it('a large-SE intercept keeps its ×10³ (1006.5 ± 50.35 is not "1.01")', () => {
    const fit = withParams(ohm, [param('b₀', 1006.5, 50.35), param('b₁', 3.712, 0.41)])
    expect(equationText(fit, 'T', 'R', dot)).toBe('R = 1.01×10³ + 3.7·T')
  })

  it('negative coefficients: the sign becomes the operator, the power of ten stays, once', () => {
    const fit = withParams(ohm, [param('b₀', -1006.5, 50.35), param('b₁', -3.4000357e-6, 1.89e-9)])
    const text = equationText(fit, 'x', 'y', dot)
    expect(text).toBe('y = −1.01×10³ − 3.4000×10⁻⁶·x')
    expect(text.match(/×10/g)).toHaveLength(2)
    expect(text).not.toContain('+ −')
    expect(text).not.toContain('− −')
  })

  it('free fall, centred at a round t0: y = 0.5278 + 3.197·(t − 0.3) + 4.93·(t − 0.3)²', () => {
    const fit = fitOf({ type: 'polynomial', degree: 2 }, FREE_FALL_T, FREE_FALL_Y, { xUnit: 's', yUnit: 'm' })
    expect(fit.equation.form).toBe('centred')
    expect(equationText(fit, 't', 'y', dot)).toBe('y = 0.5278 + 3.197·(t − 0.3) + 4.93·(t − 0.3)²')
    expect(equationText(fit, 't', 'y', comma)).toBe('y = 0,5278 + 3,197·(t − 0,3) + 4,93·(t − 0,3)²')
  })

  it('a negative centre reads (x + 1.5)', () => {
    const fit = { ...withParams(ohm, [param('b₀′', 2, 0.1), param('b₁', -0.5, 0.01)]) }
    const centred = { ...fit, equation: { ...fit.equation, form: 'centred' as const, x0: -1.5 } }
    expect(equationText(centred, 'x', 'y', dot)).toBe('y = 2.00 − 0.500·(x + 1.5)')
  })

  it('exponential (cooling): the a of the asymmetric interval as rounded there, b at its PDG place', () => {
    const fit = fitOf({ type: 'exponential' }, COOLING_T, COOLING_DT, { xUnit: 'min', yUnit: 'K' })
    expect(fit.params[0].note).toBe('asymmetric-ci')
    expect(equationText(fit, 't', 'ΔT', dot)).toBe('ΔT = 63.17 · e^(−0.04014 · t)')
    expect(equationText(fit, 't', 'ΔT', comma)).toBe('ΔT = 63,17 · e^(−0,04014 · t)')
  })

  it('power law: a negative or ×10ⁿ exponent is enclosed, x^(−0.500), never x^−0.500', () => {
    const a = { ...param('a', 2, 0.05), se: null, note: 'asymmetric-ci' as const }
    const fit = withParams(ohm, [a, param('b', -0.5, 0.01)], { type: 'power' })
    expect(equationText(fit, 'x', 'y', dot)).toBe('y = 2.00 · x^(−0.500)')
    const tiny = withParams(ohm, [a, param('b', 3.4000357e-6, 1.89e-9)], { type: 'power' })
    expect(equationText(tiny, 'x', 'y', dot)).toBe('y = 2.00 · x^(3.4000×10⁻⁶)')
    const plain = withParams(ohm, [a, param('b', 1.5, 0.01)], { type: 'power' })
    expect(equationText(plain, 'x', 'y', dot)).toBe('y = 2.00 · x^1.500')
  })

  it('exact fit (no SE): 6 significant figures', () => {
    const fit = fitOf({ type: 'linear' }, [0, 1, 2, 3], [1, 3, 5, 7])
    expect(fit.exactFit).toBe(true)
    expect(equationText(fit, 'x', 'y', dot)).toBe('y = 1.00000 + 2.00000·x')
  })
})
