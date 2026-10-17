import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INACTIVE } from '@/domain/model'
import type {
  ColumnId,
  ColumnKind,
  ColumnMeta,
  DatasetId,
  Exclusion,
  ExclusionId,
  Filter,
  FilterId,
  ImportedDataset,
  RawTable,
  RawTableId,
  RowId,
} from '@/domain/model'
import { analysisSample } from './analysisSample'
import { buildDatasetView } from './datasetView'
import type { AnalysisSample } from './types'

function rawFromCsv(text: string): RawTable {
  const lines = text.replace(/\r/g, '').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const rows = lines.map((l) => l.split(','))
  const width = Math.max(...rows.map((r) => r.length))
  return {
    id: 'raw_s' as RawTableId,
    source: {
      kind: 'csv',
      fileName: null,
      sheetName: null,
      encoding: 'utf-8',
      delimiter: ',',
      byteSize: null,
      importedAt: '',
    },
    rowCount: rows.length,
    sourceRow: Int32Array.from(rows.map((_, i) => i + 1)),
    columns: Array.from({ length: width }, (_, c) => ({ text: rows.map((r) => r[c] ?? ''), native: null })),
    tokenIssues: [],
  }
}

const meta = (id: string, index: number, kind: ColumnKind = 'numeric'): ColumnMeta => ({
  id: id as ColumnId,
  source: { type: 'raw', index },
  name: id,
  unit: null,
  unitSource: null,
  role: 'measurement',
  uncertaintyOf: null,
  detected: { kind, decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
  override: {},
})

const DS = 'ds_s' as DatasetId
function dataset(raw: RawTable, cols: ColumnMeta[]): ImportedDataset {
  return {
    id: DS,
    name: 's',
    createdAt: '',
    example: null,
    columns: cols,
    notes: [],
    origin: 'import',
    rawTableId: raw.id,
    layout: { headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: raw.rowCount - 1 },
  }
}

const exclusion = (rowIds: number[], datasetId = DS): Exclusion => ({
  id: `ex_${rowIds.join('_')}` as ExclusionId,
  datasetId,
  rowIds: rowIds as RowId[],
  reason: 'measurement-problem',
  note: '',
  createdAt: '',
})
const range = (column: string, min: number | null, max: number | null, enabled = true): Filter => ({
  id: `f_${column}` as FilterId,
  datasetId: DS,
  enabled,
  type: 'range',
  column: column as ColumnId,
  min,
  max,
})

const invariant = (s: AnalysisSample) =>
  expect(s.nActive + s.counts.missing + s.counts.invalid + s.counts.excluded + s.counts.filtered).toBe(
    s.nTotal,
  )

/** OLS slope by the textbook formula (independent of the fit module). */
function slope(x: number[], y: number[]): number {
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) * (x[i] - mx)
  }
  return sxy / sxx
}

describe('analysisSample', () => {
  // grid rows: 0 header, 1..7 data, 4 blank
  const raw = rawFromCsv('x,y,g\n1,10,A\n,20,B\nbad,30,A\n,,\n4,,B\n5,50,C\n6,60,A\n')
  const view = buildDatasetView(dataset(raw, [meta('x', 0), meta('y', 1), meta('g', 2, 'categorical')]), raw)
  const X = 'x' as ColumnId
  const Y = 'y' as ColumnId

  it('precedence missing > invalid > excluded > filtered; each row counted once', () => {
    // row 2: x missing AND excluded → missing; row 3: x invalid AND filtered → invalid; row 6: excluded AND filtered → excluded
    const s = analysisSample(view, [X, Y], [exclusion([2, 6])], [range('y', null, 25)])
    expect(Array.from(view.rowIds)).toEqual([1, 2, 3, 5, 6, 7])
    expect(Array.from(s.reason)).toEqual([
      INACTIVE.active,
      INACTIVE.missing,
      INACTIVE.invalid,
      INACTIVE.missing, // row 5: y missing
      INACTIVE.excluded,
      INACTIVE.filtered, // row 7: y = 60 > 25
    ])
    expect(s.counts).toEqual({ missing: 2, invalid: 1, excluded: 1, filtered: 1 })
    expect(s.nActive).toBe(1)
    expect(s.nTotal).toBe(6) // the blank grid row 4 is outside nTotal
    invariant(s)
    expect(s.rowIds).toBe(view.rowIds)
  })

  it('column-wise vs pairwise: x missing in one row and y in another', () => {
    const sx = analysisSample(view, [X], [], [])
    const sy = analysisSample(view, [Y], [], [])
    const sxy = analysisSample(view, [X, Y], [], [])
    expect(sy.nActive).toBe(5)
    expect(sx.nActive).toBe(4) // missing + invalid
    expect(sxy.nActive).toBe(3)
    for (const s of [sx, sy, sxy]) invariant(s)
  })

  it('only exclusions/filters of this dataset and only ENABLED filters apply; bounds inclusive', () => {
    const other = analysisSample(
      view,
      [Y],
      [exclusion([1], 'ds_other' as DatasetId)],
      [range('y', 0, 10, false)],
    )
    expect(other.nActive).toBe(5)
    const inclusive = analysisSample(view, [Y], [], [range('y', 10, 30)])
    expect(inclusive.nActive).toBe(3) // 10, 20, 30
    invariant(inclusive)
  })

  it('a filter on a missing value fails; category filters keep labels', () => {
    const s = analysisSample(view, [Y], [], [range('x', 0, 100)]) // rows 2 (x missing) and 3 (x invalid) fail
    expect(s.counts.filtered).toBe(2)
    const cat: Filter = {
      id: 'f_g' as FilterId,
      datasetId: DS,
      enabled: true,
      type: 'category',
      column: 'g' as ColumnId,
      keep: ['A'],
    }
    const c = analysisSample(view, [Y], [], [cat])
    expect(c.nActive).toBe(3) // A rows with y: 1, 3, 7
    invariant(c)
  })

  it('an unknown column counts as missing on every row (never throws)', () => {
    const s = analysisSample(view, ['nope' as ColumnId], [], [])
    expect(s.counts.missing).toBe(6)
    invariant(s)
  })

  it('Ohm: excluding grid row 3 removes exactly that row and changes the slope as expected', () => {
    const ohm = rawFromCsv(readFileSync(resolve('src/examples/ohm.csv'), 'utf8'))
    const v = buildDatasetView(dataset(ohm, [meta('I', 0), meta('V', 1)]), ohm)
    const I = v.columns.get('I' as ColumnId)!.values
    const V = v.columns.get('V' as ColumnId)!.values
    const all = analysisSample(v, ['I' as ColumnId, 'V' as ColumnId], [], [])
    const ex = analysisSample(v, ['I' as ColumnId, 'V' as ColumnId], [exclusion([3])], [])
    expect(all.nActive).toBe(10)
    expect(ex.nActive).toBe(9)
    expect(ex.counts.excluded).toBe(1)
    const pick = (s: AnalysisSample, a: Float64Array) =>
      Array.from(a).filter((_, i) => s.reason[i] === INACTIVE.active)
    expect(pick(ex, V)).not.toContain(1.402) // grid row 3 = I 0.030, V 1.402
    expect(slope(pick(all, I), pick(all, V))).toBeCloseTo(47.1472727273, 9)
    const b1 = slope(pick(ex, I), pick(ex, V))
    expect(b1).not.toBeCloseTo(47.1472727273, 6)
    const xs = [0.01, 0.02, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]
    const ys = [0.464, 0.941, 1.882, 2.339, 2.808, 3.294, 3.764, 4.241, 4.706]
    expect(b1).toBeCloseTo(slope(xs, ys), 12)
  })
})
