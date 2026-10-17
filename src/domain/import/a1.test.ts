import { describe, expect, it } from 'vitest'
import {
  clipRange,
  colIndex,
  colLetter,
  formatA1,
  parseA1Range,
  sameRange,
  toGridRange,
  toSheetRange,
} from './a1'

describe('A1 references', () => {
  it('column letters both ways, up to XFD', () => {
    const pairs: [number, string][] = [
      [0, 'A'],
      [25, 'Z'],
      [26, 'AA'],
      [51, 'AZ'],
      [52, 'BA'],
      [701, 'ZZ'],
      [702, 'AAA'],
      [16383, 'XFD'],
    ]
    for (const [n, s] of pairs) {
      expect(colLetter(n)).toBe(s)
      expect(colIndex(s)).toBe(n)
      expect(colIndex(s.toLowerCase())).toBe(n)
    }
    expect(colIndex('XFE')).toBe(-1)
    expect(colIndex('A1')).toBe(-1)
    expect(colIndex('')).toBe(-1)
    expect(() => colLetter(-1)).toThrow()
    expect(() => colLetter(1.5)).toThrow()
  })

  it('parses ranges, single cells, absolute references and reversed corners', () => {
    expect(parseA1Range('B2:E9')).toEqual({ r0: 1, c0: 1, r1: 8, c1: 4 })
    expect(parseA1Range(' b2 : e9 ')).toEqual({ r0: 1, c0: 1, r1: 8, c1: 4 })
    expect(parseA1Range('$B$2:$E$9')).toEqual({ r0: 1, c0: 1, r1: 8, c1: 4 })
    expect(parseA1Range('E9:B2')).toEqual({ r0: 1, c0: 1, r1: 8, c1: 4 })
    expect(parseA1Range('C7')).toEqual({ r0: 6, c0: 2, r1: 6, c1: 2 })
    expect(parseA1Range('XFD1048576')).toEqual({ r0: 1048575, c0: 16383, r1: 1048575, c1: 16383 })
  })

  it('refuses what is not a cell range of a sheet', () => {
    for (const bad of [
      '',
      'B',
      '2',
      'B0',
      'A1:B2:C3',
      'Sheet1!A1',
      'B:E',
      '2:9',
      'XFE1',
      'A1048577',
      'A-1',
      '1A',
    ])
      expect(parseA1Range(bad), bad).toBeNull()
  })

  it('formats ranges and round-trips', () => {
    expect(formatA1({ r0: 1, c0: 1, r1: 8, c1: 4 })).toBe('B2:E9')
    expect(formatA1({ r0: 6, c0: 2, r1: 6, c1: 2 })).toBe('C7')
    for (const a1 of ['A1:XFD3', 'AA10:AB12', 'Z9']) expect(formatA1(parseA1Range(a1)!)).toBe(a1)
  })

  it('converts between sheet and grid coordinates with the origin, and clips to a grid', () => {
    const origin = { row: 2, col: 1 } // the used range starts at B3
    const sheet = parseA1Range('C4:D5')!
    const grid = toGridRange(sheet, origin)
    expect(grid).toEqual({ r0: 1, c0: 1, r1: 2, c1: 2 })
    expect(sameRange(toSheetRange(grid, origin), sheet)).toBe(true)
    expect(clipRange({ r0: -2, c0: 1, r1: 10, c1: 3 }, 5, 3)).toEqual({ r0: 0, c0: 1, r1: 4, c1: 2 })
    expect(clipRange({ r0: 6, c0: 0, r1: 8, c1: 1 }, 5, 3)).toBeNull()
  })
})
