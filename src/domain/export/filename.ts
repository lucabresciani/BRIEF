/**
 * Download file names: ASCII letters, digits, '.', '-', '_' only (safe on Windows, macOS, Linux,
 * iOS and in Content-Disposition), at most 80 characters including the extension, never empty.
 */
const MAX_LENGTH = 80

/** Letters that Unicode decomposition does not reduce to ASCII but that have an obvious spelling. */
const TRANSLITERATION: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  þ: 'th',
  Þ: 'Th',
  μ: 'u', // NFKD maps the micro sign µ to Greek mu
  Ω: 'Ohm', // NFKD maps the ohm sign Ω to Greek omega
  '°': 'deg',
}

/** Device names Windows refuses as a file name, whatever the extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * "Caduta libera — 2° prova" + "sciplot" → "Caduta-libera-2deg-prova.sciplot". Accents are dropped,
 * runs of other characters become one '-', leading/trailing separators are trimmed; an empty
 * result becomes "project".
 */
export function safeFileName(name: string, ext: string): string {
  const cleanExt = ext.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)
  const suffix = cleanExt ? '.' + cleanExt : ''
  const ascii = Array.from(
    name.normalize('NFKD').replace(/\p{M}/gu, ''),
    (ch) => TRANSLITERATION[ch] ?? ch,
  ).join('')
  const trim = (s: string) => s.replace(/^[-._]+|[-._]+$/g, '')
  let base = trim(ascii.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-'))
  base = trim(base.slice(0, MAX_LENGTH - suffix.length - 1)) || 'project'
  const stem = base.split('.')[0]
  if (WINDOWS_RESERVED.test(stem)) base = stem + '_' + base.slice(stem.length)
  return base + suffix
}

/**
 * Name of an exported figure before safeFileName: "{project or dataset} – {plot label}", so the
 * figures of one project's plots get different names. Either part alone when the other is empty or
 * the same (a plot created from a dataset is named after it).
 */
export function figureFileBase(owner: string, plotLabel: string): string {
  const a = owner.trim()
  const b = plotLabel.trim()
  if (!a || !b || a === b) return a || b || 'figure'
  return `${a} – ${b}`
}
