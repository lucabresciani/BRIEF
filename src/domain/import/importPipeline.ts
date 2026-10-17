import type * as XLSXNS from 'xlsx'
import {
  NATIVE,
  fail,
  issue,
  newId,
  ok,
  type ColumnMeta,
  type DatasetLayout,
  type Delimiter,
  type Issue,
  type RawColumn,
  type RawRegion,
  type RawTable,
  type ReasonCode,
  type Result,
  type RowId,
  type SourceKind,
  type TextEncoding,
} from '@/domain/model'
import { parseColumn } from '@/domain/derive/parseColumn'
import { CELL } from '@/domain/derive/types'
import { colLetter, type GridOrigin, type GridRange } from './a1'
import { analyseSheet, type DetectedBlock } from './blocks'
import { inferColumn, type ColumnInference } from './columnInfer'
import { decodeBytes, stripBomChar } from './decode'
import { detectDelimiter } from './delimiter'
import { blankDataRows, detectLayout, type LayoutDetection } from './layout'
import { LIMITS, checkFileSize } from './limits'
import { isMissingToken, isSheetErrorToken } from './missing'
import { classifyNumberToken } from './numberToken'
import { suggestRoles } from './semanticRoles'
import { readWorkbook, type NativeColumn, type WorkbookGrid } from './spreadsheet'
import { baseName, fileExtension, sniffFormat } from './sniff'
import { tokenize } from './tokenize'

/**
 * Import pipeline: bytes or text → ImportDraft, everything the import dialog needs to
 * show and confirm. Pure and synchronous (it runs in the import worker or, as a fallback, on the main thread).
 * The RawTable keeps EVERY tokenised row and cell exactly as read; the layout and per-column detections are
 * reversible metadata, and every decision that could be wrong is reported as an Issue.
 */
export interface ImportOverrides {
  encoding?: TextEncoding
  delimiter?: Delimiter
  ignoreQuotes?: boolean
  headerRow?: number | null
  unitsRow?: number | null
  dataStartRow?: number
  sheetName?: string
}

export interface ImportDraft {
  rawTable: RawTable
  columns: ColumnMeta[]
  layout: DatasetLayout
  notes: string[]
  detection: {
    encoding: TextEncoding | null
    delimiter: Delimiter | null
    delimiterConfidence: 'high' | 'low'
    alternatives: Delimiter[]
    headerConfidence: 'high' | 'low'
    sheetName: string | null
    sheets: { name: string; rows: number; cols: number }[] | null
    /** Whole-sheet spreadsheet imports: the blocks of the sheet (null for text and for block imports). */
    sheet: SheetDetection | null
  }
  issues: Issue[]
  /**
   * True when the dataset and its first plot can be created without the blocking dialog: every numeric
   * column was detected with high confidence, the delimiter is certain, and there is no error and no
   * W_DECIMAL_AMBIGUOUS / W_HEADER_UNCERTAIN / W_DELIMITER_AMBIGUOUS / I_MULTIPLE_TABLES (a sheet of
   * several tables goes to the block picker).
   */
  fastPath: boolean
  suggestedName: string
}

/**
 * The small tables of a sheet, in the frame of the whole-sheet draft: rawTable row i, column j is
 * grid cell (i, j), which is sheet cell (origin.row + i, origin.col + j).
 */
export interface SheetDetection {
  origin: GridOrigin
  /** Merged areas relative to the grid. */
  merges: GridRange[]
  blocks: DetectedBlock[]
  /** Table and matrix blocks (2 or more: I_MULTIPLE_TABLES, no fast path). */
  tables: number
  /** Blocks beyond MAX_BLOCKS, not listed. */
  overflow: number
}

export interface TextSource {
  kind: SourceKind
  fileName: string | null
  byteSize?: number | null
  encoding?: TextEncoding | null
}

interface GridInput {
  rows: string[][]
  sourceRow: Int32Array
  native: NativeColumn[] | null
  sepLineRow: number | null
}

export interface DraftContext {
  kind: SourceKind
  fileName: string | null
  byteSize: number | null
  encoding: TextEncoding | null
  delimiter: Delimiter | null
  delimiterConfidence: 'high' | 'low'
  alternatives: Delimiter[]
  sheetName: string | null
  sheets: { name: string; rows: number; cols: number }[] | null
  /** Issues that belong to the draft but not to the raw table (file size). */
  fileIssues: Issue[]
  /** Issues describing how the raw table was read (encoding, sep line, delimiter, sheet). */
  readIssues: Issue[]
  /** Tokeniser issues (ragged rows…), filtered to the table here. */
  tokenIssues: Issue[]
  overrides: ImportOverrides
  /** A space between digits may be a thousands separator (false when the text has no delimiter). */
  spaceGrouping: boolean
  /** Single column read because ',' looks like a decimal comma ("1,425" → 1.425). */
  singleColumnComma: boolean
  /** Spreadsheet only: the blocks of the whole sheet. */
  sheet?: SheetDetection | null
  /** Block imports: where the table was cut from (RawSource.region). */
  region?: RawRegion
  /** Lines kept as notes besides the preamble (titles of a transposed or stacked block). */
  notes?: string[]
  /** Issues of the draft only (not of the raw table). */
  draftIssues?: Issue[]
  name?: string
}

const PASTED_NAME = 'Pasted data'
const FAST_PATH_BLOCKERS: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'W_DECIMAL_AMBIGUOUS',
  'W_HEADER_UNCERTAIN',
  'W_DELIMITER_AMBIGUOUS',
  'E_QUOTES_UNCLOSED',
  'I_MULTIPLE_TABLES',
])

/** Text (pasted, example, already decoded) → draft. */
export function importText(
  text: string,
  source: TextSource,
  overrides: ImportOverrides = {},
): Result<ImportDraft> {
  return importDecoded(
    stripBomChar(text),
    {
      kind: source.kind,
      fileName: source.fileName,
      byteSize: source.byteSize ?? null,
      encoding: source.encoding ?? null,
    },
    overrides,
    [],
    [],
  )
}

/**
 * File bytes → draft. Size limits (E_FILE_TOO_LARGE / W_FILE_LARGE) → format sniffing (magic bytes) →
 * text: decode + the text path; xlsx / ods / xls: the injected SheetJS module (absent → E_UNSUPPORTED_FORMAT;
 * a password-protected .xlsx in an OLE container → E_SPREADSHEET_UNREADABLE), with the blocks of the sheet
 * in detection.sheet (2 or more tables: I_MULTIPLE_TABLES and no fast path); .sciplot projects are opened
 * elsewhere → E_UNSUPPORTED_FORMAT; binary → E_UNSUPPORTED_FORMAT.
 */
export function importBytes(
  bytes: Uint8Array,
  fileName: string,
  overrides: ImportOverrides = {},
  deps?: { xlsx?: typeof XLSXNS },
): Result<ImportDraft> {
  if (bytes.length === 0) return fail(issue('E_EMPTY_INPUT'))
  const format = sniffFormat(bytes, fileName)
  const ext = fileExtension(fileName)
  if (format === 'sciplot' || format === 'unknown') {
    return fail(
      issue('E_UNSUPPORTED_FORMAT', { format: format === 'sciplot' ? 'sciplot' : ext || 'unknown' }),
    )
  }

  const size = checkFileSize(bytes.length, format === 'text' ? 'text' : 'sheet')
  if (size.error) return fail(size.error)
  const fileIssues = size.warning ? [size.warning] : []

  if (format === 'text') {
    const decoded = decodeBytes(bytes, overrides.encoding)
    const kind: SourceKind = ext === 'csv' ? 'csv' : ext === 'tsv' ? 'tsv' : 'text'
    return importDecoded(
      decoded.text,
      { kind, fileName, byteSize: bytes.length, encoding: decoded.encoding },
      overrides,
      fileIssues,
      decoded.issues,
    )
  }

  if (!deps?.xlsx) return fail(issue('E_UNSUPPORTED_FORMAT', { format }), fileIssues)
  const wb = readWorkbook(deps.xlsx, bytes, { sheetName: overrides.sheetName, maxCells: LIMITS.maxCells })
  if (!wb.ok) return fail(wb.error, [...fileIssues, ...wb.warnings])
  const { grid, native, sourceRow, sheetName, origin, merges } = wb.value
  const { detection } = analyseSheet(grid, { merges, origin, native })
  const sheet: SheetDetection = { origin, merges, ...detection }
  return buildDraft(
    { rows: padRows(grid), sourceRow, native, sepLineRow: null },
    {
      ...sheetContext(format, fileName, bytes.length, wb.value, fileIssues, overrides),
      readIssues: [...wb.warnings, ...wb.value.issues],
      sheet,
      draftIssues:
        detection.tables >= 2
          ? [issue('I_MULTIPLE_TABLES', { count: detection.tables, sheet: sheetName })]
          : [],
    },
  )
}

/** The reading context of a sheet (no text decoding, no delimiter). */
export function sheetContext(
  kind: 'xlsx' | 'ods' | 'xls',
  fileName: string,
  byteSize: number,
  wb: Pick<WorkbookGrid, 'sheetName' | 'sheets'>,
  fileIssues: Issue[],
  overrides: ImportOverrides,
): DraftContext {
  return {
    kind,
    fileName,
    byteSize,
    encoding: null,
    delimiter: null,
    delimiterConfidence: 'high',
    alternatives: [],
    sheetName: wb.sheetName,
    sheets: wb.sheets,
    fileIssues,
    readIssues: [],
    tokenIssues: [],
    overrides,
    spaceGrouping: true,
    singleColumnComma: false,
  }
}

function importDecoded(
  text: string,
  src: { kind: SourceKind; fileName: string | null; byteSize: number | null; encoding: TextEncoding | null },
  overrides: ImportOverrides,
  fileIssues: Issue[],
  decodeIssues: Issue[],
): Result<ImportDraft> {
  if (text.trim() === '') return fail(issue('E_EMPTY_INPUT'), [...fileIssues, ...decodeIssues])

  const det = detectDelimiter(text, { ignoreQuotes: overrides.ignoreQuotes })
  const forced = overrides.delimiter !== undefined
  const delimiter = overrides.delimiter ?? det.delimiter
  // The user's explicit choice replaces the detector's doubts; the "sep=" line is still reported.
  const delimiterIssues = forced ? det.issues.filter((i) => i.code === 'I_SEP_LINE') : det.issues
  const readIssues = [...decodeIssues, ...delimiterIssues]

  const tok = tokenize(text, delimiter, { maxCells: LIMITS.maxCells, ignoreQuotes: overrides.ignoreQuotes })
  if (!tok.ok) return fail(tok.error, [...fileIssues, ...readIssues])

  return buildDraft(
    {
      rows: tok.value.rows,
      sourceRow: tok.value.sourceRow,
      native: null,
      sepLineRow: det.sepLine ? 0 : null,
    },
    {
      ...src,
      delimiter,
      delimiterConfidence: forced ? 'high' : det.confidence,
      alternatives: [det.delimiter, ...det.alternatives].filter(
        (d, i, all) => d !== delimiter && all.indexOf(d) === i,
      ),
      sheetName: null,
      sheets: null,
      fileIssues,
      readIssues,
      tokenIssues: tok.value.issues,
      overrides,
      spaceGrouping: delimiter !== 'none',
      singleColumnComma: delimiter === 'none' && det.commaDecimal,
    },
  )
}

/** Locale-aware "could be a number" for the layout heuristics (missing tokens and sheet errors are neither). */
function numericLike(s: string, spaceGrouping: boolean): boolean {
  const t = s.trim()
  if (t === '' || isMissingToken(t) || isSheetErrorToken(t)) return false
  return classifyNumberToken(t, { spaceGrouping }).cls !== 'invalid'
}
/** Unit tail of a number-like cell for the layout heuristics ('%' for percent cells). */
function unitTailOf(s: string, spaceGrouping: boolean): string | null {
  const tok = classifyNumberToken(s, { spaceGrouping })
  return tok.cls === 'invalid' ? null : tok.percent ? '%' : tok.unit
}
const missingLike = (s: string) => isMissingToken(s) || isSheetErrorToken(s)

function padRows(grid: readonly (readonly string[])[]): string[][] {
  let width = 0
  for (const r of grid) if (r.length > width) width = r.length
  return grid.map((r) => {
    const row = r.slice()
    while (row.length < width) row.push('')
    return row
  })
}

/** Keeps ragged/extra-field warnings only for rows of the table (short preamble lines are expected). */
function tableTokenIssues(
  issues: readonly Issue[],
  from: number,
  to: number,
  sourceRow: Int32Array,
): Issue[] {
  const out: Issue[] = []
  for (const i of issues) {
    if ((i.code !== 'W_RAGGED_ROWS' && i.code !== 'W_EXTRA_FIELDS') || !i.rows) {
      out.push(i)
      continue
    }
    const rows = i.rows.filter((r) => r >= from && r <= to)
    if (rows.length) out.push(issue(i.code, { count: rows.length, row: sourceRow[rows[0]!]! }, { rows }))
  }
  return out
}

function subsetNative(col: NativeColumn, rows: readonly number[]): NativeColumn {
  const kind = new Uint8Array(rows.length)
  const num = new Float64Array(rows.length)
  for (let i = 0; i < rows.length; i++) {
    kind[i] = col.kind[rows[i]!]!
    num[i] = col.num[rows[i]!]!
  }
  return { kind, num }
}

/** Grid + reading context → draft: layout, per-column inference, roles, the raw table and the issues. */
export function buildDraft(grid: GridInput, ctx: DraftContext): Result<ImportDraft> {
  const { rows, sourceRow, native, sepLineRow } = grid
  const ov = ctx.overrides
  // Row overrides come from the dialog and can be stale: overrides are merged across re-reads, so a
  // header row chosen for a longer sheet, or before a delimiter/quote change, may not exist in this grid.
  // A row outside the grid is ignored (that part of the layout is detected again; the dialog shows the
  // result) instead of reaching detectLayout, which treats it as a programmer error.
  const inGrid = (v: number | null | undefined) =>
    v == null || (Number.isInteger(v) && v >= 0 && v < rows.length)
  const lay = detectLayout(rows, {
    headerRow: inGrid(ov.headerRow) ? ov.headerRow : undefined,
    unitsRow: inGrid(ov.unitsRow) ? ov.unitsRow : undefined,
    dataStartRow: inGrid(ov.dataStartRow) ? ov.dataStartRow : undefined,
    sepLineRow,
    isNumericLike: (s) => numericLike(s, ctx.spaceGrouping),
    unitTail: (s) => unitTailOf(s, ctx.spaceGrouping),
    isMissing: missingLike,
    sourceRow,
  })
  const layout = lay.layout
  const tableStart = Math.min(layout.headerRow ?? layout.dataStartRow, layout.dataStartRow)
  const tokenIssues = tableTokenIssues(ctx.tokenIssues, tableStart, layout.dataEndRow, sourceRow)

  // Data rows: the block between dataStartRow and dataEndRow, minus entirely blank rows (I_BLANK_ROWS).
  const blank = blankDataRows(rows, layout)
  const blankSet = new Set<number>(blank)
  const dataRows: number[] = []
  for (let r = layout.dataStartRow; r <= layout.dataEndRow; r++) {
    if (r !== sepLineRow && !blankSet.has(r)) dataRows.push(r)
  }
  const sharedIssues = [...ctx.fileIssues, ...ctx.readIssues, ...tokenIssues, ...lay.issues]
  if (dataRows.length === 0) return fail(issue('E_NO_DATA_ROWS'), sharedIssues)

  // Per-column inference on the data rows.
  const used: number[] = []
  for (let c = 0; c < lay.used.length; c++) if (lay.used[c]) used.push(c)
  const ids = used.map(() => newId<'ColumnId'>('col'))
  const texts = used.map((c) => dataRows.map((r) => rows[r]![c]!))
  const natives = used.map((c) => (native?.[c] ? subsetNative(native[c]!, dataRows) : null))
  const infer = (k: number, decimalHint?: 'dot' | 'comma' | null): ColumnInference =>
    inferColumn(texts[k]!, dataRows, {
      columnId: ids[k]!,
      delimiter: ctx.delimiter,
      native: natives[k],
      headerUnit: lay.units[used[k]!],
      columnName: lay.names[used[k]!],
      decimalHint,
      singleColumnComma: ctx.singleColumnComma,
    })
  const inferences = used.map((_, k) => infer(k))

  // Columns holding only ambiguous tokens ("1.234") follow the file-level vote (cell-weighted over the
  // other numeric columns) when it is unanimous; they stay low-confidence either way.
  const onlyAmbiguous = inferences.map((inf) =>
    inf.issues.some((i) => i.code === 'W_DECIMAL_AMBIGUOUS' && i.params?.because !== 'mixed'),
  )
  if (onlyAmbiguous.some(Boolean)) {
    let dotVotes = 0
    let commaVotes = 0
    inferences.forEach((inf, k) => {
      if (inf.detection.kind !== 'numeric' || onlyAmbiguous[k]) return
      texts[k]!.forEach((t, i) => {
        if (natives[k] && natives[k]!.kind[i] !== NATIVE.text) return
        const cls = classifyNumberToken(t, { spaceGrouping: ctx.spaceGrouping }).cls
        if (cls === 'dot') dotVotes++
        else if (cls === 'comma') commaVotes++
      })
    })
    const hint = dotVotes > 0 && commaVotes === 0 ? 'dot' : commaVotes > 0 && dotVotes === 0 ? 'comma' : null
    if (hint) for (let k = 0; k < inferences.length; k++) if (onlyAmbiguous[k]) inferences[k] = infer(k, hint)
  }

  // Names, units, suggested roles.
  const metas = used.map((c, k) => {
    const inf = inferences[k]!
    const unit = lay.units[c] ?? inf.unit
    const unitSource: ColumnMeta['unitSource'] =
      lay.units[c] !== null ? lay.unitSources[c]! : inf.unit !== null ? 'cells' : null
    return {
      name: lay.names[c]!,
      unit,
      unitSource,
      kind: inf.detection.kind,
      ...integerShape(k),
    }
  })
  /**
   * Whether all readable values are integers, and whether they count up by one in row order (1, 2, 3…),
   * read exactly as the dataset view will read them.
   */
  function integerShape(k: number): { integerValued?: boolean; consecutive?: boolean } {
    const inf = inferences[k]!
    if (inf.detection.kind !== 'numeric') return {}
    const col = parseColumn(ids[k]!, texts[k]!, inf.detection, natives[k], {
      spaceGrouping: ctx.spaceGrouping,
    })
    let n = 0
    let prev = NaN
    let consecutive = true
    for (let i = 0; i < col.values.length; i++) {
      if (col.status[i] !== CELL.ok) continue
      const v = col.values[i]!
      if (!Number.isInteger(v)) return { integerValued: false, consecutive: false }
      if (n > 0 && v !== prev + 1) consecutive = false
      prev = v
      n++
    }
    return { integerValued: n > 0, consecutive: n > 1 && consecutive }
  }
  const roles = suggestRoles(metas)
  const columns: ColumnMeta[] = used.map((c, k) => ({
    id: ids[k]!,
    source: { type: 'raw', index: c },
    name: metas[k]!.name,
    unit: metas[k]!.unit,
    unitSource: metas[k]!.unitSource,
    role: roles[k]!.role,
    uncertaintyOf: roles[k]!.uncertaintyOf !== null ? ids[roles[k]!.uncertaintyOf!]! : null,
    detected: inferences[k]!.detection,
    override: {},
  }))

  // A transposed block: sourceRow holds sheet columns, so a header or units "row" is a sheet column.
  const located = (list: Issue[]) => (ctx.region?.orientation === 'rows' ? list.map(asColumnPosition) : list)

  // The raw table: every grid row and column, exactly as read.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  const rawColumns: RawColumn[] = []
  for (let c = 0; c < width; c++) {
    rawColumns.push({ text: rows.map((r) => r[c] ?? ''), native: native?.[c] ?? null })
  }
  const rawTable: RawTable = {
    id: newId<'RawTableId'>('raw'),
    source: {
      kind: ctx.kind,
      fileName: ctx.fileName,
      sheetName: ctx.sheetName,
      encoding: ctx.encoding,
      delimiter: ctx.delimiter,
      byteSize: ctx.byteSize,
      importedAt: new Date().toISOString(),
      ...(ctx.region ? { region: ctx.region } : {}),
    },
    rowCount: rows.length,
    sourceRow,
    columns: rawColumns,
    tokenIssues: located([...ctx.readIssues, ...tokenIssues]),
  }

  const issues: Issue[] = [...sharedIssues, ...(ctx.draftIssues ?? [])]
  if (blank.length) issues.push(issue('I_BLANK_ROWS', { count: blank.length }, { rows: blank as RowId[] }))
  for (const inf of inferences) issues.push(...inf.issues)
  if (ctx.kind === 'clipboard') issues.push(issue('I_CLIPBOARD_PRECISION'))

  const numericHigh = columns.every((c) => c.detected.kind !== 'numeric' || c.detected.confidence === 'high')
  const fastPath =
    numericHigh &&
    ctx.delimiterConfidence === 'high' &&
    !issues.some((i) => i.severity === 'error' || FAST_PATH_BLOCKERS.has(i.code))

  return ok({
    rawTable,
    columns,
    layout,
    notes: [...(ctx.notes ?? []), ...lay.notes],
    detection: {
      encoding: ctx.encoding,
      delimiter: ctx.delimiter,
      delimiterConfidence: ctx.delimiterConfidence,
      alternatives: ctx.alternatives,
      headerConfidence: lay.headerConfidence,
      sheetName: ctx.sheetName,
      sheets: ctx.sheets,
      sheet: ctx.sheet ?? null,
    },
    issues: located(issues),
    fastPath,
    suggestedName:
      ctx.name ?? (ctx.kind === 'clipboard' || !ctx.fileName ? PASTED_NAME : baseName(ctx.fileName)),
  })
}

/** Issues whose `row` param is a source position (RawTable.sourceRow), not a count or a line of text. */
const POSITION_CODES: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['W_HEADER_UNCERTAIN', 'I_UNITS_ROW'])

/**
 * The same issue for a transposed table: its `row` (a sheet column number there) becomes the column's
 * letters with axis 'column', so the message reads "Column D" ("{axis|column=…|other=…}" in the texts).
 */
function asColumnPosition(i: Issue): Issue {
  const row = i.params?.row
  if (!POSITION_CODES.has(i.code) || typeof row !== 'number' || !Number.isInteger(row) || row < 1) return i
  return { ...i, params: { ...i.params, row: colLetter(row - 1), axis: 'column' } }
}

/** No cell of the row reads as a number (a row of names); false for an empty row. */
export function namesRow(row: readonly string[] | undefined): boolean {
  if (!row) return false
  let named = 0
  for (const t of row) {
    if (t.trim() === '' || missingLike(t)) continue
    if (numericLike(t, true)) return false
    named++
  }
  return named > 0
}

/** The layout of a block grid exactly as buildDraft detects it (same classifiers and stale-row guard). */
export function blockLayout(rows: string[][], sourceRow: Int32Array, ov: ImportOverrides): LayoutDetection {
  const inGrid = (v: number | null | undefined) =>
    v == null || (Number.isInteger(v) && v >= 0 && v < rows.length)
  return detectLayout(rows, {
    headerRow: inGrid(ov.headerRow) ? ov.headerRow : undefined,
    unitsRow: inGrid(ov.unitsRow) ? ov.unitsRow : undefined,
    dataStartRow: inGrid(ov.dataStartRow) ? ov.dataStartRow : undefined,
    isNumericLike: (s) => numericLike(s, true),
    unitTail: (s) => unitTailOf(s, true),
    isMissing: missingLike,
    sourceRow,
  })
}
