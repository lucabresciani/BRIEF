/**
 * CSV export (RFC 4180: CRLF records, fields quoted when they contain the delimiter, a quote, CR
 * or LF; quotes doubled). Two tables:
 * - originalCsv: the data as imported (or as typed in the notebook): every cell's text as recorded,
 *   except that numbers are written with the decimal mark the format asks for (see cellInDecimal);
 * - analysisCsv: parsed values at full round-trip precision, the analysis status of every row and,
 *   when a fit is given, in_fit / predicted / residual; for a split series, the group of every row and,
 *   fitted per group, those columns from the row's own group fit.
 * Every cell goes through a formula-injection guard, so a spreadsheet never evaluates exported text.
 */
import { classifyNumberToken, parseNumber } from '@/domain/import/numberToken'
import {
  INACTIVE,
  effectiveSettings,
  type ColumnId,
  type ColumnMeta,
  type Dataset,
  type DecimalMode,
  type RawTable,
} from '@/domain/model'
import type { DerivedSeries } from '@/domain/derive/pipeline'
import { recordPosition } from '@/domain/derive/recordPosition'
import { columnGroups } from '@/domain/derive/split'
import { predict as predictFit } from '@/domain/fit/band'
import {
  CELL,
  type AnalysisSample,
  type DatasetView,
  type FitOk,
  type ParsedColumn,
} from '@/domain/derive/types'

export interface CsvOptions {
  delimiter: ',' | ';' | '\t'
  decimal: '.' | ','
  bom: boolean
}

/** standard: machine-friendly (',' and '.'); excelItalian: what Excel with an Italian locale expects. */
export const CSV_PRESETS: { readonly standard: CsvOptions; readonly excelItalian: CsvOptions } =
  Object.freeze({
    standard: Object.freeze({ delimiter: ',', decimal: '.', bom: false }),
    excelItalian: Object.freeze({ delimiter: ';', decimal: ',', bom: true }),
  })

/** Starts a formula whatever follows: = and @ (and their full-width forms), full-width + and −. */
const FORMULA_START = /^[=@\uFF1D\uFF20\uFF0B\uFF0D]/
/**
 * A leading + or − is only safe when the cell is a plain signed number, optionally followed (with or
 * without spaces) by '%' or by a unit that starts with a letter / ° / µ / Ω and goes on with letters,
 * digits (superscripts too), spaces and · ⋅ / ^ - ⁻ ⁺: "-3.2", "-1.5e-7", "-3,2 °C", "+7",
 * "-9.81 m/s²", "-1.6e-19 C", "-3 kg·m⁻³". A number followed by a name is not a valid formula, so such
 * text is never evaluated. Anything else ("-2+3", "-1+cmd|' /C calc'!A0", "-A1", "-5%/A1",
 * "-1 SUM(A1)") would be evaluated by Excel or LibreOffice: no + ( ) | ! = & or quotes after the number.
 */
const SAFE_SIGNED =
  /^[+-](?:\d|[.,]\d)[\d.,\u00A0\u202F ]*(?:[eE][+-]?\d+)?[\u00A0\u202F ]*(?:%(?: *\p{L}[\p{L}\p{N} ]*)?|[\p{L}°µΩ][\p{L}\p{N}°%µΩ·⋅⁻⁺^/\- ]*)?$/u

/**
 * Formula-injection guard (OWASP CSV injection): prefixes "'" to cells that a spreadsheet would
 * evaluate. Tab / CR at the start are always guarded; otherwise the first non-blank character decides.
 */
export function guardFormula(cell: string): string {
  if (cell === '') return cell
  if (cell[0] === '\t' || cell[0] === '\r') return "'" + cell
  const t = cell.trimStart()
  if (FORMULA_START.test(t)) return "'" + cell
  if ((t[0] === '+' || t[0] === '-') && t.length > 1 && !SAFE_SIGNED.test(t)) return "'" + cell
  return cell
}

function field(cell: string, delimiter: string): string {
  const s = guardFormula(cell)
  return s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')
    ? '"' + s.replaceAll('"', '""') + '"'
    : s
}

/** RFC 4180 text of a table of strings; every record ends with CRLF; optional UTF-8 BOM for Excel. */
export function toCsv(rows: readonly (readonly string[])[], opts: CsvOptions): string {
  let out = opts.bom ? '\uFEFF' : ''
  for (const row of rows) {
    let line = ''
    for (let j = 0; j < row.length; j++) line += (j ? opts.delimiter : '') + field(row[j], opts.delimiter)
    out += line + '\r\n'
  }
  return out
}

/** Shortest text that reads back as exactly the same double (String(v)); '' for NaN / ±Infinity. */
export function csvNumber(v: number, decimal: '.' | ','): string {
  if (!Number.isFinite(v)) return ''
  const s = String(v)
  return decimal === ',' ? s.replace('.', ',') : s
}

/** Sign and mantissa of a number cell (digits, '.', ',', apostrophes, single spaces between digits). */
const MANTISSA = /^(\s*[+\-\u2212\u2013\ufe63\uff0d]?)((?:[\d.,'\u2019]|(?<=\d)\s(?=\d))+)/

/**
 * A cell of a numeric column written with the requested decimal mark. Only a cell that the column
 * reads as a number (its effective decimal mode, with the importer's own rules) is touched, and only
 * the separators of its mantissa are exchanged ('.' ↔ ','), so its value and recorded digits stay:
 * "0.464" → "0,464", "1,234.5" → "1.234,5", "1,234" (grouping in a '.' column) → "1.234",
 * "3.0e+08 m/s" → "3,0e+08 m/s", "12.5%" → "12,5%". Missing tokens, unreadable or conflicting cells,
 * units and exponents are written as recorded.
 */
export function cellInDecimal(text: string, mode: DecimalMode, decimal: '.' | ','): string {
  if (parseNumber(text, mode).status !== CELL.ok) return text
  // 'mixed' columns: each number carries its own convention (ambiguous ones are not read: see above).
  const own = mode === 'dot' ? '.' : mode === 'comma' ? ',' : null
  const from = own ?? (classifyNumberToken(text).cls === 'comma' ? ',' : '.')
  if (from === decimal) return text
  const m = MANTISSA.exec(text)
  if (!m) return text
  const swapped = m[2].replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'))
  return m[1] + swapped + text.slice(m[0].length)
}

/** "Name (unit)", the header convention the importer reads back. */
function headerLabel(c: ColumnMeta): string {
  return c.unit ? `${c.name} (${c.unit})` : c.name
}

/**
 * Rows of the "original data" export. Imported datasets: header row (and units row) then the data
 * rows dataStartRow..dataEndRow, cell text from the raw table, for the raw columns the dataset still
 * has (a column the user removed stays removed). Without a header row in the file the generated
 * column names are used. Notebook datasets: the typed text of the notebook columns. Derived columns
 * are not original data and are never included. With `decimal`, the data cells of numeric columns are
 * written with that decimal mark (cellInDecimal); header, units row and other columns stay verbatim.
 */
export function originalRows(dataset: Dataset, raw: RawTable | null, decimal?: '.' | ','): string[][] {
  const convert = (c: ColumnMeta): ((text: string) => string) => {
    const settings = effectiveSettings(c)
    if (decimal === undefined || settings.kind !== 'numeric') return (text) => text
    return (text) => cellInDecimal(text, settings.decimal, decimal)
  }
  if (dataset.origin === 'notebook') {
    const cols = dataset.columns.filter((c) => c.source.type === 'notebook')
    const conv = cols.map(convert)
    const rows = [cols.map(headerLabel)]
    dataset.rowIds.forEach((_, i) => rows.push(cols.map((c, j) => conv[j](dataset.cells[c.id]?.[i] ?? ''))))
    return rows
  }
  const cols = dataset.columns.filter((c) => c.source.type === 'raw')
  const conv = cols.map(convert)
  const text = (c: ColumnMeta, r: number) =>
    (c.source.type === 'raw' ? raw?.columns[c.source.index]?.text[r] : undefined) ?? ''
  const { headerRow, unitsRow, dataStartRow, dataEndRow } = dataset.layout
  const n = raw?.rowCount ?? 0
  const rows = [
    headerRow !== null && headerRow < n ? cols.map((c) => text(c, headerRow)) : cols.map(headerLabel),
  ]
  if (unitsRow !== null && unitsRow < n) rows.push(cols.map((c) => text(c, unitsRow)))
  for (let r = dataStartRow; r <= Math.min(dataEndRow, n - 1); r++)
    rows.push(cols.map((c, j) => conv[j](text(c, r))))
  return rows
}

/**
 * The data as imported / typed (see originalRows), with the requested delimiter AND decimal mark: a
 * '.'-decimal file exported for Excel with an Italian locale gets ',' decimals (where '.' would be read
 * as a thousands separator), and ','-decimal data exported as standard CSV gets '.' decimals.
 */
export function originalCsv(dataset: Dataset, raw: RawTable | null, opts: CsvOptions): string {
  return toCsv(originalRows(dataset, raw, opts.decimal), opts)
}

/** One group of a split series in the analysis export. */
export interface AnalysisCsvGroup {
  /** Text of the group cell; '' for the rows without a value in the split column. */
  label: string
  /** Indices into the view rows. */
  rows: ArrayLike<number>
  /** The group's own fit (fits per group; null when it failed); undefined → its rows use `fit`. */
  fit?: FitOk | null
  /** ŷ(x) of the group's fit. */
  predict?: (x: number) => number
}

export interface AnalysisCsvInput {
  view: DatasetView
  /** Columns to export, in this order. */
  columns: ColumnMeta[]
  /** The analysed sample (e.g. the fit's pairwise sample): gives the status column. */
  sample: AnalysisSample
  fit?: FitOk | null
  /** Column holding the fit's x: needed (with predict) for the predicted column. */
  fitXColumn?: ColumnId
  /** ŷ(x) of the fit, e.g. (x) => predict(fit, x). */
  predict?: (x: number) => number
  /** A split series: a "group" column (header `name`, default "group") and the group fits. */
  split?: { name?: string; groups: readonly AnalysisCsvGroup[] }
}

/**
 * The `split` input of analysisCsv for a derived series (undefined when the series is not split). Every
 * row is labelled with its value of the split column, also a row of a group the series could not draw
 * (x or y missing in all its rows): its group cell is that value, never "".
 */
export function splitForCsv(s: DerivedSeries): AnalysisCsvInput['split'] | undefined {
  if (!s.split) return undefined
  const perGroup = s.fitSpec?.perGroup === true
  const derived = new Map(s.split.groups.map((g) => [g.key, g]))
  const pc = s.view.columns.get(s.split.column.id)
  // A split series always has its column in the view with at most MAX_SPLIT_GROUPS values.
  const cg = pc ? columnGroups(pc) : null
  if (!cg || cg.tooMany) return { groups: [] }
  const rowsOf = cg.groups.map(() => [] as number[])
  cg.groupOf.forEach((k, i) => rowsOf[k].push(i))
  return {
    groups: cg.groups.map((key, k) => {
      const g = derived.get(key.key)
      const fit = g?.fit?.status === 'ok' ? g.fit : null
      return {
        label: key.label,
        rows: rowsOf[k],
        ...(perGroup ? { fit, ...(fit ? { predict: (x: number) => predictFit(fit, x) } : {}) } : {}),
      }
    }),
  }
}

const REASON_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(INACTIVE).map(([name, code]) => [code, name]),
)

function valueText(pc: ParsedColumn | undefined, i: number, decimal: '.' | ','): string {
  if (!pc || pc.status[i] !== CELL.ok) return ''
  switch (pc.settings.kind) {
    case 'numeric':
      return csvNumber(pc.values[i], decimal)
    case 'datetime': {
      const v = pc.values[i]
      // ISO 8601 in UTC: exact for millisecond timestamps (Date's range is ±8.64e15 ms).
      return Number.isFinite(v) && Math.abs(v) <= 8.64e15 ? new Date(v).toISOString() : ''
    }
    default: {
      const cat = pc.categories
      if (!cat) return pc.text[i] ?? ''
      const code = cat.codes[i]
      return code >= 0 ? (cat.labels[code] ?? '') : ''
    }
  }
}

/**
 * Rows of the analysis export. Columns: "row" (the row number shown in the table, i.e. the line in
 * the file; "column" with the sheet column letters for a block transposed on import), the requested
 * columns as parsed values (missing / invalid → ""), for a split series "group" (the row's group, ""
 * without a value), "status" (active, missing, invalid, excluded, filtered), and with a fit: "in_fit"
 * (1/0), "predicted" (ŷ for every row with a valid x, excluded rows included) and the stored residual
 * of the rows in the fit ("residual" = y − ŷ; "residual_ln" = ln y − ln ŷ for log-linear models),
 * empty for other rows. Fitted per group, each row takes these from its own group's fit (empty when
 * that fit failed or the row is in no group).
 */
export function analysisRows(input: AnalysisCsvInput, decimal: '.' | ','): string[][] {
  const { view, columns, sample, fitXColumn, split } = input
  const reason = new Map<number, number>()
  for (let i = 0; i < sample.rowIds.length; i++) reason.set(sample.rowIds[i], sample.reason[i])

  const groups = split?.groups ?? []
  const groupOf = new Int32Array(view.rowIds.length).fill(-1)
  groups.forEach((g, k) => {
    for (let j = 0; j < g.rows.length; j++) groupOf[g.rows[j]] = k
  })
  const perGroup = groups.some((g) => g.fit !== undefined)
  // The fit (and its prediction) of each row: its group's own when fitted per group, else the one fit.
  const fitOf = (i: number): { fit: FitOk | null; predict?: (x: number) => number } => {
    if (!perGroup) return { fit: input.fit ?? null, predict: input.predict }
    const g = groups[groupOf[i]]
    return g?.fit ? { fit: g.fit, predict: g.predict } : { fit: null }
  }
  const fits = perGroup ? groups.flatMap((g) => (g.fit ? [g.fit] : [])) : input.fit ? [input.fit] : []
  const residual = new Map<FitOk, Map<number, number>>()
  for (const f of fits) {
    const m = new Map<number, number>()
    f.provenance.rowIdsUsed.forEach((r, k) => m.set(r, f.residuals[k]))
    residual.set(f, m)
  }
  const anyFit = fits[0]
  const predicts = perGroup ? groups.some((g) => g.predict) : input.predict !== undefined
  const withPrediction = anyFit !== undefined && predicts && fitXColumn !== undefined
  const xCol = withPrediction ? view.columns.get(fitXColumn) : undefined

  // A transposed block: each record was a sheet column ("D"), not a row.
  const header = [view.recordAxis === 'column' ? 'column' : 'row', ...columns.map(headerLabel)]
  if (split) header.push(split.name ?? 'group')
  header.push('status')
  if (anyFit) {
    header.push('in_fit')
    if (withPrediction) header.push('predicted')
    header.push(anyFit.r2Of === 'lnY' ? 'residual_ln' : 'residual')
  }
  const parsed = columns.map((c) => view.columns.get(c.id))
  const rows = [header]
  for (let i = 0; i < view.rowIds.length; i++) {
    const rowId = view.rowIds[i]
    const r = reason.get(rowId)
    const line = [recordPosition(view, i).text, ...parsed.map((pc) => valueText(pc, i, decimal))]
    if (split) line.push(groups[groupOf[i]]?.label ?? '')
    line.push(r === undefined ? '' : (REASON_NAME[r] ?? ''))
    if (anyFit) {
      const own = fitOf(i)
      const res = own.fit ? residual.get(own.fit)?.get(rowId) : undefined
      line.push(res === undefined ? '0' : '1')
      if (withPrediction) {
        const ok = own.predict !== undefined && xCol !== undefined && xCol.status[i] === CELL.ok
        line.push(ok ? csvNumber(own.predict!(xCol.values[i]), decimal) : '')
      }
      line.push(res === undefined ? '' : csvNumber(res, decimal))
    }
    rows.push(line)
  }
  return rows
}

/** The analysis table as CSV (see analysisRows). */
export function analysisCsv(input: AnalysisCsvInput, opts: CsvOptions): string {
  return toCsv(analysisRows(input, opts.decimal), opts)
}
