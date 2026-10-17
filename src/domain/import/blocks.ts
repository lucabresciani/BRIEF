import { NATIVE } from '@/domain/model'
import { formatA1, toSheetRange, type GridOrigin, type GridRange } from './a1'
import { looksLikeUnit } from './layout'
import { isMissingToken, isSheetErrorToken } from './missing'
import { classifyNumberToken } from './numberToken'
import type { NativeColumn } from './spreadsheet'

/**
 * Small tables inside one sheet: lab workbooks hold grids of titled tables, transposed tables
 * stacked under each other, key/value lines above a table and 2-D matrices. A block is a 4-connected island
 * of occupied cells (a merged area counts as occupied when its anchor holds a value, so a quantity merged
 * over C:D does not split its table). Linear in the number of cells; runs in the import worker. Nothing is
 * ever joined or imported automatically: blocks, their parameters and the join hints are suggestions.
 */
export type BlockKind = 'table' | 'matrix' | 'keyValue' | 'note'

export interface BlockParam {
  key: string
  /** The value as shown in the sheet. */
  text: string
  /**
   * Its number (the native value, else the text read as a number); null when it is not a plain number
   * (a date, "25 %", an ambiguous "1,234"): the label then keeps the text.
   */
  value: number | null
  /** A key/value title line of the block, or a key/value block at most 3 rows above it. */
  source: 'title' | 'above'
}

export interface BlockHint {
  /** This block looks like a piece of the neighbour `with` (one empty column apart). */
  type: 'join'
  with: string
  /** Bounding range of both (grid coordinates) and its A1 reference. */
  range: GridRange
  a1: string
}

export interface DetectedBlock {
  /** "b1", "b2"… in reading order (top to bottom, then left to right). */
  id: string
  kind: BlockKind
  /** Grid coordinates (the frame of WorkbookGrid.grid and its merges), inclusive; trailing notes excluded. */
  range: GridRange
  /** Sheet A1 reference of range ("B2:E9"). */
  a1: string
  /** Leading title rows inside range (title cells and key/value lines). */
  titleRows: number
  /** Text of the title rows that are not key/value lines, in reading order ("oak", "plank 1"). */
  titleCells: string[]
  /**
   * Where each title cell is: its title row and column, counted from the block's top-left corner. Lets
   * blocks whose titles have a cell left blank be compared cell by cell (absent on hand-made blocks).
   */
  titlePos?: { row: number; col: number }[]
  params: BlockParam[]
  /** Variable names: the first row after the titles ('columns') or the first column ('rows'). */
  header: string[]
  /** 'rows' = variables in rows (transposed: "duty | 25 % | 50 %…"). */
  orientation: 'columns' | 'rows'
  /** 'low' when the other orientation is plausible too. */
  orientationConfidence: 'high' | 'low'
  /**
   * Remarks typed after the last record (left out of range, at most 3), and the lines of a note block: at
   * most MAX_NOTE_LINES lines of at most MAX_NOTE_CHARS characters (a sheet of text can hold thousands).
   */
  notes: string[]
  /** Lines of a note block left out beyond MAX_NOTE_LINES (they stay in the sheet and in the raw data). */
  notesOmitted: number
  hints: BlockHint[]
  /** Filled cells, and how many of them hold numbers or dates. */
  cells: number
  numbers: number
}

export interface BlockDetection {
  blocks: DetectedBlock[]
  /** Table and matrix blocks in the sheet (including any beyond MAX_BLOCKS). */
  tables: number
  /** Blocks left out beyond MAX_BLOCKS (tables are kept first, then key/value blocks, then notes). */
  overflow: number
}

export interface DetectBlocksOptions {
  /** Merged areas relative to the grid. */
  merges?: readonly GridRange[]
  /** Sheet position of grid[0][0], for the A1 references (default A1). */
  origin?: GridOrigin
  /** Native cell kinds (spreadsheets): numbers and dates are told from text without parsing. */
  native?: readonly NativeColumn[] | null
}

export const MAX_BLOCKS = 500
/** Lines kept per note block, and characters per line (the rest is cut with "…"). */
export const MAX_NOTE_LINES = 20
export const MAX_NOTE_CHARS = 200
/** At most this many title rows above a header, and remark lines trimmed after the last record. */
const MAX_TITLE_ROWS = 4
const MAX_TRAILING_NOTES = 3
/** Key/value blocks this many empty rows (or fewer) above a table give it parameters. */
const PARAM_GAP = 3
/** Share of records that must read "name, then numbers" for the 'rows' orientation. */
const ROWS_SHARE = 0.8

// Cell classes. COVERED = inside a merged area whose anchor holds a value (occupied, not a cell of its own).
const EMPTY = 0
const VALUE = 1
const TEXT = 2
const MISSING = 3
const COVERED = 4

const isReal = (k: number) => k === VALUE || k === TEXT || k === MISSING

function classify(text: string, kind: number | undefined): number {
  const t = text.trim()
  if (t === '') return EMPTY
  if (kind === NATIVE.number || kind === NATIVE.date || kind === NATIVE.boolean) return VALUE
  if (kind === NATIVE.error || isMissingToken(t) || isSheetErrorToken(t)) return MISSING
  return classifyNumberToken(t).cls === 'invalid' ? TEXT : VALUE
}

/**
 * Number of a cell: the native value, else the text read as a number. Null when it is not one, and for a
 * date: its epoch milliseconds are not a value anyone typed.
 */
function numberOf(text: string, kind?: number, num?: number): number | null {
  if (kind === NATIVE.date) return null
  if (kind === NATIVE.number && num !== undefined && Number.isFinite(num)) return num
  const tok = classifyNumberToken(text.trim())
  const v =
    tok.cls === 'neutral' || tok.cls === 'dot' ? tok.dotValue : tok.cls === 'comma' ? tok.commaValue : NaN
  return Number.isFinite(v) ? v : null
}

/** The occupancy grid: one class per cell, row-major. */
interface Sheet {
  grid: readonly (readonly string[])[]
  native: readonly NativeColumn[] | null
  rows: number
  cols: number
  cls: Uint8Array
  origin: GridOrigin
}

function buildSheet(grid: readonly (readonly string[])[], opts: DetectBlocksOptions): Sheet {
  const rows = grid.length
  let cols = 0
  for (const r of grid) if (r.length > cols) cols = r.length
  const native = opts.native ?? null
  const cls = new Uint8Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    const row = grid[r]!
    for (let c = 0; c < row.length; c++) cls[r * cols + c] = classify(row[c]!, native?.[c]?.kind[r])
  }
  for (const m of opts.merges ?? []) {
    if (m.r0 < 0 || m.c0 < 0 || m.r0 >= rows || m.c0 >= cols || !isReal(cls[m.r0 * cols + m.c0]!)) continue
    for (let r = m.r0; r <= Math.min(m.r1, rows - 1); r++)
      for (let c = m.c0; c <= Math.min(m.c1, cols - 1); c++)
        if (r !== m.r0 || c !== m.c0) cls[r * cols + c] = COVERED
  }
  return { grid, native, rows, cols, cls, origin: opts.origin ?? { row: 0, col: 0 } }
}

/** Cells of one block: `at` gives the class of a cell inside the block (EMPTY outside it). */
interface BlockView {
  range: GridRange
  at: (r: number, c: number) => number
  /** Real cells (row-major), as sheet indices r * cols + c. */
  cells: ArrayLike<number>
}

type Analysis = Omit<DetectedBlock, 'id' | 'a1' | 'hints'>

const textAt = (s: Sheet, r: number, c: number) => (s.grid[r]?.[c] ?? '').trim()

function rowCells(s: Sheet, v: BlockView, r: number, c0: number, c1: number) {
  const out: { c: number; k: number; t: string }[] = []
  for (let c = c0; c <= c1; c++) {
    const k = v.at(r, c)
    if (isReal(k)) out.push({ c, k, t: textAt(s, r, c) })
  }
  return out
}

/** Cells of one line joined with " | ", cut to MAX_NOTE_CHARS (a row of a wide sheet can be very long). */
function clipLine(cells: readonly string[]): string {
  let out = ''
  for (const t of cells) {
    out += out === '' ? t : ` | ${t}`
    if (out.length > MAX_NOTE_CHARS) return `${out.slice(0, MAX_NOTE_CHARS - 1)}…`
  }
  return out
}

/** "Tilt | -5" (two cells) or "Rate: 1200" (one cell) → a parameter; null otherwise. */
function paramFrom(s: Sheet, r: number, cells: { c: number; k: number; t: string }[]): BlockParam | null {
  if (cells.length === 2 && cells[0]!.k === TEXT && cells[1]!.k === VALUE) {
    const key = cells[0]!.t.replace(/\s*[:=]\s*$/, '').trim()
    const { c, t } = cells[1]!
    const col = s.native?.[c]
    if (key === '') return null
    return { key, text: t, value: numberOf(t, col?.kind[r], col?.num[r]), source: 'title' }
  }
  if (cells.length === 1 && cells[0]!.k === TEXT) {
    const m = /^(.*?\S)\s*([:=])\s*(\S.*)$/.exec(cells[0]!.t)
    // "10:30", "ratio 1:2": a time or a ratio, not a name and its value.
    const clock = m !== null && m[2] === ':' && /\d$/.test(m[1]!) && /^\d/.test(m[3]!)
    if (m && !clock && classify(m[3]!, undefined) === VALUE) {
      return { key: m[1]!, text: m[3]!, value: numberOf(m[3]!), source: 'title' }
    }
  }
  return null
}

function analyse(s: Sheet, v: BlockView): Analysis {
  const { r0, c0 } = v.range
  let { r1, c1 } = v.range
  const h = r1 - r0 + 1
  const count = new Int32Array(h)
  const values = new Int32Array(h)
  const texts = new Int32Array(h)
  const firstK = new Uint8Array(h)
  let numbers = 0
  for (let i = 0; i < v.cells.length; i++) {
    const idx = v.cells[i]!
    const r = Math.floor(idx / s.cols) - r0
    const k = s.cls[idx]!
    if (count[r] === 0) firstK[r] = k
    count[r]++
    if (k === VALUE) {
      values[r]++
      numbers++
    } else if (k === TEXT) texts[r]++
  }
  const cells = v.cells.length
  const cellsOf = (r: number) => rowCells(s, v, r, c0, c1).map((x) => x.t)
  const base: Analysis = {
    kind: 'table',
    range: v.range,
    titleRows: 0,
    titleCells: [],
    params: [],
    header: [],
    orientation: 'columns',
    orientationConfidence: 'high',
    notes: [],
    notesOmitted: 0,
    cells,
    numbers,
  }

  // Key/value lines ("Rate | 1200", "Pressure | 101.3", "T = 20 °C", "Date | 15/03/2024"): up to 4
  // rows of a name and a value.
  if (h <= MAX_TITLE_ROWS) {
    const params: BlockParam[] = []
    for (let i = 0; i < h; i++) {
      if (count[i] === 0) continue
      const p = paramFrom(s, r0 + i, rowCells(s, v, r0 + i, c0, c1))
      if (!p) {
        params.length = 0
        break
      }
      params.push(p)
    }
    if (params.length > 0) return { ...base, kind: 'keyValue', params }
  }
  if (cells <= 2 || numbers === 0 || h < 2) {
    const notes: string[] = []
    let filled = 0
    for (let i = 0; i < h; i++) {
      if (count[i] === 0) continue
      if (notes.length < MAX_NOTE_LINES) notes.push(clipLine(cellsOf(r0 + i)))
      filled++
    }
    return { ...base, kind: 'note', notes, notesOmitted: filled - notes.length }
  }

  // Title rows, leaving at least two rows of table: 1–2 cells above a wider row (the header), or 3 cells
  // above a row at least twice as wide ("Rod temperature | 5cm | time" over a matrix), or a row
  // of names right above another row of names that is not a units row and spans the rows below it
  // ("Pine | plank 1" over "tilt (deg) | P [J/s]"; a first record without its numbers, "Sample 1 |
  // broken glass" under "Sample | Note | Mass", is narrower than the table). A row of merged group headers
  // ("Run 1" over A:B, "Run 2" over C:D) is part of the header, never a title.
  const maxAfter = new Int32Array(h + 1)
  for (let i = h - 1; i >= 0; i--) maxAfter[i] = Math.max(maxAfter[i + 1]!, count[i]!)
  const names = (i: number) => count[i]! > 0 && texts[i] === count[i]
  const groupHeader = (i: number) => {
    if (!names(i)) return false
    let anchors = 0
    for (const x of rowCells(s, v, r0 + i, c0, c1)) if (v.at(r0 + i, x.c + 1) === COVERED) anchors++
    return anchors >= 2
  }
  const unitsLine = (i: number) =>
    rowCells(s, v, r0 + i, c0, c1).every(
      (x) => x.t === '-' || looksLikeUnit(x.t.replace(/^[([](.*)[)\]]$/, '$1')),
    )
  const titleLike = (i: number) => {
    const n = count[i]!
    if (n === 0 || groupHeader(i)) return false
    if (n <= 2 && n < maxAfter[i + 1]!) return true
    if (n === 3 && n * 2 <= maxAfter[i + 1]!) return true
    return names(i) && names(i + 1) && h - i > 3 && count[i + 1]! >= maxAfter[i + 2]! && !unitsLine(i + 1)
  }
  let t = 0
  while (t < MAX_TITLE_ROWS && h - t > 2 && titleLike(t)) t++
  const titleCells: string[] = []
  const titlePos: { row: number; col: number }[] = []
  const params: BlockParam[] = []
  for (let i = 0; i < t; i++) {
    const row = rowCells(s, v, r0 + i, c0, c1)
    const p = paramFrom(s, r0 + i, row)
    if (p) params.push(p)
    else
      for (const x of row) {
        titleCells.push(x.t)
        titlePos.push({ row: i, col: x.c - c0 })
      }
  }

  // Orientation: variables in rows when (nearly) every record starts with a name followed by numbers and
  // the first row is not a header of names ("duty | 25 % | 50 %…" is a variable, not a header).
  let bodyRows = 0
  let rowsLike = 0
  for (let i = t; i < h; i++) {
    if (count[i] === 0) continue
    bodyRows++
    const restValues = values[i]! - (firstK[i] === VALUE ? 1 : 0)
    const restTexts = texts[i]! - (firstK[i] === TEXT ? 1 : 0)
    if (firstK[i] === TEXT && restValues >= 1 && restValues >= restTexts) rowsLike++
  }
  const textualFirst = count[t]! >= 2 && values[t] === 0 && texts[t]! >= 2
  const share = bodyRows > 0 ? rowsLike / bodyRows : 0
  let orientation: 'columns' | 'rows' = 'columns'
  let orientationConfidence: 'high' | 'low' = share >= ROWS_SHARE ? 'low' : 'high'
  if (!textualFirst && bodyRows >= 2 && share >= ROWS_SHARE && c1 > c0) {
    orientation = 'rows'
    orientationConfidence = share === 1 ? 'high' : 'low'
  }

  // A 2-D matrix: numbers across the first row and down the first column, around a corner that is not a
  // number (a name, "-", or an empty cell).
  let kind: BlockKind = 'table'
  const top = r0 + t
  const first = rowCells(s, v, top, c0, c1)
  let corner = first[0]?.c ?? c0
  if (corner > c0 && v.at(top, c0) === EMPTY) {
    for (let r = top + 1; r <= r1; r++) {
      if (v.at(r, c0) === VALUE) {
        corner = c0
        break
      }
    }
  }
  const across = first.filter((x) => x.c > corner)
  if (v.at(top, corner) !== VALUE && across.length >= 2 && across.every((x) => x.k === VALUE)) {
    let down = 0
    let other = 0
    for (let r = top + 1; r <= r1; r++) {
      const k = v.at(r, corner)
      if (k === VALUE) down++
      else if (isReal(k)) other++
    }
    if (down >= 2 && other === 0) {
      kind = 'matrix'
      orientation = 'columns'
      orientationConfidence = 'high'
    }
  }

  // Short text lines after the last record are remarks, not records ("drift +0.4" after a value).
  const notes: string[] = []
  if (orientation === 'columns') {
    for (let n = 0; n < MAX_TRAILING_NOTES && r1 - top >= 2; n++) {
      const i = r1 - r0
      if (count[i]! > 2 || texts[i] !== count[i]) break
      // At most two cells: a remark is imported as a note in full.
      if (count[i]! > 0) notes.unshift(cellsOf(r1).join(' | '))
      r1--
    }
  } else {
    for (let n = 0; n < MAX_TRAILING_NOTES && c1 - c0 >= 2; n++) {
      const found: string[] = []
      let remarks = true
      for (let r = top; r <= r1 && remarks; r++) {
        const k = v.at(r, c1)
        if (k === TEXT) found.push(textAt(s, r, c1))
        else if (k !== EMPTY && k !== COVERED) remarks = false
      }
      if (!remarks || found.length > 2) break
      notes.push(...found)
      c1--
    }
  }

  const header: string[] = []
  if (orientation === 'columns') {
    for (let c = c0; c <= c1; c++) header.push(isReal(v.at(top, c)) ? textAt(s, top, c) : '')
  } else {
    for (let r = top; r <= r1; r++) header.push(isReal(v.at(r, c0)) ? textAt(s, r, c0) : '')
  }
  return {
    ...base,
    kind,
    range: { r0, c0, r1, c1 },
    titleRows: t,
    titleCells,
    titlePos,
    params,
    header,
    orientation,
    orientationConfidence,
    notes,
  }
}

/** The name of a block: its title, else its key/value title lines ("layers 0"); '' without either. */
export function blockTitle(b: Pick<DetectedBlock, 'titleCells' | 'params'> | null | undefined): string {
  if (!b) return ''
  const title = b.titleCells.join(' ').trim()
  if (title) return title
  return b.params
    .filter((p) => p.source === 'title')
    .map((p) => `${p.key} ${p.text}`)
    .join(', ')
}

/** Union-find root with path halving; a root is the smallest index of its set (reading order). */
function find(parent: Int32Array, x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]!]!
    x = parent[x]!
  }
  return x
}

const PRIORITY: Record<BlockKind, number> = { table: 0, matrix: 0, keyValue: 1, note: 2 }
const byReading = (a: { range: GridRange }, b: { range: GridRange }) =>
  a.range.r0 - b.range.r0 || a.range.c0 - b.range.c0

const withA1 = (a: Analysis, id: string, origin: GridOrigin): DetectedBlock => ({
  id,
  ...a,
  a1: formatA1(toSheetRange(a.range, origin)),
  hints: [],
})

export interface SheetBlocks {
  detection: BlockDetection
  /**
   * The analysis of any range of the grid (a rectangle drawn by the user), as detectBlocks would report
   * an island with exactly the cells inside it, plus the parameters of key/value blocks just above it.
   * The range is clipped to the grid and shrunk to its filled cells; null when it holds none.
   */
  describe: (range: GridRange) => DetectedBlock | null
}

/**
 * The blocks of a sheet grid (WorkbookGrid.grid, or any grid of cell texts), in reading order:
 * 1. occupancy: a cell with text, and every cell of a merged area whose anchor holds a value;
 * 2. 4-connected islands of occupied cells (union-find), each with its bounding range and counts;
 * 3. kind: key/value lines (≤ 4 rows of a name and a value), note (≤ 2 cells or no number), table, and
 *    matrix (numbers across the first row and down the first column);
 * 4. title rows (1–2 cells above the header); short text lines after the last record become notes;
 * 5. parameters: key/value title lines and key/value blocks up to 3 rows above the table;
 * 6. orientation 'rows' when ≥ 80 % of the records read "name, numbers…" and the first row is not a header;
 * 7. join hints: a piece without its own title, one empty column beside a table and within its rows;
 * 8. at most MAX_BLOCKS blocks (tables first), the rest counted in `overflow`.
 */
export function detectBlocks(
  grid: readonly (readonly string[])[],
  opts: DetectBlocksOptions = {},
): BlockDetection {
  return analyseSheet(grid, opts).detection
}

/** detectBlocks plus `describe` for arbitrary ranges, sharing one classification of the sheet. */
export function analyseSheet(
  grid: readonly (readonly string[])[],
  opts: DetectBlocksOptions = {},
): SheetBlocks {
  const s = buildSheet(grid, opts)
  const { rows, cols, cls } = s
  const n = rows * cols
  const parent = new Int32Array(n).fill(-1)
  const union = (a: number, b: number) => {
    const ra = find(parent, a)
    const rb = find(parent, b)
    if (ra < rb) parent[rb] = ra
    else if (rb < ra) parent[ra] = rb
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (cls[i] === EMPTY) continue
      parent[i] = i
      if (c > 0 && cls[i - 1] !== EMPTY) union(i, i - 1)
      if (r > 0 && cls[i - cols] !== EMPTY) union(i, i - cols)
    }
  }

  // Dense labels in reading order of each island's first cell, bounding ranges, real cells per island.
  const label = new Int32Array(n).fill(-1)
  const boxes: GridRange[] = []
  const realCount: number[] = []
  for (let i = 0; i < n; i++) {
    if (cls[i] === EMPTY) continue
    const r = Math.floor(i / cols)
    const c = i % cols
    const root = find(parent, i)
    let k = label[root]!
    if (k < 0) {
      k = boxes.length
      label[root] = k
      boxes.push({ r0: r, c0: c, r1: r, c1: c })
      realCount.push(0)
    }
    label[i] = k
    const b = boxes[k]!
    if (r > b.r1) b.r1 = r
    if (c < b.c0) b.c0 = c
    if (c > b.c1) b.c1 = c
    if (isReal(cls[i]!)) realCount[k] = realCount[k]! + 1
  }
  const offset = new Int32Array(boxes.length + 1)
  for (let k = 0; k < boxes.length; k++) offset[k + 1] = offset[k]! + realCount[k]!
  const cellList = new Int32Array(offset[boxes.length]!)
  const next = offset.slice(0, boxes.length)
  for (let i = 0; i < n; i++) {
    if (!isReal(cls[i]!)) continue
    const k = label[i]!
    cellList[next[k]!] = i
    next[k] = next[k]! + 1
  }

  const analysed: Analysis[] = []
  for (let k = 0; k < boxes.length; k++) {
    if (realCount[k] === 0) continue
    const inIsland = (r: number, c: number) =>
      r >= 0 && c >= 0 && r < rows && c < cols && label[r * cols + c] === k ? cls[r * cols + c]! : EMPTY
    analysed.push(
      analyse(s, { range: boxes[k]!, at: inIsland, cells: cellList.subarray(offset[k]!, offset[k + 1]!) }),
    )
  }
  const tables = analysed.filter((a) => a.kind === 'table' || a.kind === 'matrix').length
  const kept = [...analysed]
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || byReading(a, b))
    .slice(0, MAX_BLOCKS)
    .sort(byReading)
  const blocks = kept.map((a, i) => withA1(a, `b${i + 1}`, s.origin))
  attachParamsAbove(blocks, blocks)
  attachJoinHints(blocks, s.origin)
  const detection: BlockDetection = { blocks, tables, overflow: analysed.length - kept.length }

  const describe = (range: GridRange): DetectedBlock | null => {
    const r0 = Math.max(range.r0, 0)
    const c0 = Math.max(range.c0, 0)
    const r1 = Math.min(range.r1, rows - 1)
    const c1 = Math.min(range.c1, cols - 1)
    const cells: number[] = []
    const box = { r0: Infinity, c0: Infinity, r1: -Infinity, c1: -Infinity }
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!isReal(cls[r * cols + c]!)) continue
        cells.push(r * cols + c)
        box.r0 = Math.min(box.r0, r)
        box.r1 = Math.max(box.r1, r)
        box.c0 = Math.min(box.c0, c)
        box.c1 = Math.max(box.c1, c)
      }
    }
    if (cells.length === 0) return null
    const inside = (r: number, c: number) =>
      r >= r0 && r <= r1 && c >= c0 && c <= c1 ? cls[r * cols + c]! : EMPTY
    const block = withA1(analyse(s, { range: box, at: inside, cells }), 'range', s.origin)
    attachParamsAbove([block], blocks)
    return block
  }
  return { detection, describe }
}

/** Key/value blocks ending at most PARAM_GAP empty rows above a table, over its columns, add parameters. */
function attachParamsAbove(targets: readonly DetectedBlock[], all: readonly DetectedBlock[]): void {
  const kvByBottom = new Map<number, DetectedBlock[]>()
  for (const b of all) {
    if (b.kind !== 'keyValue') continue
    const list = kvByBottom.get(b.range.r1) ?? []
    list.push(b)
    kvByBottom.set(b.range.r1, list)
  }
  if (kvByBottom.size === 0) return
  for (const t of targets) {
    if (t.kind !== 'table' && t.kind !== 'matrix') continue
    for (let gap = 0; gap <= PARAM_GAP; gap++) {
      for (const kv of kvByBottom.get(t.range.r0 - 1 - gap) ?? []) {
        if (kv.range.c1 < t.range.c0 || kv.range.c0 > t.range.c1) continue
        for (const p of kv.params)
          if (!t.params.some((q) => q.key === p.key)) t.params.push({ ...p, source: 'above' })
      }
    }
  }
}

/** The block's first row holds names (a header of its own). */
function startsWithNames(b: DetectedBlock): boolean {
  const named = b.header.filter((h) => h !== '')
  return named.length > 0 && named.every((h) => classify(h, undefined) === TEXT)
}

/**
 * A block without title rows, one empty column beside a table and within the table's rows, whose first
 * row is data or lines up with the table's header row, is probably a piece of that table (an empty
 * column inside it): it gets a hint, never an automatic join.
 */
function attachJoinHints(blocks: DetectedBlock[], origin: GridOrigin): void {
  const byRight = new Map<number, DetectedBlock[]>()
  const byLeft = new Map<number, DetectedBlock[]>()
  const add = (map: Map<number, DetectedBlock[]>, key: number, b: DetectedBlock) => {
    const list = map.get(key) ?? []
    list.push(b)
    map.set(key, list)
  }
  for (const b of blocks) {
    if (b.kind !== 'table' && b.kind !== 'matrix') continue
    add(byRight, b.range.c1, b)
    add(byLeft, b.range.c0, b)
  }
  for (const f of blocks) {
    if ((f.kind !== 'table' && f.kind !== 'note') || f.titleRows > 0 || f.orientation !== 'columns') continue
    if (f.range.r1 === f.range.r0) continue // a single line beside a table is a caption, not a column
    const near = [...(byRight.get(f.range.c0 - 2) ?? []), ...(byLeft.get(f.range.c1 + 2) ?? [])]
    for (const nb of near) {
      if (f.range.r0 < nb.range.r0 || f.range.r1 > nb.range.r1) continue
      const ownHeader = f.kind === 'note' || startsWithNames(f)
      if (ownHeader && f.range.r0 !== nb.range.r0 + nb.titleRows) continue
      const range = {
        r0: Math.min(f.range.r0, nb.range.r0),
        c0: Math.min(f.range.c0, nb.range.c0),
        r1: Math.max(f.range.r1, nb.range.r1),
        c1: Math.max(f.range.c1, nb.range.c1),
      }
      f.hints.push({ type: 'join', with: nb.id, range, a1: formatA1(toSheetRange(range, origin)) })
    }
  }
}
