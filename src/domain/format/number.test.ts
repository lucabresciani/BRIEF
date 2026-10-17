import { describe, expect, it } from 'vitest'
import {
  decimalsOfText,
  formatFull,
  formatInterval,
  formatNumber,
  formatR2,
  formatStat,
  formatValueAtUncertainty,
  formatWithUncertainty,
  roundToDecimals,
  roundUncertainty,
  superscript,
} from './number'

const dot = { decimal: '.' } as const
const comma = { decimal: ',' } as const
const pm = (v: number, u: number, loc: { decimal: '.' | ',' } = dot) => formatWithUncertainty(v, u, loc).text
const ru = (u: number) =>
  formatNumber(roundUncertainty(u).value, { decimals: roundUncertainty(u).decimals, loc: dot })

describe('roundUncertainty (PDG)', () => {
  it('applies the PDG boundaries on the three leading digits', () => {
    expect(ru(0.0354)).toBe('0.035')
    // Digits are read (truncated) from the shortest representation: 0.03549 reads "354" → 2 s.f.
    expect(ru(0.03549)).toBe('0.035')
    expect(ru(0.0355)).toBe('0.04')
    expect(ru(0.0962)).toBe('0.10')
    expect(ru(0.0949)).toBe('0.09')
    expect(ru(0.0995)).toBe('0.10')
  })

  it('reports significant figures, decimal place and exponent', () => {
    expect(roundUncertainty(0.0354)).toEqual({ value: 0.035, sig: 2, decimals: 3, exponent: -2 })
    expect(roundUncertainty(0.0355)).toEqual({ value: 0.04, sig: 1, decimals: 2, exponent: -2 })
    expect(roundUncertainty(0.0962)).toEqual({ value: 0.1, sig: 2, decimals: 2, exponent: -1 })
    expect(roundUncertainty(2360.14502379268)).toEqual({ value: 2400, sig: 2, decimals: -2, exponent: 3 })
    expect(roundUncertainty(1)).toEqual({ value: 1, sig: 2, decimals: 1, exponent: 0 })
  })

  it('returns NaN for non-positive or non-finite uncertainties', () => {
    expect(roundUncertainty(0).value).toBeNaN()
    expect(roundUncertainty(-1).value).toBeNaN()
    expect(roundUncertainty(NaN).value).toBeNaN()
    expect(roundUncertainty(Infinity).value).toBeNaN()
  })
})

describe('formatWithUncertainty', () => {
  it('reproduces the oracle-derived examples', () => {
    expect(pm(9.85869828701, 0.0711117206008)).toBe('9.86 ± 0.07')
    expect(pm(0.827, 0.367)).toBe('0.8 ± 0.4')
    expect(pm(0.827, 0.119)).toBe('0.83 ± 0.12')
    expect(pm(47.1472727273, 0.0750720498733)).toBe('47.15 ± 0.08')
    expect(pm(-0.009, 0.00465809819431)).toBe('−0.009 ± 0.005')
    expect(pm(0.0948428571429, 0.000285787027777)).toBe('0.09484 ± 0.00029')
    expect(pm(0.00250793650794, 0.00173052639169)).toBe('0.0025 ± 0.0017')
    expect(pm(-0.0401413260433, 0.000125456687648)).toBe('−0.04014 ± 0.00013')
    expect(pm(4.9293491435, 0.0355558603004)).toBe('4.93 ± 0.04')
    expect(pm(0.239653765352, 0.0206460892738)).toBe('0.240 ± 0.021')
    expect(pm(1.73166666667, 0.00824192289028)).toBe('1.732 ± 0.008')
    expect(pm(1.76583333333, 0.0272879797417)).toBe('1.766 ± 0.027')
  })

  it('uses a shared exponent for very small or very large magnitudes', () => {
    const small = formatWithUncertainty(0.000986, 0.000007, dot)
    expect(small.text).toBe('(9.86 ± 0.07)×10⁻⁴')
    expect(small.sharedExponent).toBe(-4)
    expect(small.value).toBe('9.86')
    expect(small.u).toBe('0.07')
    expect(pm(7.3206e-7, 1.6e-10)).toBe('(7.3206 ± 0.0016)×10⁻⁷')
    // 4.87e-17 reads "486" → 1 significant figure.
    expect(pm(-3.16081871345029e-15, 4.86652849992036e-17)).toBe('(−3.16 ± 0.05)×10⁻¹⁵')
    expect(pm(-3.16081871345029e-15, 1.07938612033077e-17)).toBe('(−3.161 ± 0.011)×10⁻¹⁵')
    expect(pm(123456.7, 23)).toBe('(1.23457 ± 0.00023)×10⁵')
    // Rounding left of the units digit would leave ambiguous trailing zeros.
    expect(pm(4523, 2360)).toBe('(4.5 ± 2.4)×10³')
    expect(formatWithUncertainty(47.15, 0.08, dot).sharedExponent).toBeNull()
  })

  it('rounds ties of the decimal representation half-up', () => {
    // 2.675 is stored as 2.67499999…; toFixed(2) would give "2.67".
    expect(pm(2.675, 0.012)).toBe('2.675 ± 0.012')
    expect(pm(2.675, 0.05)).toBe('2.68 ± 0.05')
  })

  it('uses the locale decimal separator and U+2212', () => {
    expect(pm(47.1472727273, 0.0750720498733, comma)).toBe('47,15 ± 0,08')
    expect(pm(-0.009, 0.00465809819431, comma)).toBe('−0,009 ± 0,005')
    expect(pm(0.000986, 0.000007, comma)).toBe('(9,86 ± 0,07)×10⁻⁴')
  })

  it('never shows a misleading ± 0 and handles missing values', () => {
    expect(formatWithUncertainty(2, 0, dot)).toEqual({
      value: '2.000',
      u: '—',
      text: '2.000 ± —',
      sharedExponent: null,
    })
    expect(formatWithUncertainty(2, null, dot).u).toBe('—')
    expect(formatWithUncertainty(NaN, 0.1, dot).text).toBe('—')
    expect(pm(-0.0001, 0.005)).toBe('0.000 ± 0.005')
  })
})

describe('formatNumber', () => {
  it('shows "—" for missing values and U+2212 for negatives', () => {
    expect(formatNumber(NaN, { loc: dot })).toBe('—')
    expect(formatNumber(null, { loc: dot })).toBe('—')
    expect(formatNumber(-1.5, { sig: 3, loc: dot })).toBe('−1.50')
    expect(formatNumber(Infinity, { loc: dot })).toBe('∞')
  })

  it('rounds to significant figures without binary noise', () => {
    expect(formatNumber(0.1 + 0.2, { sig: 4, loc: dot })).toBe('0.3000')
    expect(formatNumber(9.99, { sig: 2, loc: dot })).toBe('10')
    expect(formatNumber(1234.5, { loc: dot })).toBe('1235')
    expect(formatNumber(0, { sig: 3, loc: dot })).toBe('0.00')
    expect(formatNumber(123456, { sig: 4, loc: dot })).toBe('1.235×10⁵')
    expect(formatNumber(0.00012345, { sig: 3, loc: comma })).toBe('1,23×10⁻⁴')
    expect(formatNumber(99999.7, { sig: 4, loc: dot })).toBe('1.000×10⁵')
  })

  it('rounds to a decimal place, including negative places', () => {
    expect(formatNumber(1.73166666667, { decimals: 3, loc: dot })).toBe('1.732')
    expect(formatNumber(44873.2, { decimals: -2, loc: dot })).toBe('44900')
    expect(formatNumber(-0.0004, { decimals: 2, loc: dot })).toBe('0.00')
    expect(formatNumber(2.5, { decimals: 0, loc: dot })).toBe('3')
  })
})

describe('formatR2', () => {
  it('uses "> 0.9999" instead of a rounded 1.0000', () => {
    expect(formatR2(0.99997971735562, dot)).toBe('> 0.9999')
    expect(formatR2(0.99995, dot)).toBe('> 0.9999')
    expect(formatR2(0.99994, dot)).toBe('0.9999')
    expect(formatR2(0.940132395553, dot)).toBe('0.9401')
    expect(formatR2(0.99997971735562, comma)).toBe('> 0,9999')
  })

  it('shows full digits in advanced mode and never clamps negative adjusted R²', () => {
    expect(formatR2(0.99997971735562, dot, true)).toBe('0.999979717356')
    expect(formatR2(1, dot, true)).toBe('1')
    expect(formatR2(-0.0123456, dot)).toBe('−0.0123')
    expect(formatR2(null, dot)).toBe('—')
  })
})

describe('formatStat', () => {
  // The pendulum example, observer A.
  const sem = 0.00824192289028
  it('rounds mean, median and CI bounds at the decimal of the SEM', () => {
    expect(formatStat('mean', 1.73166666667, { sem, loc: dot })).toBe('1.732')
    expect(formatStat('median', 1.73, { sem, loc: dot })).toBe('1.730')
    expect(formatStat('ci', 1.713526317, { sem, loc: dot })).toBe('1.714')
    expect(formatStat('ci', 1.749807017, { sem, loc: comma })).toBe('1,750')
    expect(formatStat('mean', 1.73166666667, { sem: null, loc: dot })).toBe('1.732')
  })

  it('shows SD and SEM with 2 significant figures', () => {
    expect(formatStat('sd', 0.0285508583961, { loc: dot })).toBe('0.029')
    expect(formatStat('sem', 0.00824192289028, { loc: dot })).toBe('0.0082')
    expect(formatStat('sd', 0.0945283346971, { loc: dot })).toBe('0.095')
    expect(formatStat('sd', 0, { loc: dot })).toBe('0')
  })

  it('shows min/max as the original text, ranges and quartiles at the data precision', () => {
    expect(formatStat('min', 1.7, { rawText: '1.70', loc: dot })).toBe('1.70')
    expect(formatStat('max', 1.98, { loc: dot })).toBe('1.98')
    expect(formatStat('range', 1.98 - 1.61, { loc: dot })).toBe('0.37')
    expect(formatStat('range', 1.98 - 1.61, { dataDecimals: 2, loc: comma })).toBe('0,37')
    expect(formatStat('quartile', 1.7525, { dataDecimals: 2, loc: dot })).toBe('1.753')
    expect(formatStat('quartile', 1.7525, { rawText: '1.70', loc: dot })).toBe('1.753')
    expect(formatStat('quartile', 1.7525, { loc: dot })).toBe('1.7525')
    expect(formatStat('n', 24, { loc: dot })).toBe('24')
    expect(formatStat('mean', null, { loc: dot })).toBe('—')
  })
})

describe('helpers', () => {
  it('roundToDecimals mirrors the displayed rounding', () => {
    expect(roundToDecimals(2.675, 2)).toBe(2.68)
    expect(roundToDecimals(-44873.2, -2)).toBe(-44900)
    expect(roundToDecimals(0.0122794117647, 4)).toBe(0.0123)
  })

  it('formatFull keeps every significant digit', () => {
    expect(formatFull(47.14727272727273, dot)).toBe('47.14727272727273')
    expect(formatFull(0.1 + 0.2, dot)).toBe('0.30000000000000004')
    expect(formatFull(-0.009, comma)).toBe('−0,009')
    expect(formatFull(1.5e-9, dot)).toBe('1.5×10⁻⁹')
    expect(formatFull(3e21, dot)).toBe('3×10²¹')
  })

  it('decimalsOfText and superscript', () => {
    expect(decimalsOfText('1.70')).toBe(2)
    expect(decimalsOfText('2,5 °C')).toBe(1)
    expect(decimalsOfText('12')).toBe(0)
    expect(superscript(-15)).toBe('⁻¹⁵')
  })

  it('formatInterval for asymmetric intervals', () => {
    const r = formatInterval(
      Number('63.173203365781328'),
      Number('62.874621575777078'),
      Number('63.47320307422529'),
      dot,
    )
    expect(r.text).toBe('63.17 [62.87, 63.47]')
    expect(formatInterval(63.17, 62.87, 63.47, comma).text).toBe('63,17 [62,87; 63,47]')
  })

  it('formatInterval: a wide multiplicative interval never shows a positive bound as 0, nor spurious digits', () => {
    // exp(CI of ln a) with a factor ≈ 1200: the shared place of the value (0.1) would give "0.0" and "600.0".
    const r = formatInterval(0.5, 0.0004, 600, dot)
    expect(r.text).toBe('0.5 [0.00040, 600]')
    expect(Number(r.lower)).toBeGreaterThan(0)
    expect(formatInterval(0.5, 0.0004, 600, comma).text).toBe('0,5 [0,00040; 600]')
    // A positive lower bound below 0.05·value keeps two significant figures.
    expect(formatInterval(2.3, 0.0123, 9.9, dot).text).toBe('2.3 [0.012, 9.9]')
    // Bounds of the other sign keep the shared place (an additive interval).
    expect(formatInterval(0.5, -0.3, 2.1, dot).text).toBe('0.5 [−0.3, 2.1]')
    // Not finite or zero width.
    expect(formatInterval(1, NaN, 2, dot).text).toBe('1.000 [—, —]')
    expect(formatInterval(1, 1, 1, dot).text).toBe('1.000 [1.000, 1.000]')
  })

  it('formatValueAtUncertainty: the value alone as a complete number (the mantissa never loses its ×10ⁿ)', () => {
    const f = formatWithUncertainty(3.4000357e-6, 1.89e-9, dot)
    expect(f.text).toBe('(3.4000 ± 0.0019)×10⁻⁶')
    expect(f.value).toBe('3.4000') // the mantissa only
    expect(formatValueAtUncertainty(3.4000357e-6, 1.89e-9, dot)).toBe('3.4000×10⁻⁶')
    expect(formatValueAtUncertainty(1006.5, 50.35, dot)).toBe('1.01×10³')
    expect(formatValueAtUncertainty(-0.000986, 0.000007, comma)).toBe('−9,86×10⁻⁴')
    expect(formatValueAtUncertainty(9.85869828701, 0.0711117206008, dot)).toBe('9.86')
    expect(formatValueAtUncertainty(2, null, dot)).toBe('2.000')
    expect(formatValueAtUncertainty(NaN, 0.1, dot)).toBe('—')
  })
})

describe('rounding reads 15 significant figures (binary noise of computed values never flips a digit)', () => {
  it('computed exact ties round as exact decimal arithmetic does', () => {
    // Pendulum observer B: Q1 1.7125, IQR 0.09 → lower Tukey fence 1.5775, computed as 1.5774999999999997.
    const fence = 1.7125 - 1.5 * (1.8025 - 1.7125)
    expect(fence).toBe(1.5774999999999997)
    expect(formatStat('quartile', fence, { dataDecimals: 2, loc: dot })).toBe('1.578')
    expect(formatNumber(1.15 * 3, { decimals: 1, loc: dot })).toBe('3.5') // 3.4499999999999997
    expect(formatNumber(4.35 * 100, { decimals: 0, loc: dot })).toBe('435') // 434.99999999999994
    expect(roundToDecimals(1.15 * 3, 1)).toBe(3.5)
    // PDG: u = 0.5 keeps 1 significant figure, so the value is rounded at the first decimal.
    expect(pm(1.15 * 3, 0.5)).toBe('3.5 ± 0.5')
  })

  it('values genuinely away from a tie, and every digit on request, are unchanged', () => {
    expect(formatNumber(1.57749999999, { decimals: 3, loc: dot })).toBe('1.577')
    expect(formatNumber(1.5774999, { sig: 4, loc: dot })).toBe('1.577')
    expect(formatFull(1.15 * 3, dot)).toBe('3.4499999999999997')
    expect(formatNumber(0.1 + 0.2, { sig: 17, loc: dot })).toBe('0.30000000000000004')
    expect(formatNumber(0.1 + 0.2, { sig: 4, loc: dot })).toBe('0.3000')
    // Typed values read exactly as before (shortest form = 15-digit form for ≤ 15 significant digits).
    expect(ru(0.0355)).toBe('0.04')
    expect(ru(0.03549)).toBe('0.035')
  })
})
