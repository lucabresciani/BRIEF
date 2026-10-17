/**
 * Where a record of a dataset sits in its source, for the hover, the caption and the CSV export: a row
 * of the file or sheet, or a sheet column for a block transposed on import (DatasetView.recordAxis).
 * Data only, no wording: callers say "Row 12" or "Column D" in the language of the UI. In a dataset
 * stacked from several tables the same row number occurs once per table, so the table is named too
 * (recordBlocks, blockOf: "plank 2 · row 5").
 */
import { colLetter } from '@/domain/import/a1'
import type { RawRegion } from '@/domain/model'
import type { DatasetView, RecordAxis } from './types'

export interface RecordPosition {
  axis: RecordAxis
  /** 1-based row number, or 1-based sheet column number (A = 1). */
  index: number
  /** What is printed: the row number ("12") or the column letters ("D"). */
  text: string
}

type PositionView = Pick<DatasetView, 'recordAxis' | 'sourceRow' | 'rowIndex'>

/** Spreadsheet letters of a 1-based column number: 1 → "A", 26 → "Z", 27 → "AA"; "" when not a positive integer. */
export const columnLetters = (n: number): string => (Number.isInteger(n) && n >= 1 ? colLetter(n - 1) : '')

/** Position of the record at index `i` of the view. */
export function recordPosition(view: PositionView, i: number): RecordPosition {
  const index = view.sourceRow[i] ?? NaN
  return view.recordAxis === 'column'
    ? { axis: 'column', index, text: columnLetters(index) }
    : { axis: 'row', index, text: String(index) }
}

/** Position of a RowId; null when the row is not in the view. */
export function recordPositionOf(view: PositionView, rowId: number): RecordPosition | null {
  const i = view.rowIndex.get(rowId)
  return i === undefined ? null : recordPosition(view, i)
}

/** One of the tables a stacked dataset was made of, with the label its records are shown with. */
export interface RecordBlock {
  label: string
  /** Its rows in the raw table (RowIds firstRow … firstRow + rowCount − 1). */
  firstRow: number
  rowCount: number
}

/**
 * The tables of a stacked import (RawSource.region), in raw-table order: their title, else their A1
 * range; a title shared by several tables gets its range ("oak (B2:E9)"). [] for a single table, whose
 * row or column alone is unambiguous.
 */
export function recordBlocks(region: RawRegion | null | undefined): RecordBlock[] {
  if (!region || region.blocks.length < 2) return []
  const labels = region.blocks.map((b) => b.label?.trim() || b.range)
  const count = new Map<string, number>()
  for (const l of labels) count.set(l, (count.get(l) ?? 0) + 1)
  return region.blocks.map((b, k) => ({
    label: count.get(labels[k]!)! > 1 && labels[k] !== b.range ? `${labels[k]} (${b.range})` : labels[k]!,
    firstRow: b.firstRow,
    rowCount: b.rowCount,
  }))
}

/** The label of the table holding a RowId (blocks in raw-table order); null when none does. */
export function blockOf(blocks: readonly RecordBlock[], rowId: number): string | null {
  let lo = 0
  let hi = blocks.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const b = blocks[mid]!
    if (rowId < b.firstRow) hi = mid - 1
    else if (rowId >= b.firstRow + b.rowCount) lo = mid + 1
    else return b.label
  }
  return null
}
