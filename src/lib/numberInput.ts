/**
 * Numbers typed into UI controls (axis limits, uncertainties, k…): accepts "1.5", "1,5", "−2", "1e-3",
 * "1,5E-3". A single separator is a decimal separator (typed values are not thousands-grouped).
 */
export function parseUserNumber(text: string): number | null {
  let s = text.trim().replace(/−/g, '-').replace(/\s+/g, '')
  if (!s) return null
  const dots = (s.match(/\./g) ?? []).length
  const commas = (s.match(/,/g) ?? []).length
  if (dots + commas > 1) return null
  s = s.replace(',', '.')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

/** Shortest round-trip text of a number with the chosen decimal separator (for editing). */
export function formatPlain(v: number, decimal: '.' | ','): string {
  const s = String(v)
  return decimal === ',' ? s.replace('.', ',') : s
}
