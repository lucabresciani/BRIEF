import { describe, expect, it } from 'vitest'
import type {
  ColumnId,
  ColumnMeta,
  DatasetId,
  ImportedDataset,
  NotebookDataset,
  RawRegion,
  RawTable,
  RawTableId,
  RowId,
} from '@/domain/model'
import { buildDatasetView } from './datasetView'
import { blockOf, columnLetters, recordBlocks, recordPosition, recordPositionOf } from './recordPosition'

const meta = (id: string, index: number): ColumnMeta => ({
  id: id as ColumnId,
  source: { type: 'raw', index },
  name: id,
  unit: null,
  unitSource: null,
  role: 'measurement',
  uncertaintyOf: null,
  detected: { kind: 'numeric', decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
  override: {},
})

/**
 * A block cut out of a sheet: header record in sheet column C, then records in D, E, F when it was
 * transposed (orientation 'rows'); rows 3..6 otherwise.
 */
function block(region?: RawRegion): { dataset: ImportedDataset; raw: RawTable } {
  const raw: RawTable = {
    id: 'raw_b' as RawTableId,
    source: {
      kind: 'xlsx',
      fileName: 'blocks.xlsx',
      sheetName: 'Sheet1',
      encoding: null,
      delimiter: null,
      byteSize: null,
      importedAt: '2026-10-14T00:00:00Z',
      ...(region ? { region } : {}),
    },
    rowCount: 4,
    sourceRow: Int32Array.from([3, 4, 5, 6]),
    columns: [
      { text: ['speed', '1000', '2000', '3000'], native: null },
      { text: ['force', '1.5', '3.1', '4.4'], native: null },
    ],
    tokenIssues: [],
  }
  const dataset: ImportedDataset = {
    id: 'ds_b' as DatasetId,
    name: 'b',
    createdAt: '2026-10-14T00:00:00Z',
    example: null,
    columns: [meta('speed', 0), meta('force', 1)],
    notes: [],
    origin: 'import',
    rawTableId: raw.id,
    layout: { headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 3 },
  }
  return { dataset, raw }
}

const region = (orientation: RawRegion['orientation']): RawRegion => ({
  orientation,
  blocks: [{ range: 'C2:F3', label: null, firstRow: 0, rowCount: 4 }],
  labelColumns: [],
})

describe('columnLetters', () => {
  it('names 1-based sheet columns as a spreadsheet does', () => {
    const cases: [number, string][] = [
      [1, 'A'],
      [4, 'D'],
      [26, 'Z'],
      [27, 'AA'],
      [52, 'AZ'],
      [53, 'BA'],
      [702, 'ZZ'],
      [703, 'AAA'],
      [16384, 'XFD'], // the last column of an .xlsx sheet
    ]
    for (const [n, letters] of cases) expect(columnLetters(n), String(n)).toBe(letters)
  })

  it('gives no letters for what is not a column number', () => {
    for (const n of [0, -1, 1.5, NaN, Infinity]) expect(columnLetters(n), String(n)).toBe('')
  })
})

describe('DatasetView.recordAxis and the record position', () => {
  it('a transposed block: each record is a sheet column, named by its letters', () => {
    const { dataset, raw } = block(region('rows'))
    const view = buildDatasetView(dataset, raw)
    expect(view.recordAxis).toBe('column')
    expect(Array.from(view.rowIds)).toEqual([1, 2, 3])
    expect(recordPosition(view, 0)).toEqual({ axis: 'column', index: 4, text: 'D' })
    expect(recordPositionOf(view, 3 as RowId)).toEqual({ axis: 'column', index: 6, text: 'F' })
    expect(recordPositionOf(view, 0)).toBeNull() // the header record is not data
  })

  it('a whole sheet, a block kept as is and a notebook: records are rows, numbered as before', () => {
    for (const r of [undefined, region('columns')]) {
      const { dataset, raw } = block(r)
      const view = buildDatasetView(dataset, raw)
      expect(view.recordAxis).toBe('row')
      expect(recordPosition(view, 0)).toEqual({ axis: 'row', index: 4, text: '4' })
    }
    const nb: NotebookDataset = {
      id: 'ds_nb' as DatasetId,
      name: 'nb',
      createdAt: '2026-10-14T00:00:00Z',
      example: null,
      columns: [{ ...meta('x', 0), source: { type: 'notebook' } }],
      notes: [],
      origin: 'notebook',
      rowIds: [7 as RowId, 9 as RowId],
      cells: { x: ['1', '2'] },
      nextRowId: 10,
    }
    const view = buildDatasetView(nb, null)
    expect(view.recordAxis).toBe('row')
    expect(recordPositionOf(view, 9)).toEqual({ axis: 'row', index: 2, text: '2' })
  })
})

describe('recordBlocks and blockOf: the table of a record in a stacked dataset', () => {
  const stacked: RawRegion = {
    orientation: 'columns',
    labelColumns: [0],
    blocks: [
      { range: 'B2:E9', label: 'oak plank 1', firstRow: 1, rowCount: 6 },
      { range: 'G2:J9', label: null, firstRow: 7, rowCount: 6 },
      { range: 'L2:O9', label: 'oak plank 1', firstRow: 13, rowCount: 6 },
    ],
  }

  it('labels each table by its title, else its range; a shared title gets the range', () => {
    expect(recordBlocks(stacked).map((b) => b.label)).toEqual([
      'oak plank 1 (B2:E9)',
      'G2:J9',
      'oak plank 1 (L2:O9)',
    ])
  })

  it('finds the table of a raw-table row; none for the header or past the end', () => {
    const blocks = recordBlocks(stacked)
    expect(blockOf(blocks, 0)).toBeNull()
    expect(blockOf(blocks, 1)).toBe('oak plank 1 (B2:E9)')
    expect(blockOf(blocks, 6)).toBe('oak plank 1 (B2:E9)')
    expect(blockOf(blocks, 7)).toBe('G2:J9')
    expect(blockOf(blocks, 18)).toBe('oak plank 1 (L2:O9)')
    expect(blockOf(blocks, 19)).toBeNull()
  })

  it('a single table (or no region) needs no table name', () => {
    expect(recordBlocks(undefined)).toEqual([])
    expect(recordBlocks(null)).toEqual([])
    expect(recordBlocks({ ...stacked, blocks: stacked.blocks.slice(0, 1) })).toEqual([])
    expect(blockOf([], 3)).toBeNull()
  })
})
