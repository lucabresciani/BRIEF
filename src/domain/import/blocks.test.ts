import { describe, expect, it } from 'vitest'
import { NATIVE } from '@/domain/model'
import { parseA1Range, type GridRange } from './a1'
import { analyseSheet, blockTitle, detectBlocks, MAX_BLOCKS, MAX_NOTE_CHARS, MAX_NOTE_LINES } from './blocks'
import type { NativeColumn } from './spreadsheet'

/** Rows written as "a|b|c"; '' is an empty cell. */
const grid = (...rows: string[]) => rows.map((r) => r.split('|'))
const merges = (...a1: string[]): GridRange[] => a1.map((r) => parseA1Range(r)!)

/** Two bands of two titled tables, from B2, one empty row/column apart; headers typed with stray spaces. */
function titledGrid(): string[][] {
  const rows: string[][] = []
  const positions = [5, 10, 15, 20, 25, 30]
  for (let band = 0; band < 2; band++) {
    const left = band === 0 ? 'oak' : 'pine'
    rows.push(['', left, `plank ${band * 2 + 1}`, '', '', '', left, `plank ${band * 2 + 2}`, '', ''])
    rows.push([
      '',
      'position',
      'Width mm',
      'Depth mm',
      'area',
      '',
      'position ',
      'Width  mm',
      'Depth mm',
      'Area',
    ])
    for (const x of positions) {
      const [w, d] = [50 - x / 5, 20 + x / 5]
      rows.push(['', `${x}`, `${w}`, `${d}`, `${w * d}`, '', `${x}`, '42.5', '24', '1020'])
    }
    if (band === 0) rows.push([])
  }
  return rows
}

describe('detectBlocks — layouts common in lab workbooks', () => {
  it('a grid of titled tables: one block each, in reading order, with title cells and header', () => {
    const d = detectBlocks(titledGrid(), { origin: { row: 1, col: 0 } })
    expect(d.blocks.map((b) => [b.id, b.kind, b.a1])).toEqual([
      ['b1', 'table', 'B2:E9'],
      ['b2', 'table', 'G2:J9'],
      ['b3', 'table', 'B11:E18'],
      ['b4', 'table', 'G11:J18'],
    ])
    expect(d.tables).toBe(4)
    expect(d.overflow).toBe(0)
    const [b1, b2] = d.blocks
    expect(b1!.titleRows).toBe(1)
    expect(b1!.titleCells).toEqual(['oak', 'plank 1'])
    expect(b2!.titleCells).toEqual(['oak', 'plank 2'])
    expect(b1!.header).toEqual(['position', 'Width mm', 'Depth mm', 'area'])
    expect(b2!.header).toEqual(['position', 'Width  mm', 'Depth mm', 'Area'])
    expect(b1!.range).toEqual({ r0: 0, c0: 1, r1: 7, c1: 4 }) // grid coordinates
    expect(b1).toMatchObject({ orientation: 'columns', orientationConfidence: 'high', params: [], hints: [] })
    expect(b1).toMatchObject({ cells: 2 + 4 + 24, numbers: 24 })
  })

  it('transposed tables stacked vertically: variables in rows, "layers | n" as a parameter', () => {
    const g = grid(
      'layers|0',
      'duty|25%|50%|75%|100%',
      'input|5|10|15|20',
      'loss|2.5|14.5|34.5|62.5|drift +0.4',
      '',
      'layers|2',
      'duty|25%|50%|75%|100%',
      'input|5|10|15|20',
      'loss|1|11.5|29|53.5',
      '',
      'layers|4',
      'duty|25%|50%|75%|100%',
      'input|5|10|15|20',
      'loss|-0.5|8.5|23.5|44.5',
    )
    const d = detectBlocks(g, { origin: { row: 1, col: 1 } })
    expect(d.blocks.map((b) => [b.kind, b.a1, b.orientation, b.orientationConfidence])).toEqual([
      ['table', 'B2:F5', 'rows', 'high'],
      ['table', 'B7:F10', 'rows', 'high'],
      ['table', 'B12:F15', 'rows', 'high'],
    ])
    expect(d.blocks.map((b) => b.params)).toEqual(
      [0, 2, 4].map((v) => [{ key: 'layers', text: String(v), value: v, source: 'title' }]),
    )
    expect(d.blocks[0]!.titleCells).toEqual([])
    expect(d.blocks[0]!.header).toEqual(['duty', 'input', 'loss'])
    // The remark typed after the last value is a note, outside the block's range.
    expect(d.blocks[0]!.notes).toEqual(['drift +0.4'])
    expect(d.blocks[1]!.notes).toEqual([])
  })

  it('key/value lines with merged cells over two side-by-side tables, a quantity merged over C:D', () => {
    const half = (tilt: string) => [
      ['Tilt', '', '', tilt, '', ''],
      ['Fluid density (kg/m3)', '', '', '998.2', '', ''],
      ['Probe', 'h [mm]', 'h - h0 [mm]', '', 'dp [Pa]', 'p [Pa]'],
      ['in', '182', '32', '', '313.3', '101638.3'],
      ['1', '158', '8', '', '78.3', '101403.3'],
      ['ref', '150', '0', '', '0', '101325'],
    ]
    const left = half('-5')
    const right = half('0')
    const g = left.map((row, i) => [...row, '', ...right[i]!])
    const kv = ['A1:C1', 'D1:F1', 'A2:C2', 'D2:F2', 'H1:J1', 'K1:M1', 'H2:J2', 'K2:M2']
    const cd = [3, 4, 5, 6].flatMap((r) => [`C${r}:D${r}`, `J${r}:K${r}`])
    const d = detectBlocks(g, { merges: merges(...kv, ...cd) })
    expect(d.blocks.map((b) => [b.kind, b.a1, b.titleRows])).toEqual([
      ['table', 'A1:F6', 2],
      ['table', 'H1:M6', 2],
    ])
    expect(d.blocks[0]!.params.map((p) => [p.key, p.value])).toEqual([
      ['Tilt', -5],
      ['Fluid density (kg/m3)', 998.2],
    ])
    expect(d.blocks[1]!.params[0]).toMatchObject({ key: 'Tilt', value: 0 })
    expect(d.blocks[0]!.header).toEqual(['Probe', 'h [mm]', 'h - h0 [mm]', '', 'dp [Pa]', 'p [Pa]'])
    // Covered cells are occupied but are not cells of their own.
    expect(d.blocks[0]!.cells).toBe(4 + 5 + 3 * 5)

    // The same table read without its merges: column D splits it; the piece gets a hint only.
    const loose = detectBlocks(left)
    expect(loose.blocks.map((b) => [b.kind, b.a1])).toEqual([
      ['table', 'A1:C6'],
      ['note', 'D1:D2'],
      ['table', 'E3:F6'],
    ])
    const piece = loose.blocks.find((b) => b.a1 === 'E3:F6')!
    expect(piece.kind).toBe('table')
    expect(piece.hints).toEqual([
      {
        type: 'join',
        with: loose.blocks.find((b) => b.a1 === 'A1:C6')!.id,
        range: parseA1Range('A1:F6'),
        a1: 'A1:F6',
      },
    ])
    expect(loose.blocks.find((b) => b.a1 === 'A1:C6')!.hints).toEqual([])
  })

  it('key/value blocks at most 3 rows above a table give it parameters; farther ones do not', () => {
    const table = ['Point|x (m)|v (m/s)', '1|0.01|0.42', '2|0.03|1.25']
    const near = detectBlocks(grid('Rate|1200', 'Pressure|101.3', '', '', ...table))
    expect(near.blocks.map((b) => [b.kind, b.a1])).toEqual([
      ['keyValue', 'A1:B2'],
      ['table', 'A5:C7'],
    ])
    expect(near.blocks[0]!.params.map((p) => [p.key, p.value, p.source])).toEqual([
      ['Rate', 1200, 'title'],
      ['Pressure', 101.3, 'title'],
    ])
    expect(near.blocks[1]!.params.map((p) => [p.key, p.value, p.source])).toEqual([
      ['Rate', 1200, 'above'],
      ['Pressure', 101.3, 'above'],
    ])
    const far = detectBlocks(grid('Rate|1200', '', '', '', '', ...table))
    expect(far.blocks[1]!.params).toEqual([])
    // "Name = value" in one cell is a parameter too; a name with a text value is not.
    const oneCell = detectBlocks(grid('T = 20 °C', '', 'x|y', '1|2', '3|4'))
    expect(oneCell.blocks[0]).toMatchObject({ kind: 'keyValue', params: [{ key: 'T', value: 20 }] })
    expect(oneCell.blocks[1]!.params).toMatchObject([{ key: 'T', value: 20, source: 'above' }])
    expect(detectBlocks(grid('Operator|MR', 'Bench|3')).blocks[0]!.kind).not.toBe('keyValue')
  })

  it('a time or a ratio in one cell is not "name: value"; a date parameter keeps its text, not its epoch', () => {
    for (const t of ['10:30', 'Measured at 10:30', 'ratio 1:2']) {
      const d = detectBlocks(grid(t, 'x|y', '1|2', '3|4'))
      expect(d.blocks[0]).toMatchObject({ titleRows: 1, titleCells: [t], params: [] })
    }
    // "Date | 15/03/2024" stored as a spreadsheet date: a key/value line whose value is text only.
    const epoch = Date.UTC(2024, 2, 15)
    const g = grid('Date|15/03/2024', 'Rate|1200', '', 'x|y', '1|2', '3|4')
    const col = (kinds: number[], nums: number[]): NativeColumn => ({
      kind: Uint8Array.from(kinds),
      num: Float64Array.from(nums),
    })
    const native = [
      col(
        [NATIVE.text, NATIVE.text, 0, NATIVE.text, NATIVE.number, NATIVE.number],
        [NaN, NaN, NaN, NaN, 1, 3],
      ),
      col(
        [NATIVE.date, NATIVE.number, 0, NATIVE.text, NATIVE.number, NATIVE.number],
        [epoch, 1200, NaN, NaN, 2, 4],
      ),
    ]
    const d = detectBlocks(g, { native })
    expect(d.blocks[0]).toMatchObject({ kind: 'keyValue', a1: 'A1:B2' })
    expect(d.blocks[1]!.params).toEqual([
      { key: 'Date', text: '15/03/2024', value: null, source: 'above' },
      { key: 'Rate', text: '1200', value: 1200, source: 'above' },
    ])
  })

  it('2-D matrices: numbers across the first row and down the first column, whatever the corner', () => {
    const named = detectBlocks(
      grid('Rod temperature (°C)||time', 'position|0|1|2', '5|77|70|64', '10|67|61|56'),
    )
    expect(named.blocks).toHaveLength(1)
    expect(named.blocks[0]).toMatchObject({
      kind: 'matrix',
      titleRows: 1,
      titleCells: ['Rod temperature (°C)', 'time'],
    })
    expect(named.tables).toBe(1)
    const dash = detectBlocks(grid('-|0|1|2', '5|1|2|3', '10|4|5|6'))
    expect(dash.blocks[0]!.kind).toBe('matrix')
    const empty = detectBlocks(grid('|0|1|2', '5|1|2|3', '10|4|5|6'))
    expect(empty.blocks[0]!.kind).toBe('matrix')
    // Numbers everywhere (no corner), or a header of names: ordinary tables.
    expect(detectBlocks(grid('1|2|3', '4|5|6', '7|8|9')).blocks[0]!.kind).toBe('table')
    expect(detectBlocks(grid('t|x|y', '0|1|2', '1|3|4')).blocks[0]!.kind).toBe('table')
  })

  it('notes: text only, at most two cells, or a single line', () => {
    const d = detectBlocks(
      grid(
        'Lab notebook',
        '',
        'Measured on bench 3',
        'Operator MR',
        '',
        '12|',
        '13|',
        '',
        'time|0|1|2|3',
        '',
        'name|city',
        'Anna|Rome',
        'Marco|Milan',
      ),
    )
    expect(d.blocks.map((b) => [b.kind, b.a1, b.notes])).toEqual([
      ['note', 'A1', ['Lab notebook']],
      ['note', 'A3:A4', ['Measured on bench 3', 'Operator MR']],
      ['note', 'A6:A7', ['12', '13']],
      ['note', 'A9:E9', ['time | 0 | 1 | 2 | 3']],
      ['note', 'A11:B13', ['name | city', 'Anna | Rome', 'Marco | Milan']],
    ])
    expect(d.tables).toBe(0)
  })

  it(`a sheet of text keeps at most ${MAX_NOTE_LINES} lines per note, each cut at ${MAX_NOTE_CHARS} characters`, () => {
    // 5000 lines of text in one column: one note block that would otherwise travel whole to the picker.
    const g = Array.from({ length: 5000 }, (_, i) => [`line ${i + 1}`])
    g[0] = ['x'.repeat(500)]
    const [b] = detectBlocks(g).blocks
    expect(b).toMatchObject({ kind: 'note', a1: 'A1:A5000', notesOmitted: 5000 - MAX_NOTE_LINES })
    expect(b!.notes).toHaveLength(MAX_NOTE_LINES)
    expect(b!.notes[0]).toBe(`${'x'.repeat(MAX_NOTE_CHARS - 1)}…`)
    expect(b!.notes[1]).toBe('line 2')
    // A wide row of text is cut too; short notes are kept whole.
    const wide = detectBlocks([Array.from({ length: 300 }, (_, c) => `name${c}`)]).blocks[0]!
    expect(wide.notes[0]!.length).toBe(MAX_NOTE_CHARS)
    expect(detectBlocks(grid('Lab notebook')).blocks[0]).toMatchObject({
      notes: ['Lab notebook'],
      notesOmitted: 0,
    })
  })

  it('short text lines after the last record are notes, kept out of the range', () => {
    const d = detectBlocks(grid('x|y', '1|2', '3|4', '5|6', 'Source: bench 3'))
    expect(d.blocks).toHaveLength(1)
    expect(d.blocks[0]).toMatchObject({ a1: 'A1:B4', notes: ['Source: bench 3'] })
    // A last record with a missing value is data, not a note.
    expect(detectBlocks(grid('x|y', '1|2', '3|4', '5|NA')).blocks[0]!.a1).toBe('A1:B4')
  })

  it('title rows: a 3-cell title over a wide matrix, two rows of names, never a merged group header', () => {
    const three = detectBlocks(
      grid('Rod temperature|5cm|time', '|-|0|1|2|3|4', 'tilt|0|77|70|64|57|50', '|15|58|54|49|45|40'),
    )
    expect(three.blocks[0]).toMatchObject({ kind: 'matrix', titleRows: 1 })
    const names = detectBlocks(grid('Pine|plank 1', 'tilt(deg)|P[J/s]', '0|42.5', '15|38.1'))
    expect(names.blocks[0]).toMatchObject({ titleRows: 1, titleCells: ['Pine', 'plank 1'] })
    expect(names.blocks[0]!.header).toEqual(['tilt(deg)', 'P[J/s]'])
    // A first record without its number is narrower than the table: data, not a header under a title.
    const record = detectBlocks(
      grid(
        'Sample|Note|Mass (g)',
        'Sample 1|broken glass|',
        'Sample 2|ok|1.2',
        'Sample 3|ok|1.3',
        'Sample 4|ok|1.1',
      ),
    )
    expect(record.blocks[0]).toMatchObject({
      titleRows: 0,
      header: ['Sample', 'Note', 'Mass (g)'],
      orientation: 'columns',
    })
    // A header and its units row are both header lines.
    const units = detectBlocks(grid('Time|Voltage', 's|mV', '0|1.2', '1|2.3'))
    expect(units.blocks[0]!.titleRows).toBe(0)
    // "Run 1" over A:B and "Run 2" over C:D group the header: they are not a title.
    const group = detectBlocks(grid('Run 1||Run 2|', 't|V|t|V', '0|1.1|0|1.2', '1|1.3|1|1.4'), {
      merges: merges('A1:B1', 'C1:D1'),
    })
    expect(group.blocks[0]).toMatchObject({ titleRows: 0, header: ['Run 1', '', 'Run 2', ''] })
  })

  it('orientation confidence is low when a labelled table could also be read across', () => {
    const d = detectBlocks(grid('Sample|x|y', 'A|1|2', 'B|3|4', 'C|5|6', 'D|7|8', 'E|9|10'))
    expect(d.blocks[0]).toMatchObject({ orientation: 'columns', orientationConfidence: 'low' })
  })

  it('a merged area connects cells only when its anchor holds a value', () => {
    const g = grid('x|y||', '1|2||', '3|4||z', '|||5', '|||6')
    expect(detectBlocks(g).blocks.map((b) => b.a1)).toEqual(['A1:B3', 'D3:D5'])
    // B2:D2 merged with a value in B2: D2 is occupied and touches D3.
    expect(detectBlocks(g, { merges: merges('B2:D2') }).blocks.map((b) => b.a1)).toEqual(['A1:D5'])
    // An empty anchor (A4:C4) occupies nothing.
    expect(detectBlocks(g, { merges: merges('A4:C4') }).blocks.map((b) => b.a1)).toEqual(['A1:B3', 'D3:D5'])
  })

  it('native kinds: dates and numbers stored by the spreadsheet are values without parsing', () => {
    const g = grid('t|when', '1|2024-03-15', '2|2024-03-16')
    const n = (kinds: number[]): NativeColumn => ({
      kind: Uint8Array.from(kinds),
      num: new Float64Array(kinds.length),
    })
    const native = [
      n([NATIVE.text, NATIVE.number, NATIVE.number]),
      n([NATIVE.text, NATIVE.date, NATIVE.date]),
    ]
    expect(detectBlocks(g).blocks[0]!.numbers).toBe(2)
    expect(detectBlocks(g, { native }).blocks[0]!.numbers).toBe(4)
  })

  it(`at most ${MAX_BLOCKS} blocks: tables are kept first, the rest is counted`, () => {
    // 50 × 12 = 600 isolated numbers (notes) above one small table.
    const rows: string[][] = []
    for (let r = 0; r < 100; r++) {
      const row: string[] = []
      for (let c = 0; c < 24; c++) row.push(r % 2 === 0 && c % 2 === 0 ? `${r}.${c}` : '')
      rows.push(row)
    }
    rows.push([], ['x', 'y'], ['1', '2'], ['3', '4'])
    const d = detectBlocks(rows)
    expect(d.blocks).toHaveLength(MAX_BLOCKS)
    expect(d.overflow).toBe(601 - MAX_BLOCKS)
    expect(d.tables).toBe(1)
    // The table comes last in reading order but is kept.
    expect(d.blocks.at(-1)).toMatchObject({ kind: 'table', a1: 'A102:B104' })
    expect(d.blocks.map((b) => b.id)).toEqual(d.blocks.map((_, i) => `b${i + 1}`))
  })

  it('runs in linear time: a 1000 × 500 sheet of numbers is one table', () => {
    const rows = 1000
    const cols = 500
    const g: string[][] = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => (r === 0 ? `c${c}` : '1')),
    )
    const native = Array.from({ length: cols }, () => {
      const kind = new Uint8Array(rows).fill(NATIVE.number)
      kind[0] = NATIVE.text
      return { kind, num: new Float64Array(rows) }
    })
    const t0 = performance.now()
    const d = detectBlocks(g, { native })
    const ms = performance.now() - t0
    expect(d.blocks.map((b) => [b.kind, b.a1])).toEqual([['table', 'A1:SF1000']])
    expect(ms).toBeLessThan(3000)
  })
})

describe('blockTitle', () => {
  it('the title cells, else the key/value title lines, else nothing', () => {
    expect(blockTitle({ titleCells: ['oak', 'plank 1'], params: [] })).toBe('oak plank 1')
    expect(
      blockTitle({
        titleCells: [],
        params: [
          { key: 'layers', text: '0', value: 0, source: 'title' },
          { key: 'Rate', text: '1200', value: 1200, source: 'above' },
        ],
      }),
    ).toBe('layers 0')
    expect(blockTitle({ titleCells: [], params: [] })).toBe('')
    expect(blockTitle(null)).toBe('')
  })
})

describe('analyseSheet.describe — a range drawn by the user', () => {
  it('reads any rectangle like an island with exactly its cells, with parameters from above', () => {
    const g = grid('Rate|1200', '', 'x|y||z', '1|2||3', '3|4||5')
    const sheet = analyseSheet(g)
    expect(sheet.detection.blocks.map((b) => b.a1)).toEqual(['A1:B1', 'A3:B5', 'D3:D5'])
    const both = sheet.describe(parseA1Range('A3:D5')!)!
    expect(both).toMatchObject({ kind: 'table', a1: 'A3:D5', header: ['x', 'y', '', 'z'] })
    expect(both.params).toEqual([{ key: 'Rate', text: '1200', value: 1200, source: 'above' }])
    // Shrunk to its filled cells and clipped to the grid; nothing inside → null.
    expect(sheet.describe(parseA1Range('A3:Z99')!)!.a1).toBe('A3:D5')
    expect(sheet.describe(parseA1Range('C3:C5')!)).toBeNull()
    expect(sheet.describe(parseA1Range('F10:G12')!)).toBeNull()
  })
})
