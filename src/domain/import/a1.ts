/**
 * A1 references and cell rectangles. A GridRange is 0-based and inclusive on both ends; whether it is in
 * sheet coordinates (A1 = row 0, column 0) or relative to a read grid (WorkbookGrid.grid) is stated where
 * it is used. toSheetRange / toGridRange convert with the grid origin.
 */
export interface GridRange {
  r0: number
  c0: number
  r1: number
  c1: number
}

export interface GridOrigin {
  /** 0-based sheet row and column of grid[0][0]. */
  row: number
  col: number
}

/** Excel's sheet size: columns A…XFD, rows 1…1 048 576. */
const MAX_COLS = 16_384
const MAX_ROWS = 1_048_576

/** 0 → "A", 25 → "Z", 26 → "AA", 16383 → "XFD". */
export function colLetter(col: number): string {
  if (!Number.isInteger(col) || col < 0) throw new RangeError(`colLetter: invalid column ${col}`)
  let s = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** "A" → 0, "xfd" → 16383; -1 when the text is not a column name. */
export function colIndex(letters: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) return -1
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1 < MAX_COLS ? n - 1 : -1
}

const CELL_REF = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/

function parseCell(ref: string): { row: number; col: number } | null {
  const m = CELL_REF.exec(ref)
  if (!m) return null
  const col = colIndex(m[1]!)
  const row = Number(m[2]) - 1
  if (col < 0 || row < 0 || row >= MAX_ROWS) return null
  return { row, col }
}

/**
 * "B2:E9", "b2", "$B$2:$E$9" or "E9:B2" (corners in any order) → sheet range; null for anything else
 * (sheet prefixes, whole rows or columns, references outside the sheet).
 */
export function parseA1Range(text: string): GridRange | null {
  const parts = text.trim().split(':')
  if (parts.length > 2) return null
  const a = parseCell(parts[0]!.trim())
  const b = parts.length === 2 ? parseCell(parts[1]!.trim()) : a
  if (!a || !b) return null
  return {
    r0: Math.min(a.row, b.row),
    c0: Math.min(a.col, b.col),
    r1: Math.max(a.row, b.row),
    c1: Math.max(a.col, b.col),
  }
}

/** Sheet range → "B2:E9" ("B2" for a single cell). */
export function formatA1(range: GridRange): string {
  const a = `${colLetter(range.c0)}${range.r0 + 1}`
  if (range.r0 === range.r1 && range.c0 === range.c1) return a
  return `${a}:${colLetter(range.c1)}${range.r1 + 1}`
}

export function toSheetRange(range: GridRange, origin: GridOrigin): GridRange {
  return {
    r0: range.r0 + origin.row,
    c0: range.c0 + origin.col,
    r1: range.r1 + origin.row,
    c1: range.c1 + origin.col,
  }
}

export function toGridRange(range: GridRange, origin: GridOrigin): GridRange {
  return {
    r0: range.r0 - origin.row,
    c0: range.c0 - origin.col,
    r1: range.r1 - origin.row,
    c1: range.c1 - origin.col,
  }
}

/** The part of `range` inside a rows × cols grid; null when they do not overlap. */
export function clipRange(range: GridRange, rows: number, cols: number): GridRange | null {
  const r0 = Math.max(range.r0, 0)
  const c0 = Math.max(range.c0, 0)
  const r1 = Math.min(range.r1, rows - 1)
  const c1 = Math.min(range.c1, cols - 1)
  return r0 > r1 || c0 > c1 ? null : { r0, c0, r1, c1 }
}

export const sameRange = (a: GridRange, b: GridRange): boolean =>
  a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1
