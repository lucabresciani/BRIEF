import { describe, expect, it } from 'vitest'
import { derivedParameter } from '@/domain/fit/derived'
import { parameterCells } from './parameterCells'
import { COOLING_DT, COOLING_T, FREE_FALL_T, FREE_FALL_Y, OHM_I, OHM_V, fitOf, param } from './fitFixtures'

const dot = { decimal: '.' } as const
const comma = { decimal: ',' } as const
const withUnit = { withUnit: true }
const noUnit = { withUnit: false }

describe('parameterCells — value ± SE and CI never more precise than the SE allows', () => {
  it('Ohm slope: (47.15 ± 0.08) before its unit, CI at the same place, decimal comma in Italian', () => {
    const fit = fitOf({ type: 'linear' }, OHM_I, OHM_V, { xUnit: 'A', yUnit: 'V' })
    const b1 = fit.params[1]
    expect(parameterCells(b1, dot, withUnit)).toEqual({ value: '(47.15 ± 0.08)', ci: '[46.97; 47.32]' })
    expect(parameterCells(b1, dot, noUnit).value).toBe('47.15 ± 0.08')
    expect(parameterCells(b1, comma, withUnit)).toEqual({ value: '(47,15 ± 0,08)', ci: '[46,97; 47,32]' })
    expect(parameterCells(fit.params[0], dot, withUnit)).toEqual({
      value: '(−0.009 ± 0.005)',
      ci: '[−0.020; 0.002]',
    })
  })

  it('a tiny coefficient: value and CI share the ×10⁻⁶', () => {
    const p = param('b₁', 3.4000357e-6, 1.89e-9)
    expect(parameterCells(p, dot, withUnit)).toEqual({
      value: '(3.4000 ± 0.0019)×10⁻⁶',
      ci: '[3.3959; 3.4042]×10⁻⁶',
    })
    expect(parameterCells(p, comma, noUnit).ci).toBe('[3,3959; 3,4042]×10⁻⁶')
  })

  it('a large SE (≥ 10): bounds rounded to the tens like the value, not to units', () => {
    const p = param('b₀', 1006.5, 50.35)
    // The CI is [895.73, 1117.27]: "[896; 1117]" would claim a precision the SE of 50 does not have.
    expect(parameterCells(p, dot, withUnit)).toEqual({
      value: '(1.01 ± 0.05)×10³',
      ci: '[0.90; 1.12]×10³',
    })
  })

  it('negative coefficients keep U+2212 on the value and both bounds', () => {
    expect(parameterCells(param('b₀', -1006.5, 50.35), dot, noUnit)).toEqual({
      value: '(−1.01 ± 0.05)×10³',
      ci: '[−1.12; −0.90]×10³',
    })
    expect(parameterCells(param('b₁', -3.4000357e-6, 1.89e-9), dot, noUnit)).toEqual({
      value: '(−3.4000 ± 0.0019)×10⁻⁶',
      ci: '[−3.4042; −3.3959]×10⁻⁶',
    })
    // An interval across zero: the lower bound is negative, the upper positive.
    expect(parameterCells(param('b₀', 50, 40), dot, noUnit)).toEqual({
      value: '(5 ± 4)×10¹',
      ci: '[−4; 14]×10¹',
    })
  })

  it('free fall: a₂ = (4.93 ± 0.04) m/s², and g = 2·a₂ with its own CI', () => {
    const fit = fitOf({ type: 'polynomial', degree: 2 }, FREE_FALL_T, FREE_FALL_Y, { xUnit: 's', yUnit: 'm' })
    expect(parameterCells(fit.params[2], dot, withUnit)).toEqual({
      value: '(4.93 ± 0.04)',
      ci: '[4.85; 5.01]',
    })
    expect(parameterCells(fit.params[0], dot, withUnit).value).toBe('(0.0123 ± 0.0025)')
    expect(parameterCells(fit.params[1], dot, withUnit).value).toBe('(0.240 ± 0.021)')
    const g = derivedParameter(fit, [0, 0, 2], { symbol: 'g', unit: 'm/s²' })
    expect(parameterCells(g, dot, withUnit)).toEqual({ value: '(9.86 ± 0.07)', ci: '[9.70; 10.01]' })
    expect(parameterCells(g, comma, withUnit)).toEqual({ value: '(9,86 ± 0,07)', ci: '[9,70; 10,01]' })
  })

  it('exponential a (asymmetric CI): value and bounds as formatInterval rounds them, not 6 figures', () => {
    const fit = fitOf({ type: 'exponential' }, COOLING_T, COOLING_DT, { xUnit: 'min', yUnit: 'K' })
    const a = fit.params[0]
    expect(a.note).toBe('asymmetric-ci')
    expect(parameterCells(a, dot, withUnit)).toEqual({ value: '63.17', ci: '[62.87; 63.47]' })
    expect(parameterCells(a, comma, withUnit)).toEqual({ value: '63,17', ci: '[62,87; 63,47]' })
    expect(parameterCells(fit.params[1], dot, withUnit).value).toBe('(−0.04014 ± 0.00013)')
  })

  it('an asymmetric interval spanning orders of magnitude keeps significant bounds', () => {
    const a = {
      symbol: 'a',
      value: 0.5,
      se: null,
      ci: [0.0004, 600] as const,
      unit: null,
      note: 'asymmetric-ci' as const,
    }
    expect(parameterCells(a, dot, noUnit)).toEqual({ value: '0.5', ci: '[0.00040; 600]' })
  })

  it('exact fit: no SE, no interval, the value to 6 significant figures', () => {
    const fit = fitOf({ type: 'linear' }, [0, 1, 2, 3], [1, 3, 5, 7])
    expect(fit.exactFit).toBe(true)
    expect(parameterCells(fit.params[1], dot, withUnit)).toEqual({ value: '2.00000', ci: null })
    expect(parameterCells(fit.params[1], comma, withUnit)).toEqual({ value: '2,00000', ci: null })
  })
})
