import { asRowId, issue, type Delimiter, type Issue } from '@/domain/model'
import { looksLikeUnit } from './layout'
import { isMissingToken } from './missing'
import { classifyNumberToken } from './numberToken'
import { parseRows } from './tokenize'

/**
 * Delimiter detection. Papa's own guesser is NOT used: it previews 10 rows and prefers the
 * candidate with more fields, so headerless European data "0,5;1,2" is split on ',' and preambles longer
 * than 10 lines break it. Here every candidate is scored on a quote-aware sample (64 KB / 200 lines):
 *
 *  1. table: the earliest row from which ≥ 90 % of the non-blank rows share the modal field count m ≥ 2
 *     (rows before it are a preamble, e.g. "Experiment: pendulum"); coverage = rows with m fields. When no
 *     candidate reaches 90 %, 60 % is accepted with confidence 'low' (a small file with ragged rows);
 *  2. ranking: coverage, then cleanliness (share of cells without another candidate character, a ','
 *     between digits being a decimal comma, not a separator), then priority tab > ; > , > |;
 *  3. W_DELIMITER_AMBIGUOUS {a, b} (confidence 'low') when the runner-up describes the same table about as
 *     well, unless its character only appears inside numbers of the winner ("0,5;1,2" → ';', high);
 *  4. no valid candidate → 'none' + W_SINGLE_COLUMN; ',' that only ever splits "1,70" into two digit groups
 *     → 'none' too (a single column of decimal-comma numbers or two integer columns?), confidence 'low',
 *     commaDecimal set; also below a "Name, unit" header ("Lunghezza, cm" over "1,5", "2,3");
 *  5. no candidate, but the lines split on runs of spaces into the same number (≥ 2) of numbers (a .dat
 *     file "0 101.3"): whitespace is not a supported delimiter, so 'none' with confidence 'low' (the import
 *     must be confirmed; the cells are not read as one fused number, see ClassifyOptions.spaceGrouping).
 * A first line "sep=;" (Excel) forces that delimiter: I_SEP_LINE {d}, sepLine set (the line stays in the raw data).
 * Scoring is quote-aware unless `ignoreQuotes` (the dialog's "Ignore quotes"): rows from the first unclosed or
 * malformed quoted field on are not scored, since the tokenizer would merge them.
 */
export interface DelimiterDetection {
  delimiter: Delimiter
  confidence: 'high' | 'low'
  alternatives: Delimiter[]
  sepLine: Delimiter | null
  issues: Issue[]
  /** 'none' was chosen because ',' looks like a decimal comma: ambiguous "1,425" should read 1.425. */
  commaDecimal: boolean
}

export interface DetectDelimiterOptions {
  /** Read quote characters as text, as the tokenizer will (the dialog's "Ignore quotes"). */
  ignoreQuotes?: boolean
}

const CANDIDATES = ['\t', ';', ',', '|'] as const
type Candidate = (typeof CANDIDATES)[number]

const SAMPLE_CHARS = 64 * 1024
const SAMPLE_ROWS = 200
const CONSISTENCY = 0.9
/** Fallback when no candidate reaches 0.9 (small files with a few ragged rows): chosen with low confidence. */
const RELAXED_CONSISTENCY = 0.6
const NEAR_COVERAGE = 0.9
const CLEAR_QUALITY_GAP = 0.2

/** Human label used in messages: 'Tab' for '\t', '—' for no delimiter, the character otherwise. */
export function delimiterLabel(d: Delimiter): string {
  return d === '\t' ? 'Tab' : d === 'none' ? '—' : d
}

/** Excel's "sep=;" first line → the delimiter it names (only the four supported ones). */
export function sepLineDelimiter(text: string): Delimiter | null {
  const first = /^[^\r\n]*/.exec(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)![0]
  const m = /^sep=(.)\s*$/i.exec(first)
  if (!m) return null
  const c = m[1]!
  return (CANDIDATES as readonly string[]).includes(c) ? (c as Candidate) : null
}

/** First 64 KB cut after the last line break (the whole text when shorter). */
function sampleOf(text: string): string {
  if (text.length <= SAMPLE_CHARS) return text
  const cut = text.slice(0, SAMPLE_CHARS)
  const last = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('\r'))
  return last > 0 ? cut.slice(0, last + 1) : cut
}

const isDigitCode = (c: number) => c >= 48 && c <= 57

/** True when every occurrence of `ch` in `cell` is a ',' between two digits (a decimal comma or grouping). */
function onlyInsideNumbers(cell: string, ch: string): boolean {
  let i = cell.indexOf(ch)
  while (i >= 0) {
    if (ch !== ',' || !isDigitCode(cell.charCodeAt(i - 1)) || !isDigitCode(cell.charCodeAt(i + 1)))
      return false
    i = cell.indexOf(ch, i + 1)
  }
  return true
}

interface Score {
  d: Candidate
  valid: boolean
  coverage: number
  quality: number
  /** Non-blank rows of the detected table (from its first row to the end of the sample). */
  table: string[][]
}

const isBlank = (r: readonly string[]) => r.every((c) => c.trim() === '')

function scoreCandidate(sample: string, d: Candidate, consistency: number, ignoreQuotes: boolean): Score {
  const none: Score = { d, valid: false, coverage: 0, quality: 0, table: [] }
  if (!sample.includes(d)) return none
  const raw = parseRows(sample, d, { maxRows: SAMPLE_ROWS, ignoreQuotes })
  // An unclosed or malformed quote in the sample (possibly cut mid-field): score only the rows before it.
  const all = raw.quoteErrorRow !== null ? raw.rows.slice(0, raw.quoteErrorRow) : raw.rows
  const rows = all.filter((r) => !isBlank(r))
  const n = rows.length
  if (n === 0) return none

  // Smallest start s whose suffix is ≥ 90 % consistent on its modal width m ≥ 2, starting on an m-wide row.
  const freq = new Map<number, number>()
  let mode = 0
  let modeF = 0
  let start = -1
  let coverage = 0
  for (let s = n - 1; s >= 0; s--) {
    const w = rows[s]!.length
    const f = (freq.get(w) ?? 0) + 1
    freq.set(w, f)
    if (f > modeF || (f === modeF && w > mode)) [mode, modeF] = [w, f]
    if (w === mode && mode >= 2 && modeF / (n - s) >= consistency) {
      start = s
      coverage = modeF
    }
  }
  if (start < 0 || (coverage < 2 && n > 1)) return none

  const table = rows.slice(start)
  let cells = 0
  let clean = 0
  for (const r of table) {
    for (const cell of r) {
      if (cell.trim() === '') continue
      cells++
      if (CANDIDATES.every((o) => o === d || onlyInsideNumbers(cell, o))) clean++
    }
  }
  return { d, valid: true, coverage, quality: cells ? clean / cells : 1, table }
}

const INT_RE = /^\s*[+\-−]?\d+\s*$/
const FRACTION_RE = /^\d+(?:[eE][+\-−]?\d+)?(?:\s*[^\s\d,;|\t]\S*)?\s*$/

/** ',' only ever splits rows into "digits" + "digits[unit]": "1,70" is a decimal comma, not two columns. */
function onlyDigitPairs(rows: readonly string[][]): boolean {
  let pairs = 0
  for (const r of rows) {
    if (r.length > 2) return false
    if (r.length === 2) {
      if (!INT_RE.test(r[0]!) || !FRACTION_RE.test(r[1]!)) return false
      pairs++
    } else if (!INT_RE.test(r[0]!)) return false
  }
  return pairs > 0
}

/**
 * "Lunghezza, cm" / "Mass, [g]": a name, ", " and ONE short unit token (or a bracketed unit), the header of
 * a single column rather than two ("Rossi, Mario Luigi" is not).
 */
function nameUnitHeader(row: readonly string[]): boolean {
  if (row.length !== 2 || INT_RE.test(row[0]!) || row[0]!.trim() === '') return false
  const u = row[1]!
  const t = u.trim()
  if (/^\(.*\)$|^\[.*\]$/.test(t)) return looksLikeUnit(t.slice(1, -1))
  return /^\s/.test(u) && t.length <= 8 && !/\s/.test(t) && looksLikeUnit(t)
}

/** The table of ',' only splits numbers ("1,70"), possibly under a "Name, unit" header. */
function commaOnlySplitsNumbers(table: readonly string[][]): boolean {
  if (onlyDigitPairs(table)) return true
  return table.length >= 2 && nameUnitHeader(table[0]!) && onlyDigitPairs(table.slice(1))
}

const WHITESPACE_SHARE = 0.8

/**
 * Lines that split on runs of whitespace into the same number (≥ 2) of fields, most of them numbers:
 * a whitespace-separated table ("t P" / "0 101.3"), which no supported delimiter describes.
 */
function looksWhitespaceSeparated(sample: string): boolean {
  const lines = sample
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, SAMPLE_ROWS)
  if (lines.length < 2) return false
  // ASCII spaces and tabs only: NBSP / thin spaces are digit-group separators ("1 234"), not columns.
  const fields = lines.map((l) => l.replace(/^[ \t]+|[ \t]+$/g, '').split(/[ \t]+/))
  const freq = new Map<number, number>()
  for (const f of fields) freq.set(f.length, (freq.get(f.length) ?? 0) + 1)
  let m = 0
  let mf = 0
  for (const [w, f] of freq) if (f > mf || (f === mf && w > m)) [m, mf] = [w, f]
  if (m < 2 || mf < WHITESPACE_SHARE * lines.length) return false
  const isNumberField = (t: string) =>
    isMissingToken(t) || classifyNumberToken(t, { spaceGrouping: false }).cls !== 'invalid'
  let numeric = 0
  for (const f of fields) if (f.length === m && f.every(isNumberField)) numeric++
  return numeric >= 2 && numeric * 2 >= mf
}

export function detectDelimiter(text: string, opts: DetectDelimiterOptions = {}): DelimiterDetection {
  const sep = sepLineDelimiter(text)
  if (sep) {
    return {
      delimiter: sep,
      confidence: 'high',
      alternatives: [],
      sepLine: sep,
      issues: [issue('I_SEP_LINE', { d: delimiterLabel(sep) }, { rows: [asRowId(0)] })],
      commaDecimal: false,
    }
  }
  const sample = sampleOf(text)
  if (sample.trim() === '')
    return {
      delimiter: 'none',
      confidence: 'high',
      alternatives: [],
      sepLine: null,
      issues: [],
      commaDecimal: false,
    }

  const ignoreQuotes = opts.ignoreQuotes === true
  const rank = (consistency: number) =>
    CANDIDATES.map((d) => scoreCandidate(sample, d, consistency, ignoreQuotes))
      .filter((s) => s.valid)
      .sort(
        (a, b) =>
          b.coverage - a.coverage ||
          b.quality - a.quality ||
          CANDIDATES.indexOf(a.d) - CANDIDATES.indexOf(b.d),
      )
  let ranked = rank(CONSISTENCY)
  const relaxed = ranked.length === 0
  if (relaxed) ranked = rank(RELAXED_CONSISTENCY)

  const single = (
    confidence: 'high' | 'low',
    alternatives: Delimiter[],
    commaDecimal: boolean,
  ): DelimiterDetection => ({
    delimiter: 'none',
    confidence,
    alternatives,
    sepLine: null,
    issues: [issue('W_SINGLE_COLUMN')],
    commaDecimal,
  })
  if (ranked.length === 0) return single(looksWhitespaceSeparated(sample) ? 'low' : 'high', [], false)

  const best = ranked[0]!
  if (best.d === ',' && commaOnlySplitsNumbers(best.table)) {
    return single('low', [',', ...ranked.slice(1).map((s) => s.d)], true)
  }

  const alternatives = ranked.slice(1).map((s) => s.d)
  const runner = ranked[1]
  if (runner) {
    const near = runner.coverage >= NEAR_COVERAGE * best.coverage
    const close = best.quality - runner.quality < CLEAR_QUALITY_GAP
    const insideNumbers = best.table.every((r) => r.every((cell) => onlyInsideNumbers(cell, runner.d)))
    if (near && close && !insideNumbers) {
      return {
        delimiter: best.d,
        confidence: 'low',
        alternatives,
        sepLine: null,
        issues: [issue('W_DELIMITER_AMBIGUOUS', { a: delimiterLabel(best.d), b: delimiterLabel(runner.d) })],
        commaDecimal: false,
      }
    }
  }
  // Relaxed: the rows disagree on their field count; the tokenizer reports the ragged rows.
  return {
    delimiter: best.d,
    confidence: relaxed ? 'low' : 'high',
    alternatives,
    sepLine: null,
    issues: [],
    commaDecimal: false,
  }
}
