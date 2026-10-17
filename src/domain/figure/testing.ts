/**
 * TEST HELPERS for the figure tests (not used by the app): projects built through the real import and
 * derivation pipeline (importText → ProjectDoc → createDeriver), plus a fake translator that returns
 * `${key}|${JSON.stringify(params)}` so tests can assert which message and parameters were chosen.
 */
import { createDeriver, type DerivedProject } from '@/domain/derive/pipeline'
import { importText } from '@/domain/import/importPipeline'
import { DEFAULT_SERIES_STYLE, NO_UNCERTAINTY } from '@/domain/model'
import type {
  ColumnId,
  DatasetId,
  Exclusion,
  ExclusionId,
  Filter,
  FitId,
  FitSpec,
  ImportedDataset,
  PlotId,
  PlotSpec,
  ProjectDoc,
  ProjectId,
  RawTable,
  RowId,
  SeriesId,
  XYSeriesSpec,
} from '@/domain/model'
import { defaultPlotSpec } from '@/domain/recommend/recommend'
import type { FigureContext } from './context'

export const fakeT = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}|${JSON.stringify(params)}` : key

export function figureContext(over: Partial<FigureContext> = {}): FigureContext {
  return {
    mode: 'screen',
    lang: 'en',
    loc: { decimal: '.' },
    t: fakeT,
    selection: null,
    dragmode: 'zoom',
    viewResetCounter: 0,
    fontFamily: 'Test Sans',
    advanced: false,
    ...over,
  }
}

export interface Imported {
  dataset: ImportedDataset
  raw: RawTable
  /** Column id by column name. */
  col: (name: string) => ColumnId
}

export function importCsv(text: string, id: string, fileName = `${id}.csv`): Imported {
  const r = importText(text, { kind: 'csv', fileName })
  if (!r.ok) throw new Error(`import failed: ${r.error.code}`)
  const d = r.value
  const dataset: ImportedDataset = {
    id: id as DatasetId,
    name: d.suggestedName,
    createdAt: '2026-01-01T00:00:00.000Z',
    example: null,
    columns: d.columns,
    notes: d.notes,
    origin: 'import',
    rawTableId: d.rawTable.id,
    layout: d.layout,
  }
  const col = (name: string) => {
    const c = d.columns.find((m) => m.name === name)
    if (!c) throw new Error(`no column ${name} in ${d.columns.map((m) => m.name).join(', ')}`)
    return c.id
  }
  return { dataset, raw: d.rawTable, col }
}

export function series(
  id: string,
  ds: Imported,
  x: string,
  y: string,
  over: Partial<XYSeriesSpec> = {},
): XYSeriesSpec {
  return {
    id: id as SeriesId,
    datasetId: ds.dataset.id,
    name: null,
    x: ds.col(x),
    y: ds.col(y),
    visible: true,
    style: { ...DEFAULT_SERIES_STYLE },
    errorBars: { x: NO_UNCERTAINTY, y: NO_UNCERTAINTY, visible: true },
    split: null,
    ...over,
  }
}

export function plotOf(over: Partial<PlotSpec> = {}): PlotSpec {
  return { ...defaultPlotSpec('plot_1' as PlotId), ...over }
}

export function fitOf(id: string, seriesId: string, over: Partial<FitSpec> = {}): FitSpec {
  return {
    id: id as FitId,
    seriesId: seriesId as SeriesId,
    model: { type: 'linear' },
    confidence: 0.95,
    show: { curve: true, confidenceBand: false, predictionBand: false, residuals: true },
    curveRange: { mode: 'data' },
    style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
    perGroup: false,
    ...over,
  }
}

export function exclusionOf(
  id: string,
  ds: Imported,
  rowIds: number[],
  over: Partial<Exclusion> = {},
): Exclusion {
  return {
    id: id as ExclusionId,
    datasetId: ds.dataset.id,
    rowIds: rowIds as RowId[],
    reason: 'measurement-problem',
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

export function docOf(
  datasets: Imported[],
  plot: PlotSpec | null,
  extra: { fits?: FitSpec[]; exclusions?: Exclusion[]; filters?: Filter[] } = {},
): ProjectDoc {
  return {
    id: 'proj_1' as ProjectId,
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    datasets: datasets.map((d) => d.dataset),
    plots: plot ? [plot] : [],
    activePlotId: plot ? plot.id : null,
    fits: extra.fits ?? [],
    exclusions: extra.exclusions ?? [],
    filters: extra.filters ?? [],
    numberFormat: { decimal: 'auto' },
  }
}

export const rawTablesOf = (datasets: Imported[]): Record<string, RawTable> =>
  Object.fromEntries(datasets.map((d) => [d.raw.id, d.raw]))

/** One-shot derivation through the real pipeline. */
export function deriveOnce(
  datasets: Imported[],
  plot: PlotSpec | null,
  extra: Parameters<typeof docOf>[2] = {},
): DerivedProject {
  return createDeriver()(docOf(datasets, plot, extra), rawTablesOf(datasets))
}
