import { describe, expect, it } from 'vitest'
import { formatPlain, parseUserNumber } from './numberInput'

describe('numbers typed in controls', () => {
  it('accepts point and comma decimals, signs and exponents', () => {
    expect(parseUserNumber('1.5')).toBe(1.5)
    expect(parseUserNumber('1,5')).toBe(1.5)
    expect(parseUserNumber('−2,25')).toBe(-2.25)
    expect(parseUserNumber('+3')).toBe(3)
    expect(parseUserNumber('1e-3')).toBe(0.001)
    expect(parseUserNumber('1,5E-3')).toBe(0.0015)
    expect(parseUserNumber(' 0,05 ')).toBe(0.05)
  })
  it('rejects anything ambiguous or not a number (never coerced to 0)', () => {
    for (const s of ['', 'abc', '1.234,5', '1,2,3', '1e', 'Infinity', 'NaN', '0x10'])
      expect(parseUserNumber(s), s).toBeNull()
  })
  it('formats for editing with the chosen separator', () => {
    expect(formatPlain(0.05, ',')).toBe('0,05')
    expect(formatPlain(47.15, '.')).toBe('47.15')
  })
})
