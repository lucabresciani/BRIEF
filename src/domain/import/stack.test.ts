import { describe, expect, it } from 'vitest'
import { NATIVE } from '@/domain/model'
import type { BlockParam } from './blocks'
import { detectLayout } from './layout'
import type { NativeColumn } from './spreadsheet'
import {
  labelCandidates,
  labelCells,
  stackRegions,
  structureSignature,
  type LabelBlock,
  type StackPart,
} from './stack'

const param = (key: string, text: string, value: number | null): BlockParam => ({
  key,
  text,
  value,
  source: 'title',
})
const block = (titleCells: string[], params: BlockParam[] = [], a1 = 'A1:B2'): LabelBlock => ({
  titleCells,
  params,
  a1,
})

describe('structureSignature', () => {
  it('same variables in the same order, whatever the case and spacing', () => {
    const a = structureSignature({
      orientation: 'columns',
      header: ['position', 'Width mm', 'Depth mm', 'area'],
    })
    const b = structureSignature({
      orientation: 'columns',
      header: ['position ', 'Width  mm', 'depth mm', 'Area'],
    })
    expect(a).toBe(b)
    expect(
      structureSignature({ orientation: 'columns', header: ['position', 'Width mm', 'Depth mm', ''] }),
    ).not.toBe(a)
    expect(
      structureSignature({ orientation: 'columns', header: ['position', 'Width mm', 'Depth mm'] }),
    ).not.toBe(a)
    expect(
      structureSignature({ orientation: 'rows', header: ['position', 'Width mm', 'Depth mm', 'area'] }),
    ).not.toBe(a)
  })
})

describe('labelCandidates', () => {
  it('a title cell "<prefix> <number>" becomes a numeric column named after the prefix', () => {
    const blocks = [
      block(['oak', 'plank 1']),
      block(['oak', 'plank 2']),
      block(['pine', 'plank 1']),
      block(['pine', 'plank 10']),
    ]
    expect(labelCandidates(blocks)).toEqual([
      {
        source: { type: 'titleCell', index: 0 },
        name: 'Title 1',
        kind: 'text',
        values: ['oak', 'oak', 'pine', 'pine'],
        suggested: true,
      },
      {
        source: { type: 'titleCell', index: 1 },
        name: 'plank',
        kind: 'number',
        values: ['1', '2', '1', '10'],
        suggested: true,
      },
      {
        source: { type: 'blockName' },
        name: 'Block',
        kind: 'text',
        values: ['oak plank 1', 'oak plank 2', 'pine plank 1', 'pine plank 10'],
        suggested: false,
      },
    ])
  })

  it('a unit after the number goes into the name; mixed prefixes stay text', () => {
    const withUnit = labelCandidates([block(['v = 2 m/s']), block(['v = 4 m/s'])])
    expect(withUnit[0]).toMatchObject({ name: 'v (m/s)', kind: 'number', values: ['2', '4'] })
    const mixed = labelCandidates([block(['run 1']), block(['test 2'])])
    expect(mixed[0]).toMatchObject({ name: 'Title', kind: 'text', values: ['run 1', 'test 2'] })
  })

  it('dates, times and ranges in titles stay text: their last digits are not a value', () => {
    for (const titles of [
      ['2024-03-15', '2024-03-16'],
      ['15.03.2024', '15.04.2024'],
      ['10:30', '10:45'],
      ['Run 1-2', 'Run 1-3'],
    ]) {
      const [first] = labelCandidates(titles.map((t) => block([t])))
      expect(first).toMatchObject({ name: 'Title', kind: 'text', values: titles })
    }
    expect(labelCandidates([block(['v1.2']), block(['v1.3'])])[0]).toMatchObject({
      name: 'v',
      kind: 'number',
      values: ['1.2', '1.3'],
    })
  })

  it('parameters that vary are candidates; constant ones and constant titles are not', () => {
    const blocks = [0, 2, 4].map((v) =>
      block(['Run'], [param('layers', String(v), v), param('Fluid density (kg/m3)', '998.2', 998.2)]),
    )
    const c = labelCandidates(blocks)
    expect(c.map((x) => [x.source, x.name, x.kind, x.values, x.suggested])).toEqual([
      [{ type: 'param', key: 'layers' }, 'layers', 'number', ['0', '2', '4'], true],
      [{ type: 'blockName' }, 'Block', 'text', ['Run · A1:B2', 'Run · A1:B2', 'Run · A1:B2'], false],
    ])
  })

  it('a title cell left blank in one block leaves that column empty there; the others keep their place', () => {
    const at = (cells: [string, number][]): LabelBlock => ({
      ...block(cells.map(([t]) => t)),
      titlePos: cells.map(([, col]) => ({ row: 0, col })),
    })
    const blocks = [
      at([
        ['oak', 0],
        ['run 1', 1],
      ]),
      at([['run 2', 1]]),
      at([
        ['oak', 0],
        ['run 3', 1],
      ]),
    ]
    const c = labelCandidates(blocks)
    expect(c.map((x) => [x.name, x.kind, x.values])).toEqual([
      ['Title 1', 'text', ['oak', '', 'oak']],
      ['run', 'number', ['1', '2', '3']],
      ['Block', 'text', ['oak run 1', 'run 2', 'oak run 3']],
    ])
    expect(
      labelCells(blocks, { source: { type: 'titleCell', index: 1 }, name: 'run', kind: 'auto' }),
    ).toEqual({
      kind: 'number',
      cells: [
        { text: '1', value: 1 },
        { text: '2', value: 2 },
        { text: '3', value: 3 },
      ],
    })
  })

  it('falls back to the block name (title, else the A1 range), suggested when nothing else varies', () => {
    const c = labelCandidates([block([], [], 'B2:E9'), block([], [], 'G2:J9')])
    expect(c).toEqual([
      {
        source: { type: 'blockName' },
        name: 'Block',
        kind: 'text',
        values: ['B2:E9', 'G2:J9'],
        suggested: true,
      },
    ])
    expect(labelCandidates([])).toEqual([])
  })
})

describe('labelCells', () => {
  const blocks = [block(['plank 1'], [param('T', '20', 20)]), block(['plank 2'], [])]
  it('numbers keep their value; a block without the parameter gets an empty cell, never 0', () => {
    expect(labelCells(blocks, { source: { type: 'titleCell', index: 0 }, name: 'R', kind: 'auto' })).toEqual({
      kind: 'number',
      cells: [
        { text: '1', value: 1 },
        { text: '2', value: 2 },
      ],
    })
    expect(labelCells(blocks, { source: { type: 'param', key: 'T' }, name: 'T', kind: 'auto' })).toEqual({
      kind: 'text',
      cells: [
        { text: '20', value: null },
        { text: '', value: null },
      ],
    })
    expect(
      labelCells(blocks, { source: { type: 'param', key: 'T' }, name: 'T', kind: 'number' }).cells,
    ).toEqual([
      { text: '20', value: 20 },
      { text: '', value: null },
    ])
  })
  it('an explicit kind wins: text keeps the title, number keeps an unreadable title as text', () => {
    expect(
      labelCells(blocks, { source: { type: 'titleCell', index: 0 }, name: 'R', kind: 'text' }).cells,
    ).toEqual([
      { text: 'plank 1', value: null },
      { text: 'plank 2', value: null },
    ])
    const odd = [block(['plank 1']), block(['oak'])]
    expect(
      labelCells(odd, { source: { type: 'titleCell', index: 0 }, name: 'R', kind: 'number' }).cells,
    ).toEqual([
      { text: '1', value: 1 },
      { text: 'oak', value: null },
    ])
  })
})

describe('stackRegions', () => {
  function part(rows: string[][], firstSheetRow: number, a1: string): StackPart {
    const native: NativeColumn[] = rows[0]!.map((_, c) => ({
      kind: Uint8Array.from(
        rows.map((r) => (r[c] === '' ? NATIVE.empty : /^-?\d/.test(r[c]!) ? NATIVE.number : NATIVE.text)),
      ),
      num: Float64Array.from(rows.map((r) => (/^-?\d/.test(r[c] ?? '') ? Number(r[c]) : NaN))),
    }))
    return {
      rows,
      native,
      sourceRow: Int32Array.from(rows.map((_, i) => firstSheetRow + i)),
      layout: detectLayout(rows),
      a1,
      label: a1,
    }
  }

  it('one grid: label columns, the union of the columns by name, every data row with its sheet row', () => {
    const a = part(
      [
        ['oak | plank 1', '', ''],
        ['position', 'Width (mm)', 'area'],
        ['5', '48', '960'],
        ['10', '46', '1012'],
      ],
      2,
      'B2:D5',
    )
    a.layout = detectLayout(a.rows, { headerRow: 1 })
    const b = part(
      [
        ['Position ', 'width (mm)'],
        ['5', '47.5'],
        ['10', ''],
      ],
      11,
      'B11:C13',
    )
    const s = stackRegions(
      [a, b],
      [
        {
          name: 'plank',
          kind: 'number',
          cells: [
            { text: '1', value: 1 },
            { text: '2', value: 2 },
          ],
        },
      ],
      'columns',
    )
    expect(s.rows).toEqual([
      ['plank', 'position', 'Width (mm)', 'area'],
      ['1', '5', '48', '960'],
      ['1', '10', '46', '1012'],
      ['2', '5', '47.5', ''],
      ['2', '10', '', ''],
    ])
    expect(Array.from(s.sourceRow)).toEqual([3, 4, 5, 12, 13])
    expect([s.headerRow, s.unitsRow, s.dataStartRow]).toEqual([0, null, 1])
    // Label cells are numbers; copied cells keep their native kind; a missing column is empty, never 0.
    expect(Array.from(s.native[0]!.kind)).toEqual([
      NATIVE.text,
      NATIVE.number,
      NATIVE.number,
      NATIVE.number,
      NATIVE.number,
    ])
    expect(Array.from(s.native[0]!.num.slice(1))).toEqual([1, 1, 2, 2])
    expect(s.native[3]!.kind[3]).toBe(NATIVE.empty)
    expect(Number.isNaN(s.native[3]!.num[3])).toBe(true)
    expect(s.region).toEqual({
      orientation: 'columns',
      blocks: [
        { range: 'B2:D5', label: 'B2:D5', firstRow: 1, rowCount: 2 },
        { range: 'B11:C13', label: 'B11:C13', firstRow: 3, rowCount: 2 },
      ],
      labelColumns: [0],
    })
    // Rows of each block in the stacked grid (title and later headers are not in it).
    expect(Array.from(s.rowMap[0]!)).toEqual([-1, 0, 1, 2])
    expect(Array.from(s.rowMap[1]!)).toEqual([-1, 3, 4])
  })

  it('keeps a units row when a block has one', () => {
    const a = part(
      [
        ['t', 'V'],
        ['s', 'mV'],
        ['0', '1.2'],
      ],
      1,
      'A1:B3',
    )
    expect(a.layout.layout.unitsRow).toBe(1)
    const s = stackRegions(
      [
        a,
        part(
          [
            ['t', 'V'],
            ['s', 'mV'],
            ['1', '2.5'],
          ],
          5,
          'A5:B7',
        ),
      ],
      [],
      'columns',
    )
    expect(s.rows).toEqual([
      ['t', 'V'],
      ['s', 'mV'],
      ['0', '1.2'],
      ['1', '2.5'],
    ])
    expect([s.unitsRow, s.dataStartRow]).toEqual([1, 2])
    expect(Array.from(s.sourceRow)).toEqual([1, 2, 3, 7])
    expect(s.region.labelColumns).toEqual([])
  })
})
