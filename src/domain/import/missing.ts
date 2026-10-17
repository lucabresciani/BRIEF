/**
 * Missing-value and spreadsheet-error tokens. Neither kind ever becomes 0: callers turn
 * them into NaN plus a CELL status (missing / sheetError) and keep the original text for display.
 */

/** Tokens read as "no value" (compared trimmed and case-insensitively). '' is an empty cell. */
export const MISSING_TOKENS: readonly string[] = [
  '',
  'NA',
  'N/A',
  'n/a',
  'NaN',
  'nan',
  'null',
  'NULL',
  'none',
  'None',
  'missing',
  '-',
  '--',
  '---',
  '\u2014',
  '\u2013',
  '?',
  '.',
  'n.d.',
  'nd',
  'N.D.',
  'n.a.',
  'n.v.',
]

const MISSING_SET: ReadonlySet<string> = new Set(MISSING_TOKENS.map((t) => t.toLowerCase()))

/** True for an empty / whitespace-only cell or a conventional missing-value token. */
export function isMissingToken(text: string): boolean {
  return MISSING_SET.has(text.trim().toLowerCase())
}

/**
 * Error values written by spreadsheets when a formula fails, as they appear in exported text:
 * Excel EN/IT (#DIV/0!, #N/A, #N/D, #VALUE!, #VALORE!, #REF!, #RIF!, #NAME?, #NOME?, #NUM!, #NULL!, #NULLO!,
 * #SPILL!, #CALC!, #GETTING_DATA), plus the common FR/DE/ES spellings, Google Sheets' #ERROR! and
 * LibreOffice's "Err:502" codes.
 */
const SHEET_ERROR_RE = new RegExp(
  '^(?:#(?:' +
    [
      'DIV/0!',
      'N/A',
      'N/D',
      'NV',
      'VALUE!',
      'VALORE!',
      'VALEUR!',
      'WERT!',
      '¡VALOR!',
      'REF!',
      'RIF!',
      'BEZUG!',
      '¡REF!',
      'NAME\\?',
      'NOME\\?',
      'NOM\\?',
      '¿NOMBRE\\?',
      'NUM!',
      'NOMBRE!',
      'ZAHL!',
      '¡NUM!',
      'NULL!',
      'NULLO!',
      'NUL!',
      '¡NULO!',
      '¡DIV/0!',
      'SPILL!',
      'CALC!',
      'GETTING_DATA',
      'FIELD!',
      'BLOCKED!',
      'CONNECT!',
      'BUSY!',
      'UNKNOWN!',
      'ERROR!',
    ].join('|') +
    ')|Err:\\d{3})$',
  'i',
)

/** True when the text is a spreadsheet error value (it is treated as missing, never as 0). */
export function isSheetErrorToken(text: string): boolean {
  return SHEET_ERROR_RE.test(text.trim())
}
