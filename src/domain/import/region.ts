import { NATIVE } from '@/domain/model'
import { clipRange, formatA1, toSheetRange, type GridRange } from './a1'
import type { NativeColumn, WorkbookGrid } from './spreadsheet'

/**
 * One block cut out of a sheet grid, ready for the import pipeline. A block with its variables
 * in rows ('rows', the transposed case: "duty | 25 % | 50 %…") is transposed so that every block reaches
 * buildDraft as columns of variables: text, native kinds and merges are swapped together, and sourceRow
 * then holds the 1-based SHEET COLUMN of each record (D → 4) instead of its sheet row.
 */
export interface RegionGrid {
  rows: string[][]
  native: NativeColumn[]
  /** Per row of `rows`: the 1-based sheet row ('columns') or sheet column ('rows') it came from. */
  sourceRow: Int32Array
  /** Merged areas relative to `rows` (transposed with it). */
  merges: GridRange[]
  /** Cells of `rows` holding a formula without a saved result. */
  formulaCells: { row: number; col: number }[]
  /** The cropped range in grid coordinates (clipped to the grid) and as a sheet A1 reference. */
  range: GridRange
  a1: string
  transposed: boolean
}

export type RegionOrientation = 'columns' | 'rows'

const emptyNative = (n: number): NativeColumn => {
  const num = new Float64Array(n)
  num.fill(NaN)
  return { kind: new Uint8Array(n), num }
}

/**
 * Crops `range` (grid coordinates, clipped to the grid) out of a read sheet; null when the range lies
 * outside it. Merges that cross the edge are clipped (an anchor left outside leaves an empty area).
 */
export function cropRegion(
  wb: Pick<WorkbookGrid, 'grid' | 'native' | 'sourceRow' | 'origin' | 'merges' | 'formulaCells'>,
  range: GridRange,
  orientation: RegionOrientation,
): RegionGrid | null {
  const width = wb.grid[0]?.length ?? 0
  const clipped = clipRange(range, wb.grid.length, width)
  if (!clipped) return null
  const { r0, c0, r1, c1 } = clipped
  const h = r1 - r0 + 1
  const w = c1 - c0 + 1
  const a1 = formatA1(toSheetRange(clipped, wb.origin))
  const transposed = orientation === 'rows'
  const nRows = transposed ? w : h
  const nCols = transposed ? h : w
  const rows: string[][] = Array.from({ length: nRows }, () => new Array<string>(nCols).fill(''))
  const native = Array.from({ length: nCols }, () => emptyNative(nRows))
  for (let i = 0; i < h; i++) {
    const src = wb.grid[r0 + i]!
    for (let j = 0; j < w; j++) {
      const [ti, tj] = transposed ? [j, i] : [i, j]
      rows[ti]![tj] = src[c0 + j] ?? ''
      const col = wb.native[c0 + j]
      native[tj]!.kind[ti] = col ? col.kind[r0 + i]! : NATIVE.empty
      native[tj]!.num[ti] = col ? col.num[r0 + i]! : NaN
    }
  }
  const sourceRow = new Int32Array(nRows)
  for (let i = 0; i < nRows; i++) {
    sourceRow[i] = transposed ? wb.origin.col + c0 + i + 1 : wb.sourceRow[r0 + i]!
  }
  const merges: GridRange[] = []
  for (const m of wb.merges) {
    const part = clipRange({ r0: m.r0 - r0, c0: m.c0 - c0, r1: m.r1 - r0, c1: m.c1 - c0 }, h, w)
    if (part) merges.push(transposed ? { r0: part.c0, c0: part.r0, r1: part.c1, c1: part.r1 } : part)
  }
  const formulaCells: { row: number; col: number }[] = []
  for (const f of wb.formulaCells) {
    if (f.row < r0 || f.row > r1 || f.col < c0 || f.col > c1) continue
    const [i, j] = [f.row - r0, f.col - c0]
    formulaCells.push(transposed ? { row: j, col: i } : { row: i, col: j })
  }
  return { rows, native, sourceRow, merges, formulaCells, range: clipped, a1, transposed }
}
