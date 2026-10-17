import { describe, expect, it } from 'vitest'
import { NATIVE } from '@/domain/model'
import { parseA1Range, toGridRange } from './a1'
import { cropRegion } from './region'
import type { NativeColumn, WorkbookGrid } from './spreadsheet'

const N = NATIVE

/** A read sheet whose used range starts at B3 (origin row 2, column 1). */
function sheet(): Pick<WorkbookGrid, 'grid' | 'native' | 'sourceRow' | 'origin' | 'merges' | 'formulaCells'> {
  const grid = [
    ['layers', '0', '', ''],
    ['duty', '25%', '50%', '75%'],
    ['input', '6', '', '18'],
    ['loss', '1.5', '7.25', '21.5'],
  ]
  const native: NativeColumn[] = [0, 1, 2, 3].map((c) => ({
    kind: Uint8Array.from(
      grid.map((row, r) => (row[c] === '' ? N.empty : c === 0 || r === 0 ? N.text : N.number)),
    ),
    num: Float64Array.from(
      grid.map((row, r) =>
        c > 0 && r > 0 && row[c] !== '' ? parseFloat(row[c]!) / (r === 1 ? 100 : 1) : NaN,
      ),
    ),
  }))
  return {
    grid,
    native,
    sourceRow: Int32Array.from([3, 4, 5, 6]),
    origin: { row: 2, col: 1 },
    merges: [{ r0: 2, c0: 1, r1: 2, c1: 2 }], // C5:D5, the anchor holds 6
    formulaCells: [{ row: 2, col: 2 }],
  }
}
const at = (a1: string) => toGridRange(parseA1Range(a1)!, { row: 2, col: 1 })

describe('cropRegion', () => {
  it('columns: the block as it is, with sheet rows, merges and formula cells relative to it', () => {
    const r = cropRegion(sheet(), at('B4:E6'), 'columns')!
    expect(r.a1).toBe('B4:E6')
    expect(r.transposed).toBe(false)
    expect(r.rows).toEqual([
      ['duty', '25%', '50%', '75%'],
      ['input', '6', '', '18'],
      ['loss', '1.5', '7.25', '21.5'],
    ])
    expect(Array.from(r.sourceRow)).toEqual([4, 5, 6])
    expect(Array.from(r.native[1]!.kind)).toEqual([N.number, N.number, N.number])
    expect(Array.from(r.native[1]!.num)).toEqual([0.25, 6, 1.5])
    expect(r.merges).toEqual([{ r0: 1, c0: 1, r1: 1, c1: 2 }])
    expect(r.formulaCells).toEqual([{ row: 1, col: 2 }])
  })

  it('rows: transposed together (text, native kinds, merges); sourceRow = the sheet column', () => {
    const r = cropRegion(sheet(), at('B4:E6'), 'rows')!
    expect(r.transposed).toBe(true)
    expect(r.rows).toEqual([
      ['duty', 'input', 'loss'],
      ['25%', '6', '1.5'],
      ['50%', '', '7.25'],
      ['75%', '18', '21.5'],
    ])
    // B = 2, C = 3, D = 4, E = 5: each record is labelled with its sheet column.
    expect(Array.from(r.sourceRow)).toEqual([2, 3, 4, 5])
    expect(Array.from(r.native[0]!.kind)).toEqual([N.text, N.number, N.number, N.number])
    expect(Array.from(r.native[0]!.num.slice(1))).toEqual([0.25, 0.5, 0.75])
    expect(r.native[1]!.kind[2]).toBe(N.empty)
    expect(Number.isNaN(r.native[1]!.num[2])).toBe(true)
    // The horizontal merge C5:D5 becomes vertical in the transposed block.
    expect(r.merges).toEqual([{ r0: 1, c0: 1, r1: 2, c1: 1 }])
    expect(r.formulaCells).toEqual([{ row: 2, col: 1 }])
  })

  it('clips to the grid: merges crossing the edge are cut, a range outside gives null', () => {
    const r = cropRegion(sheet(), at('A1:C5'), 'columns')!
    expect(r.a1).toBe('B3:C5')
    expect(r.range).toEqual({ r0: 0, c0: 0, r1: 2, c1: 1 })
    expect(r.rows).toEqual([
      ['layers', '0'],
      ['duty', '25%'],
      ['input', '6'],
    ])
    expect(r.merges).toEqual([{ r0: 2, c0: 1, r1: 2, c1: 1 }])
    expect(r.formulaCells).toEqual([])
    expect(cropRegion(sheet(), at('H10:J12'), 'columns')).toBeNull()
  })
})
