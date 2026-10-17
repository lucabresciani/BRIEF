import type * as XLSXNS from 'xlsx'
import {
  asRowId,
  fail,
  issue,
  NATIVE,
  ok,
  type Issue,
  type NativeKind,
  type Result,
  type RowId,
} from '@/domain/model'
import { clipRange, type GridOrigin, type GridRange } from './a1'

/**
 * Workbook → text grid + native cell kinds. SheetJS is passed in as a parameter (loaded lazily in the
 * import worker), never imported at runtime here. XLSX / XLSM / ODS (zip) and XLS (Excel 97–2003 and older,
 * OLE container) are read the same way.
 *
 * Conventions:
 *  - numbers come from the stored value v, never from the formatted text w (w is kept only for display);
 *  - date-formatted numbers → NATIVE.date with epoch ms UTC, honouring the workbook's 1904 date system;
 *    time-only formats ("hh:mm:ss", elapsed "[h]:mm:ss") with a serial below 1 (or any elapsed time) →
 *    NATIVE.date holding milliseconds since midnight / elapsed milliseconds, exactly as the CSV path reads
 *    "10:30:00" (never 31 Dec 1899);
 *  - percent-formatted numbers keep v (the fraction, 0.12) with text w ("12%"); downstream shows 12 by default;
 *  - error cells (#DIV/0!) → NATIVE.error; a formula without a saved result → missing + W_FORMULA_NO_VALUE;
 *  - merged ranges: only the top-left cell holds a value; header merges (in the last two filled rows above
 *    the first number: the header and a units row) are propagated to the right, data-area merges stay
 *    empty (no fill-down) — both reported with W_MERGED_CELLS (see propagateHeaderMerges). With
 *    propagateMerges: false nothing is copied and nothing reported: a block import reads each block's
 *    header on its own;
 *  - empty edge rows/columns are trimmed (I_TRIMMED_EMPTY); sourceRow keeps the real sheet row numbers;
 *  - maxCells applies to the trimmed block (E_TOO_MANY_CELLS): a declared range inflated by formatted empty
 *    cells (A1:C1000000 around 8 values) is not refused. The declared size (!fullref) only guards memory
 *    before the full parse, at DECLARED_GUARD × maxCells.
 */
type XLSXModule = typeof XLSXNS
type CellObject = XLSXNS.CellObject
type WorkSheet = XLSXNS.WorkSheet

export interface SheetInfo {
  name: string
  /** Declared size of the used range (before trimming empty edges). */
  rows: number
  cols: number
  hidden: boolean
}

export interface WorkbookGrid {
  sheets: SheetInfo[]
  sheetName: string
  /** Formatted text per cell (w ?? String(v)), '' for empty; rows × cols after trimming empty edges. */
  grid: string[][]
  /** Per column, aligned with grid rows: NATIVE kind and v (dates: epoch ms UTC); NaN where not a number/date. */
  native: { kind: Uint8Array; num: Float64Array }[]
  /** 1-based sheet row number of each grid row (range origin included: data from A3 → 3). */
  sourceRow: Int32Array
  /** 0-based sheet row and column of grid[0][0] (data from B3 → {row: 2, col: 1}). */
  origin: GridOrigin
  /** Merged areas relative to the grid, clipped to it; the top-left cell is the anchor. */
  merges: GridRange[]
  /** Grid cells holding a formula without a saved result (missing, counted by W_FORMULA_NO_VALUE). */
  formulaCells: { row: number; col: number }[]
  issues: Issue[]
}

export interface ReadWorkbookOptions {
  sheetName?: string
  maxCells: number
  /** Copy header merges across their cells (W_MERGED_CELLS). Default true. */
  propagateMerges?: boolean
}

export type NativeColumn = { kind: Uint8Array; num: Float64Array }

/** Rows read per sheet in the probe pass (sheet list, sizes, default sheet). */
const PROBE_ROWS = 20
/** A declared range above DECLARED_GUARD × maxCells is refused before the full parse (memory guard). */
const DECLARED_GUARD = 10

const ERROR_TEXT: Readonly<Record<number, string>> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
  0x2b: '#GETTING_DATA',
}

const MS_PER_DAY = 86_400_000

/**
 * Spreadsheet serial date → epoch ms (UTC). 1900 system: serial 1 = 1900-01-01, with Lotus' fictitious
 * 1900-02-29 at serial 60 (serials ≥ 61 are offset by one day). 1904 system: serial 0 = 1904-01-01.
 */
export function serialToEpochMs(serial: number, date1904: boolean): number {
  const days = date1904 ? serial + 1462 : serial
  const offset = days < 60 ? 25568 : 25569
  return Math.round((days - offset) * MS_PER_DAY)
}

/** Removes quoted text, escaped characters, [..] sections and _x / *x padding from a number format. */
function stripLiterals(fmt: string): string {
  let out = ''
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i]
    if (c === '"') {
      i = fmt.indexOf('"', i + 1)
      if (i < 0) break
    } else if (c === '\\' || c === '_' || c === '*') i++
    else if (c === '[') {
      i = fmt.indexOf(']', i + 1)
      if (i < 0) break
    } else out += c
  }
  return out
}

/** 'scaled' = a real percent format (value × 100 shown); 'literal' = a quoted/escaped "%" sign (no scaling). */
export function percentFormat(fmt: string): 'scaled' | 'literal' | 'none' {
  if (!fmt.includes('%')) return 'none'
  return stripLiterals(fmt).includes('%') ? 'scaled' : 'literal'
}

/**
 * Date-format kind: 'elapsed' for durations ("[h]:mm:ss", "[mm]:ss"), 'time' for a time of day without
 * date parts ("hh:mm:ss", "h:mm AM/PM"), 'date' otherwise. Only meaningful for formats SSF calls dates.
 */
export function timeFormatKind(fmt: string): 'elapsed' | 'time' | 'date' {
  if (/\[(?:h+|m+|s+)\]/i.test(fmt)) return 'elapsed'
  const core = stripLiterals(fmt).replace(/AM\/PM|A\/P/gi, '')
  return !/[ydegb]/i.test(core) && /[hs]/i.test(core) ? 'time' : 'date'
}

function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0] as const
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const

/** Zip (xlsx / ods) or OLE compound file (xls, or an encrypted xlsx); null for anything else. */
export function spreadsheetContainer(bytes: Uint8Array): 'zip' | 'ole' | null {
  return startsWith(bytes, ZIP_SIGNATURE) ? 'zip' : startsWith(bytes, OLE_SIGNATURE) ? 'ole' : null
}

/** An OLE2 container holding an "EncryptionInfo" stream is a password-protected OOXML workbook, not a .xls. */
function isEncryptedOoxml(bytes: Uint8Array): boolean {
  const name = 'EncryptionInfo'
  const pat = new Uint8Array(name.length * 2)
  for (let i = 0; i < name.length; i++) pat[2 * i] = name.charCodeAt(i)
  outer: for (let i = 0; i + pat.length <= bytes.length; i++) {
    if (bytes[i] !== pat[0]) continue
    for (let j = 1; j < pat.length; j++) if (bytes[i + j] !== pat[j]) continue outer
    return true
  }
  return false
}

/**
 * SheetJS failure → E_SPREADSHEET_UNREADABLE. A damaged OLE file can fall through to SheetJS' zip reader
 * ("Unsupported ZIP encryption"), so for OLE input only an explicit password message means 'password'.
 */
function unreadable(e: unknown, container: 'zip' | 'ole'): Issue {
  const msg = e instanceof Error ? e.message : String(e)
  const locked = container === 'ole' ? /password/i : /password|encrypt/i
  const reason = locked.test(msg) ? 'password' : 'corrupt'
  return issue('E_SPREADSHEET_UNREADABLE', { reason, detail: msg.slice(0, 200) })
}

function cellAt(XLSX: XLSXModule, ws: WorkSheet, r: number, c: number): CellObject | undefined {
  const dense = ws['!data'] as (CellObject[] | undefined)[] | undefined
  if (dense) return dense[r]?.[c]
  return ws[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined
}

interface ReadCell {
  kind: NativeKind
  text: string
  num: number
  /** A formula whose result was never saved: missing, reported with W_FORMULA_NO_VALUE. */
  formulaNoValue: boolean
}

const EMPTY: ReadCell = { kind: NATIVE.empty, text: '', num: NaN, formulaNoValue: false }

function formatOf(XLSX: XLSXModule, z: CellObject['z']): string {
  if (typeof z === 'string') return z
  if (typeof z === 'number') {
    const table = XLSX.SSF.get_table() as Record<number, string | undefined>
    return table[z] ?? ''
  }
  return ''
}

/** Per-format facts, cached for one workbook (formats repeat across thousands of cells). */
interface FormatFacts {
  date: boolean
  /** Time of day or duration (see timeFormatKind); 'date' for a calendar date (with or without a time). */
  time: 'elapsed' | 'time' | 'date'
  literalPercent: boolean
}
type FormatCache = Map<string, FormatFacts>

function formatFacts(XLSX: XLSXModule, z: CellObject['z'], cache: FormatCache): FormatFacts {
  const fmt = formatOf(XLSX, z)
  let facts = cache.get(fmt)
  if (!facts) {
    const date = fmt !== '' && XLSX.SSF.is_date(fmt) === true
    facts = {
      date,
      time: date ? timeFormatKind(fmt) : 'date',
      literalPercent: fmt !== '' && percentFormat(fmt) === 'literal',
    }
    cache.set(fmt, facts)
  }
  return facts
}

function readCell(
  XLSX: XLSXModule,
  cell: CellObject | undefined,
  date1904: boolean,
  formats: FormatCache,
): ReadCell {
  if (!cell) return EMPTY
  const v = cell.v
  if (typeof cell.f === 'string' && cell.f !== '' && (v === undefined || v === null || cell.t === 'z')) {
    return { kind: NATIVE.empty, text: '', num: NaN, formulaNoValue: true }
  }
  switch (cell.t) {
    case 'z':
      return EMPTY
    case 'n': {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { kind: NATIVE.error, text: cell.w ?? '#NUM!', num: NaN, formulaNoValue: false }
      }
      const text = cell.w ?? String(v)
      const facts = formatFacts(XLSX, cell.z, formats)
      if (facts.date) {
        // A time without a date ("10:30:00" = 0.4375) or a duration: ms since midnight / elapsed ms.
        if (facts.time === 'elapsed' || (facts.time === 'time' && v >= 0 && v < 1)) {
          return { kind: NATIVE.date, text, num: Math.round(v * MS_PER_DAY), formulaNoValue: false }
        }
        return { kind: NATIVE.date, text, num: serialToEpochMs(v, date1904), formulaNoValue: false }
      }
      // A literal "%" (0.0"%") shows v itself: read the shown text like a CSV "12%", never scale v.
      if (facts.literalPercent) {
        return { kind: NATIVE.text, text, num: NaN, formulaNoValue: false }
      }
      return { kind: NATIVE.number, text, num: v, formulaNoValue: false }
    }
    case 'd': {
      const t = v instanceof Date ? v.getTime() : NaN
      if (Number.isNaN(t))
        return { kind: NATIVE.text, text: cell.w ?? String(v ?? ''), num: NaN, formulaNoValue: false }
      return { kind: NATIVE.date, text: cell.w ?? new Date(t).toISOString(), num: t, formulaNoValue: false }
    }
    case 'b':
      return { kind: NATIVE.boolean, text: cell.w ?? (v ? 'TRUE' : 'FALSE'), num: NaN, formulaNoValue: false }
    case 'e':
      return {
        kind: NATIVE.error,
        text: cell.w ?? (typeof v === 'number' ? (ERROR_TEXT[v] ?? '#ERROR!') : '#ERROR!'),
        num: NaN,
        formulaNoValue: false,
      }
    default: {
      const text = typeof v === 'string' ? v : (cell.w ?? (v === undefined || v === null ? '' : String(v)))
      return text === '' ? EMPTY : { kind: NATIVE.text, text, num: NaN, formulaNoValue: false }
    }
  }
}

/** Visible sheet with at least 2 numeric columns in the probe rows, else the first visible non-empty sheet. */
function pickDefaultSheet(XLSX: XLSXModule, book: XLSXNS.WorkBook, sheets: SheetInfo[]): string | null {
  const stats = sheets.map((s) => {
    const ws = book.Sheets[s.name]
    const ref = ws?.['!ref']
    if (!ws || !ref) return { nonEmpty: false, numericCols: 0 }
    const range = XLSX.utils.decode_range(ref)
    let nonEmpty = false
    let numericCols = 0
    for (let c = range.s.c; c <= range.e.c; c++) {
      let nums = 0
      let filled = 0
      for (let r = range.s.r; r <= range.e.r; r++) {
        const cell = cellAt(XLSX, ws, r, c)
        if (!cell || cell.t === 'z' || cell.v === undefined || cell.v === '') continue
        filled++
        if (cell.t === 'n') nums++
      }
      if (filled > 0) nonEmpty = true
      if (nums > 0 && nums * 2 >= filled) numericCols++
    }
    return { nonEmpty, numericCols }
  })
  const pick = (pred: (i: number) => boolean) => {
    const i = sheets.findIndex((_, k) => pred(k))
    return i >= 0 ? sheets[i].name : null
  }
  return (
    pick((i) => !sheets[i].hidden && stats[i].numericCols >= 2) ??
    pick((i) => !sheets[i].hidden && stats[i].nonEmpty) ??
    pick((i) => stats[i].nonEmpty)
  )
}

/**
 * Reads one sheet of an XLSX / XLSM / ODS / XLS workbook. Never throws for problems in the file:
 * neither a zip nor an OLE container → E_UNSUPPORTED_FORMAT; an OLE container holding an encrypted .xlsx,
 * a SheetJS failure (damaged file, password) → E_SPREADSHEET_UNREADABLE {reason}; declared size > maxCells →
 * E_TOO_MANY_CELLS {cells, limit}; no data → E_SHEET_EMPTY {sheet}. Legacy .xls text in old code pages
 * (Excel 95) needs XLSX.set_cptable first (done by the import worker).
 */
export function readWorkbook(
  XLSX: XLSXModule,
  bytes: Uint8Array,
  opts: ReadWorkbookOptions,
): Result<WorkbookGrid> {
  if (!(opts.maxCells > 0)) throw new Error('readWorkbook: maxCells must be positive')

  const container = spreadsheetContainer(bytes)
  if (container === null) return fail(issue('E_UNSUPPORTED_FORMAT'))
  if (container === 'ole' && isEncryptedOoxml(bytes))
    return fail(issue('E_SPREADSHEET_UNREADABLE', { reason: 'password' }))

  // ---- probe: sheet list, declared sizes and the default sheet, reading only the first rows ----
  let probe: XLSXNS.WorkBook
  try {
    probe = XLSX.read(bytes, {
      type: 'array',
      sheetRows: PROBE_ROWS,
      dense: true,
      cellText: false,
      cellHTML: false,
      cellFormula: false,
      cellStyles: false,
    })
  } catch (e) {
    return fail(unreadable(e, container))
  }
  const sheets: SheetInfo[] = []
  for (const name of probe.SheetNames) {
    const ws = probe.Sheets[name]
    if (!ws || ws['!type'] === 'chart') continue
    const ref = (ws['!fullref'] as string | undefined) ?? ws['!ref']
    let rows = 0
    let cols = 0
    if (ref) {
      const range = XLSX.utils.decode_range(ref)
      rows = range.e.r - range.s.r + 1
      cols = range.e.c - range.s.c + 1
    }
    const props = probe.Workbook?.Sheets?.find((s) => s.name === name)
    sheets.push({ name, rows, cols, hidden: (props?.Hidden ?? 0) !== 0 })
  }
  if (sheets.length === 0) return fail(issue('E_SPREADSHEET_UNREADABLE', { reason: 'noSheets' }))

  let sheetName: string
  if (opts.sheetName !== undefined) {
    if (!sheets.some((s) => s.name === opts.sheetName))
      return fail(issue('E_SHEET_EMPTY', { sheet: opts.sheetName }))
    sheetName = opts.sheetName
  } else {
    const picked = pickDefaultSheet(XLSX, probe, sheets)
    if (picked === null) return fail(issue('E_SHEET_EMPTY', { sheet: sheets[0].name }))
    sheetName = picked
  }
  const info = sheets.find((s) => s.name === sheetName) as SheetInfo
  const guard = DECLARED_GUARD * opts.maxCells
  if (info.rows * info.cols > guard) {
    return fail(
      issue('E_TOO_MANY_CELLS', { cells: info.rows * info.cols, limit: opts.maxCells, sheet: sheetName }),
    )
  }

  // ---- full parse of the chosen sheet ----
  let book: XLSXNS.WorkBook
  try {
    book = XLSX.read(bytes, {
      type: 'array',
      sheets: [sheetName],
      dense: true,
      cellDates: false,
      cellNF: true,
      cellText: true,
      cellFormula: true,
      cellHTML: false,
      cellStyles: false,
      sheetStubs: true, // keeps formula cells without a cached value (otherwise silently dropped)
    })
  } catch (e) {
    return fail(unreadable(e, container))
  }
  const ws = book.Sheets[sheetName]
  const ref = ws?.['!ref']
  if (!ws || !ref) return fail(issue('E_SHEET_EMPTY', { sheet: sheetName }))
  const date1904 = book.Workbook?.WBProps?.date1904 === true
  const formats: FormatCache = new Map()
  const range = XLSX.utils.decode_range(ref)
  const declared = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1)
  if (declared > guard) {
    return fail(issue('E_TOO_MANY_CELLS', { cells: declared, limit: opts.maxCells, sheet: sheetName }))
  }

  // pass 1: bounds of the non-empty cells and the first row holding numbers (end of the header zone).
  // Dense sheets are walked over their stored rows only, so an inflated declared range costs nothing.
  const dense = ws['!data'] as (CellObject[] | undefined)[] | undefined
  let minR = Infinity
  let maxR = -Infinity
  let minC = Infinity
  let maxC = -Infinity
  let firstNumericRow = Infinity
  const lastRow = dense ? Math.min(range.e.r, dense.length - 1) : range.e.r
  for (let r = range.s.r; r <= lastRow; r++) {
    const stored = dense ? dense[r] : undefined
    if (dense && !stored) continue
    const lastCol = stored ? Math.min(range.e.c, stored.length - 1) : range.e.c
    for (let c = range.s.c; c <= lastCol; c++) {
      const cell = readCell(XLSX, cellAt(XLSX, ws, r, c), date1904, formats)
      if (cell.kind === NATIVE.empty && !cell.formulaNoValue) continue
      if (cell.kind === NATIVE.text && cell.text.trim() === '') continue
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (c < minC) minC = c
      if (c > maxC) maxC = c
      if ((cell.kind === NATIVE.number || cell.kind === NATIVE.date) && r < firstNumericRow)
        firstNumericRow = r
    }
  }
  if (minR === Infinity) return fail(issue('E_SHEET_EMPTY', { sheet: sheetName }))

  const issues: Issue[] = []
  const trimmedRows = minR - range.s.r + (range.e.r - maxR)
  const trimmedCols = minC - range.s.c + (range.e.c - maxC)
  if (trimmedRows > 0 || trimmedCols > 0) {
    issues.push(issue('I_TRIMMED_EMPTY', { rows: trimmedRows, cols: trimmedCols, sheet: sheetName }))
  }

  // pass 2: extract the trimmed block
  const nRows = maxR - minR + 1
  const nCols = maxC - minC + 1
  if (nRows * nCols > opts.maxCells) {
    return fail(issue('E_TOO_MANY_CELLS', { cells: nRows * nCols, limit: opts.maxCells, sheet: sheetName }))
  }
  const grid: string[][] = new Array<string[]>(nRows)
  const native = Array.from({ length: nCols }, () => {
    const num = new Float64Array(nRows)
    num.fill(NaN)
    return { kind: new Uint8Array(nRows), num }
  })
  const sourceRow = new Int32Array(nRows)
  const formulaCells: { row: number; col: number }[] = []
  for (let i = 0; i < nRows; i++) {
    const r = minR + i
    sourceRow[i] = r + 1
    const row = new Array<string>(nCols).fill('')
    for (let j = 0; j < nCols; j++) {
      const cell = readCell(XLSX, cellAt(XLSX, ws, r, minC + j), date1904, formats)
      row[j] = cell.text
      native[j].kind[i] = cell.kind
      native[j].num[i] = cell.num
      if (cell.formulaNoValue) formulaCells.push({ row: i, col: j })
    }
    grid[i] = row
  }
  const formulaIssue = formulaNoValueIssue(formulaCells)
  if (formulaIssue) issues.push(formulaIssue)

  const merges: GridRange[] = []
  for (const m of (ws['!merges'] ?? []) as XLSXNS.Range[]) {
    const clipped = clipRange(
      { r0: m.s.r - minR, c0: m.s.c - minC, r1: m.e.r - minR, c1: m.e.c - minC },
      nRows,
      nCols,
    )
    if (clipped) merges.push(clipped)
  }
  if (opts.propagateMerges !== false) {
    // The header zone ends at the first row holding a number or date (only the first row when the
    // sheet has none).
    const headerEnd = firstNumericRow === Infinity ? 1 : firstNumericRow - minR
    const merged = propagateHeaderMerges(grid, native, merges, headerEnd)
    if (merged) issues.push(merged)
  }

  return ok({
    sheets,
    sheetName,
    grid,
    native,
    sourceRow,
    origin: { row: minR, col: minC },
    merges,
    formulaCells,
    issues,
  })
}

/** W_FORMULA_NO_VALUE for the given grid cells (null when there are none). */
export function formulaNoValueIssue(cells: readonly { row: number; col: number }[]): Issue | null {
  if (cells.length === 0) return null
  const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b)
  return issue('W_FORMULA_NO_VALUE', { count: cells.length }, { rows: rows.map(asRowId) as RowId[] })
}

/**
 * Merged areas of a grid (only the anchor, the top-left cell, holds a value): header merges are copied to
 * the right, data-area merges stay empty (no fill-down). The header zone is rows headerStart … headerEnd − 1
 * (headerEnd = the first row holding a number or date); within it only the last two filled rows — a header
 * and a units row — are propagated, never a title: a merge whose row holds nothing else, or that spans the
 * whole width, stays one note. A column that is empty below the header is not filled either: a quantity
 * merged over C:D in every row is one column, not two. Mutates grid and native (merges relative to the
 * grid); returns W_MERGED_CELLS {count, header, data}, or null when nothing was propagated or left empty.
 */
export function propagateHeaderMerges(
  grid: string[][],
  native: NativeColumn[],
  merges: readonly GridRange[],
  headerEnd: number,
  headerStart = 0,
): Issue | null {
  if (merges.length === 0) return null
  const nRows = grid.length
  const nCols = grid[0]?.length ?? 0
  /** Filled cells per row before anything is copied (a title row holds one). */
  const filled = grid.map((row) => row.reduce((k, t) => (t.trim() !== '' ? k + 1 : k), 0))
  const headerRows = new Set<number>()
  for (let i = Math.min(headerEnd, nRows) - 1; i >= headerStart && headerRows.size < 2; i--) {
    if (filled[i]! > 0) headerRows.add(i)
  }
  const dataBelow: (boolean | undefined)[] = []
  const hasData = (j: number) => {
    let v = dataBelow[j]
    if (v === undefined) {
      v = false
      for (let i = Math.max(headerEnd, 0); i < nRows && !v; i++) if (grid[i]![j]!.trim() !== '') v = true
      dataBelow[j] = v
    }
    return v
  }
  let header = 0
  let data = 0
  const rows = new Set<number>()
  for (const m of merges) {
    if (m.r1 < headerEnd) {
      const top = m.r0
      if (!headerRows.has(top)) continue
      const span = m.c1 - m.c0 + 1
      const title = filled[top] === 1 || (nCols >= 2 && span >= nCols)
      if (title || grid[top]![m.c0]!.trim() === '') continue
      let copied = false
      for (let j = m.c0 + 1; j <= m.c1; j++) {
        if (!hasData(j)) continue
        copied = true
        grid[top]![j] = grid[top]![m.c0]!
        native[j]!.kind[top] = native[m.c0]!.kind[top]!
        native[j]!.num[top] = native[m.c0]!.num[top]!
      }
      if (!copied) continue
      header++
      rows.add(top)
    } else {
      data++
      for (let r = m.r0; r <= m.r1; r++) rows.add(r)
    }
  }
  if (header + data === 0) return null
  return issue(
    'W_MERGED_CELLS',
    { count: header + data, header, data },
    { rows: [...rows].sort((a, b) => a - b).map(asRowId) as RowId[] },
  )
}
