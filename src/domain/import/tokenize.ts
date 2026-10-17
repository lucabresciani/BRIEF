import Papa from 'papaparse'
import { asRowId, fail, issue, ok, type Delimiter, type Issue, type Result, type RowId } from '@/domain/model'
import { stripBomChar } from './decode'

/**
 * Text → rectangular grid of strings with Papa Parse (header:false, dynamicTyping:false: every cell stays
 * the exact text of the file; types are decided later, per column). Nothing is dropped: short rows are
 * padded with '', extra fields become extra columns, interior blank lines stay as all-'' rows.
 */
export interface TokenizedGrid {
  rows: string[][]
  /** 1-based physical line where each grid row starts (quoted multi-line fields span several lines). */
  sourceRow: Int32Array
  issues: Issue[]
}

export interface RawRows {
  /** Fields per row exactly as tokenised (not padded). The final empty line after a trailing newline is not a row. */
  rows: string[][]
  sourceRow: number[]
  /**
   * Physical line of the opening quote of the first malformed quoted field (null when quotes are well formed):
   * a quote never closed (Papa 'MissingQuotes') or a closing quote followed by more text, `"Rod A" long`
   * (Papa 'InvalidQuotes'). Papa then keeps searching for a later quote and merges every line in between into
   * one cell, so both make the grid unreliable.
   */
  quoteErrorLine: number | null
  /** Grid row where that field starts. */
  quoteErrorRow: number | null
  /**
   * Which problem that is, as the reader of the file sees it (quoteKind): 'unclosed' = the quote is not closed
   * on its own line, 'malformed' = it is, and text follows the closing quote; null without one.
   */
  quoteErrorKind: QuoteErrorKind | null
  /** Set when parsing stopped because the cell limit was exceeded. */
  abortedAtCells: number | null
}

export type QuoteErrorKind = 'unclosed' | 'malformed'

/**
 * Kind of a quote error whose field opens just before `afterOpen`. Papa reports 'InvalidQuotes' for the first
 * quote after the opening one (escaped "" pairs skipped) that is not followed by a delimiter, a line break or
 * the end. When that quote lies on the opening line, the field was closed and text follows it (`"Rod A" long`):
 * 'malformed'. When it lies on a later line, Papa took another quote (often the opening quote of a quoted
 * field on the next row) as the closing one, and the opening line itself never closes its quote: 'unclosed'.
 */
function quoteKind(text: string, afterOpen: number, code: string): QuoteErrorKind {
  if (code !== 'InvalidQuotes') return 'unclosed'
  let i = afterOpen
  for (;;) {
    const q = text.indexOf('"', i)
    if (q < 0) return 'unclosed'
    if (text.charCodeAt(q + 1) === 34) {
      i = q + 2
      continue
    }
    const between = text.slice(afterOpen, q)
    return between.includes('\n') || between.includes('\r') ? 'unclosed' : 'malformed'
  }
}

/**
 * Line terminator used to split rows. Pure CRLF files use '\r\n'; any LF (alone or mixed with CRLF) uses '\n'
 * (a stray trailing '\r' is then removed from the last field); only-CR files use '\r'. Text inside quotes is
 * ignored when quotes are honoured, because Excel writes LF inside quoted cells of CRLF files.
 */
export function guessNewline(text: string, quoteAware: boolean): '\r\n' | '\n' | '\r' {
  let s = text.length > 2 ** 20 ? text.slice(0, 2 ** 20) : text
  if (quoteAware && s.includes('"')) s = s.replace(/"[^]*?"/g, '')
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 13) {
      if (s.charCodeAt(i + 1) === 10) {
        crlf++
        i++
      } else cr++
    } else if (c === 10) lf++
  }
  if (crlf > 0 && lf === 0 && cr === 0) return '\r\n'
  if (lf > 0 || crlf > 0) return '\n'
  return cr > 0 ? '\r' : '\n'
}

/**
 * A delimiter absent from the text, used when every line is a single field. Usually a control character
 * the text does not contain; otherwise a run of U+0001 one longer than the longest run in the text, which
 * cannot occur in it (Papa Parse accepts multi-character delimiters). Never fails, one pass per candidate.
 */
export function absentDelimiter(text: string): string {
  for (const c of ['\u0001', '\u0002', '\u0003', '\u0004', '\u0005', '\u0006', '\u0007', '\u0008']) {
    if (!text.includes(c)) return c
  }
  let run = 0
  let longest = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 1) {
      run++
      if (run > longest) longest = run
    } else run = 0
  }
  return '\u0001'.repeat(longest + 1)
}

/** Counts physical line breaks ('\r\n', '\r', '\n' each count once) incrementally while offsets grow. */
function lineCounter(text: string) {
  let pos = 0
  let line = 1
  return (offset: number): number => {
    while (pos < offset) {
      const c = text.charCodeAt(pos)
      if (c === 13) {
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1
        line++
      } else {
        pos++
        if (c === 10) line++
      }
    }
    return line
  }
}

/**
 * Low-level tokenisation shared by the delimiter detector and `tokenize`: raw (unpadded) rows, the physical
 * line where each starts, unclosed-quote detection, optional row and cell limits.
 */
export function parseRows(
  input: string,
  delimiter: Delimiter,
  opts: { ignoreQuotes?: boolean; maxRows?: number; maxCells?: number } = {},
): RawRows {
  const text = stripBomChar(input)
  const out: RawRows = {
    rows: [],
    sourceRow: [],
    quoteErrorLine: null,
    quoteErrorRow: null,
    quoteErrorKind: null,
    abortedAtCells: null,
  }
  if (text === '') return out
  const quoteAware = !opts.ignoreQuotes
  const newline = guessNewline(text, quoteAware)
  const stripCR = newline === '\n' && text.includes('\r')
  const delim = delimiter === 'none' ? absentDelimiter(text) : delimiter
  const lineAt = lineCounter(text)
  const maxCells = opts.maxCells ?? Infinity
  const maxRows = opts.maxRows ?? Infinity
  let rowStart = 0
  let cells = 0
  let stopped = false

  Papa.parse<string[]>(text, {
    delimiter: delim,
    newline,
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
    quoteChar: '"',
    fastMode: opts.ignoreQuotes ? true : undefined,
    step(result, parser) {
      const row = result.data
      if (stripCR && row.length > 0) {
        const last = row[row.length - 1]!
        if (last.endsWith('\r')) row[row.length - 1] = last.slice(0, -1)
      }
      out.sourceRow.push(lineAt(rowStart))
      out.rows.push(row)
      for (const e of result.errors) {
        if ((e.code === 'MissingQuotes' || e.code === 'InvalidQuotes') && out.quoteErrorLine === null) {
          // Papa's index is one past the opening quote.
          const open = Math.max(rowStart, (e.index ?? rowStart + 1) - 1)
          out.quoteErrorRow = out.rows.length - 1
          out.quoteErrorLine = lineAt(open)
          out.quoteErrorKind = quoteKind(text, open + 1, e.code)
        }
      }
      rowStart = result.meta.cursor
      cells += row.length
      if (cells > maxCells) {
        out.abortedAtCells = cells
        stopped = true
        parser.abort()
      } else if (out.rows.length >= maxRows) {
        stopped = true
        parser.abort()
      }
    },
  })

  // A file ending with a newline yields one last empty "row" that is not a line of the file.
  const n = out.rows.length
  if (n > 0 && !stopped && out.quoteErrorLine === null) {
    const last = out.rows[n - 1]!
    const endsWithBreak = text.endsWith('\n') || text.endsWith('\r')
    if (last.length === 1 && last[0] === '' && endsWithBreak) {
      out.rows.pop()
      out.sourceRow.pop()
    }
  }
  return out
}

const isBlankRow = (row: readonly string[]) => row.every((c) => c.trim() === '')

/** Most frequent field count among non-blank rows with ≥ 2 fields (ties → the wider); 1 if there are none. */
export function modalWidth(rows: readonly (readonly string[])[]): number {
  const freq = new Map<number, number>()
  for (const r of rows) {
    if (r.length < 2 || isBlankRow(r)) continue
    freq.set(r.length, (freq.get(r.length) ?? 0) + 1)
  }
  let best = 1
  let bestF = 0
  for (const [w, f] of freq) if (f > bestF || (f === bestF && w > best)) [best, bestF] = [w, f]
  return best
}

/**
 * Tokenises the whole text with an explicit delimiter ('none' = one field per line).
 * Errors: E_QUOTES_UNCLOSED {row, kind} (physical line of the opening quote of an unclosed or malformed
 * quoted field, see RawRows.quoteErrorLine; kind 'unclosed' = not closed on its line, 'malformed' = text
 * after the closing quote, `"Rod A" long`; the remedy is the same, "Ignore quotes") unless `ignoreQuotes` (quotes
 * are then ordinary characters); E_TOO_MANY_CELLS {cells, limit} when the fields read, or the padded
 * grid, exceed `maxCells` (parsing is aborted, nothing is truncated silently).
 * Warnings in `issues`: W_RAGGED_ROWS {count, row} for non-blank rows shorter than the modal width (padded
 * with ''), W_EXTRA_FIELDS {count, row} for rows with non-empty fields beyond it (kept as extra columns).
 */
export function tokenize(
  text: string,
  delimiter: Delimiter,
  opts: { maxCells: number; ignoreQuotes?: boolean },
): Result<TokenizedGrid> {
  const raw = parseRows(text, delimiter, { ignoreQuotes: opts.ignoreQuotes, maxCells: opts.maxCells })
  if (raw.abortedAtCells !== null) {
    return fail(issue('E_TOO_MANY_CELLS', { cells: raw.abortedAtCells, limit: opts.maxCells }))
  }
  if (raw.quoteErrorLine !== null) {
    const rows: RowId[] = raw.quoteErrorRow !== null ? [asRowId(raw.quoteErrorRow)] : []
    return fail(
      issue(
        'E_QUOTES_UNCLOSED',
        { row: raw.quoteErrorLine, kind: raw.quoteErrorKind ?? 'unclosed' },
        { rows },
      ),
    )
  }

  const rows = raw.rows
  let width = 0
  for (const r of rows) if (r.length > width) width = r.length
  if (rows.length * width > opts.maxCells) {
    return fail(issue('E_TOO_MANY_CELLS', { cells: rows.length * width, limit: opts.maxCells }))
  }

  const modal = modalWidth(rows)
  const short: RowId[] = []
  const long: RowId[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    if (isBlankRow(r)) continue
    if (r.length < modal) short.push(asRowId(i))
    else if (r.length > modal) {
      for (let j = modal; j < r.length; j++) {
        if (r[j]!.trim() !== '') {
          long.push(asRowId(i))
          break
        }
      }
    }
  }
  for (const r of rows) while (r.length < width) r.push('')

  const sourceRow = Int32Array.from(raw.sourceRow)
  const issues: Issue[] = []
  if (short.length) {
    issues.push(issue('W_RAGGED_ROWS', { count: short.length, row: sourceRow[short[0]!]! }, { rows: short }))
  }
  if (long.length) {
    issues.push(issue('W_EXTRA_FIELDS', { count: long.length, row: sourceRow[long[0]!]! }, { rows: long }))
  }
  return ok({ rows, sourceRow, issues })
}
