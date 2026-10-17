import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { importText } from '@/domain/import/importPipeline'
import { DEFAULT_AXIS, DEFAULT_EXPORT } from '@/domain/model'
import type {
  ColumnId,
  ColumnKind,
  ColumnMeta,
  ColumnRole,
  Dataset,
  DatasetId,
  ImportedDataset,
  NotebookDataset,
  PlotId,
  RowId,
  SeriesId,
} from '@/domain/model'
import { defaultPlotSpec, initialPlot, recommend } from './recommend'

const NOW = '2026-10-14T00:00:00.000Z'

function fromCsv(
  text: string,
  file: string,
): ImportedDataset & { raw: Parameters<typeof buildDatasetView>[1] } {
  const r = importText(text, { kind: 'example', fileName: file })
  if (!r.ok) throw new Error(`import of ${file} failed: ${r.error.code}`)
  const d = r.value
  return {
    id: `ds_${file}` as DatasetId,
    name: d.suggestedName,
    createdAt: NOW,
    example: null,
    columns: d.columns,
    notes: d.notes,
    origin: 'import',
    rawTableId: d.rawTable.id,
    layout: d.layout,
    raw: d.rawTable,
  }
}
const example = (file: string) => fromCsv(readFileSync(resolve('src/examples', file), 'utf8'), file)
const viewOf = (ds: ReturnType<typeof fromCsv>) => buildDatasetView(ds, ds.raw)
const id = (ds: Dataset, name: string): ColumnId => {
  const c = ds.columns.find((m) => m.name === name)
  if (!c) throw new Error(`no column ${name}`)
  return c.id
}

/** Hand-made notebook dataset: name → typed cells, with optional role/kind per column. */
function notebook(
  cols: { name: string; cells: string[]; role?: ColumnRole; kind?: ColumnKind; uncertaintyOf?: string }[],
): NotebookDataset {
  const n = cols[0].cells.length
  const metas: ColumnMeta[] = cols.map((c) => ({
    id: c.name as ColumnId,
    source: { type: 'notebook' },
    name: c.name,
    unit: null,
    unitSource: null,
    role: c.role ?? 'measurement',
    uncertaintyOf: (c.uncertaintyOf ?? null) as ColumnId | null,
    detected: {
      kind: c.kind ?? 'numeric',
      decimal: 'dot',
      percent: 'display',
      confidence: 'high',
      explanations: [],
    },
    override: {},
  }))
  return {
    id: 'ds_nb' as DatasetId,
    name: 'nb',
    createdAt: NOW,
    example: null,
    columns: metas,
    notes: [],
    origin: 'notebook',
    rowIds: Array.from({ length: n }, (_, i) => i as RowId),
    cells: Object.fromEntries(cols.map((c) => [c.name, c.cells])),
    nextRowId: n,
  }
}

describe('recommend — the five examples', () => {
  it('Ohm: scatter of V against I; a fit is suggested, never added; no time series', () => {
    const ds = example('ohm.csv')
    const r = recommend(ds, viewOf(ds))
    expect(r.plotType).toBe('scatter')
    expect(r.messageKey).toBe('recommend.scatter')
    expect(r.params).toEqual({ x: 'I', y: 'V' })
    expect(r.columns).toEqual({ x: id(ds, 'I'), y: id(ds, 'V'), value: null, group: null })
    expect(r.suggestFit).toBe(true)
    expect(r.alternatives).toEqual([])
    expect(r.uncertaintyColumn).toBeNull()
  })

  it('free fall: u(y) is excluded from y and suggested as its uncertainty; t is time → line offered', () => {
    const ds = example('freeFall.csv')
    const r = recommend(ds, viewOf(ds))
    expect(r.plotType).toBe('scatter')
    expect(r.params).toEqual({ x: 't', y: 'y' })
    expect(r.uncertaintyColumn).toBe(id(ds, 'u(y)'))
    expect(r.alternatives).toEqual([{ plotType: 'line', messageKey: 'recommend.alt.line' }])
    expect(r.suggestFit).toBe(true)
  })

  it('cooling: x = t (time-like), y = T (capital T is not time); ΔT is not used', () => {
    const ds = example('cooling.csv')
    const r = recommend(ds, viewOf(ds))
    expect(r.params).toEqual({ x: 't', y: 'T' })
    expect(r.alternatives.map((a) => a.plotType)).toEqual(['line'])
  })

  it('Beer–Lambert: scatter of A against c; the replicate identifier is not a quantity', () => {
    const ds = example('beerLambert.csv')
    const r = recommend(ds, viewOf(ds))
    expect(r.plotType).toBe('scatter')
    expect(r.params).toEqual({ x: 'c', y: 'A' })
    expect(r.alternatives).toEqual([])
  })

  it('pendulum: one quantity and a group → box of T by observer', () => {
    const ds = example('pendulum.csv')
    const r = recommend(ds, viewOf(ds))
    expect(r.plotType).toBe('box')
    expect(r.messageKey).toBe('recommend.box')
    expect(r.params).toEqual({ column: 'T', group: 'observer' })
    expect(r.columns).toEqual({ x: null, y: null, value: id(ds, 'T'), group: id(ds, 'observer') })
    expect(r.suggestFit).toBe(false)
  })
})

describe('recommend — rules', () => {
  it('one quantity alone → histogram', () => {
    const ds = notebook([{ name: 'd', cells: ['1.2', '1.4', '1.1', '1.3'] }])
    const r = recommend(ds, buildDatasetView(ds, null))
    expect(r.plotType).toBe('histogram')
    expect(r.messageKey).toBe('recommend.histogram')
    expect(r.params).toEqual({ column: 'd' })
  })

  it('an identifier plus one quantity → histogram (an identifier is a row label)', () => {
    const ds = notebook([
      { name: 'trial', cells: ['1', '2', '3', '4'], role: 'identifier' },
      { name: 'T', cells: ['1.7', '1.8', '1.75', '1.72'] },
    ])
    expect(recommend(ds, buildDatasetView(ds, null)).plotType).toBe('histogram')
  })

  it('no usable quantity → recommend.none', () => {
    const ds = notebook([
      { name: 'label', cells: ['a', 'b', 'c'], kind: 'text' },
      { name: 'u', cells: ['0.1', '0.1', '0.1'], role: 'uncertainty' },
    ])
    const r = recommend(ds, buildDatasetView(ds, null))
    expect(r.messageKey).toBe('recommend.none')
    expect(r.plotType).toBe('scatter')
    expect(r.suggestFit).toBe(false)
    expect(r.columns).toEqual({ x: null, y: null, value: null, group: null })
  })

  it('uncertainty and ignored columns never become y', () => {
    const ds = notebook([
      { name: 'x', cells: ['1', '2', '3'] },
      { name: 'u', cells: ['0.1', '0.1', '0.2'], role: 'uncertainty', uncertaintyOf: 'y' },
      { name: 'junk', cells: ['5', '6', '7'], role: 'ignore' },
      { name: 'y', cells: ['2', '4', '6'] },
    ])
    const r = recommend(ds, buildDatasetView(ds, null))
    expect(r.params).toEqual({ x: 'x', y: 'y' })
    expect(r.uncertaintyColumn).toBe('u')
  })

  it('a column with fewer than 2 valid values is not a quantity', () => {
    const ds = notebook([
      { name: 'x', cells: ['1', '2', '3'] },
      { name: 'y', cells: ['', 'NA', '4'] },
      { name: 'z', cells: ['4', '5', '6'] },
    ])
    expect(recommend(ds, buildDatasetView(ds, null)).params).toEqual({ x: 'x', y: 'z' })
  })

  it('a time-like column is x even when it is not first; "time", "tempo" and lower-case "t" are time-like', () => {
    for (const name of ['time', 'Tempo di caduta', 't', 'timestamp']) {
      const ds = notebook([
        { name: 'signal', cells: ['3', '1', '2'] },
        { name, cells: ['0', '1', '2'] },
      ])
      const r = recommend(ds, buildDatasetView(ds, null))
      expect(r.params, name).toEqual({ x: name, y: 'signal' })
      expect(r.alternatives, name).toEqual([{ plotType: 'line', messageKey: 'recommend.alt.line' }])
    }
    for (const name of ['T', 'temperature', 'theta']) {
      const ds = notebook([
        { name: 'signal', cells: ['3', '1', '2'] },
        { name, cells: ['0', '1', '2'] },
      ])
      const r = recommend(ds, buildDatasetView(ds, null))
      expect(r.params, name).toEqual({ x: 'signal', y: name })
      expect(r.alternatives, name).toEqual([])
    }
  })

  it('a strictly increasing x that is not time-like is not called a time series', () => {
    const ds = notebook([
      { name: 'I', cells: ['0.01', '0.02', '0.03', '0.04'] },
      { name: 'V', cells: ['0.46', '0.94', '1.40', '1.88'] },
    ])
    expect(recommend(ds, buildDatasetView(ds, null)).alternatives).toEqual([])
  })

  it('a datetime column is x with a line alternative; no fit is suggested on dates', () => {
    const ds = notebook([
      { name: 'when', cells: ['2026-01-01', '2026-01-02', '2026-01-03'], kind: 'datetime' },
      { name: 'level', cells: ['3.1', '3.4', '3.0'] },
    ])
    const r = recommend(ds, buildDatasetView(ds, null))
    expect(r.plotType).toBe('scatter')
    expect(r.params).toEqual({ x: 'when', y: 'level' })
    expect(r.alternatives.map((a) => a.plotType)).toEqual(['line'])
    expect(r.suggestFit).toBe(false)
  })

  it('a group with one observation per label is not a box plot', () => {
    const ds = notebook([
      { name: 'sample', cells: ['a', 'b', 'c'], kind: 'categorical', role: 'group' },
      { name: 'm', cells: ['1.1', '1.3', '1.2'] },
    ])
    expect(recommend(ds, buildDatasetView(ds, null)).plotType).toBe('histogram')
  })

  it('the user role wins: a column set to "ignore" is left out, an override to text is not numeric', () => {
    const ds = example('ohm.csv')
    const ignored: Dataset = {
      ...ds,
      columns: ds.columns.map((c) => (c.name === 'I' ? { ...c, role: 'ignore' } : c)),
    }
    expect(recommend(ignored, viewOf(ds)).plotType).toBe('histogram')
    const asText: Dataset = {
      ...ds,
      columns: ds.columns.map((c) => (c.name === 'V' ? { ...c, override: { kind: 'text' } } : c)),
    }
    expect(recommend(asText, buildDatasetView(asText, ds.raw)).plotType).toBe('histogram')
  })
})

describe('defaultPlotSpec / initialPlot', () => {
  it('defaultPlotSpec fills every per-type option with fresh, neutral objects', () => {
    const a = defaultPlotSpec('p1' as PlotId)
    const b = defaultPlotSpec('p2' as PlotId)
    expect(a.id).toBe('p1')
    expect(a.name).toBe('') // automatic label
    expect(a.type).toBe('scatter')
    expect(a.series).toEqual([])
    expect(a.xAxis).toEqual(DEFAULT_AXIS)
    expect(a.xAxis).not.toBe(DEFAULT_AXIS)
    expect(a.xAxis.range).not.toBe(DEFAULT_AXIS.range)
    expect(a.xAxis).not.toBe(a.yAxis)
    expect(a.export).toEqual(DEFAULT_EXPORT)
    expect(a.export).not.toBe(DEFAULT_EXPORT)
    expect(a.scatter).toEqual({ residualPanel: false, showExcluded: true })
    expect(a.line).toEqual({ markers: true, sortByX: false })
    expect(a.bar).toEqual({
      datasetId: null,
      category: null,
      value: null,
      showObservations: true,
      colorByCategory: false,
      aggregate: 'mean',
      spread: { kind: 'none' },
    })
    expect(a.histogram).toEqual({
      datasetId: null,
      value: null,
      bins: { mode: 'auto' },
      groupBy: null,
      groupMode: 'overlay',
    })
    expect(a.box).toEqual({
      datasetId: null,
      value: null,
      groupBy: null,
      points: 'all',
      showMean: false,
      colorByGroup: false,
    })
    a.series.push({} as never)
    a.xAxis.scale = 'log'
    expect(b.series).toEqual([])
    expect(b.xAxis.scale).toBe('linear')
    expect(DEFAULT_AXIS.scale).toBe('linear')
  })

  it('free fall: one series with no error bars; the other plot types point at the same data', () => {
    const ds = example('freeFall.csv')
    const { plot, recommendation } = initialPlot(ds, viewOf(ds), 'plot_1' as PlotId, 'ser_1' as SeriesId)
    expect(recommendation.uncertaintyColumn).toBe(id(ds, 'u(y)'))
    expect(plot.id).toBe('plot_1')
    expect(plot.type).toBe('scatter')
    expect(plot.series).toHaveLength(1)
    const s = plot.series[0]
    expect(s).toMatchObject({
      id: 'ser_1',
      datasetId: ds.id,
      x: id(ds, 't'),
      y: id(ds, 'y'),
      visible: true,
      name: null,
    })
    expect(s.errorBars).toEqual({ x: { kind: 'none' }, y: { kind: 'none' }, visible: true })
    expect(s.style.paletteIndex).toBe(0)
    expect(s.split).toBeNull() // one curve; nothing is grouped until the user asks
    expect(plot.histogram).toMatchObject({ datasetId: ds.id, value: id(ds, 'y'), groupBy: null })
    expect(plot.box).toMatchObject({ datasetId: ds.id, value: id(ds, 'y'), groupBy: null })
    expect(plot.bar).toMatchObject({ datasetId: ds.id, category: id(ds, 't'), value: id(ds, 'y') })
    // Never a fit: initialPlot returns only a plot (fits live in ProjectDoc.fits).
    expect(Object.keys({ plot, recommendation }).sort()).toEqual(['plot', 'recommendation'])
  })

  it('pendulum: a box plot of T by observer, the bar and histogram options filled, no XY series', () => {
    const ds = example('pendulum.csv')
    const { plot } = initialPlot(ds, viewOf(ds), 'plot_1' as PlotId, 'ser_1' as SeriesId)
    expect(plot.type).toBe('box')
    expect(plot.series).toEqual([])
    expect(plot.box).toMatchObject({
      datasetId: ds.id,
      value: id(ds, 'T'),
      groupBy: id(ds, 'observer'),
      points: 'all',
    })
    expect(plot.bar).toMatchObject({
      datasetId: ds.id,
      category: id(ds, 'observer'),
      value: id(ds, 'T'),
      aggregate: 'mean',
    })
    expect(plot.histogram).toMatchObject({ datasetId: ds.id, value: id(ds, 'T') })
  })

  it('nothing to plot → an unconfigured scatter', () => {
    const ds = notebook([{ name: 'label', cells: ['a', 'b'], kind: 'text' }])
    const { plot, recommendation } = initialPlot(
      ds,
      buildDatasetView(ds, null),
      'p' as PlotId,
      's' as SeriesId,
    )
    expect(recommendation.messageKey).toBe('recommend.none')
    expect(plot.type).toBe('scatter')
    expect(plot.series).toEqual([])
    expect(plot.histogram.value).toBeNull()
    expect(plot.box.value).toBeNull()
  })
})

describe('initialPlot: tables merged on import are split by their label column', () => {
  const plotFor = (cells: string[], splitBy: ColumnId | null | undefined) => {
    const ds = notebook([
      { name: 'label', cells, role: 'group', kind: 'categorical' },
      { name: 'x', cells: cells.map((_, i) => String(i)) },
      { name: 'y', cells: cells.map((_, i) => String(i * 2)) },
    ])
    return initialPlot(ds, buildDatasetView(ds, null), 'plot_1' as PlotId, 'ser_1' as SeriesId, { splitBy })
      .plot
  }

  it('2 to 50 values: one curve per value (the scatter keeps x and y)', () => {
    const plot = plotFor(['oak', 'oak', 'pine', 'pine', 'birch'], 'label' as ColumnId)
    expect(plot.series[0]).toMatchObject({ x: 'x', y: 'y', split: { column: 'label', overrides: [] } })
  })

  it('rows without a value do not count as a value (and are kept by the split, not dropped)', () => {
    expect(plotFor(['oak', '', '', 'oak'], 'label' as ColumnId).series[0]!.split).toBeNull()
    expect(plotFor(['oak', '', 'pine', 'oak'], 'label' as ColumnId).series[0]!.split).not.toBeNull()
  })

  it('one value, more than 50, no label column or a label that is x or y: a single curve', () => {
    expect(plotFor(['a', 'a', 'a'], 'label' as ColumnId).series[0]!.split).toBeNull()
    const many = Array.from({ length: 51 }, (_, i) => `run ${i}`)
    expect(plotFor(many, 'label' as ColumnId).series[0]!.split).toBeNull()
    expect(plotFor(many.slice(0, 50), 'label' as ColumnId).series[0]!.split).not.toBeNull()
    expect(plotFor(['a', 'b'], null).series[0]!.split).toBeNull()
    expect(plotFor(['a', 'b', 'c'], 'x' as ColumnId).series[0]!.split).toBeNull()
  })
})
