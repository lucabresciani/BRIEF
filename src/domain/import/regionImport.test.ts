import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { CELL } from '@/domain/derive/types'
import type { DatasetId, Result } from '@/domain/model'
import { importBytes, type ImportDraft, type ImportOverrides } from './importPipeline'
import { importRegions, type RegionImportSpec } from './regionImport'

const fixtureBytes = (name: string) => new Uint8Array(readFileSync(resolve('tests/fixtures/import', name)))
const MICRO = 'micro-tables.xlsx'

function draftOf(r: Result<ImportDraft>): ImportDraft {
  if (!r.ok) throw new Error(`import failed: ${r.error.code} ${JSON.stringify(r.error.params ?? {})}`)
  return r.value
}
function draftsOf(r: Result<ImportDraft[]>): ImportDraft[] {
  if (!r.ok) throw new Error(`import failed: ${r.error.code} ${JSON.stringify(r.error.params ?? {})}`)
  return r.value
}
const regions = (file: string, spec: RegionImportSpec, overrides: ImportOverrides = {}) =>
  importRegions(fixtureBytes(file), file, spec, overrides, { xlsx: XLSX })
const codes = (d: ImportDraft) => d.issues.map((i) => i.code)
const find = (d: ImportDraft, code: string) => d.issues.find((i) => i.code === code)

/** Values of one column exactly as the analysis reads them (NaN when not ok). */
function values(d: ImportDraft, name: string): number[] {
  const view = buildDatasetView(
    {
      id: 'ds' as DatasetId,
      name: d.suggestedName,
      createdAt: '2026-10-15T00:00:00Z',
      example: null,
      columns: d.columns,
      notes: d.notes,
      origin: 'import',
      rawTableId: d.rawTable.id,
      layout: d.layout,
    },
    d.rawTable,
  )
  const col = d.columns.find((c) => c.name === name)
  if (!col) throw new Error(`no column ${name}: ${d.columns.map((c) => c.name).join(', ')}`)
  const p = view.columns.get(col.id)!
  return Array.from(p.values, (v, i) => (p.status[i] === CELL.ok ? v : NaN))
}
const names = (d: ImportDraft) => d.columns.map((c) => c.name)
const GRID = ['B2:E9', 'G2:J9', 'L2:O9', 'B11:E18', 'G11:J18', 'L11:O18']

describe('importBytes: whole sheets with several tables, and .xls workbooks', () => {
  it('a sheet of six small tables: the blocks are listed, I_MULTIPLE_TABLES, no fast path', () => {
    const d = draftOf(importBytes(fixtureBytes(MICRO), MICRO, {}, { xlsx: XLSX }))
    expect(d.detection.sheetName).toBe('Grid')
    const sheet = d.detection.sheet!
    expect(sheet.origin).toEqual({ row: 1, col: 1 })
    expect(sheet.tables).toBe(6)
    expect(sheet.overflow).toBe(0)
    expect(sheet.blocks.map((b) => b.a1)).toEqual(GRID)
    expect(sheet.blocks[0]!.titleCells).toEqual(['oak', 'plank 1'])
    // Grid coordinates are those of the raw table: cell (0, 0) is B2.
    expect(d.rawTable.columns[0]!.text[0]).toBe('oak')
    expect(find(d, 'I_MULTIPLE_TABLES')).toMatchObject({
      severity: 'info',
      params: { count: 6, sheet: 'Grid' },
    })
    expect(d.fastPath).toBe(false)
  })

  it('a sheet with one table keeps its fast path and lists its block', () => {
    const d = draftOf(importBytes(fixtureBytes('excel-saved.xlsx'), 'excel-saved.xlsx', {}, { xlsx: XLSX }))
    expect(d.detection.sheet!.blocks.map((b) => [b.kind, b.a1])).toEqual([['table', 'A1:F5']])
    expect(codes(d)).not.toContain('I_MULTIPLE_TABLES')
  })

  it('.xls (Excel 97–2003): read like .xlsx, with its two side-by-side tables', () => {
    const d = draftOf(importBytes(fixtureBytes('biff8-tables.xls'), 'biff8-tables.xls', {}, { xlsx: XLSX }))
    expect(d.rawTable.source.kind).toBe('xls')
    expect(d.detection.sheetName).toBe('Misure')
    expect(d.detection.sheet!.blocks.map((b) => [b.kind, b.a1])).toEqual([
      ['table', 'A1:F5'],
      ['table', 'H1:I6'],
    ])
    expect(find(d, 'I_MULTIPLE_TABLES')?.params).toMatchObject({ count: 2 })
    expect(d.fastPath).toBe(false)
    expect(values(d, 'Tensione')).toEqual([1.25, 2.5, 3.75, 5, NaN])
  })
})

describe('importRegions: one block', () => {
  it('a titled table: the title is a note, the header is the row after it', () => {
    const [d, ...rest] = draftsOf(
      regions(MICRO, {
        sheetName: 'Grid',
        mode: 'separate',
        regions: [{ range: 'B2:E9', orientation: 'columns' }],
      }),
    )
    expect(rest).toEqual([])
    expect(names(d!)).toEqual(['position', 'Width mm', 'Depth mm', 'area'])
    expect(d!.notes).toEqual(['oak | plank 1'])
    expect(values(d!, 'Width mm')).toEqual([48, 46, 44, 42, 40, 38])
    expect(values(d!, 'area')).toEqual([960, 1012, 1056, 1092, 1120, 1140]) // cached formula results
    expect(Array.from(d!.rawTable.sourceRow)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    expect(d!.rawTable.source).toMatchObject({
      kind: 'xlsx',
      sheetName: 'Grid',
      region: {
        orientation: 'columns',
        blocks: [{ range: 'B2:E9', label: 'oak plank 1', firstRow: 0, rowCount: 8 }],
        labelColumns: [],
      },
    })
    expect(d!.suggestedName).toBe('micro-tables · oak plank 1')
    expect(d!.detection.sheet).toBeNull()
    expect(codes(d!)).toEqual(['I_PREAMBLE_KEPT'])
  })

  it('several regions → one draft each, in order', () => {
    const ds = draftsOf(
      regions(MICRO, {
        sheetName: 'Grid',
        mode: 'separate',
        regions: [
          { range: 'L11:O18', orientation: 'columns', name: 'Birch P2' },
          { range: 'B2:E9', orientation: 'columns' },
        ],
      }),
    )
    expect(ds.map((d) => d.suggestedName)).toEqual(['micro-tables · Birch P2', 'micro-tables · oak plank 1'])
    expect(names(ds[0]!)).toEqual(['position', 'Width mm', 'Depth mm', 'Area'])
  })

  it('variables in rows: transposed, records labelled by their sheet column, titles kept as notes', () => {
    const [d] = draftsOf(
      regions(MICRO, {
        sheetName: 'Transposed',
        mode: 'separate',
        regions: [{ range: 'B2:F6', orientation: 'rows' }],
      }),
    )
    expect(names(d!)).toEqual(['duty', 'input', 'rise', 'loss'])
    expect(values(d!, 'duty')).toEqual([25, 50, 75, 100])
    expect(values(d!, 'loss')).toEqual([2.5, 14.5, 34.5, 62.5])
    // Header = sheet column B, records = columns C, D, E, F.
    expect(Array.from(d!.rawTable.sourceRow)).toEqual([2, 3, 4, 5, 6])
    expect(d!.rawTable.source.region).toMatchObject({ orientation: 'rows', blocks: [{ range: 'B3:F6' }] })
    expect(find(d!, 'I_BLOCK_TRANSPOSED')?.params).toEqual({ range: 'B3:F6', count: 1 })
    expect(d!.notes).toEqual(['layers | 0', 'drift +0.4'])
    expect(d!.suggestedName).toBe('micro-tables · layers 0')
  })

  it('variables in rows with a units column: the message names the sheet column, not a row', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['speed', '1/min', 25, 50, 75],
      ['voltage', 'V', 10, 11, 12],
      ['current', 'A', 1, 2, 3],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'T')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const spec: RegionImportSpec = {
      sheetName: 'T',
      mode: 'separate',
      regions: [{ range: 'A1:E3', orientation: 'rows' }],
    }
    const [d] = draftsOf(importRegions(bytes, 't.xlsx', spec, {}, { xlsx: XLSX }))
    expect(d!.columns.map((c) => [c.name, c.unit])).toEqual([
      ['speed', '1/min'],
      ['voltage', 'V'],
      ['current', 'A'],
    ])
    // The units "row" of the transposed table is sheet column B.
    expect(find(d!, 'I_UNITS_ROW')).toMatchObject({ params: { row: 'B', axis: 'column' }, rows: [1] })
    // Blocks kept as they are still speak of rows.
    const [whole] = draftsOf(
      importRegions(
        bytes,
        't.xlsx',
        { ...spec, regions: [{ range: 'A1:E3', orientation: 'columns' }] },
        {},
        { xlsx: XLSX },
      ),
    )
    expect(whole!.issues.every((i) => i.params?.axis === undefined)).toBe(true)
  })

  it('a rectangle drawn over a remark keeps it as data: a record G, nothing dropped', () => {
    const [d] = draftsOf(
      regions(MICRO, {
        sheetName: 'Transposed',
        mode: 'separate',
        regions: [{ range: 'B2:G6', orientation: 'rows' }],
      }),
    )
    expect(Array.from(d!.rawTable.sourceRow)).toEqual([2, 3, 4, 5, 6, 7])
    expect(values(d!, 'duty')).toEqual([25, 50, 75, 100, NaN])
    expect(d!.rawTable.columns[3]!.text[5]).toBe('drift +0.4')
    expect(d!.notes).toEqual(['layers | 0'])
  })

  it('a text-only block imported as a table: its cells are data, not repeated as notes', () => {
    const [d] = draftsOf(
      regions('excel-saved.xlsx', {
        sheetName: 'Notes',
        mode: 'separate',
        regions: [{ range: 'A1:A2', orientation: 'columns' }],
      }),
    )
    expect(d!.rawTable.columns[0]!.text).toEqual(['Lab notebook', 'Measured on bench 3'])
    expect(d!.notes).toEqual([])
  })

  it('a quantity merged over C:D: the empty column is left out; key/value lines are notes', () => {
    const [d] = draftsOf(
      regions(MICRO, {
        sheetName: 'Paired',
        mode: 'separate',
        regions: [{ range: 'A1:F10', orientation: 'columns' }],
      }),
    )
    expect(names(d!)).toEqual(['Probe', 'h', 'h - h0', 'dp', 'p'])
    expect(d!.columns.map((c) => c.unit)).toEqual([null, 'mm', 'mm', 'Pa', 'Pa'])
    expect(values(d!, 'h - h0')).toEqual([32, 21, 8, -4, -11, 0, 13])
    expect(d!.notes).toEqual(['Tilt | -5', 'Fluid density (kg/m3) | 998.2'])
    expect(find(d!, 'I_TRIMMED_EMPTY')?.params).toEqual({ cols: 1 })
    // Only data merges: nothing was copied, and the message says so (header: 0).
    expect(find(d!, 'W_MERGED_CELLS')?.params).toEqual({ count: 7, header: 0, data: 7 })
  })

  it('a matrix: its first row is the header (one column per time)', () => {
    const [d] = draftsOf(
      regions(MICRO, {
        sheetName: 'Matrix',
        mode: 'separate',
        regions: [{ range: 'B2:H9', orientation: 'columns' }],
      }),
    )
    expect(names(d!)).toEqual(['position', '0', '1', '2', '3', '4', '5'])
    expect(d!.columns[0]!.unit).toBe('cm')
    expect(values(d!, '0')).toEqual([77, 67, 58, 51, 46, 41])
  })

  it('.xls blocks: native dates and percents, a merged group title, a merged data cell left empty', () => {
    const [a, b] = draftsOf(
      regions('biff8-tables.xls', {
        sheetName: 'Misure',
        mode: 'separate',
        regions: [
          { range: 'A1:F5', orientation: 'columns' },
          { range: 'H1:I6', orientation: 'columns' },
        ],
      }),
    )
    expect(a!.rawTable.source.kind).toBe('xls')
    expect(names(a!)).toEqual(['Tempo', 'Tensione', 'Resistenza', 'Data', 'Efficienza', 'Nota'])
    expect(a!.columns.map((c) => c.unit)).toEqual(['s', 'µV', 'Ω', null, '%', null])
    expect(values(a!, 'Data')).toEqual([15, 16, 17, 18].map((d) => Date.UTC(2024, 2, d)))
    expect(values(a!, 'Efficienza')).toEqual([12, 7.5, 100, 0.5])
    expect(names(b!)).toEqual(['p1', 'p2'])
    expect(b!.notes).toEqual(['Pressione è'])
    expect(values(b!, 'p2')).toEqual([99.8, 99.5, 99.1, NaN]) // I6 is inside the merge I5:I6: missing, not 99.1
    expect(find(b!, 'W_MERGED_CELLS')?.params).toEqual({ count: 1, header: 0, data: 1 })
  })

  it('a rectangle drawn by the user, and row overrides of the region', () => {
    // Without its title line the block starts at its header.
    const [d] = draftsOf(
      regions(MICRO, {
        sheetName: 'Grid',
        mode: 'separate',
        regions: [{ range: 'B3:E9', orientation: 'columns' }],
      }),
    )
    expect(names(d!)).toEqual(['position', 'Width mm', 'Depth mm', 'area'])
    expect(d!.notes).toEqual([])
    // headerRow of the region (a row of the block) wins over the shared overrides and over the detection.
    const [e] = draftsOf(
      regions(
        MICRO,
        {
          sheetName: 'Grid',
          mode: 'separate',
          regions: [{ range: 'B2:E9', orientation: 'columns', headerRow: null }],
        },
        { headerRow: 1 },
      ),
    )
    expect(e!.layout.headerRow).toBeNull()
    const [f] = draftsOf(
      regions(
        MICRO,
        { sheetName: 'Grid', mode: 'separate', regions: [{ range: 'B2:E9', orientation: 'columns' }] },
        {
          headerRow: 0,
        },
      ),
    )
    expect(f!.layout.headerRow).toBe(0)
  })

  it('formulas without a saved value are reported with the rows of the block', () => {
    const [d] = draftsOf(
      regions('formula-no-cache.xlsx', {
        sheetName: 'Sheet1',
        mode: 'separate',
        regions: [{ range: 'A1:C4', orientation: 'columns' }],
      }),
    )
    expect(find(d!, 'W_FORMULA_NO_VALUE')).toMatchObject({ params: { count: 2 }, rows: [1, 2] })
  })
})

describe('importRegions: stacked blocks', () => {
  it('six tables with the same columns → one dataset with label columns from the titles', () => {
    const [d, ...rest] = draftsOf(
      regions(MICRO, {
        sheetName: 'Grid',
        mode: 'stack',
        regions: GRID.map((range) => ({ range, orientation: 'columns' as const })),
      }),
    )
    expect(rest).toEqual([])
    expect(names(d!)).toEqual(['Title 1', 'plank', 'position', 'Width mm', 'Depth mm', 'area'])
    const [wood, plank] = d!.columns
    expect([wood!.role, wood!.detected.kind]).toEqual(['group', 'categorical'])
    expect([plank!.role, plank!.detected.kind]).toEqual(['group', 'numeric'])
    expect(d!.rawTable.columns[0]!.text.slice(1, 20).filter((_, i) => i % 6 === 0)).toEqual([
      'oak',
      'pine',
      'birch',
      'oak',
    ])
    expect(values(d!, 'plank')).toEqual([...Array(18).fill(1), ...Array(18).fill(2)])
    expect(values(d!, 'position')).toHaveLength(36)
    // "Area" and "position " are the same columns: no block left a column empty.
    expect(values(d!, 'area').every(Number.isFinite)).toBe(true)
    expect(Array.from(d!.rawTable.sourceRow.slice(0, 8))).toEqual([3, 4, 5, 6, 7, 8, 9, 4])
    expect(d!.rawTable.source.region).toMatchObject({
      orientation: 'columns',
      labelColumns: [0, 1],
      blocks: GRID.map((range, k) => ({ range, firstRow: 1 + 6 * k, rowCount: 6 })),
    })
    expect(find(d!, 'I_STACKED_BLOCKS')?.params).toEqual({ count: 6, labels: 2 })
    expect(d!.notes[0]).toBe('B2:E9: oak | plank 1')
    expect(d!.suggestedName).toBe('micro-tables · Grid')
  })

  it('transposed blocks stack too, labelled by the parameter that varies ("layers")', () => {
    const [d] = draftsOf(
      regions(MICRO, {
        sheetName: 'Transposed',
        mode: 'stack',
        regions: ['B2:F6', 'B8:F12', 'B14:F18'].map((range) => ({ range, orientation: 'rows' as const })),
      }),
    )
    expect(names(d!)).toEqual(['layers', 'duty', 'input', 'rise', 'loss'])
    expect(values(d!, 'layers')).toEqual([0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 4, 4])
    expect(values(d!, 'loss').slice(4, 8)).toEqual([1, 11.5, 29, 53.5])
    expect(Array.from(d!.rawTable.sourceRow)).toEqual([2, 3, 4, 5, 6, 3, 4, 5, 6, 3, 4, 5, 6])
    expect(d!.issues.filter((i) => i.code === 'I_BLOCK_TRANSPOSED')).toHaveLength(1)
    expect(d!.rawTable.source.region?.orientation).toBe('rows')
  })

  it('tables named by key/value lines: their records keep only the line that differs ("Tilt -5")', () => {
    const table = (tilt: number) => [
      ['Tilt', tilt, ''],
      ['Fluid density', 998.2, ''],
      ['x', 'y', 'z'],
      [1, 2, 3],
      [4, 5, 6],
    ]
    const ws = XLSX.utils.aoa_to_sheet([...table(-5), [], ...table(0)])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'KV')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const stack = (name?: string): RegionImportSpec => ({
      sheetName: 'KV',
      mode: 'stack',
      regions: [
        { range: 'A1:C5', orientation: 'columns', ...(name ? { name } : {}) },
        { range: 'A7:C11', orientation: 'columns' },
      ],
    })
    const [d] = draftsOf(importRegions(bytes, 'kv.xlsx', stack(), {}, { xlsx: XLSX }))
    expect(names(d!)).toEqual(['Tilt', 'x', 'y', 'z'])
    expect(d!.rawTable.source.region?.blocks.map((b) => b.label)).toEqual(['Tilt -5', 'Tilt 0'])
    // A name typed in the picker wins.
    const [named] = draftsOf(importRegions(bytes, 'kv.xlsx', stack('first run'), {}, { xlsx: XLSX }))
    expect(named!.rawTable.source.region?.blocks.map((b) => b.label)).toEqual(['first run', 'Tilt 0'])
    // Imported separately, a table keeps its full title.
    const [one] = draftsOf(
      importRegions(
        bytes,
        'kv.xlsx',
        { ...stack(), mode: 'separate', regions: [stack().regions[0]!] },
        {},
        { xlsx: XLSX },
      ),
    )
    expect(one!.rawTable.source.region?.blocks[0]!.label).toBe('Tilt -5, Fluid density 998.2')
  })

  it('a table whose first title cell was left blank: its run stays a run, that cell stays empty', () => {
    const table = (sample: string, run: number) => [
      [sample, `run ${run}`, ''],
      ['x', 'y', 'w'],
      [1, run, 3],
      [2, run * 2, 3],
    ]
    const ws = XLSX.utils.aoa_to_sheet([...table('oak', 1), [], ...table('', 2), [], ...table('oak', 3)])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Odd')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const [d] = draftsOf(
      importRegions(
        bytes,
        'odd.xlsx',
        {
          sheetName: 'Odd',
          mode: 'stack',
          regions: ['A1:C4', 'A6:C9', 'A11:C14'].map((range) => ({ range, orientation: 'columns' as const })),
        },
        {},
        { xlsx: XLSX },
      ),
    )
    expect(names(d!)).toEqual(['Title 1', 'run', 'x', 'y', 'w'])
    expect(d!.rawTable.columns[0]!.text.slice(1)).toEqual(['oak', 'oak', '', '', 'oak', 'oak'])
    expect(values(d!, 'run')).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('labels chosen by the user: a number kept as text, or none at all', () => {
    const spec = (labels: RegionImportSpec['labels']): RegionImportSpec => ({
      sheetName: 'Grid',
      mode: 'stack',
      regions: GRID.slice(0, 2).map((range) => ({ range, orientation: 'columns' as const })),
      labels,
    })
    const [d] = draftsOf(
      regions(MICRO, spec([{ source: { type: 'titleCell', index: 0 }, name: 'Wood', kind: 'text' }])),
    )
    expect(names(d!)[0]).toBe('Wood')
    const [n] = draftsOf(regions(MICRO, spec([{ source: { type: 'blockName' }, name: 'Run', kind: 'text' }])))
    expect(n!.rawTable.columns[0]!.text.slice(1, 8)).toEqual([
      ...Array(6).fill('oak plank 1'),
      'pine plank 1',
    ])
    const [s] = draftsOf(
      regions(MICRO, {
        sheetName: 'Transposed',
        mode: 'stack',
        regions: ['B2:F6', 'B8:F12'].map((range) => ({ range, orientation: 'rows' as const })),
        labels: [{ source: { type: 'param', key: 'layers' }, name: 'insulation', kind: 'text' }],
      }),
    )
    expect(s!.columns[0]).toMatchObject({
      name: 'insulation',
      role: 'group',
      override: { kind: 'categorical' },
    })
    const [none] = draftsOf(regions(MICRO, spec([])))
    expect(names(none!)).toEqual(['position', 'Width mm', 'Depth mm', 'area'])
    expect(find(none!, 'I_STACKED_BLOCKS')?.params).toEqual({ count: 2, labels: 0 })
  })

  it('a block whose header is uncertain keeps the warning (and blocks the fast path) once stacked', () => {
    // "Sample rate | 1000" under the header may be metadata or data: detectLayout says so.
    const block = [
      ['x', 'y'],
      ['Sample rate', 1000],
      [1, 2],
      [3, 4],
    ]
    const ws = XLSX.utils.aoa_to_sheet(block.map((row, i) => [...row, null, ...[block[i]![0], block[i]![1]]]))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const spec: RegionImportSpec = {
      sheetName: 'S',
      mode: 'stack',
      regions: ['A1:B4', 'D1:E4'].map((range) => ({ range, orientation: 'columns' as const })),
    }
    const [d] = draftsOf(importRegions(bytes, 's.xlsx', spec, {}, { xlsx: XLSX }))
    expect(find(d!, 'W_HEADER_UNCERTAIN')).toMatchObject({ params: { row: 1 }, rows: [0] })
    expect(d!.fastPath).toBe(false)
  })

  it('merge warnings of the blocks become one warning on the rows of the stacked table', () => {
    const [d] = draftsOf(
      regions(MICRO, {
        sheetName: 'Paired',
        mode: 'stack',
        regions: ['A1:F10', 'H1:M10'].map((range) => ({ range, orientation: 'columns' as const })),
      }),
    )
    expect(names(d!)).toEqual(['Tilt', 'Probe', 'h', 'h - h0', 'dp', 'p'])
    expect(values(d!, 'Tilt')).toEqual([...Array(7).fill(-5), ...Array(7).fill(0)])
    const merged = d!.issues.filter((i) => i.code === 'W_MERGED_CELLS')
    expect(merged).toHaveLength(1)
    expect(merged[0]!.params).toEqual({ count: 14, header: 0, data: 14 })
    expect(merged[0]!.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  })
})

describe('importRegions: refused inputs', () => {
  const one = (range: string, extra: Partial<RegionImportSpec> = {}): RegionImportSpec => ({
    sheetName: 'Grid',
    mode: 'separate',
    regions: [{ range, orientation: 'columns' }],
    ...extra,
  })
  const errorOf = (r: Result<ImportDraft[]>) => (r.ok ? null : r.error)

  it('programmer errors (the picker validates first) → E_INTERNAL_GUARD', () => {
    expect(errorOf(regions(MICRO, one('B2:')))).toMatchObject({ code: 'E_INTERNAL_GUARD' })
    expect(errorOf(regions(MICRO, { sheetName: 'Grid', mode: 'separate', regions: [] }))).toMatchObject({
      code: 'E_INTERNAL_GUARD',
    })
    expect(
      errorOf(
        regions(MICRO, {
          sheetName: 'Grid',
          mode: 'stack',
          regions: [
            { range: 'B2:E9', orientation: 'columns' },
            { range: 'G2:J9', orientation: 'rows' },
          ],
        }),
      ),
    ).toMatchObject({ code: 'E_INTERNAL_GUARD' })
  })

  it('files and sheets that cannot be read', () => {
    expect(errorOf(importRegions(new Uint8Array(0), 'a.xlsx', one('A1')))).toMatchObject({
      code: 'E_EMPTY_INPUT',
    })
    const csv = new TextEncoder().encode('x,y\n1,2\n')
    expect(errorOf(importRegions(csv, 'a.csv', one('A1'), {}, { xlsx: XLSX }))).toMatchObject({
      code: 'E_UNSUPPORTED_FORMAT',
      params: { format: 'csv' },
    })
    expect(errorOf(importRegions(fixtureBytes(MICRO), MICRO, one('B2:E9')))).toMatchObject({
      code: 'E_UNSUPPORTED_FORMAT',
      params: { format: 'xlsx' },
    })
    expect(errorOf(regions(MICRO, one('B2:E9', { sheetName: 'Nope' })))).toMatchObject({
      code: 'E_SHEET_EMPTY',
    })
    expect(errorOf(regions(MICRO, one('AA100:AB120')))).toMatchObject({
      code: 'E_NO_DATA_ROWS',
      params: { range: 'AA100:AB120' },
    })
    // An empty column reaching past the used cells (read as F2:F18): the error names the range sent.
    const blank = regions(MICRO, {
      sheetName: 'Grid',
      mode: 'separate',
      regions: [
        { range: 'B2:E9', orientation: 'columns' },
        { range: 'F2:F30', orientation: 'columns' },
      ],
    })
    expect(errorOf(blank)).toMatchObject({ code: 'E_NO_DATA_ROWS', params: { range: 'F2:F30' } })
  })
})
