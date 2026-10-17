/**
 * The one ISO 8601 reader of the app: the import decides that a column holds dates with it, and the
 * column parser reads the values with it, so a column detected as dates never has cells that then fail.
 *
 * Accepted, with surrounding blanks ignored:
 *  - a date, YYYY-MM-DD (any year from 0000, calendar checked: 2023-02-29 is refused);
 *  - a date and time, YYYY-MM-DD[T|t| ]HH:MM[:SS[.fraction]], read in UTC unless it carries an offset;
 *  - an offset after the date or the time: Z, z, ±HH, ±HHMM or ±HH:MM (optionally after a blank);
 *  - a time of day alone, HH:MM[:SS[.fraction]], read as milliseconds since midnight.
 * A comma may replace the decimal point of the seconds. Hours run 00–23 (24:00 is refused).
 */
const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?$/

/** Epoch milliseconds of a date or date-time, milliseconds since midnight of a time alone; NaN otherwise. */
export function parseIsoDateTime(text: string): number {
  const s = text.trim()
  const t = TIME_RE.exec(s)
  if (t) {
    const h = Number(t[1])
    const mi = Number(t[2])
    const se = t[3] ? Number(t[3]) : 0
    if (h > 23 || mi > 59 || se > 59) return NaN
    return ((h * 60 + mi) * 60 + se) * 1000 + fractionMs(t[4])
  }
  const m = DATE_RE.exec(s)
  if (!m) return NaN
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const h = m[4] ? Number(m[4]) : 0
  const mi = m[5] ? Number(m[5]) : 0
  const se = m[6] ? Number(m[6]) : 0
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || se > 59) return NaN
  // setUTCFullYear, not Date.UTC: Date.UTC reads the years 0–99 as 1900–1999.
  const date = new Date(0)
  date.setUTCFullYear(y, mo - 1, d)
  date.setUTCHours(h, mi, se, 0)
  let ms = date.getTime() + fractionMs(m[7])
  const tz = m[8]
  if (tz && tz.toUpperCase() !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1
    const digits = tz.slice(1).replace(':', '')
    const oh = Number(digits.slice(0, 2))
    const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0
    if (oh > 23 || om > 59) return NaN
    ms -= sign * (oh * 60 + om) * 60_000
  }
  return ms
}

export const isIsoDateTime = (text: string): boolean => !Number.isNaN(parseIsoDateTime(text))

function fractionMs(frac: string | undefined): number {
  if (!frac) return 0
  return Number(`0.${frac}`) * 1000
}

function daysInMonth(y: number, mo: number): number {
  if (mo === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28
  return mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31
}
