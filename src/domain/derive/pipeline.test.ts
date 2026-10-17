import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { produce } from 'immer'
import { describe, expect, it, vi } from 'vitest'
import { runFit } from '@/domain/fit/runFit'
import { importText } from '@/domain/import/importPipeline'
import { INACTIVE } from '@/domain/model'
import type {
  ColumnId,
  ColumnMeta,
  Dataset,
  DatasetId,
  ExclusionId,
  FilterId,
  FitId,
  FitModel,
  FitSpec,
  ImportedDataset,
  NotebookDataset,
  PlotId,
  PlotSpec,
  ProjectDoc,
  ProjectId,
  RawTable,
  RowId,
  SeriesId,
  TransformSpec,
  XYSeriesSpec,
} from '@/domain/model'
import { initialPlot } from '@/domain/recommend/recommend'
import { buildDatasetView } from './datasetView'
import { createDeriver } from './pipeline'
import type { DerivedSeries } from './pipeline'
import { CELL, RENDER } from './types'
import type { AnalysisSample, FitOk } from './types'

// runFit unchanged, only counted: which plots had their fits computed.
vi.mock('@/domain/fit/runFit', async (importOriginal) => {
  const mod = await importOriginal<{ runFit: typeof runFit }>()
  return { ...mod, runFit: vi.fn(mod.runFit) }
})

const NOW = '2026-10-14T00:00:00.000Z'
const ref = (name: string) =>
  JSON.parse(readFileSync(resolve(`tests/fixtures/reference/${name}.json`), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >

/** |a − b| ≤ tol·|b| (tol relative to the reference value). */
function expectRel(actual: number | null | undefined, expected: string | number, tol: number) {
  const e = Number(expected)
  expect(actual).not.toBeNull()
  expect(Math.abs((actual as number) - e)).toBeLessThanOrEqual(tol * Math.abs(e))
}

function load(file: string, id: string): { dataset: ImportedDataset; raw: RawTable } {
  const r = importText(readFileSync(resolve('src/examples', file), 'utf8'), {
    kind: 'example',
    fileName: file,
  })
  if (!r.ok) throw new Error(`import of ${file} failed: ${r.error.code}`)
  const d = r.value
  return {
    dataset: {
      id: id as DatasetId,
      name: d.suggestedName,
      createdAt: NOW,
      example: null,
      columns: d.columns,
      notes: d.notes,
      origin: 'import',
      rawTableId: d.rawTable.id,
      layout: d.layout,
    },
    raw: d.rawTable,
  }
}

const colId = (ds: Dataset, name: string): ColumnId => {
  const c = ds.columns.find((m) => m.name === name)
  if (!c) throw new Error(`no column ${name}`)
  return c.id
}

const notebookMeta = (id: string, source: ColumnMeta['source'] = { type: 'notebook' }): ColumnMeta => ({
  id: id as ColumnId,
  source,
  name: id,
  unit: null,
  unitSource: null,
  role: 'measurement',
  uncertaintyOf: null,
  detected: { kind: 'numeric', decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
  override: {},
})

function notebook(
  id: string,
  cells: Record<string, string[]>,
  derived: { id: string; spec: TransformSpec }[] = [],
): NotebookDataset {
  const n = Object.values(cells)[0].length
  return {
    id: id as DatasetId,
    name: id,
    createdAt: NOW,
    example: null,
    columns: [
      ...Object.keys(cells).map((k) => notebookMeta(k)),
      ...derived.map((d) => notebookMeta(d.id, { type: 'derived', spec: d.spec })),
    ],
    notes: [],
    origin: 'notebook',
    rowIds: Array.from({ length: n }, (_, i) => i as RowId),
    cells,
    nextRowId: n,
  }
}

function series(id: string, datasetId: string, x: ColumnId | string, y: ColumnId | string): XYSeriesSpec {
  return {
    id: id as SeriesId,
    datasetId: datasetId as DatasetId,
    name: null,
    x: x as ColumnId,
    y: y as ColumnId,
    visible: true,
    style: { paletteIndex: 0, symbol: 'auto', open: false, markerSize: 7, lineDash: 'auto', lineWidth: 1.5 },
    errorBars: { x: { kind: 'none' }, y: { kind: 'none' }, visible: true },
    split: null,
  }
}

const fitSpec = (id: string, seriesId: string, model: FitModel = { type: 'linear' }): FitSpec => ({
  id: id as FitId,
  seriesId: seriesId as SeriesId,
  model,
  confidence: 0.95,
  show: { curve: true, confidenceBand: false, predictionBand: false, residuals: true },
  curveRange: { mode: 'data' },
  style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
  perGroup: false,
})

function project(
  datasets: Dataset[],
  plot: PlotSpec,
  fits: FitSpec[] = [],
): Omit<ProjectDoc, 'datasets'> & { datasets: Dataset[] } {
  return {
    id: 'proj_1' as ProjectId,
    name: 'test',
    createdAt: NOW,
    updatedAt: NOW,
    datasets,
    plots: [plot],
    activePlotId: plot.id,
    fits,
    exclusions: [],
    filters: [],
    numberFormat: { decimal: 'auto' },
  }
}

/** Ohm through the real import + recommendation, with a linear fit on the recommended series. */
function ohmProject() {
  const { dataset, raw } = load('ohm.csv', 'ds_ohm')
  const { plot } = initialPlot(
    dataset,
    buildDatasetView(dataset, raw),
    'plot_1' as PlotId,
    'ser_ohm' as SeriesId,
  )
  const doc = project([dataset], plot, [fitSpec('fit_ohm', 'ser_ohm')]) as ProjectDoc
  return {
    doc: produce(doc, () => {}),
    rawTables: { [raw.id]: raw } as Record<string, RawTable>,
    dataset,
    raw,
  }
}

const fitOk = (s: DerivedSeries | undefined): FitOk => {
  expect(s?.fit?.status).toBe('ok')
  return s!.fit as FitOk
}

function expectCountInvariant(sample: AnalysisSample) {
  const c = sample.counts
  expect(sample.nActive + c.missing + c.invalid + c.excluded + c.filtered).toBe(sample.nTotal)
}

/** Independent closed-form OLS (two-pass) for the recomputation check. */
function ols(x: number[], y: number[]) {
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2
    sxy += (x[i] - mx) * (y[i] - my)
  }
  const b1 = sxy / sxx
  const b0 = my - b1 * mx
  let rss = 0
  for (let i = 0; i < n; i++) rss += (y[i] - b0 - b1 * x[i]) ** 2
  const s = Math.sqrt(rss / (n - 2))
  return { b0, b1, se1: s / Math.sqrt(sxx), se0: s * Math.sqrt(1 / n + (mx * mx) / sxx) }
}

describe('createDeriver — Ohm end to end', () => {
  it('imports, recommends a scatter of V against I and fits slope and SE as the oracle', () => {
    const { doc, rawTables, dataset } = ohmProject()
    const out = createDeriver()(doc, rawTables)
    expect(out.plot?.id).toBe('plot_1')
    expect(out.plotView?.type).toBe('scatter')
    expect(out.series).toHaveLength(1)
    const s = out.series[0]
    expect(s.xColumn.id).toBe(colId(dataset, 'I'))
    expect(s.yColumn.id).toBe(colId(dataset, 'V'))
    expect(s.index).toBe(0)
    const fit = fitOk(s)
    const L = ref('ohm').linear as { coefficients: string[]; se: string[]; s: string; r2: string }
    expectRel(fit.params[1].value, L.coefficients[1], 1e-12) // 47.1472727273
    expectRel(fit.params[1].se, L.se[1], 1e-10) // 0.0750720498733
    expectRel(fit.params[0].value, L.coefficients[0], 1e-10) // −0.009
    expectRel(fit.params[0].se, L.se[0], 1e-10)
    expectRel(fit.s, L.s, 1e-10)
    expect(fit.provenance.nUsed).toBe(10)
    expect(fit.provenance.nTotal).toBe(10)
    expect(fit.provenance.usesGroupMeans).toBe(false)
    expect(s.data.sample.nActive).toBe(10)
    expectCountInvariant(s.data.sample)
    expect(s.xBars).toBeNull()
    expect(s.yBars).toBeNull()
    expect(s.replicate).toBeNull()
    expect(s.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(out.views.get(dataset.id)?.rowIds.length).toBe(10)
  })

  it('excluding grid row 3 gives n = 9 and the coefficients of an independent recomputation', () => {
    const { doc, rawTables, dataset } = ohmProject()
    const derive = createDeriver()
    const before = fitOk(derive(doc, rawTables).series[0])
    const excluded = produce(doc, (d) => {
      d.exclusions.push({
        id: 'ex_1' as ExclusionId,
        datasetId: dataset.id,
        rowIds: [3 as RowId],
        reason: 'measurement-problem',
        note: 'loose contact',
        createdAt: NOW,
      })
    })
    const s = derive(excluded, rawTables).series[0]
    const fit = fitOk(s)
    expect(fit).not.toBe(before)
    expect(fit.provenance.nUsed).toBe(9)
    expect(fit.provenance.nTotal).toBe(10)
    expect(fit.provenance.inactive.excluded).toBe(1)
    expect(fit.provenance.rowIdsUsed).not.toContain(3)
    expect(s.data.sample.nActive).toBe(9)
    expect(s.data.sample.counts.excluded).toBe(1)
    expectCountInvariant(s.data.sample)

    // Independent recomputation from the CSV text without its 3rd data line (I = 0.030, V = 1.402).
    const lines = readFileSync(resolve('src/examples/ohm.csv'), 'utf8').trim().split(/\r?\n/).slice(1)
    const kept = lines.filter((_, k) => k !== 2).map((l) => l.split(',').map(Number))
    expect(kept).toHaveLength(9)
    const o = ols(
      kept.map((r) => r[0]),
      kept.map((r) => r[1]),
    )
    expectRel(fit.params[1].value, o.b1, 1e-12)
    expectRel(fit.params[0].value, o.b0, 1e-9)
    expectRel(fit.params[1].se, o.se1, 1e-9)
    expectRel(fit.params[0].se, o.se0, 1e-9)
    expect(Math.abs(fit.params[1].value - before.params[1].value)).toBeGreaterThan(1e-6)

    const inactive = s.issues.find((i) => i.code === 'I_ROWS_INACTIVE')
    expect(inactive?.params).toMatchObject({ n: 9, total: 10, excluded: 1, filtered: 0, missing: 0 })
    expect(inactive?.rows).toEqual([3])
  })
})

describe('createDeriver — invariance', () => {
  it('scale, plot type, visibility, error-bar visibility, style and fit display keep the same fit', () => {
    const { doc, rawTables, dataset } = ohmProject()
    const derive = createDeriver()
    const base = derive(doc, rawTables)
    const s0 = base.series[0]
    const fit0 = fitOk(s0)
    const V = colId(dataset, 'V')
    const I = colId(dataset, 'I')
    const sumV = base.columnSummary(dataset.id, V)
    const sumI = base.columnSummary(dataset.id, I)
    expect(sumV?.n).toBe(10)

    const variants: [string, ProjectDoc][] = [
      [
        'log axes',
        produce(doc, (d) => {
          d.plots[0].xAxis.scale = 'log'
          d.plots[0].yAxis.scale = 'log'
        }),
      ],
      ['line plot', produce(doc, (d) => void (d.plots[0].type = 'line'))],
      ['hidden series', produce(doc, (d) => void (d.plots[0].series[0].visible = false))],
      ['error bars hidden', produce(doc, (d) => void (d.plots[0].series[0].errorBars.visible = false))],
      [
        'style',
        produce(doc, (d) => {
          d.plots[0].series[0].style.markerSize = 11
          d.plots[0].series[0].style.paletteIndex = 3
          d.plots[0].series[0].style.symbol = 'diamond'
        }),
      ],
      ['fit bands shown', produce(doc, (d) => void (d.fits[0].show.confidenceBand = true))],
      [
        'curve range',
        produce(doc, (d) => void (d.fits[0].curveRange = { mode: 'extend', min: 0, max: 0.2 })),
      ],
      ['title and legend', produce(doc, (d) => void (d.plots[0].title = 'Ohm'))],
      ['axis range', produce(doc, (d) => void (d.plots[0].yAxis.range = { mode: 'fixed', min: 0, max: 5 }))],
    ]
    for (const [label, variant] of variants) {
      const out = derive(variant, rawTables)
      const s = out.allSeries[0]
      expect(s.fit, label).toBe(fit0)
      expect(s.data.sample, label).toBe(s0.data.sample)
      expect(out.columnSummary(dataset.id, V), label).toBe(sumV)
      expect(out.columnSummary(dataset.id, I), label).toBe(sumI)
      expect(out.views.get(dataset.id), label).toBe(base.views.get(dataset.id))
      expectCountInvariant(s.data.sample)
    }
  })

  it('style alone does not rebuild the series data; a scale change rebuilds only `render`', () => {
    const { doc, rawTables } = ohmProject()
    const derive = createDeriver()
    const s0 = derive(doc, rawTables).series[0]
    const styled = derive(
      produce(doc, (d) => void (d.plots[0].series[0].style.markerSize = 11)),
      rawTables,
    ).series[0]
    expect(styled).not.toBe(s0) // the spec changed
    expect(styled.data).toBe(s0.data)
    expect(styled.fit).toBe(s0.fit)
    const logged = derive(
      produce(doc, (d) => void (d.plots[0].xAxis.scale = 'log')),
      rawTables,
    ).series[0]
    expect(logged.data).not.toBe(s0.data)
    expect(logged.data.x).toBe(s0.data.x)
    expect(logged.data.y).toBe(s0.data.y)
    expect(logged.data.sample).toBe(s0.data.sample)
    expect(logged.fit).toBe(s0.fit)
  })

  it('switching to a histogram hides the series but keeps their fits alive for the way back', () => {
    const { doc, rawTables } = ohmProject()
    const derive = createDeriver()
    const fit0 = fitOk(derive(doc, rawTables).series[0])
    const hist = produce(doc, (d) => void (d.plots[0].type = 'histogram'))
    const h = derive(hist, rawTables)
    expect(h.plotView?.type).toBe('histogram')
    expect(h.series).toEqual([])
    expect(h.allSeries[0].fit).toBe(fit0)
    const back = produce(hist, (d) => void (d.plots[0].type = 'scatter'))
    expect(derive(back, rawTables).series[0].fit).toBe(fit0)
  })

  it('a log axis with a value ≤ 0 hides it in the figure only: sample, n and fit unchanged', () => {
    const ds = notebook('ds_nb', { x: ['1', '2', '3', '4', '5'], y: ['2.1', '-0.5', '6.2', '7.9', '10.1'] })
    const plot: PlotSpec = {
      ...initialPlot(ds, buildDatasetView(ds, null), 'p' as PlotId, 'ser_nb' as SeriesId).plot,
    }
    const doc = produce(project([ds], plot, [fitSpec('fit_nb', 'ser_nb')]) as ProjectDoc, () => {})
    expect(plot.series[0]?.y).toBe('y')
    const derive = createDeriver()
    const lin = derive(doc, {}).series[0]
    const log = derive(
      produce(doc, (d) => void (d.plots[0].yAxis.scale = 'log')),
      {},
    ).series[0]
    expect(Array.from(lin.data.render)).toEqual([0, 0, 0, 0, 0])
    expect(Array.from(log.data.render)).toEqual([0, RENDER.logDomain, 0, 0, 0])
    expect(log.data.sample).toBe(lin.data.sample)
    expect(log.data.sample.nActive).toBe(5)
    expect(log.fit).toBe(lin.fit)
    expect(fitOk(log).provenance.nUsed).toBe(5)
  })
})

describe('createDeriver — memoisation', () => {
  it('the same references return the very same DerivedProject', () => {
    const { doc, rawTables } = ohmProject()
    const derive = createDeriver()
    const a = derive(doc, rawTables)
    expect(derive(doc, rawTables)).toBe(a)
  })

  it('an unrelated edit returns the same views, series array, series objects and fits', () => {
    const { doc, rawTables } = ohmProject()
    const derive = createDeriver()
    const a = derive(doc, rawTables)
    const b = derive(
      produce(doc, (d) => void (d.name = 'renamed project')),
      { ...rawTables },
    )
    expect(b).not.toBe(a)
    expect(b.views).toBe(a.views)
    expect(b.series).toBe(a.series)
    expect(b.series[0]).toBe(a.series[0])
    expect(b.plotView).toBe(a.plotView)
  })

  it('renaming a column keeps the view and the fit, and shows the new name', () => {
    const { doc, rawTables, dataset } = ohmProject()
    const derive = createDeriver()
    const a = derive(doc, rawTables)
    const V = colId(dataset, 'V')
    const renamed = produce(doc, (d) => {
      const c = d.datasets[0].columns.find((m) => m.id === V)!
      c.name = 'Voltage'
    })
    const b = derive(renamed, rawTables)
    expect(b.views.get(dataset.id)).toBe(a.views.get(dataset.id))
    expect(b.series[0].fit).toBe(a.series[0].fit)
    expect(b.series[0].yColumn.name).toBe('Voltage')
  })

  it('changing a column unit recomputes the fit with the new parameter units', () => {
    const { doc, rawTables, dataset } = ohmProject()
    const derive = createDeriver()
    const a = fitOk(derive(doc, rawTables).series[0])
    expect(a.params[1].unit).toBe('V/A')
    const V = colId(dataset, 'V')
    const b = fitOk(
      derive(
        produce(doc, (d) => {
          const c = d.datasets[0].columns.find((m) => m.id === V)!
          c.unit = 'mV'
          c.unitSource = 'user'
        }),
        rawTables,
      ).series[0],
    )
    expect(b).not.toBe(a)
    expect(b.params[1].unit).toBe('mV/A')
    expect(b.params[1].value).toBe(a.params[1].value)
  })

  it('an exclusion in another dataset does not recompute this dataset', () => {
    const ohm = load('ohm.csv', 'ds_ohm')
    const ff = load('freeFall.csv', 'ds_ff')
    const plot = initialPlot(
      ohm.dataset,
      buildDatasetView(ohm.dataset, ohm.raw),
      'plot_1' as PlotId,
      'ser_ohm' as SeriesId,
    ).plot
    plot.series.push(series('ser_ff', 'ds_ff', colId(ff.dataset, 't'), colId(ff.dataset, 'y')))
    const doc = produce(
      project([ohm.dataset, ff.dataset], plot, [
        fitSpec('fit_ohm', 'ser_ohm'),
        fitSpec('fit_ff', 'ser_ff', { type: 'polynomial', degree: 2 }),
      ]) as ProjectDoc,
      () => {},
    )
    const rawTables = { [ohm.raw.id]: ohm.raw, [ff.raw.id]: ff.raw }
    const derive = createDeriver()
    const a = derive(doc, rawTables)
    expect(a.series).toHaveLength(2)
    expect(a.series[1].index).toBe(1)
    const b = derive(
      produce(doc, (d) => {
        d.exclusions.push({
          id: 'ex_ff' as ExclusionId,
          datasetId: 'ds_ff' as DatasetId,
          rowIds: [1 as RowId],
          reason: 'other',
          note: '',
          createdAt: NOW,
        })
      }),
      rawTables,
    )
    expect(b.series[0]).toBe(a.series[0])
    expect(b.series[0].fit).toBe(a.series[0].fit)
    expect(fitOk(b.series[1]).provenance.nUsed).toBe(14)
    expect(fitOk(a.series[1]).provenance.nUsed).toBe(15)
  })
})

describe('createDeriver — one derivation per plot', () => {
  const A = 'plot_1' as PlotId
  const B = 'plot_2' as PlotId

  /** Ohm with two plots: A = V against I with a linear fit (active), B = I against V with a quadratic fit. */
  function twoPlots() {
    const { doc, rawTables, dataset } = ohmProject()
    const b: PlotSpec = {
      ...doc.plots[0],
      id: B,
      name: 'B',
      series: [series('ser_b', 'ds_ohm', colId(dataset, 'V'), colId(dataset, 'I'))],
    }
    const two = produce(doc, (d) => {
      d.plots.push(b)
      d.fits.push(fitSpec('fit_b', 'ser_b', { type: 'polynomial', degree: 2 }))
    })
    return { doc: two, rawTables }
  }

  it('derives the plot asked for; the dataset stage is shared; no id → the active plot', () => {
    const { doc, rawTables } = twoPlots()
    const derive = createDeriver()
    const a = derive(doc, rawTables, A)
    const b = derive(doc, rawTables, B)
    expect(a.plot?.id).toBe(A)
    expect(b.plot?.id).toBe(B)
    expect(a.series[0].fitSpec?.id).toBe('fit_ohm')
    expect(b.series[0].fitSpec?.id).toBe('fit_b')
    expect(b.series[0].xColumn.name).toBe('V')
    expect(b.parts.data).toBe(a.parts.data)
    expect(b.views).toBe(a.views)
    expect(b.columnSample).toBe(a.columnSample)
    expect(b.parts.plot).not.toBe(a.parts.plot)
    expect(derive(doc, rawTables, A)).toBe(a)
    expect(derive(doc, rawTables)).toBe(a)
    const noActive = produce(doc, (d) => void (d.activePlotId = null))
    expect(derive(noActive, rawTables).plot?.id).toBe(A)
    expect(
      derive(
        produce(doc, (d) => void (d.activePlotId = B)),
        rawTables,
      ).parts.plot,
    ).toBe(b.parts.plot)
  })

  it('editing plot A or its fit returns the identical plot part for B', () => {
    const { doc, rawTables } = twoPlots()
    const derive = createDeriver()
    const a = derive(doc, rawTables, A)
    const b = derive(doc, rawTables, B)
    const styledA = produce(doc, (d) => {
      d.plots[0].title = 'A'
      d.plots[0].series[0].style.markerSize = 11
    })
    const a2 = derive(styledA, rawTables, A)
    const b2 = derive(styledA, rawTables, B)
    expect(b2.parts.plot).toBe(b.parts.plot)
    expect(b2.parts.data).toBe(b.parts.data)
    // The document is always the current one: a new object, with the same parts.
    expect(b2).not.toBe(b)
    expect(b2.doc).toBe(styledA)
    expect(b2.series).toBe(b.series)
    expect(a2.parts.plot).not.toBe(a.parts.plot)
    expect(a2.series[0].fit).toBe(a.series[0].fit)

    const refitA = produce(styledA, (d) => void (d.fits[0].model = { type: 'polynomial', degree: 2 }))
    expect(derive(refitA, rawTables, B).parts.plot).toBe(b.parts.plot)
    expect(fitOk(derive(refitA, rawTables, A).series[0]).params).toHaveLength(3)
  })

  it('switching the active plot and back keeps the fits of both', () => {
    const { doc, rawTables } = twoPlots()
    const derive = createDeriver()
    const onA = derive(doc, rawTables)
    const docB = produce(doc, (d) => void (d.activePlotId = B))
    const onB = derive(docB, rawTables)
    expect(onB.plot?.id).toBe(B)
    const backOnA = derive(
      produce(docB, (d) => void (d.activePlotId = A)),
      rawTables,
    )
    expect(backOnA.series[0].fit).toBe(onA.series[0].fit)
    expect(backOnA.series[0].data).toBe(onA.series[0].data)
    expect(backOnA.parts.plot).toBe(onA.parts.plot)
  })

  it('fits are computed only for the plots that are derived', () => {
    const { doc, rawTables } = twoPlots()
    const fitted = () => vi.mocked(runFit).mock.calls.map(([spec]) => spec.id)
    vi.mocked(runFit).mockClear()
    const derive = createDeriver()
    derive(doc, rawTables, A)
    expect(fitted()).toEqual(['fit_ohm'])
    derive(doc, rawTables, B)
    expect(fitted()).toEqual(['fit_ohm', 'fit_b'])
    const refitB = produce(doc, (d) => void (d.fits[1].model = { type: 'linear' }))
    derive(refitB, rawTables, A)
    expect(fitted()).toEqual(['fit_ohm', 'fit_b'])
    derive(refitB, rawTables, B)
    expect(fitted()).toEqual(['fit_ohm', 'fit_b', 'fit_b'])
  })

  it('a deleted plot is dropped from the caches: brought back, it is derived afresh', () => {
    const { doc, rawTables } = twoPlots()
    const derive = createDeriver()
    const a = derive(doc, rawTables, A)
    const b = derive(doc, rawTables, B)
    const without = produce(doc, (d) => {
      d.plots.splice(1, 1)
      d.fits.splice(1, 1)
    })
    expect(derive(without, rawTables, A).parts.plot).toBe(a.parts.plot)
    // An id that is not in the document derives no plot (never another plot in its place).
    const gone = derive(without, rawTables, B)
    expect(gone.plot).toBeNull()
    expect(gone.series).toEqual([])
    expect(gone.parts.data).toBe(a.parts.data)
    // The very same spec and fit back (an undo): nothing of the old state survives, the values agree.
    const back = produce(without, (d) => {
      d.plots.push(doc.plots[1])
      d.fits.push(doc.fits[1])
    })
    const b2 = derive(back, rawTables, B)
    expect(b2.parts.plot).not.toBe(b.parts.plot)
    expect(b2.series[0].fit).not.toBe(b.series[0].fit)
    expect(b2.series[0].fit).toEqual(b.series[0].fit)
    expect(derive(back, rawTables, A).series[0].fit).toBe(a.series[0].fit)
  })

  it('a new rawTables object with the same tables keeps both stages and the result', () => {
    const { doc, rawTables } = twoPlots()
    const derive = createDeriver()
    const a = derive(doc, rawTables, A)
    const again = derive(doc, { ...rawTables, raw_other: rawTables[Object.keys(rawTables)[0]] }, A)
    expect(again.parts.data).toBe(a.parts.data)
    expect(again).toBe(a)
  })

  it('a dataset edit rebuilds the dataset stage for every plot, keeping what it does not touch', () => {
    const { doc, rawTables } = twoPlots()
    const derive = createDeriver()
    const a = derive(doc, rawTables, A)
    const b = derive(doc, rawTables, B)
    const excluded = produce(doc, (d) => {
      d.exclusions.push({
        id: 'ex_1' as ExclusionId,
        datasetId: 'ds_ohm' as DatasetId,
        rowIds: [3 as RowId],
        reason: 'other',
        note: '',
        createdAt: NOW,
      })
    })
    const a2 = derive(excluded, rawTables, A)
    const b2 = derive(excluded, rawTables, B)
    expect(a2.parts.data).not.toBe(a.parts.data)
    expect(b2.parts.data).toBe(a2.parts.data)
    expect(b2.parts.plot).not.toBe(b.parts.plot)
    expect(a2.parts.data.doc.exclusions).toBe(excluded.exclusions)
    expect(fitOk(a2.series[0]).provenance.nUsed).toBe(9)
    expect(fitOk(b2.series[0]).provenance.nUsed).toBe(9)
  })
})

describe('createDeriver — uncertainty and replicates', () => {
  it('free fall: u(y) is suggested, never applied; once chosen the y bars equal the u(y) column', () => {
    const { dataset, raw } = load('freeFall.csv', 'ds_ff')
    const { plot, recommendation } = initialPlot(
      dataset,
      buildDatasetView(dataset, raw),
      'plot_1' as PlotId,
      'ser_ff' as SeriesId,
    )
    const uy = colId(dataset, 'u(y)')
    expect(recommendation.uncertaintyColumn).toBe(uy)
    const doc = produce(
      project([dataset], plot, [
        fitSpec('fit_ff', 'ser_ff', { type: 'polynomial', degree: 2 }),
      ]) as ProjectDoc,
      () => {},
    )
    const rawTables = { [raw.id]: raw }
    const derive = createDeriver()
    const a = derive(doc, rawTables).series[0]
    expect(a.yBars).toBeNull()
    expect(fitOk(a).uComparison).toBeNull()

    const withBars = produce(doc, (d) => {
      d.plots[0].series[0].errorBars.y = {
        kind: 'measurement',
        origin: 'user',
        source: { type: 'column', column: uy },
        meaning: { type: 'standard' },
      }
    })
    const b = derive(withBars, rawTables).series[0]
    const expected = readFileSync(resolve('src/examples/freeFall.csv'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((l) => Number(l.split(',')[2]))
    expect(Array.from(b.yBars!.plus)).toEqual(expected)
    expect(b.yBars!.minus).toBeNull()
    expect(b.yBars!.descriptor.labelKey).toBe('uncertainty.label.measurement.standard')
    const fit = fitOk(b)
    const Q = ref('freeFall').quadratic as { coefficients: string[] }
    expectRel(fit.params[2].value, Q.coefficients[2], 1e-10) // a₂ = 4.9293491435
    expect(fit.uComparison).not.toBeNull()
    expect(fit.uComparison!.medianU).toBeCloseTo(0.004, 15)
    // The bars feed only the neutral s/u comparison: the coefficients are identical (unweighted OLS).
    expect(fit.params.map((p) => p.value)).toEqual(fitOk(a).params.map((p) => p.value))
    // Hiding the bars changes nothing in the arrays.
    const hidden = derive(
      produce(withBars, (d) => void (d.plots[0].series[0].errorBars.visible = false)),
      rawTables,
    ).series[0]
    expect(hidden.yBars).toBe(b.yBars)
    expect(hidden.fit).toBe(b.fit)
  })

  it('an uncertainty COLUMN on a derived axis is refused (E_DERIVED_UNCERTAINTY): no u(V) bars on ln V', () => {
    const ds = notebook(
      'ds_lnv',
      {
        I: ['0.01', '0.02', '0.03', '0.04', '0.05'],
        V: ['0.46', '0.94', '1.40', '1.87', '2.34'],
        uV: ['0.02', '0.02', '0.02', '0.02', '0.02'],
      },
      [
        { id: 'lnV', spec: { op: 'ln', input: 'V' as ColumnId } },
        { id: 'lnI', spec: { op: 'ln', input: 'I' as ColumnId } },
      ],
    )
    const fromColumn = {
      kind: 'measurement',
      origin: 'instrument',
      source: { type: 'column', column: 'uV' as ColumnId },
      meaning: { type: 'standard' },
    } as const
    const s0 = series('ser_ln', 'ds_lnv', 'I', 'lnV')
    const plot: PlotSpec = {
      ...initialPlot(ds, buildDatasetView(ds, null), 'p' as PlotId, 's' as SeriesId).plot,
      series: [{ ...s0, errorBars: { x: fromColumn, y: fromColumn, visible: true } }],
    }
    const doc = produce(project([ds], plot, [fitSpec('fit_ln', 'ser_ln')]) as ProjectDoc, () => {})
    const derive = createDeriver()
    const s = derive(doc, {}).series[0]
    // y = ln V is derived: u(V) is not u(ln V) and nothing is propagated → every bar invalid, none drawn.
    expect(Array.from(s.yBars!.plus).every(Number.isNaN)).toBe(true)
    expect(Array.from(s.yBars!.status).every((st) => st === CELL.invalid)).toBe(true)
    const refused = s.yBars!.issues.find((i) => i.code === 'E_DERIVED_UNCERTAINTY')
    expect(refused).toMatchObject({ params: { column: 'lnV' }, columnId: 'lnV', severity: 'error' })
    expect(s.issues).toContain(refused)
    // The s / u comparison never mixes ln units with volts.
    expect(fitOk(s).uComparison).toBeNull()
    // x = I is a raw column: the same spec on x is resolved normally.
    expect(Array.from(s.xBars!.plus)).toEqual([0.02, 0.02, 0.02, 0.02, 0.02])
    expect(s.xBars!.issues).toEqual([])

    // Asymmetric columns on a derived x: both sides NaN.
    const asym = produce(doc, (d) => {
      const sp = d.plots[0].series[0]
      sp.x = 'lnI' as ColumnId
      sp.errorBars.x = {
        ...fromColumn,
        source: { type: 'columnAsymmetric', plus: 'uV' as ColumnId, minus: 'uV' as ColumnId },
      }
    })
    const a = derive(asym, {}).series[0]
    expect(Array.from(a.xBars!.plus).every(Number.isNaN)).toBe(true)
    expect(Array.from(a.xBars!.minus!).every(Number.isNaN)).toBe(true)
    expect(a.xBars!.issues.map((i) => i.code)).toEqual(['E_DERIVED_UNCERTAINTY'])

    // A typed value is the user's statement about ln V itself: drawn as given, no issue.
    const typed = produce(doc, (d) => {
      d.plots[0].series[0].errorBars.y = { ...fromColumn, source: { type: 'absolute', value: 0.01 } }
    })
    const t = derive(typed, {}).series[0]
    expect(Array.from(t.yBars!.plus)).toEqual([0.01, 0.01, 0.01, 0.01, 0.01])
    expect(t.yBars!.issues).toEqual([])
    expect(fitOk(t).uComparison).not.toBeNull()
  })

  it('Beer–Lambert SD by identical x: 6 groups of 3 on the groupMeans side, the fit uses the 18 observations', () => {
    const { dataset, raw } = load('beerLambert.csv', 'ds_bl')
    const { plot } = initialPlot(
      dataset,
      buildDatasetView(dataset, raw),
      'plot_1' as PlotId,
      'ser_bl' as SeriesId,
    )
    expect(plot.series[0].x).toBe(colId(dataset, 'c'))
    expect(plot.series[0].y).toBe(colId(dataset, 'A'))
    const doc = produce(project([dataset], plot, [fitSpec('fit_bl', 'ser_bl')]) as ProjectDoc, (d) => {
      d.plots[0].series[0].errorBars.y = { kind: 'sd', grouping: { by: 'sameX' } }
    })
    const s = createDeriver()(doc, { [raw.id]: raw }).series[0]
    expect(s.yBars).toBeNull()
    expect(s.replicate?.groups).toHaveLength(6)
    expect(s.replicate!.groups.every((g) => g.n === 3)).toBe(true)
    const groups = ref('beerLambert').groups as unknown as { sd: string }[]
    expectRel(s.replicate!.groups[0].sd, groups[0].sd, 1e-12)
    expect(s.replicate!.bars.descriptor.labelKey).toBe('uncertainty.label.sd')
    const fit = fitOk(s)
    expect(fit.provenance.nUsed).toBe(18)
    expect(fit.provenance.usesGroupMeans).toBe(false)
    const L = ref('beerLambert').linear as { coefficients: string[] }
    expectRel(fit.params[1].value, L.coefficients[1], 1e-12)
    expect(fit.uComparison).toBeNull()
    // A real spread in every group, and x constant inside each: no zero-spread or mixed-x note.
    expect(s.issues.map((i) => i.code)).not.toContain('I_ZERO_SPREAD')
    expect(s.issues.map((i) => i.code)).not.toContain('W_GROUP_X_VARIES')
  })

  it('column grouping: x varying inside a group is reported unless the x column is an identifier', () => {
    // Pendulum: x = trial number (role identifier), SEM per observer → the trial only places the group.
    const { dataset, raw } = load('pendulum.csv', 'ds_p')
    expect(dataset.columns.find((c) => c.name === 'trial')!.role).toBe('identifier')
    const plot: PlotSpec = {
      ...initialPlot(dataset, buildDatasetView(dataset, raw), 'plot_1' as PlotId, 'ser_x' as SeriesId).plot,
      type: 'scatter',
      series: [series('ser_p', 'ds_p', colId(dataset, 'trial'), colId(dataset, 'T'))],
    }
    const doc = produce(project([dataset], plot) as ProjectDoc, (d) => {
      d.plots[0].series[0].errorBars.y = {
        kind: 'sem',
        grouping: { by: 'column', column: colId(dataset, 'observer') },
      }
    })
    const derive = createDeriver()
    const s = derive(doc, { [raw.id]: raw }).series[0]
    expect(s.replicate!.groups.map((g) => [g.key, g.n])).toEqual([
      ['A', 12],
      ['B', 12],
    ])
    expect(s.issues.map((i) => i.code)).not.toContain('W_GROUP_X_VARIES')
    // The same column read as a measured quantity: each observer's mean mixes 12 different x values.
    const measured = produce(doc, (d) => {
      const trial = d.datasets[0].columns.find((c) => c.name === 'trial')!
      trial.role = 'measurement'
    })
    const m = derive(measured, { [raw.id]: raw }).series[0]
    const varies = m.issues.find((i) => i.code === 'W_GROUP_X_VARIES')
    expect(varies?.params).toEqual({ count: 2 })
    expect(varies?.rows).toHaveLength(24)
  })
})

describe('createDeriver — problems in the data never throw', () => {
  it('a fit on a categorical axis → E_COLUMN_NOT_NUMERIC, reported once', () => {
    const { dataset, raw } = load('pendulum.csv', 'ds_p')
    const plot: PlotSpec = {
      ...initialPlot(dataset, buildDatasetView(dataset, raw), 'plot_1' as PlotId, 'ser_x' as SeriesId).plot,
      type: 'scatter',
      series: [series('ser_p', 'ds_p', colId(dataset, 'observer'), colId(dataset, 'T'))],
    }
    const doc = produce(project([dataset], plot, [fitSpec('fit_p', 'ser_p')]) as ProjectDoc, () => {})
    const s = createDeriver()(doc, { [raw.id]: raw }).series[0]
    expect(s.fit?.status).toBe('error')
    if (s.fit?.status !== 'error') return
    expect(s.fit.error.code).toBe('E_COLUMN_NOT_NUMERIC')
    expect(s.fit.error.params).toEqual({ column: 'observer' })
    expect(s.fit.provenance.nUsed).toBe(0)
    expect(s.issues.filter((i) => i.code === 'E_COLUMN_NOT_NUMERIC')).toHaveLength(1)
    expect(s.data.sample.nActive).toBe(0)
    expectCountInvariant(s.data.sample)
  })

  it('a derived column out of its domain → E_TRANSFORM_DOMAIN {count, op} with the rows', () => {
    const ds = notebook('ds_nb', { x: ['1', '2', '3', '4', '5', '6'], y: ['1', '-2', '0', '4', '5', '7'] }, [
      { id: 'lny', spec: { op: 'ln', input: 'y' as ColumnId } },
    ])
    const plot: PlotSpec = {
      ...initialPlot(ds, buildDatasetView(ds, null), 'p' as PlotId, 's' as SeriesId).plot,
      series: [series('ser_ln', 'ds_nb', 'x', 'lny')],
    }
    const doc = produce(project([ds], plot, [fitSpec('fit_ln', 'ser_ln')]) as ProjectDoc, () => {})
    const out = createDeriver()(doc, {})
    const domain = out.datasetIssues.get(ds.id)!.find((i) => i.code === 'E_TRANSFORM_DOMAIN')
    expect(domain?.params).toMatchObject({ count: 2, op: 'ln' })
    expect(domain?.rows).toEqual([1, 2])
    expect(domain?.columnId).toBe('lny')
    expect(out.issues).toContain(domain)
    const s = out.series[0]
    expect(s.data.sample.counts.invalid).toBe(2)
    expectCountInvariant(s.data.sample)
    const fit = fitOk(s)
    expect(fit.provenance.nUsed).toBe(4)
    expect(fit.provenance.rowIdsUsed).toEqual([0, 3, 4, 5])
  })

  it('too few active points → the fit error is a series issue, never an exception', () => {
    const ds = notebook('ds_nb', { x: ['1', '2', 'abc'], y: ['1', '2', '3'] })
    const plot: PlotSpec = initialPlot(ds, buildDatasetView(ds, null), 'p' as PlotId, 'ser' as SeriesId).plot
    const doc = produce(project([ds], plot, [fitSpec('f', 'ser')]) as ProjectDoc, () => {})
    const s = createDeriver()(doc, {}).series[0]
    expect(s.fit?.status).toBe('error')
    expect(s.issues).toContainEqual(expect.objectContaining({ code: 'E_TOO_FEW_POINTS' }))
    expect(s.data.sample.counts.invalid).toBe(1)
  })

  it('y values in rows where x is missing → I_SAMPLE_DIFFERS (column n vs fit pairs)', () => {
    const ds = notebook('ds_nb', { x: ['1', '2', '', '4', '5'], y: ['2', '4', '6', '8', '10.1'] })
    const plot: PlotSpec = {
      ...initialPlot(ds, buildDatasetView(ds, null), 'p' as PlotId, 'ser' as SeriesId).plot,
    }
    const doc = produce(project([ds], plot, [fitSpec('f', 'ser')]) as ProjectDoc, () => {})
    const out = createDeriver()(doc, {})
    const s = out.series[0]
    expect(fitOk(s).provenance.nUsed).toBe(4)
    const differs = s.issues.find((i) => i.code === 'I_SAMPLE_DIFFERS')
    expect(differs?.params).toEqual({ column: 'y', nCol: 5, nFit: 4 })
    expect(out.columnSummary(ds.id, 'y' as ColumnId)?.n).toBe(5)
    expect(out.columnSummary(ds.id, 'x' as ColumnId)?.n).toBe(4)
    expect(s.issues.find((i) => i.code === 'I_ROWS_INACTIVE')?.params).toMatchObject({
      n: 4,
      total: 5,
      missing: 1,
    })
  })

  it('a series pointing at a deleted column → E_INTERNAL_GUARD, no exception', () => {
    const { doc, rawTables } = ohmProject()
    const broken = produce(doc, (d) => void (d.plots[0].series[0].y = 'col_gone' as ColumnId))
    const out = createDeriver()(broken, rawTables)
    expect(out.series).toEqual([])
    expect(out.issues).toContainEqual(
      expect.objectContaining({
        code: 'E_INTERNAL_GUARD',
        params: { where: 'series', ref: 'ser_ohm', problem: 'dangling' },
      }),
    )
  })

  it('a missing raw table gives an empty view instead of an exception', () => {
    const { doc } = ohmProject()
    const out = createDeriver()(doc, {})
    expect(out.views.get('ds_ohm' as DatasetId)?.rowIds.length).toBe(0)
    expect(out.series[0].fit?.status).toBe('error')
  })
})

describe('createDeriver — column statistics and samples', () => {
  it('pendulum: column summaries, observer filter, disabled filters and the count invariant', () => {
    const { dataset, raw } = load('pendulum.csv', 'ds_p')
    const { plot } = initialPlot(
      dataset,
      buildDatasetView(dataset, raw),
      'plot_1' as PlotId,
      'ser' as SeriesId,
    )
    expect(plot.type).toBe('box')
    const doc = produce(project([dataset], plot) as ProjectDoc, () => {})
    const rawTables = { [raw.id]: raw }
    const derive = createDeriver()
    const out = derive(doc, rawTables)
    expect(out.series).toEqual([])
    const T = colId(dataset, 'T')
    const sum = out.columnSummary(dataset.id, T)!
    expect(sum.n).toBe(24)
    expect(sum.n + sum.nMissing + sum.nInvalid + sum.nExcluded + sum.nFiltered).toBe(24)
    expect(out.columnSummary(dataset.id, colId(dataset, 'observer'))).toBeNull()
    expect(out.columnSummary(dataset.id, 'col_nope' as ColumnId)).toBeNull()
    expect(out.columnSummary('ds_nope' as DatasetId, T)).toBeNull()
    expect(out.columnSample('ds_nope' as DatasetId, [T])).toBeNull()
    const sample = out.columnSample(dataset.id, [T])!
    expect(out.columnSample(dataset.id, [T])).toBe(sample)
    expectCountInvariant(sample)

    const obs = colId(dataset, 'observer')
    const filtered = produce(doc, (d) => {
      d.filters.push({
        id: 'f_1' as FilterId,
        datasetId: dataset.id,
        enabled: true,
        type: 'category',
        column: obs,
        keep: ['A'],
      })
    })
    const f = derive(filtered, rawTables)
    const sa = f.columnSummary(dataset.id, T)!
    expect(sa.n).toBe(12)
    expect(sa.nFiltered).toBe(12)
    expectRel(sa.mean, 1.73166666667, 1e-11)
    expectRel(sa.sd, 0.0285508583961, 1e-11)
    expectCountInvariant(f.columnSample(dataset.id, [T])!)

    // A disabled filter acts like no filter; toggling it back keeps one summary object per state.
    const disabled = produce(filtered, (d) => void (d.filters[0].enabled = false))
    const off = derive(disabled, rawTables)
    expect(off.columnSummary(dataset.id, T)).toStrictEqual(sum)
    const renamedFilter = produce(disabled, (d) => {
      d.datasets[0].name = 'Pendulum (renamed)'
    })
    expect(derive(renamedFilter, rawTables).columnSummary(dataset.id, T)).toBe(
      off.columnSummary(dataset.id, T),
    )
  })

  it('blank rows: I_BLANK_ROWS in the dataset issues, outside nTotal', () => {
    const r = importText('x,y\n1,2\n\n2,4.1\n3,5.9\n', { kind: 'clipboard', fileName: null })
    if (!r.ok) throw new Error('import failed')
    const d = r.value
    const ds: ImportedDataset = {
      id: 'ds_b' as DatasetId,
      name: 'b',
      createdAt: NOW,
      example: null,
      columns: d.columns,
      notes: d.notes,
      origin: 'import',
      rawTableId: d.rawTable.id,
      layout: d.layout,
    }
    const { plot } = initialPlot(ds, buildDatasetView(ds, d.rawTable), 'p' as PlotId, 's' as SeriesId)
    const out = createDeriver()(
      produce(project([ds], plot) as ProjectDoc, () => {}),
      { [d.rawTable.id]: d.rawTable },
    )
    expect(out.datasetIssues.get(ds.id)).toContainEqual(
      expect.objectContaining({ code: 'I_BLANK_ROWS', params: { count: 1 } }),
    )
    const s = out.series[0]
    expect(s.data.sample.nTotal).toBe(3)
    expect(s.data.sample.nActive).toBe(3)
    expect(Array.from(s.data.sample.reason)).toEqual([INACTIVE.active, INACTIVE.active, INACTIVE.active])
  })
})
