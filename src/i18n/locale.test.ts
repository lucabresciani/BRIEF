import { describe, expect, it } from 'vitest'
import { formatMegabytes, intlLocale } from './locale'

describe('locale', () => {
  it('dates and numbers follow Italian or British conventions', () => {
    expect(intlLocale('it')).toBe('it-IT')
    expect(intlLocale('en')).toBe('en-GB')
    const date = new Date(2026, 9, 2, 14, 5)
    expect(new Intl.DateTimeFormat(intlLocale('en'), { dateStyle: 'short' }).format(date)).toBe('02/10/2026')
  })

  it('sizes are in megabytes with one decimal, in the language notation, never split from the unit', () => {
    expect(formatMegabytes(1.5 * 2 ** 20, 'en')).toBe('1.5 MB')
    expect(formatMegabytes(1.5 * 2 ** 20, 'it')).toBe('1,5 MB')
    expect(formatMegabytes(1234 * 2 ** 20, 'it')).toBe('1234 MB')
    expect(formatMegabytes(1234 * 2 ** 20, 'en')).toBe('1,234 MB')
    expect(formatMegabytes(0, 'en')).toBe('0 MB')
  })
})
