/**
 * Test-only builders for the inspector and data panels (imported by *.test.tsx files, never by the app):
 * a small notebook project loaded into the real stores, so the panels read it through the real deriver.
 */
import type {
  ColumnId,
  ColumnKind,
  ColumnMeta,
  DatasetId,
  FitId,
  FitModel,
  FitSpec,
  NotebookDataset,
  PlotId,
  PlotSpec,
  ProjectDoc,
  ProjectId,
  RowId,
  SeriesId,
  TransformSpec,
  XYSeriesSpec,
} from '@/domain/model'
import { DEFAULT_SERIES_STYLE } from '@/domain/model'
import { defaultPlotSpec } from '@/domain/recommend/recommend'
import { replaceRawTables } from '@/state/dataStore'
import { loadProject } from '@/state/projectStore'
import { useUiStore, type Level } from '@/state/uiStore'

export const NOW = '2026-10-14T00:00:00.000Z'
export const DS = 'ds_test' as DatasetId
export const PLOT = 'plot_test' as PlotId
export const SERIES = 'ser_test' as SeriesId
export const FIT = 'fit_test' as FitId

export function column(
  id: string,
  opts: {
    kind?: ColumnKind
    derived?: TransformSpec
    unit?: string | null
    role?: ColumnMeta['role']
    uncertaintyOf?: string | null
  } = {},
): ColumnMeta {
  return {
    id: id as ColumnId,
    source: opts.derived ? { type: 'derived', spec: opts.derived } : { type: 'notebook' },
    name: id,
    unit: opts.unit ?? null,
    unitSource: opts.unit ? 'user' : null,
    role: opts.role ?? 'measurement',
    uncertaintyOf: (opts.uncertaintyOf ?? null) as ColumnId | null,
    detected: {
      kind: opts.kind ?? 'numeric',
      decimal: 'dot',
      percent: 'display',
      confidence: 'high',
      explanations: [],
    },
    override: {},
  }
}

/** Notebook dataset: typed cells per column id; `extra` columns (e.g. derived ones) carry no cells. */
export function notebook(
  cells: Record<string, string[]>,
  columns: ColumnMeta[],
  extra: ColumnMeta[] = [],
): NotebookDataset {
  const n = Object.values(cells)[0]?.length ?? 0
  return {
    id: DS,
    name: 'Test data',
    createdAt: NOW,
    example: null,
    columns: [...columns, ...extra],
    notes: [],
    origin: 'notebook',
    rowIds: Array.from({ length: n }, (_, i) => i as RowId),
    cells,
    nextRowId: n,
  }
}

export function xySeries(x: string, y: string, errorBars?: Partial<XYSeriesSpec['errorBars']>): XYSeriesSpec {
  return {
    id: SERIES,
    datasetId: DS,
    name: null,
    x: x as ColumnId,
    y: y as ColumnId,
    visible: true,
    style: { ...DEFAULT_SERIES_STYLE },
    errorBars: { x: { kind: 'none' }, y: { kind: 'none' }, visible: true, ...errorBars },
    split: null,
  }
}

export function plotWith(patch: Partial<PlotSpec>): PlotSpec {
  return { ...defaultPlotSpec(PLOT), ...patch }
}

export function fit(model: FitModel): FitSpec {
  return {
    id: FIT,
    seriesId: SERIES,
    model,
    confidence: 0.95,
    show: { curve: true, confidenceBand: false, predictionBand: false, residuals: true },
    curveRange: { mode: 'data' },
    style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
    perGroup: false,
  }
}

/** Replaces the stores' project (as opening a file does) and sets the disclosure level. */
export function loadTestProject(
  dataset: NotebookDataset,
  plot: PlotSpec,
  opts: { fits?: FitSpec[]; level?: Level } = {},
): ProjectDoc {
  const doc: ProjectDoc = {
    id: 'prj_test' as ProjectId,
    name: 'test',
    createdAt: NOW,
    updatedAt: NOW,
    datasets: [dataset],
    plots: [plot],
    activePlotId: plot.id,
    fits: opts.fits ?? [],
    exclusions: [],
    filters: [],
    numberFormat: { decimal: 'dot' },
  }
  replaceRawTables({})
  loadProject(doc)
  useUiStore.setState({ level: opts.level ?? 'intermediate', hints: true })
  return doc
}
