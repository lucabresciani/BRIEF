import { describe, expect, it } from 'vitest'
import { DEFAULT_SERIES_STYLE, INACTIVE, NO_UNCERTAINTY } from '@/domain/model'
import type {
  ColumnId,
  ColumnKind,
  ColumnMeta,
  DatasetId,
  Exclusion,
  ExclusionId,
  Filter,
  ImportedDataset,
  RawTable,
  RawTableId,
  RowId,
  SeriesId,
  XYSeriesSpec,
} from '@/domain/model'
import { buildDatasetView } from './datasetView'
import { seriesData } from './series'
import { RENDER } from './types'

function rawFromCsv(text: string): RawTable {
  const rows = text
    .trim()
    .split('\n')
    .map((l) => l.split(','))
  return {
    id: 'raw_x' as RawTableId,
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
    columns: Array.from({ length: rows[0].length }, (_, c) => ({
      text: rows.map((r) => r[c] ?? ''),
      native: null,
    })),
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
const DS = 'ds_x' as DatasetId
const raw = rawFromCsv('x,y,g\n-1,5,A\n0,2,B\n1,-3,A\n2,,B\n10,100,C\n100,1000,A')
const ds: ImportedDataset = {
  id: DS,
  name: 'x',
  createdAt: '',
  example: null,
  columns: [meta('x', 0), meta('y', 1), meta('g', 2, 'categorical')],
  notes: [],
  origin: 'import',
  rawTableId: raw.id,
  layout: { headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: raw.rowCount - 1 },
}
const view = buildDatasetView(ds, raw)
const spec = (x = 'x', y = 'y'): XYSeriesSpec => ({
  id: 'ser_1' as SeriesId,
  datasetId: DS,
  name: null,
  x: x as ColumnId,
  y: y as ColumnId,
  visible: true,
  style: DEFAULT_SERIES_STYLE,
  errorBars: { x: NO_UNCERTAINTY, y: NO_UNCERTAINTY, visible: true },
  split: null,
})
const exclusions: Exclusion[] = [
  {
    id: 'ex_1' as ExclusionId,
    datasetId: DS,
    rowIds: [5] as RowId[],
    reason: 'other',
    note: '',
    createdAt: '',
  },
]
const filters: Filter[] = []

describe('seriesData', () => {
  it('INVARIANCE: style, visibility and error-bar settings never change the sample', () => {
    const base = seriesData(spec(), view, exclusions, filters, { x: 'linear', y: 'linear' })
    const restyled: XYSeriesSpec = {
      ...spec(),
      visible: false,
      style: { ...DEFAULT_SERIES_STYLE, markerSize: 12, symbol: 'diamond', paletteIndex: 3 },
      errorBars: {
        x: NO_UNCERTAINTY,
        y: { kind: 'sd', grouping: { by: 'sameX' } },
        visible: false,
      },
    }
    const other = seriesData(restyled, view, exclusions, filters, { x: 'linear', y: 'log' })
    expect(other.sample).toBe(base.sample)
    expect(other.x).toBe(base.x)
    expect(other.y).toBe(base.y)
  })

  it('INVARIANCE: log vs linear scales give the identical sample; only render differs', () => {
    const lin = seriesData(spec(), view, exclusions, filters, { x: 'linear', y: 'linear' })
    const logY = seriesData(spec(), view, exclusions, filters, { x: 'linear', y: 'log' })
    const logXY = seriesData(spec(), view, exclusions, filters, { x: 'log', y: 'log' })
    expect(logY.sample).toBe(lin.sample) // same object
    expect(logXY.sample).toBe(lin.sample)
    expect(Array.from(logXY.sample.reason)).toEqual(Array.from(lin.sample.reason))
    expect(logXY.sample.nActive).toBe(lin.sample.nActive)
    expect(Array.from(lin.render).every((r) => r === RENDER.shown)).toBe(true)
    // log y hides y ≤ 0 (row 3: y = −3) in the drawing only
    expect(Array.from(logY.render)).toEqual([0, 0, 1, 0, 0, 0])
    // log x also hides x ≤ 0 (rows 1, 2)
    expect(Array.from(logXY.render)).toEqual([1, 1, 1, 0, 0, 0])
    // the hidden points are still analysed
    expect(logXY.sample.reason[0]).toBe(INACTIVE.active)
    expect(logXY.sample.reason[2]).toBe(INACTIVE.active)
  })

  it('pairwise sample: x and y valid and row active; arrays reused by reference', () => {
    const s = seriesData(spec(), view, exclusions, filters, { x: 'linear', y: 'linear' })
    expect(s.x).toBe(view.columns.get('x' as ColumnId)!.values)
    expect(s.y).toBe(view.columns.get('y' as ColumnId)!.values)
    expect(s.rowIds).toBe(view.rowIds)
    expect(s.sample.counts).toEqual({ missing: 1, invalid: 0, excluded: 1, filtered: 0 })
    expect(s.sample.nActive).toBe(4)
    expect(s.seriesId).toBe('ser_1')
    expect(s.datasetId).toBe(DS)
  })

  it('a new exclusions array recomputes the sample; a label column mapped to an axis is invalid, not 0', () => {
    const a = seriesData(spec(), view, exclusions, filters, { x: 'linear', y: 'linear' })
    const b = seriesData(spec(), view, [], filters, { x: 'linear', y: 'linear' })
    expect(b.sample).not.toBe(a.sample)
    expect(b.sample.nActive).toBe(5)
    const cat = seriesData(spec('g', 'y'), view, [], filters, { x: 'linear', y: 'linear' })
    expect(cat.sample.nActive).toBe(0)
    expect(cat.sample.counts.invalid).toBe(5)
    expect(cat.sample.nActive + cat.sample.counts.missing + cat.sample.counts.invalid).toBe(cat.sample.nTotal)
  })

  it('unknown columns: all rows missing, NaN arrays, never throws', () => {
    const s = seriesData(spec('nope', 'y'), view, [], filters, { x: 'log', y: 'linear' })
    expect(s.sample.counts.missing).toBe(6)
    expect(Number.isNaN(s.x[0])).toBe(true)
  })
})
