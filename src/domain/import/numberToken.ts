import type { DecimalMode } from '@/domain/model'
import { CELL, type CellStatus } from '@/domain/derive/types'
import { isMissingToken, isSheetErrorToken } from './missing'

/**
 * Locale-aware classification of ONE cell.
 * The mantissa is read twice — with '.' as decimal (',' / space / apostrophe as grouping) and with ',' as
 * decimal ('.' / space / apostrophe as grouping) — and Number() is only ever called on a validated
 * canonical string, never on the raw text (Number('') = 0, Number('0x1A') = 26, parseFloat('12abc') = 12).
 *
 *  neutral   — same value under both readings: "12", "-3", "1e5", "+7", "−3", "1 234"
 *  dot       — only valid with '.' as decimal: "0.5", "1,234.5", "1.5e-3", "3.0e+08 m/s"
 *  comma     — only valid with ',' as decimal: "0,5", "0,234", "1.234,5", "1,5E-3", "1 234,5", "−3,2"
 *  ambiguous — both readings valid but different: "1,234" (1234 or 1.234), "12.500"
 *  invalid   — anything else: "abc", "0x1A", "Infinity", "1.2.3", "1e", ""
 *
 * Grouping is valid only when the first group is 1–3 digits without a leading zero and every later group
 * has exactly 3 digits; grouping is never combined with an exponent.
 */
export type TokenClass = 'neutral' | 'dot' | 'comma' | 'ambiguous' | 'invalid'

export interface NumberToken {
  cls: TokenClass
  /** Value with '.' as decimal separator (NaN when that reading is invalid). */
  dotValue: number
  /** Value with ',' as decimal separator (NaN when that reading is invalid). */
  commaValue: number
  /** Unit text after the number ("12 mV" → "mV"); null when absent or for '%'. */
  unit: string | null
  /** A trailing '%' was present. The value is NOT divided by 100. */
  percent: boolean
  /**
   * Evidence of thousands grouping: a token readable one way only that contains the other separator
   * ("1,234.5", "1.234,5", "1,234,567"). A column with such a token uses grouping on purpose.
   */
  grouping: boolean
}

export interface ClassifyOptions {
  /**
   * Accept a single ASCII space between digits as a thousands separator ("1 234,5"). Default true. Off for
   * files read without a delimiter: there a space between digits more likely separates two columns
   * ("10 100.9" is t = 10, p = 100.9, not 10100.9). NBSP and thin spaces stay accepted.
   */
  spaceGrouping?: boolean
}

const MINUS = new Set(['-', '\u2212', '\u2013', '\ufe63', '\uff0d'])
const APOSTROPHES = new Set(["'", '’'])
const SPACE_RE = /\s/

/**
 * A unit is one token starting with a letter or a unit symbol, then letters, digits (also superscripts)
 * and the usual unit punctuation: "mV", "°C", "m/s", "mg/L", "kg·m⁻³", "µs", "a.u.", "%RH".
 */
const UNIT_RE = /^(?:[\p{L}µΩ°℃℉Å‰]|%(?=\p{L}))[\p{L}\p{N}µΩ°℃℉Å‰·⋅*/^_\-\u2212⁻⁺.()%]{0,15}$/u

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'
const isSpace = (c: string | undefined): boolean => c !== undefined && SPACE_RE.test(c)

function invalid(): NumberToken {
  return { cls: 'invalid', dotValue: NaN, commaValue: NaN, unit: null, percent: false, grouping: false }
}

/** Reads a validated mantissa with the given decimal separator; NaN when that reading is not valid. */
function readMantissa(mant: string, dec: '.' | ',', exp: string, negative: boolean): number {
  const other = dec === '.' ? ',' : '.'
  const k = mant.indexOf(dec)
  if (k !== mant.lastIndexOf(dec)) return NaN
  const intPart = k < 0 ? mant : mant.slice(0, k)
  const frac = k < 0 ? '' : mant.slice(k + 1)
  for (const c of frac) if (!isDigit(c)) return NaN

  let intDigits: string
  let grouped = false
  for (const c of intPart) {
    if (!isDigit(c)) {
      grouped = true
      break
    }
  }
  if (!grouped) intDigits = intPart
  else {
    if (exp !== '') return NaN
    let kind: 'sep' | 'space' | 'apos' | null = null
    const groups: string[] = []
    let cur = ''
    for (const c of intPart) {
      if (isDigit(c)) {
        cur += c
        continue
      }
      const ck = c === other ? 'sep' : isSpace(c) ? 'space' : APOSTROPHES.has(c) ? 'apos' : null
      if (ck === null || (kind !== null && ck !== kind)) return NaN
      kind = ck
      groups.push(cur)
      cur = ''
    }
    groups.push(cur)
    const first = groups[0]
    if (first.length < 1 || first.length > 3 || first[0] === '0') return NaN
    for (let g = 1; g < groups.length; g++) if (groups[g].length !== 3) return NaN
    intDigits = groups.join('')
  }
  if (intDigits === '' && frac === '') return NaN
  const canonical =
    (negative ? '-' : '') + (intDigits || '0') + (frac ? '.' + frac : '') + (exp ? 'e' + exp : '')
  const v = Number(canonical)
  if (!Number.isFinite(v)) return NaN
  if (v === 0) return /[1-9]/.test(intDigits + frac) ? NaN : 0 // underflow ("1e-400") is not 0; no −0
  return v
}

/** Classifies a cell text as a number under the '.' and ',' decimal conventions (see TokenClass). */
export function classifyNumberToken(text: string, opts?: ClassifyOptions): NumberToken {
  const s = text.trim()
  if (s === '') return invalid()
  const spaceGrouping = opts?.spaceGrouping ?? true

  let i = 0
  let negative = false
  if (s[0] === '+') i = 1
  else if (MINUS.has(s[0])) {
    negative = true
    i = 1
  }

  // Mantissa: digits, '.', ',', apostrophes, and single spaces between digits (thousands groups).
  const start = i
  while (i < s.length) {
    const c = s[i]
    if (isDigit(c) || c === '.' || c === ',' || APOSTROPHES.has(c)) i++
    else if (isSpace(c) && (spaceGrouping || c !== ' ') && isDigit(s[i - 1]) && isDigit(s[i + 1])) i++
    else break
  }
  const mant = s.slice(start, i)
  let hasDigit = false
  for (const c of mant) if (isDigit(c)) hasDigit = true
  if (!hasDigit) return invalid()

  // Exponent directly attached: e / E, optional sign, at least one digit ("1e" and "1eV" are invalid).
  let exp = ''
  if (s[i] === 'e' || s[i] === 'E') {
    let j = i + 1
    let sign = ''
    if (s[j] === '+') j++
    else if (MINUS.has(s[j])) {
      sign = '-'
      j++
    }
    const ds = j
    while (isDigit(s[j])) j++
    if (j === ds) return invalid()
    exp = sign + s.slice(ds, j)
    i = j
  }

  // Tail: '%' or a unit, optionally separated by whitespace.
  let unit: string | null = null
  let percent = false
  if (i < s.length) {
    const rest = s.slice(i)
    const spaced = isSpace(rest[0])
    const tail = rest.trim()
    if (tail === '%') percent = true
    else {
      if (!UNIT_RE.test(tail)) return invalid()
      if (/^[eE][+\-\u2212]?\d/.test(tail)) return invalid() // "1.5 E-3": a detached exponent, not a unit
      if (!spaced && /^[xX]/.test(tail)) return invalid() // "0x1A", "10x"
      if (!spaced && mant === '0' && /^[bBoO]\d/.test(tail)) return invalid() // "0b11", "0o17"
      unit = tail
    }
  }

  const dotValue = readMantissa(mant, '.', exp, negative)
  const commaValue = readMantissa(mant, ',', exp, negative)
  const dotOk = !Number.isNaN(dotValue)
  const commaOk = !Number.isNaN(commaValue)
  let cls: TokenClass
  if (dotOk && commaOk) cls = dotValue === commaValue ? 'neutral' : 'ambiguous'
  else if (dotOk) cls = 'dot'
  else if (commaOk) cls = 'comma'
  else return invalid()
  const grouping = (cls === 'dot' && mant.includes(',')) || (cls === 'comma' && mant.includes('.'))
  return { cls, dotValue, commaValue, unit, percent, grouping }
}

/**
 * Column-level rule for ambiguous tokens written with the OTHER separator ("1.000" in a comma-decimal
 * column, "1,000" in a dot-decimal one). Reading them as thousands grouping (1000) is allowed only when
 * the column shows grouping elsewhere ("101.298,5") or has no token of its own convention (the mode was a
 * tie-break, reported as W_DECIMAL_AMBIGUOUS). Otherwise "1.000" next to "0,995" is far more likely a
 * typed 1.000 than 1000: such cells become CELL.separatorConflict instead of a value 1000× off.
 */
export function foreignGroupingAllowed(
  decimal: DecimalMode,
  counts: { dot: number; comma: number; grouping: boolean },
): boolean {
  if (decimal === 'mixed' || counts.grouping) return true
  return (decimal === 'dot' ? counts.dot : counts.comma) === 0
}

/** Votes and grouping evidence of classified tokens, the input of foreignGroupingAllowed. */
export function tokenVotes(tokens: Iterable<NumberToken | null>): {
  dot: number
  comma: number
  grouping: boolean
} {
  let dot = 0
  let comma = 0
  let grouping = false
  for (const t of tokens) {
    if (!t) continue
    if (t.cls === 'dot') dot++
    else if (t.cls === 'comma') comma++
    if (t.grouping) grouping = true
  }
  return { dot, comma, grouping }
}

/** Unit used for unit comparisons: '%' for percent cells; µ/μ and Ω/Ω spellings unified. */
export function tokenUnit(tok: Pick<NumberToken, 'unit' | 'percent'>): string | null {
  if (tok.percent) return '%'
  return tok.unit === null ? null : normalizeUnit(tok.unit)
}

/** Canonical spelling for unit comparison (MICRO SIGN vs GREEK MU, OHM SIGN vs GREEK OMEGA). */
export function normalizeUnit(unit: string): string {
  return unit.trim().replace(/μ/g, 'µ').replace(/Ω/g, 'Ω')
}

/** True when a spreadsheet cell's formatted text shows a percent sign (Excel percent format, "12%"). */
export function hasPercentSuffix(text: string): boolean {
  return text.trimEnd().endsWith('%')
}

export interface ParsedNumber {
  status: CellStatus
  /** NaN whenever status ≠ ok: a missing value never becomes 0. */
  value: number
  unit: string | null
  percent: boolean
}

export interface ReadOptions extends ClassifyOptions {
  /** The column unit (null = none). When given, a cell carrying another unit is CELL.unexpectedUnit. */
  expectedUnit?: string | null
  /**
   * May an ambiguous token with the other separator be read as grouping ("1.000" = 1000 in a comma
   * column)? Default true; columns pass foreignGroupingAllowed(). When false such cells are
   * CELL.separatorConflict.
   */
  foreignGrouping?: boolean
}

/**
 * Parses one cell under a column's decimal mode.
 *  - missing token → CELL.missing; spreadsheet error → CELL.sheetError; unreadable → CELL.invalid.
 *  - 'dot': neutral/dot → value; ambiguous → the '.'-decimal reading ("1,234" = 1234, "1.234" = 1.234),
 *    unless opts.foreignGrouping is false (then "1,234" → CELL.separatorConflict);
 *    comma-only → CELL.separatorConflict.  'comma': mirror image.
 *  - 'mixed': each token with its own separator; ambiguous tokens → CELL.invalid (a guess could be 1000× off).
 *  - opts.expectedUnit (the column unit, null = none): when given, a cell carrying a different unit
 *    ("12 mV" in a V column, "12abc" in a unitless column) → CELL.unexpectedUnit. Units are never converted.
 */
export function parseNumber(text: string, decimal: DecimalMode, opts?: ReadOptions): ParsedNumber {
  if (isMissingToken(text)) return { status: CELL.missing, value: NaN, unit: null, percent: false }
  if (isSheetErrorToken(text)) return { status: CELL.sheetError, value: NaN, unit: null, percent: false }
  return resolveToken(classifyNumberToken(text, opts), decimal, opts)
}

/** True when the token's reading under `decimal` treats its only separator as thousands grouping. */
function readsAsGrouping(tok: NumberToken, decimal: 'dot' | 'comma'): boolean {
  if (tok.cls !== 'ambiguous') return false
  // The grouping reading of "1,234" / "1.234" is the larger of the two (×1000).
  const chosen = decimal === 'dot' ? tok.dotValue : tok.commaValue
  const other = decimal === 'dot' ? tok.commaValue : tok.dotValue
  return Math.abs(chosen) > Math.abs(other)
}

/** The decimal-mode and unit rules of parseNumber applied to an already classified token. */
export function resolveToken(tok: NumberToken, decimal: DecimalMode, opts?: ReadOptions): ParsedNumber {
  const { unit, percent } = tok
  if (tok.cls === 'invalid') return { status: CELL.invalid, value: NaN, unit, percent }

  let value: number
  if (decimal === 'dot' || decimal === 'comma') {
    const conflict = decimal === 'dot' ? 'comma' : 'dot'
    if (tok.cls === conflict) return { status: CELL.separatorConflict, value: NaN, unit, percent }
    if (opts?.foreignGrouping === false && readsAsGrouping(tok, decimal)) {
      return { status: CELL.separatorConflict, value: NaN, unit, percent }
    }
    value = decimal === 'dot' ? tok.dotValue : tok.commaValue
  } else {
    if (tok.cls === 'ambiguous') return { status: CELL.invalid, value: NaN, unit, percent }
    value = tok.cls === 'comma' ? tok.commaValue : tok.dotValue
  }

  if (opts && opts.expectedUnit !== undefined) {
    const cellUnit = tokenUnit(tok)
    const expected = opts.expectedUnit === null ? null : normalizeUnit(opts.expectedUnit)
    if (cellUnit !== null && cellUnit !== expected) {
      return { status: CELL.unexpectedUnit, value: NaN, unit, percent }
    }
  }
  return { status: CELL.ok, value, unit, percent }
}
