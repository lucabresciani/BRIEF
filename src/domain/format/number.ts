/**
 * The ONE formatter for every number the app shows.
 *
 * All rounding is done on the decimal digits of the double read to 15 significant figures (the
 * precision a double carries reliably; see decomposeForRounding), with round-half-up on those digits.
 * This makes ties deterministic for values as the user sees them ("0.0355" is a tie, even though the
 * nearest double is 0.035499999…), and for computed values whose exact decimal result is a tie
 * (1.7125 − 1.5·0.09 = 1.5775, computed as 1.5774999999999997), instead of depending on the binary
 * representation as toFixed() does. formatFull alone shows the shortest round-trip form (every digit).
 *
 * Conventions:
 * - Value ± uncertainty: PDG rule (Review of Particle Physics §5.3) on the three highest-order digits
 *   of the uncertainty, READ (truncated) from its shortest decimal representation:
 *   100–354 → 2 significant figures; 355–949 → 1; 950–999 → rounded up to 1000, 2 significant figures.
 *   The value is rounded to the same decimal place. (0.03549 reads "354" → 0.035; 0.0355 → 0.04.)
 * - Negative numbers use U+2212 (−); the decimal separator follows the locale; missing → "—".
 */

export interface NumberFormatLocale {
  decimal: '.' | ','
}

const MINUS = '−'
const DASH = '—'
const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
}

/** Integer exponent as superscript characters, e.g. −3 → "⁻³". */
export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((ch) => SUPERSCRIPT[ch] ?? ch)
    .join('')
}

/** |v| = d₁.d₂d₃… × 10^exp, digits without leading zeros (shortest round-trip representation). */
interface Decomposed {
  neg: boolean
  digits: string
  exp: number
}

function decompose(v: number): Decomposed {
  if (v === 0) return { neg: false, digits: '0', exp: 0 }
  const [mant, e] = Math.abs(v).toExponential().split('e')
  return { neg: v < 0, digits: mant.replace('.', ''), exp: Number(e) }
}

/**
 * The digits ROUNDING works on: 15 significant figures (what a double carries reliably), trailing zeros
 * dropped. Computed values carry binary noise in the 16th–17th digit: the Tukey fence 1.7125 − 1.5·0.09
 * is the double 1.5774999999999997, whose shortest form would round to "1.577" although the exact value
 * 1.5775 rounds half-up to "1.578". Reading 15 digits gives the result of exact decimal arithmetic for
 * every tie, and leaves every value more than 1e-15 (relative) away from a tie unchanged. Values typed by
 * the user (≤ 15 significant digits) read exactly as with the shortest form. formatFull keeps all digits.
 */
function decomposeForRounding(v: number): Decomposed {
  if (v === 0) return { neg: false, digits: '0', exp: 0 }
  const [mant, e] = Math.abs(v).toExponential(14).split('e')
  const digits = mant.replace('.', '').replace(/0+$/, '')
  return { neg: v < 0, digits: digits === '' ? '0' : digits, exp: Number(e) }
}

/** Adds one to a non-negative decimal integer string. */
function incrementDigits(s: string): string {
  const out = s.split('')
  let i = out.length - 1
  while (i >= 0) {
    if (out[i] === '9') {
      out[i] = '0'
      i--
    } else {
      out[i] = String(Number(out[i]) + 1)
      return out.join('')
    }
  }
  return '1' + out.join('')
}

/**
 * Rounds |v| half-up (on decimal digits) to the decimal place `dec` (digits after the point; negative
 * values round to tens, hundreds…). Returns the integer M with |v| ≈ M × 10^(−dec).
 */
function roundToPlace(d: Decomposed, dec: number): string {
  if (d.digits === '0') return '0'
  const keep = d.exp + dec + 1
  if (keep > d.digits.length) return d.digits + '0'.repeat(keep - d.digits.length)
  if (keep < 0) return '0'
  if (keep === 0) return d.digits[0] >= '5' ? '1' : '0'
  const kept = d.digits.slice(0, keep)
  return d.digits[keep] >= '5' ? incrementDigits(kept) : kept
}

/** Renders M × 10^(−dec) as a plain decimal string (no sign, '.' separator). */
function renderScaled(m: string, dec: number): string {
  const trimmed = m.replace(/^0+(?=\d)/, '')
  if (dec <= 0) return trimmed === '0' ? '0' : trimmed + '0'.repeat(-dec)
  const padded = trimmed.padStart(dec + 1, '0')
  return `${padded.slice(0, padded.length - dec)}.${padded.slice(padded.length - dec)}`
}

function localize(plain: string, neg: boolean, loc: NumberFormatLocale): string {
  const isZero = !/[1-9]/.test(plain)
  const body = loc.decimal === ',' ? plain.replace('.', ',') : plain
  return neg && !isZero ? MINUS + body : body
}

/**
 * Rounds a value half-up at a decimal place (on its 15-significant-figure decimal digits) and returns the
 * rounded number. Used wherever a displayed (rounded) value must be re-evaluated, e.g. equation checks.
 */
export function roundToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  const d = decomposeForRounding(value)
  const m = roundToPlace(d, decimals)
  const n = Number(`${m}e${-decimals}`)
  return d.neg ? -n : n
}

/** Number of decimals shown by a plain decimal text such as "1.70" or "2,5 °C" (0 if none). */
export function decimalsOfText(text: string): number {
  const m = text.trim().match(/^[+\-−]?\d*[.,](\d+)/)
  return m ? m[1].length : 0
}

/** Rounds |v| to `sig` significant figures; returns the integer M and decimal place (|v| ≈ M·10^(−dec)). */
function roundToSig(d: Decomposed, sig: number): { m: string; dec: number } {
  if (d.digits === '0') return { m: '0', dec: Math.max(0, sig - 1) }
  let dec = sig - 1 - d.exp
  let m = roundToPlace(d, dec)
  if (m.replace(/^0+/, '').length > sig) {
    // A carry added a digit (9.99 → 10.0): one place fewer keeps `sig` significant figures.
    dec -= 1
    m = roundToPlace(d, dec)
  }
  return { m, dec }
}

/** Exponent of the leading digit of M × 10^(−dec) (M > 0). */
function leadingExponent(m: string, dec: number): number {
  return m.replace(/^0+/, '').length - 1 - dec
}

export interface RoundedUncertainty {
  /** The rounded uncertainty. */
  value: number
  /** Significant figures kept (PDG). */
  sig: 1 | 2
  /** Decimal place of the rounding (digits after the point; negative for tens, hundreds…). */
  decimals: number
  /** Power of ten of the leading digit of the rounded uncertainty. */
  exponent: number
}

/**
 * PDG rounding of an uncertainty. The three highest-order digits are read (truncated) from the
 * decimal digits of u (15 significant figures): 100–354 → 2 significant figures; 355–949 → 1; 950–999 →
 * rounded up to 1000 and shown with 2 significant figures (0.0962 → 0.10).
 * Non-positive or non-finite u → value NaN (nothing to round).
 */
export function roundUncertainty(u: number): RoundedUncertainty {
  if (!(u > 0) || !Number.isFinite(u)) return { value: NaN, sig: 2, decimals: 0, exponent: 0 }
  const d = decomposeForRounding(u)
  const lead3 = Number((d.digits + '00').slice(0, 3))
  if (lead3 >= 950) {
    const exponent = d.exp + 1
    return { value: Number(`1e${exponent}`), sig: 2, decimals: 1 - exponent, exponent }
  }
  const sig: 1 | 2 = lead3 <= 354 ? 2 : 1
  const decimals = sig - 1 - d.exp
  const m = roundToPlace(d, decimals)
  return { value: Number(`${m}e${-decimals}`), sig, decimals, exponent: d.exp }
}

export interface FormattedWithUncertainty {
  /**
   * Rounded value; ONLY THE MANTISSA when sharedExponent is not null ("3.4000" of
   * "(3.4000 ± 0.0019)×10⁻⁶"). To show the value on its own use formatValueAtUncertainty.
   */
  value: string
  /** Rounded uncertainty; the mantissa when sharedExponent is not null. '—' when not available. */
  u: string
  /** Full text, e.g. "9.86 ± 0.07" or "(7.3206 ± 0.0016)×10⁻⁷". */
  text: string
  sharedExponent: number | null
}

/**
 * "value ± u" with the PDG rule: u to 1–2 significant figures, the value rounded to the same decimal
 * place. A shared ×10ⁿ exponent is used when the larger of |value| and u is ≥ 1e5 or < 1e-3, or when
 * the rounding place is left of the units digit (avoids ambiguous trailing zeros such as "4500 ± 2400").
 * Without a positive finite u the value is shown to 4 significant figures and u as "—".
 */
export function formatWithUncertainty(
  value: number,
  u: number | null,
  loc: NumberFormatLocale,
): FormattedWithUncertainty {
  if (!Number.isFinite(value)) return { value: DASH, u: DASH, text: DASH, sharedExponent: null }
  if (u === null || !(u > 0) || !Number.isFinite(u)) {
    const v = formatNumber(value, { sig: 4, loc })
    return { value: v, u: DASH, text: `${v} ± ${DASH}`, sharedExponent: null }
  }
  const ru = roundUncertainty(u)
  const dv = decomposeForRounding(value)
  const mv = roundToPlace(dv, ru.decimals)
  const du = decompose(ru.value)
  const mu = roundToPlace(du, ru.decimals)
  const vZero = !/[1-9]/.test(mv)
  const magExp = vZero ? ru.exponent : Math.max(leadingExponent(mv, ru.decimals), ru.exponent)
  const share = magExp >= 5 || magExp < -3 || ru.decimals < 0
  const n = share ? magExp : 0
  const vs = localize(renderScaled(mv, ru.decimals + n), dv.neg, loc)
  const us = localize(renderScaled(mu, ru.decimals + n), false, loc)
  const text = share ? `(${vs} ± ${us})×10${superscript(n)}` : `${vs} ± ${us}`
  return { value: vs, u: us, text, sharedExponent: share ? n : null }
}

/**
 * The value of formatWithUncertainty as ONE self-contained number, for places that show it without its
 * ± (equations, table cells): the same digits, with the shared power of ten written out —
 * 3.4000357e-6 ± 1.89e-9 → "3.4000×10⁻⁶"; 1006.5 ± 50.35 → "1.01×10³"; 9.8587 ± 0.0711 → "9.86".
 * (formatWithUncertainty(...).value is only the mantissa when a shared exponent is used.)
 */
export function formatValueAtUncertainty(value: number, u: number | null, loc: NumberFormatLocale): string {
  const f = formatWithUncertainty(value, u, loc)
  return f.sharedExponent === null ? f.value : `${f.value}×10${superscript(f.sharedExponent)}`
}

/**
 * A single number. `decimals` → fixed decimal place; otherwise `sig` significant figures (default 4),
 * switching to "m×10ⁿ" when the rounded |value| is ≥ 1e5 or < 1e-3. Null/NaN → "—"; ±Infinity → "±∞".
 */
export function formatNumber(
  value: number | null | undefined,
  opts: { sig?: number; decimals?: number; loc: NumberFormatLocale },
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH
  if (!Number.isFinite(value)) return value > 0 ? '∞' : MINUS + '∞'
  const sig = Math.max(1, Math.min(17, Math.round(opts.sig ?? 4)))
  // More than 15 significant figures asks for the digits beyond the reliable ones: keep them.
  const d = opts.decimals === undefined && sig > 15 ? decompose(value) : decomposeForRounding(value)
  if (opts.decimals !== undefined) {
    return localize(renderScaled(roundToPlace(d, opts.decimals), opts.decimals), d.neg, opts.loc)
  }
  if (value === 0) return localize(renderScaled('0', sig - 1), false, opts.loc)
  const { m, dec } = roundToSig(d, sig)
  const lead = leadingExponent(m, dec)
  if (lead >= 5 || lead < -3) {
    const mant = localize(renderScaled(m, dec + lead), d.neg, opts.loc)
    return `${mant}×10${superscript(lead)}`
  }
  return localize(renderScaled(m, dec), d.neg, opts.loc)
}

/**
 * Full precision ("Copy full precision", exports shown to people): the shortest round-trip decimal,
 * localized, with U+2212 and ×10ⁿ outside 1e-6 … 1e21.
 */
export function formatFull(value: number | null | undefined, loc: NumberFormatLocale): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH
  if (!Number.isFinite(value)) return value > 0 ? '∞' : MINUS + '∞'
  const d = decompose(value)
  if (d.exp >= 21 || d.exp < -6) {
    const mant = d.digits.length > 1 ? `${d.digits[0]}.${d.digits.slice(1)}` : d.digits
    return `${localize(mant, d.neg, loc)}×10${superscript(d.exp)}`
  }
  const dec = Math.max(0, d.digits.length - 1 - d.exp)
  return localize(renderScaled(roundToPlace(d, dec), dec), d.neg, loc)
}

/** Removes float noise from sums/differences of decimal data (1.98 − 1.61) before full display. */
function cleanFull(value: number, loc: NumberFormatLocale): string {
  return formatFull(Number(value.toPrecision(12)), loc)
}

/**
 * R² and adjusted R²: 4 decimals; "> 0.9999" whenever 4 decimals would round to 1.0000 (r2 ≥ 0.99995),
 * unless `advanced` (then up to 12 significant figures, trailing zeros dropped). Never clamped: an
 * adjusted R² can be negative and is shown as such. Null → "—".
 */
export function formatR2(r2: number | null, loc: NumberFormatLocale, advanced = false): string {
  if (r2 === null || !Number.isFinite(r2)) return DASH
  if (advanced) {
    const s = formatNumber(r2, { sig: 12, loc })
    if (s.includes('×')) return s
    const sep = loc.decimal
    return s.includes(sep) ? s.replace(/0+$/, '').replace(new RegExp(`\\${sep}$`), '') : s
  }
  if (r2 >= 0.99995) return `> ${localize('0.9999', false, loc)}`
  return formatNumber(r2, { decimals: 4, loc })
}

export type StatKind = 'n' | 'mean' | 'median' | 'sd' | 'sem' | 'min' | 'max' | 'range' | 'quartile' | 'ci'

/**
 * Display rule per descriptive statistic (review "avoid misleading precision"):
 * - n: integer;
 * - mean, median, CI bounds: at the decimal place of the PDG-rounded SEM (4 significant figures when
 *   no SEM is available, e.g. n = 1);
 * - SD, SEM: 2 significant figures;
 * - min, max: the original text when given (`rawText`), otherwise the value without float noise;
 * - range: the data decimals (`dataDecimals`) when known, otherwise without float noise;
 * - quartiles (type-7 interpolated): one digit more than the data (`dataDecimals`, or the decimals of
 *   `rawText`), otherwise without float noise.
 * `dataDecimals` is an optional extension of the documented context.
 */
export function formatStat(
  kind: StatKind,
  value: number | null,
  ctx: { sem?: number | null; rawText?: string; dataDecimals?: number | null; loc: NumberFormatLocale },
): string {
  if (value === null || Number.isNaN(value)) return DASH
  const loc = ctx.loc
  switch (kind) {
    case 'n':
      return localize(String(Math.round(Math.abs(value))), value < 0, loc)
    case 'mean':
    case 'median':
    case 'ci': {
      const sem = ctx.sem
      if (sem !== null && sem !== undefined && sem > 0 && Number.isFinite(sem)) {
        return formatNumber(value, { decimals: roundUncertainty(sem).decimals, loc })
      }
      return formatNumber(value, { sig: 4, loc })
    }
    case 'sd':
    case 'sem':
      return value === 0 ? '0' : formatNumber(value, { sig: 2, loc })
    case 'min':
    case 'max': {
      const raw = ctx.rawText?.trim()
      return raw ? raw : cleanFull(value, loc)
    }
    case 'range':
      if (ctx.dataDecimals !== null && ctx.dataDecimals !== undefined) {
        return formatNumber(value, { decimals: ctx.dataDecimals, loc })
      }
      return cleanFull(value, loc)
    case 'quartile': {
      const dd =
        ctx.dataDecimals ??
        (ctx.rawText !== undefined && ctx.rawText.trim() ? decimalsOfText(ctx.rawText) : null)
      if (dd !== null && dd !== undefined) return formatNumber(value, { decimals: dd + 1, loc })
      return cleanFull(value, loc)
    }
  }
}

/** Decimal place that leaves `sig` significant figures of v ≠ 0 (after a possible carry, 9.96 → 10). */
function decimalsForSig(v: number, sig: number): number {
  return roundToSig(decomposeForRounding(v), sig).dec
}

/**
 * A value with an asymmetric interval (e.g. a = exp(ln a) of a log-linear fit). The value is rounded at
 * the PDG place of the shorter half-width. A bound of the same sign as the value (a multiplicative
 * interval such as exp(CI of ln a), whose bounds can differ from the value by orders of magnitude) shares
 * that place only while it keeps between 2 and (figures of the value + 1) significant figures: a strictly
 * positive lower bound never reads as 0 and a far upper bound gets no spurious digits —
 * 0.5 [0.0004, 600] → "0.5 [0.00040, 600]", while 63.17 [62.87, 63.47] keeps one shared place.
 * Bounds of the other sign (or zero) keep the shared place. Returns '—' parts when not finite.
 */
export function formatInterval(
  value: number,
  lower: number,
  upper: number,
  loc: NumberFormatLocale,
): { value: string; lower: string; upper: string; text: string } {
  const sep = loc.decimal === ',' ? ';' : ','
  if (![value, lower, upper].every(Number.isFinite)) {
    const v = formatNumber(value, { sig: 4, loc })
    return { value: v, lower: DASH, upper: DASH, text: `${v} [${DASH}${sep} ${DASH}]` }
  }
  const half = Math.min(Math.abs(value - lower), Math.abs(upper - value))
  if (!(half > 0)) {
    const f4 = (x: number) => formatNumber(x, { sig: 4, loc })
    const [v4, lo4, hi4] = [f4(value), f4(lower), f4(upper)]
    return { value: v4, lower: lo4, upper: hi4, text: `${v4} [${lo4}${sep} ${hi4}]` }
  }
  const dec = roundUncertainty(half).decimals
  const valueFigures = roundToPlace(decomposeForRounding(value), dec).replace(/^0+/, '').length
  const maxSig = Math.max(2, valueFigures + 1)
  const bound = (b: number) => {
    let d = dec
    if (b !== 0 && value !== 0 && b > 0 === value > 0) {
      d = Math.max(d, decimalsForSig(b, 2))
      d = Math.min(d, decimalsForSig(b, maxSig))
    }
    return formatNumber(b, { decimals: d, loc })
  }
  const v = formatNumber(value, { decimals: dec, loc })
  const lo = bound(lower)
  const hi = bound(upper)
  return { value: v, lower: lo, upper: hi, text: `${v} [${lo}${sep} ${hi}]` }
}
