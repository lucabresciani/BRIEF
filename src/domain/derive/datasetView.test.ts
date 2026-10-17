import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NATIVE } from '@/domain/model'
import type {
  ColumnId,
  ColumnKind,
  ColumnMeta,
  ColumnSource,
  DatasetId,
  ImportedDataset,
  NotebookDataset,
  RawTable,
  RawTableId,
  RowId,
} from '@/domain/model'
import { buildDatasetView } from './datasetView'
import { CELL } from './types'

/** Simple comma CSV (no quotes) → RawTable, exactly as a tokenizer would produce it. */
function rawFromCsv(text: string, native?: RawTable['columns'][number]['native'][]): RawTable {
  const lines = text.replace(/\r/g, '').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const rows = lines.map((l) => l.split(','))
  const width = Math.max(...rows.map((r) => r.length))
  return {
    id: 'raw_t' as RawTableId,
    source: {
      kind: 'csv',
      fileName: 't.csv',
      sheetName: null,
      encoding: 'utf-8',
      delimiter: ',',
      byteSize: text.length,
      importedAt: '2026-10-14T00:00:00Z',
    },
    rowCount: rows.length,
    sourceRow: Int32Array.from(rows.map((_, i) => i + 1)),
    columns: Array.from({ length: width }, (_, c) => ({
      text: rows.map((r) => r[c] ?? ''),
      native: native?.[c] ?? null,
    })),
    tokenIssues: [],
  }
}

function meta(
  id: string,
  name: string,
  source: ColumnSource,
  unit: string | null = null,
  kind: ColumnKind = 'numeric',
): ColumnMeta {
  return {
    id: id as ColumnId,
    source,
    name,
    unit,
    unitSource: unit ? 'header' : null,
    role: 'measurement',
    uncertaintyOf: null,
    detected: { kind, decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
    override: {},
  }
}

function imported(
  raw: RawTable,
  columns: ColumnMeta[],
  layout?: Partial<ImportedDataset['layout']>,
): ImportedDataset {
  return {
    id: 'ds_t' as DatasetId,
    name: 't',
    createdAt: '2026-10-14T00:00:00Z',
    example: null,
    columns,
    notes: [],
    origin: 'import',
    rawTableId: raw.id,
    layout: { headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: raw.rowCount - 1, ...layout },
  }
}

const example = (name: string) => readFileSync(resolve(`src/examples/${name}.csv`), 'utf8')

describe('buildDatasetView — imported', () => {
  it('ohm.csv: data rows, RowId = grid index, sourceRow = file line', () => {
    const raw = rawFromCsv(example('ohm'))
    const ds = imported(raw, [
      meta('I', 'I', { type: 'raw', index: 0 }, 'A'),
      meta('V', 'V', { type: 'raw', index: 1 }, 'V'),
    ])
    const v = buildDatasetView(ds, raw)
    expect(Array.from(v.rowIds)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(Array.from(v.sourceRow)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(v.rowIndex.get(3)).toBe(2)
    expect(v.columnOrder).toEqual(['I', 'V'])
    const V = v.columns.get('V' as ColumnId)!
    expect(V.values[0]).toBe(0.464)
    expect(V.values[9]).toBe(4.706)
    expect(V.report.nValid).toBe(10)
  })

  it('blank rows are kept out of the view (blankRows) but stay in the raw data', () => {
    const raw = rawFromCsv('x,y\n1,2\n,\n3,\n  ,  \n5,6\n')
    const ds = imported(raw, [
      meta('x', 'x', { type: 'raw', index: 0 }),
      meta('y', 'y', { type: 'raw', index: 1 }),
    ])
    const v = buildDatasetView(ds, raw)
    expect(Array.from(v.rowIds)).toEqual([1, 3, 5])
    expect(Array.from(v.blankRows)).toEqual([2, 4])
    const y = v.columns.get('y' as ColumnId)!
    expect(y.status[1]).toBe(CELL.missing) // row 3 has x but no y: missing, not blank, never 0
    expect(y.values[1]).toBeNaN()
    expect(raw.columns[0].text[2]).toBe('') // raw untouched
  })

  it('parsed columns are cached on the raw column: stable references across rebuilds and renames', () => {
    const raw = rawFromCsv(example('pendulum'))
    const cols = [
      meta('trial', 'trial', { type: 'raw', index: 0 }),
      meta('obs', 'observer', { type: 'raw', index: 1 }, null, 'categorical'),
      meta('T', 'T', { type: 'raw', index: 2 }, 's'),
    ]
    const a = buildDatasetView(imported(raw, cols), raw)
    const renamed = cols.map((c) => (c.id === 'obs' ? { ...c, name: 'Observer' } : c))
    const b = buildDatasetView(imported(raw, renamed), raw)
    expect(b.columns.get('T' as ColumnId)).toBe(a.columns.get('T' as ColumnId))
    expect(b.columns.get('obs' as ColumnId)).toBe(a.columns.get('obs' as ColumnId))
    expect(b.rowIds).toBe(a.rowIds)
    expect(a.columns.get('obs' as ColumnId)!.categories!.labels).toEqual(['A', 'B'])
  })

  it('an override changes the parsed values (and only that column is recomputed)', () => {
    const raw = rawFromCsv('a,b\nX,2\n')
    // A field holding a decimal comma, as the tokenizer yields for the quoted CSV field "1,5".
    const rawComma: RawTable = { ...raw, columns: [{ text: ['a', '1,5'], native: null }, raw.columns[1]] }
    const base = [meta('a', 'a', { type: 'raw', index: 0 }), meta('b', 'b', { type: 'raw', index: 1 })]
    const dot = buildDatasetView(imported(rawComma, base), rawComma)
    expect(dot.columns.get('a' as ColumnId)!.status[0]).toBe(CELL.separatorConflict)
    const over = base.map((c) => (c.id === 'a' ? { ...c, override: { decimal: 'comma' as const } } : c))
    const comma = buildDatasetView(imported(rawComma, over), rawComma)
    expect(comma.columns.get('a' as ColumnId)!.values[0]).toBe(1.5)
    expect(comma.columns.get('b' as ColumnId)).toBe(dot.columns.get('b' as ColumnId))
  })

  it('header toggle: RowIds stay grid indices, so a row keeps its identity', () => {
    const raw = rawFromCsv(example('ohm'))
    const cols = [meta('I', 'I', { type: 'raw', index: 0 }), meta('V', 'V', { type: 'raw', index: 1 })]
    const withHeader = buildDatasetView(imported(raw, cols), raw)
    const noHeader = buildDatasetView(imported(raw, cols, { headerRow: null, dataStartRow: 0 }), raw)
    expect(noHeader.rowIds[0]).toBe(0)
    const r = 3
    const vWith = withHeader.columns.get('V' as ColumnId)!.values[withHeader.rowIndex.get(r)!]
    const vNo = noHeader.columns.get('V' as ColumnId)!.values[noHeader.rowIndex.get(r)!]
    expect(vWith).toBe(vNo)
    expect(noHeader.columns.get('V' as ColumnId)!.status[0]).toBe(CELL.invalid) // the header text "V (V)"
  })

  it('a missing RawTable gives an empty view; an absent raw index gives an all-missing column', () => {
    const raw = rawFromCsv('x\n1\n2\n')
    const ds = imported(raw, [
      meta('x', 'x', { type: 'raw', index: 0 }),
      meta('ghost', 'g', { type: 'raw', index: 7 }),
    ])
    const empty = buildDatasetView(ds, null)
    expect(empty.rowIds.length).toBe(0)
    expect(empty.columns.get('x' as ColumnId)!.values.length).toBe(0)
    const v = buildDatasetView(ds, raw)
    const g = v.columns.get('ghost' as ColumnId)!
    expect(Array.from(g.status)).toEqual([CELL.missing, CELL.missing])
  })

  it('spreadsheet native cells are subset with the data rows', () => {
    const raw = rawFromCsv('v\n12%\nx\n', [
      {
        kind: Uint8Array.from([NATIVE.text, NATIVE.number, NATIVE.text]),
        num: Float64Array.from([NaN, 0.12, NaN]),
      },
    ])
    const v = buildDatasetView(imported(raw, [meta('v', 'v', { type: 'raw', index: 0 }, '%')]), raw)
    const col = v.columns.get('v' as ColumnId)!
    expect(col.values[0]).toBe(12)
    expect(col.status[1]).toBe(CELL.invalid)
  })

  it('derived columns: computed after raw ones, inputs resolved regardless of order', () => {
    const raw = rawFromCsv(example('cooling'))
    const cols = [
      meta('lnDT', 'ln ΔT', { type: 'derived', spec: { op: 'ln', input: 'dT' as ColumnId } }),
      meta('t', 't', { type: 'raw', index: 0 }, 'min'),
      meta('T', 'T', { type: 'raw', index: 1 }, '°C'),
      meta(
        'dT',
        'ΔT',
        { type: 'derived', spec: { op: 'affine', input: 'T' as ColumnId, a: 1, b: -22 } },
        'K',
      ),
      meta('dTfile', 'ΔT file', { type: 'raw', index: 2 }, 'K'),
    ]
    const v = buildDatasetView(imported(raw, cols), raw)
    expect(v.columnOrder).toEqual(['lnDT', 't', 'T', 'dT', 'dTfile'])
    const dT = v.columns.get('dT' as ColumnId)!
    const file = v.columns.get('dTfile' as ColumnId)!
    for (let i = 0; i < v.rowIds.length; i++) expect(dT.values[i]).toBeCloseTo(file.values[i], 10)
    expect(v.columns.get('lnDT' as ColumnId)!.values[0]).toBeCloseTo(Math.log(63.2), 12)
    const again = buildDatasetView(imported(raw, cols), raw)
    expect(again.columns.get('lnDT' as ColumnId)).toBe(v.columns.get('lnDT' as ColumnId))
  })

  it('a derived cycle does not throw: the cyclic input is absent (missing)', () => {
    const raw = rawFromCsv('x\n1\n')
    const cols = [
      meta('a', 'a', { type: 'derived', spec: { op: 'square', input: 'b' as ColumnId } }),
      meta('b', 'b', { type: 'derived', spec: { op: 'square', input: 'a' as ColumnId } }),
    ]
    const v = buildDatasetView(imported(raw, cols), raw)
    expect(v.columns.get('a' as ColumnId)!.status[0]).toBe(CELL.missing)
  })
})

describe('buildDatasetView — imported units and delimiter', () => {
  it('cells are checked against the unit in the FILE: relabelling or clearing the unit changes nothing', () => {
    const raw = rawFromCsv('I (A),U\n0.1,12 mV\n0.2,15 mV\n0.3,18 V\n')
    const base = meta('U', 'U', { type: 'raw', index: 1 }, 'mV')
    const read = (unit: string | null) => {
      const col = { ...base, unit, unitSource: 'user' as const }
      return buildDatasetView(imported(raw, [col]), raw).columns.get('U' as ColumnId)!
    }
    const first = read('mV')
    // "18 V" carries another unit than the cells' "mV" (2 of 3 < 80 %, so no cell unit): all flagged alike.
    expect(Array.from(first.status)).toEqual([CELL.unexpectedUnit, CELL.unexpectedUnit, CELL.unexpectedUnit])
    for (const unit of ['millivolt', null, 'V']) {
      const p = read(unit)
      expect([unit, Array.from(p.status)]).toEqual([unit, Array.from(first.status)])
      expect(p).toBe(first) // the unit label is not part of the parse: same cached object
    }
    const majority = rawFromCsv('U\n12 mV\n15 mV\n18 mV\n20 mV\n7 V\n')
    const p = buildDatasetView(
      imported(majority, [{ ...base, source: { type: 'raw', index: 0 }, unit: null }]),
      majority,
    ).columns.get('U' as ColumnId)!
    expect(Array.from(p.values)).toEqual([12, 15, 18, 20, NaN])
    expect(p.status[4]).toBe(CELL.unexpectedUnit)
  })

  it('the header unit (or units row) of the file is the reference', () => {
    const raw = rawFromCsv('t,V (V)\n0,1 V\n1,2 mV\n')
    const p = buildDatasetView(
      imported(raw, [meta('V', 'V', { type: 'raw', index: 1 }, null)]),
      raw,
    ).columns.get('V' as ColumnId)!
    expect(Array.from(p.status)).toEqual([CELL.ok, CELL.unexpectedUnit])
    const units = rawFromCsv('t,V\ns,mV\n0,1 mV\n1,2 V\n')
    const q = buildDatasetView(
      imported(units, [meta('V', 'V', { type: 'raw', index: 1 }, 'volt')], { unitsRow: 1, dataStartRow: 2 }),
      units,
    ).columns.get('V' as ColumnId)!
    expect(Array.from(q.status)).toEqual([CELL.ok, CELL.unexpectedUnit])
  })

  it("text read without a delimiter ('none'): a space between digits is not a thousands separator", () => {
    const raw = rawFromCsv('t P\n0 101.3\n10 100.9\n')
    const none: RawTable = { ...raw, source: { ...raw.source, delimiter: 'none' } }
    const v = buildDatasetView(imported(none, [meta('c', 't P', { type: 'raw', index: 0 })]), none)
    const p = v.columns.get('c' as ColumnId)!
    expect(Array.from(p.status)).toEqual([CELL.invalid, CELL.invalid])
    const withDelim = buildDatasetView(imported(raw, [meta('c', 't P', { type: 'raw', index: 0 })]), raw)
    expect(withDelim.columns.get('c' as ColumnId)!.values[1]).toBe(10100.9) // e.g. "10 100,9" in a ';' file
  })
})

describe('buildDatasetView — notebook', () => {
  it('rowIds + cells; rows keep their ids; sourceRow is the position; short cell arrays padded', () => {
    const ds: NotebookDataset = {
      id: 'ds_n' as DatasetId,
      name: 'nb',
      createdAt: '2026-10-14T00:00:00Z',
      example: null,
      columns: [meta('x', 'x', { type: 'notebook' }), meta('y', 'y', { type: 'notebook' })],
      notes: [],
      origin: 'notebook',
      rowIds: [5, 9, 12] as RowId[],
      cells: { x: ['1', '2', '3'], y: ['0,5', ''] },
      nextRowId: 13,
    }
    ds.columns[1].override = { decimal: 'comma' }
    const v = buildDatasetView(ds, null)
    expect(Array.from(v.rowIds)).toEqual([5, 9, 12])
    expect(Array.from(v.sourceRow)).toEqual([1, 2, 3])
    const y = v.columns.get('y' as ColumnId)!
    expect(y.values[0]).toBe(0.5)
    expect(Array.from(y.status.slice(1))).toEqual([CELL.missing, CELL.missing])
    expect(y.report.invalidExamples).toEqual([])
    expect(buildDatasetView(ds, null).columns.get('x' as ColumnId)).toBe(v.columns.get('x' as ColumnId))
  })
})
