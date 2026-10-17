/**
 * Raw cell texts (+ native spreadsheet cells) and the effective settings → ParsedColumn.
 * Pure and deterministic; the raw texts are never modified. A missing value is NaN + CELL.missing,
 * never 0; every cell that cannot be read keeps its text and gets a status with a reason.
 */
import { NATIVE } from '@/domain/model'
import type { ColumnId, ColumnParseSettings, ReasonCode, RowId } from '@/domain/model'
import { isMissingToken, isSheetErrorToken } from '@/domain/import/missing'
import { parseIsoDateTime } from '@/domain/import/isoDateTime'
import {
  classifyNumberToken,
  foreignGroupingAllowed,
  hasPercentSuffix,
  resolveToken,
  tokenVotes,
  type NumberToken,
  type ReadOptions,
} from '@/domain/import/numberToken'
import { CELL } from './types'
import type { CellStatus, ParseReport, ParsedColumn } from './types'

/** Invalid cells listed by example in the report (the counts are always complete). */
export const MAX_INVALID_EXAMPLES = 20
const MAX_MISSING_TOKENS = 12

export interface ParseColumnOptions {
  /** RowId of each text (aligned); defaults to the index. Used in the report's examples. */
  rowIds?: ArrayLike<number>
  /**
   * The column unit. When given (null = the column has no unit), a numeric cell carrying a different
   * unit tail ("12 mV" in a V column) is CELL.unexpectedUnit: units are never converted.
   * When undefined, unit tails are not checked.
   */
  unit?: string | null
  /**
   * A single space between digits may be a thousands separator ("1 234,5"). Default true; false for text
   * read without a delimiter, where "10 100.9" is two numbers, never 10100.9 (RawSource.delimiter 'none').
   */
  spaceGrouping?: boolean
}

/** Excel shows 0.12 as "12%": 'display' reads 12 (as shown), avoiding 0.07·100 = 7.000000000000001. */
const percentDisplay = (v: number) => Number((v * 100).toPrecision(15))
const percentFraction = (v: number) => Number((v / 100).toPrecision(15))

/**
 * Parses one column. Rows are aligned with `texts`.
 * - numeric: parseNumber per cell with the decimal mode; native spreadsheet numbers win over text
 *   (percent-formatted cells: 'display' = v·100, 'fraction' = v); text "12%" is 12 in 'display'
 *   and 0.12 in 'fraction'. Native booleans/dates in a numeric column are invalid. An ambiguous token with
 *   the other separator ("1.000" in a comma column) is grouping only when foreignGroupingAllowed() says
 *   the column uses grouping; otherwise it is CELL.separatorConflict (the same rule as the import inference).
 * - categorical / text: label codes in order of first appearance; only blank cells (and spreadsheet
 *   errors) are missing (−1): missing-value words are labels here ("none" = a control group, "Na" =
 *   sodium); values are NaN (a label is never turned into a number).
 * - datetime: epoch milliseconds (UTC). ISO 8601 "YYYY-MM-DD[(T| )HH:MM[:SS[.fff]]][Z|±HH:MM]";
 *   a time alone "HH:MM[:SS]" is milliseconds since midnight; native date cells use their value.
 */
export function parseColumn(
  columnId: ColumnId,
  texts: readonly string[],
  settings: ColumnParseSettings,
  native?: { kind: Uint8Array; num: Float64Array } | null,
  opts?: ParseColumnOptions,
): ParsedColumn {
  const n = texts.length
  const values = new Float64Array(n).fill(NaN)
  const status = new Uint8Array(n)
  const rowIdOf = (i: number) => (opts?.rowIds ? opts.rowIds[i] : i) as RowId
  const report: ParseReport = {
    nRows: n,
    nValid: 0,
    nMissing: 0,
    nSheetError: 0,
    nInvalid: 0,
    invalidExamples: [],
    missingTokens: [],
  }
  const missingTokens = new Set<string>()
  const nativeKind = (i: number): number | null => (native && i < native.kind.length ? native.kind[i] : null)

  const mark = (i: number, s: CellStatus, code?: ReasonCode) => {
    status[i] = s
    if (s === CELL.ok) report.nValid++
    else if (s === CELL.missing) {
      report.nMissing++
      if (missingTokens.size < MAX_MISSING_TOKENS) missingTokens.add(texts[i].trim())
    } else if (s === CELL.sheetError) report.nSheetError++
    else {
      report.nInvalid++
      if (report.invalidExamples.length < MAX_INVALID_EXAMPLES)
        report.invalidExamples.push({ rowId: rowIdOf(i), text: texts[i], code: code ?? invalidCode(s) })
    }
  }

  let categories: ParsedColumn['categories'] = null

  if (settings.kind === 'categorical' || settings.kind === 'text') {
    const codes = new Int32Array(n).fill(-1)
    const labels: string[] = []
    const index = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      const nk = nativeKind(i)
      const t = texts[i]
      if (nk === NATIVE.error || (nk !== NATIVE.number && isSheetErrorToken(t))) mark(i, CELL.sheetError)
      else if (nk === NATIVE.empty || t.trim() === '') mark(i, CELL.missing)
      else {
        const label = t.trim()
        let code = index.get(label)
        if (code === undefined) {
          code = labels.length
          labels.push(label)
          index.set(label, code)
        }
        codes[i] = code
        mark(i, CELL.ok)
      }
    }
    categories = { codes, labels }
  } else if (settings.kind === 'datetime') {
    for (let i = 0; i < n; i++) {
      const nk = nativeKind(i)
      const t = texts[i]
      if (nk === NATIVE.date && Number.isFinite(native!.num[i])) {
        values[i] = native!.num[i]
        mark(i, CELL.ok)
      } else if (nk === NATIVE.error) mark(i, CELL.sheetError)
      else if (nk === NATIVE.empty || isMissingToken(t)) mark(i, CELL.missing)
      else if (isSheetErrorToken(t)) mark(i, CELL.sheetError)
      else {
        const ms = nk === null || nk === NATIVE.text ? parseIsoDateTime(t) : NaN
        if (Number.isFinite(ms)) {
          values[i] = ms
          mark(i, CELL.ok)
        } else mark(i, CELL.invalid, 'E_NOT_A_NUMBER')
      }
    }
  } else {
    const classifyOpts = { spaceGrouping: opts?.spaceGrouping ?? true }
    // Pass 1: classify the text cells; their votes decide whether foreign grouping is allowed.
    const toks = new Array<NumberToken | null>(n).fill(null)
    for (let i = 0; i < n; i++) {
      const nk = nativeKind(i)
      if (nk !== null && nk !== NATIVE.text) continue
      const t = texts[i]
      if (isMissingToken(t) || isSheetErrorToken(t)) continue
      toks[i] = classifyNumberToken(t, classifyOpts)
    }
    const parseOpts: ReadOptions = {
      foreignGrouping: foreignGroupingAllowed(settings.decimal, tokenVotes(toks)),
    }
    if (opts && opts.unit !== undefined) parseOpts.expectedUnit = opts.unit
    for (let i = 0; i < n; i++) {
      const nk = nativeKind(i)
      const t = texts[i]
      if (nk === NATIVE.number) {
        const v = native!.num[i]
        if (!Number.isFinite(v)) {
          mark(i, CELL.invalid)
          continue
        }
        values[i] = hasPercentSuffix(t) && settings.percent === 'display' ? percentDisplay(v) : v
        mark(i, CELL.ok)
        continue
      }
      if (nk === NATIVE.error) {
        mark(i, CELL.sheetError)
        continue
      }
      if (nk === NATIVE.empty) {
        mark(i, CELL.missing)
        continue
      }
      if (nk === NATIVE.boolean || nk === NATIVE.date) {
        mark(i, CELL.invalid)
        continue
      }
      if (isMissingToken(t)) {
        mark(i, CELL.missing)
        continue
      }
      if (isSheetErrorToken(t)) {
        mark(i, CELL.sheetError)
        continue
      }
      const tok = toks[i] as NumberToken
      const p = resolveToken(tok, settings.decimal, parseOpts)
      if (p.status === CELL.ok) {
        values[i] = p.percent && settings.percent === 'fraction' ? percentFraction(p.value) : p.value
        mark(i, CELL.ok)
      } else if (p.status === CELL.invalid && settings.decimal === 'mixed' && tok.cls === 'ambiguous') {
        mark(i, CELL.invalid, 'W_DECIMAL_AMBIGUOUS')
      } else mark(i, p.status)
    }
  }

  report.missingTokens = [...missingTokens]
  return { columnId, settings, values, status, categories, text: texts, report }
}

/** Reason code shown for an unreadable cell of the given status. */
export function invalidCode(s: CellStatus): ReasonCode {
  switch (s) {
    case CELL.separatorConflict:
      return 'W_SEPARATOR_CONFLICT'
    case CELL.unexpectedUnit:
      return 'W_UNEXPECTED_UNIT'
    case CELL.domain:
      return 'E_TRANSFORM_DOMAIN'
    default:
      return 'E_NOT_A_NUMBER'
  }
}
