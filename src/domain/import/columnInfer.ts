import {
  asRowId,
  issue,
  NATIVE,
  type ColumnDetection,
  type ColumnId,
  type ColumnKind,
  type DecimalMode,
  type Delimiter,
  type Issue,
  type ReasonCode,
  type RowId,
} from '@/domain/model'
import { CELL } from '@/domain/derive/types'
import { isIsoDateTime } from './isoDateTime'
import { isMissingToken, isSheetErrorToken } from './missing'
import {
  classifyNumberToken,
  foreignGroupingAllowed,
  normalizeUnit,
  resolveToken,
  tokenUnit,
  type NumberToken,
} from './numberToken'

/**
 * Column-level inference: kind, decimal convention, unit and the explanations shown in the
 * import preview. Nothing here changes data: it only decides how the raw text will be read, and every
 * decision that could be wrong is reported (never silently guessed).
 */
export interface ColumnInference {
  detection: ColumnDetection
  /** Unit taken from the cells when ≥ 80 % of the numeric cells carry it (I_UNIT_FROM_CELLS). */
  unit: string | null
  /** Per-column issues with columnId and rows (RowId = grid row index, as given in rowIds). */
  issues: Issue[]
}

export interface InferColumnOptions {
  columnId: ColumnId
  delimiter: Delimiter | null
  /** Spreadsheet columns: native kinds and v values, aligned with texts. */
  native?: { kind: Uint8Array; num: Float64Array } | null
  /** Unit from the header or units row: when given, the cells are checked against it instead of their own majority. */
  headerUnit?: string | null
  /** Column name for the {column} issue parameter. */
  columnName?: string
  /** Decimal convention decided by other columns of the same file; used only when this column has only ambiguous tokens. */
  decimalHint?: 'dot' | 'comma' | null
  /**
   * The delimiter detector chose 'none' because ',' only ever split rows into two digit groups ("1,425"):
   * it judged ',' a decimal comma, so a column of only ambiguous tokens follows that reading.
   */
  singleColumnComma?: boolean
}

/** Cells of a categorical/text column that count as missing: only blank cells (and spreadsheet errors). */
const isBlank = (text: string) => text.trim() === ''

/**
 * The cell-unit vote (step 2 of inferColumn): the most frequent unit tail if it is carried by ≥ 80 % of
 * the number-like cells (native percent numbers count as '%'), else null.
 */
function unitVote(
  texts: readonly string[],
  nativeNumber: readonly boolean[],
  toks: readonly (NumberToken | null)[],
): { unit: string | null; count: number; numberLike: number; fromNativeOnly: boolean } {
  const unitCounts = new Map<string, number>()
  let fromNativeOnly = true
  let numberLike = 0
  for (let i = 0; i < texts.length; i++) {
    let u: string | null = null
    if (nativeNumber[i]) {
      numberLike++
      u = texts[i].trimEnd().endsWith('%') ? '%' : null
    } else if (toks[i]) {
      numberLike++
      u = tokenUnit(toks[i] as NumberToken)
      if (u !== null) fromNativeOnly = false
    }
    if (u !== null) unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1)
  }
  let unit: string | null = null
  let count = 0
  for (const [u, c] of unitCounts) {
    if (c > count) {
      unit = u
      count = c
    }
  }
  if (numberLike === 0 || count < UNIT_SHARE * numberLike) unit = null
  return { unit, count, numberLike, fromNativeOnly }
}

/**
 * The unit a column's cells are checked against when the column is read: the header / units-row unit
 * when there is one, else the unit carried by ≥ 80 % of the number-like cells (the same rule as
 * inferColumn). It depends only on the imported cells, never on the editable unit label, so relabelling
 * a unit cannot change which cells are valid.
 */
export function referenceUnit(
  texts: readonly string[],
  native: { kind: Uint8Array; num: Float64Array } | null | undefined,
  headerUnit: string | null,
  opts: { spaceGrouping?: boolean } = {},
): string | null {
  if (headerUnit !== null && headerUnit.trim() !== '') return normalizeUnit(headerUnit)
  const n = texts.length
  const nativeNumber = new Array<boolean>(n).fill(false)
  const toks = new Array<NumberToken | null>(n).fill(null)
  for (let i = 0; i < n; i++) {
    const nk = native && i < native.kind.length ? native.kind[i] : NATIVE.text
    if (nk === NATIVE.number) nativeNumber[i] = true
    else if (nk === NATIVE.text && !isMissingToken(texts[i]) && !isSheetErrorToken(texts[i])) {
      const tok = classifyNumberToken(texts[i], opts)
      if (tok.cls !== 'invalid') toks[i] = tok
    }
  }
  return unitVote(texts, nativeNumber, toks).unit
}

/** Share of the non-missing cells that must parse for a column to be numeric (50 % → numeric, low confidence). */
const NUMERIC_SHARE = 0.8
const PARTLY_NUMERIC_SHARE = 0.5
const UNIT_SHARE = 0.8
const DATETIME_SHARE = 0.8

/** Codes that explain a detection decision; copied (without rows) into ColumnDetection.explanations. */
const EXPLAINING: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'W_DECIMAL_AMBIGUOUS',
  'W_DECIMAL_MIXED',
  'W_SEPARATOR_CONFLICT',
  'I_UNIT_FROM_CELLS',
  'W_UNEXPECTED_UNIT',
  'I_PERCENT',
  'W_COLUMN_PARTLY_NUMERIC',
  'W_ALL_MISSING',
])

/**
 * Infers how one column is read. Steps (votes over non-missing cells):
 *  1. decimal: dot-only vs comma-only tokens vote (neutral/ambiguous don't). Only dot → 'dot'; only comma → 'comma';
 *     both without thousands grouping → 'mixed' + W_DECIMAL_MIXED (each cell with its own separator, ambiguous
 *     cells invalid); both with grouping → majority wins, the minority are W_SEPARATOR_CONFLICT;
 *     only ambiguous → 'comma' if the delimiter is ';' (or other columns say so, or the detector judged ','
 *     a decimal comma of a single column) else 'dot', low confidence, W_DECIMAL_AMBIGUOUS
 *     {example, a, b, chosen, mode, because}. An ambiguous token with the OTHER separator ("1.000" among
 *     "0,995", "1,005") is read as grouping only when the column shows grouping elsewhere; otherwise it is a
 *     W_SEPARATOR_CONFLICT (low confidence), never a silent 1000.
 *  2. unit: the most frequent cell unit if ≥ 80 % of numeric cells carry it; cells with another unit (or any unit
 *     when the column has none) → W_UNEXPECTED_UNIT (they will be read as CELL.unexpectedUnit, never converted).
 *  3. kind: numeric if ≥ 80 % of non-missing cells parse (50–80 % → low confidence + W_COLUMN_PARTLY_NUMERIC);
 *     else datetime if ≥ 80 % are ISO 8601 dates or times (isoDateTime.ts) or native dates; else categorical if
 *     distinct labels ≤ max(12, n/2); else text.
 *  Missing cells → I_MISSING_VALUES {count, tokens}; sheet errors → I_SHEET_ERRORS {count, example};
 *  nothing but missing → W_ALL_MISSING; native percent-formatted numbers → I_PERCENT {count}.
 *  Missing-value words ("none", "NA", "nd", "-") are missing in numeric and datetime columns only: in a
 *  categorical or text column they are labels (a control group "none", sodium "Na"), and only blank cells
 *  are missing there.
 *  With delimiter 'none' a space between digits is not a thousands separator ("10 100.9" is invalid).
 */
export function inferColumn(
  texts: readonly string[],
  rowIds: readonly number[],
  opts: InferColumnOptions,
): ColumnInference {
  const n = texts.length
  if (rowIds.length !== n) throw new Error('inferColumn: texts and rowIds must have the same length')
  const native = opts.native ?? null
  if (native && (native.kind.length !== n || native.num.length !== n)) {
    throw new Error('inferColumn: native arrays must be aligned with texts')
  }
  const { columnId } = opts
  const column = opts.columnName ?? ''
  const at = (rows: number[]) => ({ rows: rows.map(asRowId) as RowId[], columnId })
  const classify = { spaceGrouping: opts.delimiter !== 'none' }

  // ---- pass 1: classify every cell ----------------------------------------------------------------------
  const toks: (NumberToken | null)[] = new Array<NumberToken | null>(n).fill(null)
  const missingRows: number[] = []
  const missingTokens: string[] = []
  /** Missing-value words (not blank): missing for numbers and dates, labels for categories. */
  const wordMissing: number[] = []
  const errorRows: number[] = []
  let errorExample = ''
  const nativeNumber: boolean[] = new Array<boolean>(n).fill(false)
  const percentRows: number[] = []
  let nNativeNumber = 0
  let nDates = 0
  const nonNumberRows: number[] = []
  const labels = new Set<string>()
  let nDot = 0
  let nComma = 0
  let nAmbiguous = 0
  let grouping = false
  let firstAmbiguous: { text: string; tok: NumberToken } | null = null
  const ambiguousRows: number[] = []

  for (let i = 0; i < n; i++) {
    const text = texts[i]
    const nk = native ? native.kind[i] : NATIVE.text
    if (nk === NATIVE.empty) {
      missingRows.push(rowIds[i])
      if (!missingTokens.includes('')) missingTokens.push('')
      continue
    }
    if (nk === NATIVE.error) {
      errorRows.push(rowIds[i])
      if (!errorExample) errorExample = text.trim()
      continue
    }
    if (nk === NATIVE.number) {
      nativeNumber[i] = true
      nNativeNumber++
      if (text.trimEnd().endsWith('%')) percentRows.push(rowIds[i])
      labels.add(text.trim())
      continue
    }
    if (nk === NATIVE.date) {
      nDates++
      nonNumberRows.push(rowIds[i])
      labels.add(text.trim())
      continue
    }
    if (nk === NATIVE.boolean) {
      nonNumberRows.push(rowIds[i])
      labels.add(text.trim())
      continue
    }
    // text cell (CSV, paste, or a spreadsheet string cell)
    if (isMissingToken(text)) {
      missingRows.push(rowIds[i])
      if (!isBlank(text)) wordMissing.push(i)
      const t = text.trim()
      if (!missingTokens.includes(t)) missingTokens.push(t)
      continue
    }
    if (isSheetErrorToken(text)) {
      errorRows.push(rowIds[i])
      if (!errorExample) errorExample = text.trim()
      continue
    }
    labels.add(text.trim())
    const tok = classifyNumberToken(text, classify)
    if (tok.cls === 'invalid') {
      if (isIsoDateTime(text)) nDates++
      nonNumberRows.push(rowIds[i])
      continue
    }
    toks[i] = tok
    if (tok.grouping) grouping = true
    if (tok.cls === 'dot') nDot++
    else if (tok.cls === 'comma') nComma++
    else if (tok.cls === 'ambiguous') {
      nAmbiguous++
      ambiguousRows.push(rowIds[i])
      if (!firstAmbiguous) firstAmbiguous = { text: text.trim(), tok }
    }
  }

  let nMissing = missingRows.length
  const nErrors = errorRows.length
  let nonMissing = n - nMissing - nErrors
  const issues: Issue[] = []

  // ---- step 1: decimal convention -------------------------------------------------------------------------
  const tieBreak: 'dot' | 'comma' =
    opts.decimalHint ?? (opts.singleColumnComma || opts.delimiter === ';' ? 'comma' : 'dot')
  let decimal: DecimalMode = 'dot'
  let decimalConfidence: 'high' | 'low' = 'high'
  const decimalIssues: Issue[] = []
  if (nDot > 0 && nComma > 0) {
    decimalConfidence = 'low'
    if (grouping) decimal = nDot > nComma ? 'dot' : nComma > nDot ? 'comma' : tieBreak
    else {
      decimal = 'mixed'
      decimalIssues.push(issue('W_DECIMAL_MIXED', { n: nDot, m: nComma, column }, { columnId }))
    }
  } else if (nDot > 0) decimal = 'dot'
  else if (nComma > 0) decimal = 'comma'
  else if (nAmbiguous > 0 && firstAmbiguous) {
    decimal = tieBreak
    decimalConfidence = 'low'
    const because = opts.decimalHint
      ? 'otherColumns'
      : opts.singleColumnComma
        ? 'singleColumnComma'
        : opts.delimiter === ';'
          ? 'semicolonDelimiter'
          : 'default'
    const { tok, text } = firstAmbiguous
    decimalIssues.push(
      issue(
        'W_DECIMAL_AMBIGUOUS',
        {
          example: text,
          a: tok.dotValue,
          b: tok.commaValue,
          chosen: decimal === 'comma' ? tok.commaValue : tok.dotValue,
          mode: decimal,
          because,
          count: nAmbiguous,
          column,
        },
        at(ambiguousRows),
      ),
    )
  }

  // ---- step 2: unit ------------------------------------------------------------------------------------------
  const vote = unitVote(texts, nativeNumber, toks)
  const cellUnit = vote.unit
  const cellUnitCount = vote.count
  const numberLike = vote.numberLike
  const headerUnit =
    opts.headerUnit != null && opts.headerUnit.trim() !== '' ? normalizeUnit(opts.headerUnit) : null
  const reference = headerUnit ?? cellUnit

  // ---- pass 2: read every number-like cell under the chosen mode ---------------------------------------------
  const foreignGrouping = foreignGroupingAllowed(decimal, { dot: nDot, comma: nComma, grouping })
  let nOk = nNativeNumber
  const conflictRows: number[] = []
  const unexpectedRows: number[] = []
  const mixedAmbiguousRows: number[] = []
  for (let i = 0; i < n; i++) {
    const tok = toks[i]
    if (!tok) continue
    const p = resolveToken(tok, decimal, { expectedUnit: reference, foreignGrouping })
    if (p.status === CELL.ok) nOk++
    else if (p.status === CELL.separatorConflict) conflictRows.push(rowIds[i])
    else if (p.status === CELL.unexpectedUnit) unexpectedRows.push(rowIds[i])
    else if (p.status === CELL.invalid) mixedAmbiguousRows.push(rowIds[i])
  }

  // ---- step 3: kind ---------------------------------------------------------------------------------------------
  let kind: ColumnKind
  let confidence: 'high' | 'low' = 'high'
  const okShare = nonMissing > 0 ? nOk / nonMissing : 0
  const numberShare = nonMissing > 0 ? numberLike / nonMissing : 0
  if (nonMissing === 0) {
    kind = 'numeric'
    confidence = 'low'
  } else if (okShare >= NUMERIC_SHARE) {
    kind = 'numeric'
    confidence = decimalConfidence
  } else if (okShare >= PARTLY_NUMERIC_SHARE || numberShare >= NUMERIC_SHARE) {
    // numbers with too many problems (non-numbers, conflicting separators or units): numeric, but review it
    kind = 'numeric'
    confidence = 'low'
  } else if (nDates / nonMissing >= DATETIME_SHARE) {
    kind = 'datetime'
  } else {
    // Labels: missing-value words are categories here ("none" = untreated control), only blanks are missing.
    if (wordMissing.length > 0) {
      for (const i of wordMissing) labels.add(texts[i].trim())
      const kept = new Set(wordMissing.map((i) => rowIds[i]))
      const blank = missingRows.filter((r) => !kept.has(r))
      missingRows.length = 0
      missingRows.push(...blank)
      missingTokens.length = 0
      if (blank.length > 0) missingTokens.push('')
      nMissing = blank.length
      nonMissing = n - nMissing - nErrors
    }
    kind = labels.size <= Math.max(12, 0.5 * nonMissing) ? 'categorical' : 'text'
    if (numberShare >= 0.3) confidence = 'low'
  }

  if (kind === 'numeric' && nonMissing > 0) {
    issues.push(...decimalIssues)
    if (conflictRows.length > 0) {
      confidence = 'low'
      issues.push(
        issue(
          'W_SEPARATOR_CONFLICT',
          { count: conflictRows.length, mode: decimal, column },
          at(conflictRows),
        ),
      )
    }
    if (mixedAmbiguousRows.length > 0 && firstAmbiguous) {
      const { tok, text } = firstAmbiguous
      issues.push(
        issue(
          'W_DECIMAL_AMBIGUOUS',
          {
            example: text,
            a: tok.dotValue,
            b: tok.commaValue,
            chosen: 'mixed',
            mode: 'mixed',
            because: 'mixed',
            count: mixedAmbiguousRows.length,
            column,
          },
          at(mixedAmbiguousRows),
        ),
      )
    }
    if (cellUnit !== null && headerUnit === null && !(cellUnit === '%' && vote.fromNativeOnly)) {
      issues.push(issue('I_UNIT_FROM_CELLS', { unit: cellUnit, count: cellUnitCount, column }, { columnId }))
    }
    if (unexpectedRows.length > 0) {
      confidence = 'low'
      issues.push(
        issue(
          'W_UNEXPECTED_UNIT',
          { count: unexpectedRows.length, unit: reference ?? '', column },
          at(unexpectedRows),
        ),
      )
    }
    if (percentRows.length > 0) {
      if (percentRows.length < nNativeNumber) confidence = 'low' // percent and plain numbers mixed
      issues.push(issue('I_PERCENT', { count: percentRows.length, column }, at(percentRows)))
    }
    if (nonNumberRows.length > 0) {
      issues.push(
        issue('W_COLUMN_PARTLY_NUMERIC', { count: nonNumberRows.length, column }, at(nonNumberRows)),
      )
    }
  }

  if (nMissing > 0) {
    const tokens = missingTokens.map((t) => (t === '' ? '""' : t)).join(', ')
    issues.push(issue('I_MISSING_VALUES', { count: nMissing, tokens, column }, at(missingRows)))
  }
  if (nErrors > 0) {
    issues.push(issue('I_SHEET_ERRORS', { count: nErrors, example: errorExample, column }, at(errorRows)))
  }
  if (n > 0 && nonMissing === 0) issues.push(issue('W_ALL_MISSING', { column, count: n }, { columnId }))

  const explanations = issues
    .filter((i) => EXPLAINING.has(i.code))
    .map((i): Issue => {
      const out: Issue = { code: i.code, severity: i.severity }
      if (i.params) out.params = i.params
      if (i.columnId) out.columnId = i.columnId
      return out
    })

  return {
    detection: { kind, decimal, percent: 'display', confidence, explanations },
    unit: kind === 'numeric' ? cellUnit : null,
    issues,
  }
}
