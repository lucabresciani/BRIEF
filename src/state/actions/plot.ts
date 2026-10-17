import type { Draft } from 'immer'
import {
  DEFAULT_SERIES_STYLE,
  NO_UNCERTAINTY,
  newId,
  type AxisSpec,
  type BarOptions,
  type BoxOptions,
  type ColumnId,
  type DatasetId,
  type FitId,
  type FitSpec,
  type HistogramOptions,
  type LegendSpec,
  type LineOptions,
  type MarkerSymbol,
  type PlotExportSettings,
  type PlotId,
  type PlotSpec,
  type PlotType,
  type ProjectDoc,
  type ScatterOptions,
  type SeriesId,
  type SeriesStyle,
} from '@/domain/model'
import { cascadeRemoval } from '@/domain/model/integrity'
import { defaultPlotSpec, initialPlot } from '@/domain/recommend/recommend'
import { deriveNow } from '../derived'
import { commit, useProjectStore } from '../projectStore'
import { ui, type ViewState } from '../uiStore'
import { getActivePlotId, syncWorkspace } from '../workspace'
import type { Translator } from '@/i18n/translate'
import { labelOf, nextPaletteIndex, pageTranslator, plotDraft, plotOfSeries, seriesDraft } from './helpers'

// Every plot action edits the plot it is given, by default the active plot (the focused pane). The
// coalesce keys carry the plot id: typing in one plot and then in another makes two undo steps.

export function setPlotType(type: PlotType, plotId: PlotId | null = getActivePlotId()): void {
  commit(
    'plot.type',
    (d) => {
      const p = plotDraft(d, plotId)
      if (!p) return
      p.type = type
      // Scatter/line need an x–y series: create a sensible one when the plot started as a distribution.
      if ((type === 'scatter' || type === 'line') && p.series.length === 0) {
        const datasetId = p.box.datasetId ?? p.histogram.datasetId ?? p.bar.datasetId ?? d.datasets[0]?.id
        const ds = d.datasets.find((x) => x.id === datasetId)
        if (!ds) return
        const numeric = ds.columns.filter(
          (c) =>
            c.role !== 'ignore' &&
            c.role !== 'uncertainty' &&
            (c.override.kind ?? c.detected.kind) === 'numeric',
        )
        const yId =
          p.box.value ?? p.histogram.value ?? p.bar.value ?? numeric.find((c) => c.role === 'measurement')?.id
        const xId = numeric.find((c) => c.id !== yId)?.id
        if (!yId || !xId) return
        p.series.push({
          id: newId<'SeriesId'>('ser') as SeriesId,
          datasetId: ds.id,
          name: null,
          x: xId,
          y: yId,
          visible: true,
          style: { ...DEFAULT_SERIES_STYLE, paletteIndex: 0 },
          errorBars: { x: NO_UNCERTAINTY, y: NO_UNCERTAINTY, visible: true },
          split: null,
        })
      }
    },
    { params: { type }, plotId },
  )
}

export function updateAxis(
  axis: 'x' | 'y',
  patch: Partial<AxisSpec>,
  opts: { coalesce?: string; plotId?: PlotId | null } = {},
): void {
  const plotId = opts.plotId ?? getActivePlotId()
  commit(
    'plot.axis',
    (d) => {
      const p = plotDraft(d, plotId)
      if (!p) return
      const a = axis === 'x' ? p.xAxis : p.yAxis
      Object.assign(a, patch)
    },
    {
      params: { axis: axis.toUpperCase() },
      coalesceKey: opts.coalesce ? `axis:${plotId}:${axis}:${opts.coalesce}` : undefined,
      plotId,
    },
  )
}

export function setTitle(title: string, plotId: PlotId | null = getActivePlotId()): void {
  commit(
    'plot.style',
    (d) => {
      const p = plotDraft(d, plotId)
      if (p) p.title = title
    },
    { coalesceKey: `plot.title:${plotId}`, plotId },
  )
}

export function setLegend(patch: Partial<LegendSpec>, plotId: PlotId | null = getActivePlotId()): void {
  commit(
    'plot.style',
    (d) => {
      const p = plotDraft(d, plotId)
      if (p) Object.assign(p.legend, patch)
    },
    { plotId },
  )
}

type OptionsByType = {
  scatter: ScatterOptions
  line: LineOptions
  bar: BarOptions
  histogram: HistogramOptions
  box: BoxOptions
}

export function setPlotOptions<K extends keyof OptionsByType>(
  kind: K,
  patch: Partial<OptionsByType[K]>,
  coalesce?: string,
  plotId: PlotId | null = getActivePlotId(),
): void {
  commit(
    'plot.options',
    (d) => {
      const p = plotDraft(d, plotId)
      if (!p) return
      Object.assign(p[kind] as object, patch)
    },
    { coalesceKey: coalesce ? `options:${plotId}:${kind}:${coalesce}` : undefined, plotId },
  )
}

/** Bar options are a discriminated union: switching 'aggregate' replaces the variant-specific field. */
export function setBarOptions(next: BarOptions, plotId: PlotId | null = getActivePlotId()): void {
  commit(
    'plot.options',
    (d) => {
      const p = plotDraft(d, plotId)
      if (p) p.bar = next as Draft<BarOptions>
    },
    { plotId },
  )
}

export function setExportSettings(
  patch: Partial<PlotExportSettings>,
  plotId: PlotId | null = getActivePlotId(),
): void {
  commit(
    'plot.options',
    (d) => {
      const p = plotDraft(d, plotId)
      if (p) Object.assign(p.export, patch)
    },
    { plotId },
  )
}

export function setSeriesMapping(
  seriesId: SeriesId,
  mapping: { x?: ColumnId; y?: ColumnId },
  names: { x: string; y: string },
): void {
  const owner = plotOfSeries(useProjectStore.getState().doc, seriesId)
  commit(
    'series.map',
    (d) => {
      const s = seriesDraft(d, seriesId)
      if (!s) return
      const changedX = mapping.x && mapping.x !== s.x
      const changedY = mapping.y && mapping.y !== s.y
      if (mapping.x) s.x = mapping.x
      if (mapping.y) s.y = mapping.y
      // Uncertainty specs refer to the old variable: reset them to "none" rather than mislabel.
      if (changedX) s.errorBars.x = NO_UNCERTAINTY
      if (changedY) s.errorBars.y = NO_UNCERTAINTY
      // Labels typed for the old variable no longer apply.
      const p = d.plots.find((pl) => pl.series.some((x) => x.id === seriesId))
      if (p && p.series[0]?.id === seriesId) {
        if (changedX) p.xAxis.label = p.xAxis.unit = null
        if (changedY) p.yAxis.label = p.yAxis.unit = null
        if (changedX || changedY) {
          p.xAxis.range = { mode: 'auto' }
          p.yAxis.range = { mode: 'auto' }
        }
      }
    },
    { params: names, plotId: owner?.id ?? null },
  )
  if (owner) ui.resetView(owner.id)
}

export function swapAxes(seriesId: SeriesId, names: { x: string; y: string }): void {
  const s = useProjectStore
    .getState()
    .doc.plots.flatMap((p) => p.series)
    .find((x) => x.id === seriesId)
  if (!s) return
  setSeriesMapping(seriesId, { x: s.y, y: s.x }, { x: names.y, y: names.x })
}

export function addSeries(
  datasetId: DatasetId,
  x: ColumnId,
  y: ColumnId,
  name: string,
  plotId: PlotId | null = getActivePlotId(),
): SeriesId {
  const id = newId<'SeriesId'>('ser') as SeriesId
  commit(
    'series.add',
    (d) => {
      const p = plotDraft(d, plotId)
      if (!p) return
      p.series.push({
        id,
        datasetId,
        name: null,
        x,
        y,
        visible: true,
        style: { ...DEFAULT_SERIES_STYLE, paletteIndex: nextPaletteIndex(p) },
        errorBars: { x: NO_UNCERTAINTY, y: NO_UNCERTAINTY, visible: true },
        split: null,
      })
    },
    { datasetId, params: { name }, plotId },
  )
  return id
}

const ownerOf = (seriesId: SeriesId) => plotOfSeries(useProjectStore.getState().doc, seriesId)?.id ?? null

export function removeSeries(seriesId: SeriesId, name: string): void {
  commit('series.remove', (d) => cascadeRemoval(d as ProjectDoc, { kind: 'series', id: seriesId }), {
    params: { name },
    plotId: ownerOf(seriesId),
  })
}

export function setSeriesVisibility(seriesId: SeriesId, visible: boolean, name: string): void {
  commit(
    'series.visibility',
    (d) => {
      const s = seriesDraft(d, seriesId)
      if (s) s.visible = visible
    },
    { params: { name }, plotId: ownerOf(seriesId) },
  )
}

export function renameSeries(seriesId: SeriesId, name: string | null): void {
  commit(
    'plot.style',
    (d) => {
      const s = seriesDraft(d, seriesId)
      if (s) s.name = name
    },
    { coalesceKey: `series.name:${seriesId}`, plotId: ownerOf(seriesId) },
  )
}

export function updateSeriesStyle(seriesId: SeriesId, patch: Partial<SeriesStyle>, coalesce?: string): void {
  commit(
    'plot.style',
    (d) => {
      const s = seriesDraft(d, seriesId)
      if (s) Object.assign(s.style, patch)
    },
    { coalesceKey: coalesce ? `style:${seriesId}:${coalesce}` : undefined, plotId: ownerOf(seriesId) },
  )
}

/**
 * One curve per value of `column` (null: the series is drawn whole again). The group overrides name
 * values of the column they were made for, so another column starts without any. `names`: the series
 * label and the column name, for the history entry.
 */
export function setSeriesSplit(
  seriesId: SeriesId,
  column: ColumnId | null,
  names: { name: string; column: string },
): void {
  commit(
    'series.split',
    (d) => {
      const s = seriesDraft(d, seriesId)
      if (!s) return
      if (column === null) s.split = null
      else if (s.split?.column !== column) s.split = { column, overrides: [] }
    },
    {
      params: { name: names.name, column: names.column, mode: column === null ? 'off' : 'on' },
      plotId: ownerOf(seriesId),
    },
  )
}

/**
 * Colour (palette index, null = automatic) and marker ('auto') of one group of a split series. A group
 * back to automatic on both loses its override. The figure reads the first override of a key, so the
 * later ones of the same key are dropped: removing the first must never bring an older one back.
 */
export function setGroupStyle(
  seriesId: SeriesId,
  key: string,
  patch: { paletteIndex?: number | null; symbol?: MarkerSymbol | 'auto' },
): void {
  commit(
    'plot.style',
    (d) => {
      const split = seriesDraft(d, seriesId)?.split
      if (!split) return
      const at = split.overrides.findIndex((o) => o.key === key)
      const before = at >= 0 ? split.overrides[at] : { key, paletteIndex: null, symbol: 'auto' as const }
      const next = { ...before, ...patch, key }
      const kept = split.overrides.filter((o) => o.key !== key)
      if (next.paletteIndex !== null || next.symbol !== 'auto')
        kept.splice(at >= 0 ? Math.min(at, kept.length) : kept.length, 0, next)
      split.overrides = kept
    },
    { plotId: ownerOf(seriesId) },
  )
}

/** Every group of a split series back to its automatic colour and marker. */
export function resetGroupStyles(seriesId: SeriesId): void {
  commit(
    'plot.style',
    (d) => {
      const split = seriesDraft(d, seriesId)?.split
      if (split) split.overrides = []
    },
    { plotId: ownerOf(seriesId) },
  )
}

/** "Use view as axis limits": turns the current zoom into saved, undoable axis ranges. */
export function viewToLimits(view: ViewState, plotId: PlotId | null = getActivePlotId()): void {
  if (!view.x && !view.y) return
  commit(
    'plot.viewToLimits',
    (d) => {
      const p = plotDraft(d, plotId)
      if (!p) return
      if (view.x) p.xAxis.range = { mode: 'fixed', min: view.x[0], max: view.x[1] }
      if (view.y) p.yAxis.range = { mode: 'fixed', min: view.y[0], max: view.y[1] }
    },
    { plotId },
  )
}

// ---- Plots (tabs) -----------------------------------------------------------------------------------

/**
 * `name`, else "name (2)", "name (3)"… when another tab already reads `name`: two plots created from
 * one dataset, or two copies of one plot, never have the same tab label. '' (automatic) stays ''.
 */
function freeName(name: string, doc: Pick<ProjectDoc, 'plots' | 'datasets'>, t: Translator): string {
  if (!name) return name
  const taken = new Set(doc.plots.map((p) => labelOf(doc, p.id, t)))
  if (!taken.has(name)) return name
  for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`)) return `${name} (${n})`
}

/**
 * A new plot, added after the others and shown. From a dataset: the recommended plot of that dataset,
 * named after it; without one: an empty plot with an automatic name. null when nothing was created
 * (read-only tab).
 */
export function createPlot(opts: { datasetId?: DatasetId; name?: string } = {}): PlotId | null {
  const doc = useProjectStore.getState().doc
  const id = newId<'PlotId'>('plot') as PlotId
  const dataset = opts.datasetId ? doc.datasets.find((d) => d.id === opts.datasetId) : undefined
  const view = dataset ? deriveNow().views.get(dataset.id) : undefined
  const plot: PlotSpec =
    dataset && view
      ? initialPlot(dataset, view, id, newId<'SeriesId'>('ser') as SeriesId).plot
      : defaultPlotSpec(id)
  const t = pageTranslator()
  plot.name = freeName(opts.name ?? dataset?.name ?? '', doc, t)
  const ok = commit(
    'plot.create',
    (d) => {
      d.plots.push(plot as Draft<PlotSpec>)
    },
    {
      datasetId: dataset?.id ?? null,
      plotId: id,
      params: { name: labelOf({ plots: [...doc.plots, plot], datasets: doc.datasets }, id, t) },
    },
  )
  if (!ok) return null
  ui.showPlot(id)
  return id
}

/**
 * A copy of a plot, placed after it and shown: new ids for the plot, its series and their fits (the
 * fits are copied, so the two plots fit independently). Exclusions and filters belong to the datasets
 * and stay shared. Named "<label> (copy)" in the page language.
 */
export function duplicatePlot(plotId: PlotId): PlotId | null {
  const doc = useProjectStore.getState().doc
  const index = doc.plots.findIndex((p) => p.id === plotId)
  if (index < 0) return null
  const t = pageTranslator()
  const label = labelOf(doc, plotId, t)
  const source = doc.plots[index]
  const id = newId<'PlotId'>('plot') as PlotId
  const seriesIds = new Map<SeriesId, SeriesId>(
    source.series.map((s) => [s.id, newId<'SeriesId'>('ser') as SeriesId]),
  )
  const copy: PlotSpec = {
    ...structuredClone(source),
    id,
    name: freeName(`${label} ${t('save.copySuffix')}`, doc, t),
  }
  copy.series = copy.series.map((s) => ({ ...s, id: seriesIds.get(s.id)! }))
  const fits: FitSpec[] = doc.fits
    .filter((f) => seriesIds.has(f.seriesId))
    .map((f) => ({
      ...structuredClone(f),
      id: newId<'FitId'>('fit') as FitId,
      seriesId: seriesIds.get(f.seriesId)!,
    }))
  const ok = commit(
    'plot.duplicate',
    (d) => {
      const at = d.plots.findIndex((p) => p.id === plotId)
      if (at < 0) return
      d.plots.splice(at + 1, 0, copy as Draft<PlotSpec>)
      d.fits.push(...(fits as Draft<FitSpec>[]))
    },
    { plotId: id, params: { name: label } },
  )
  if (!ok) return null
  ui.showPlot(id)
  return id
}

/** Renames a tab ('' = automatic label). Typing coalesces into one undo step per plot. */
export function renamePlot(plotId: PlotId, name: string): void {
  const doc = useProjectStore.getState().doc
  const plot = doc.plots.find((p) => p.id === plotId)
  if (!plot) return
  const label = labelOf(
    { plots: doc.plots.map((p) => (p === plot ? { ...p, name } : p)), datasets: doc.datasets },
    plotId,
    pageTranslator(),
  )
  commit(
    'plot.rename',
    (d) => {
      const p = plotDraft(d, plotId)
      if (p) p.name = name
    },
    { plotId, params: { name: label }, coalesceKey: `plot.rename:${plotId}` },
  )
}

/**
 * Deletes a plot with the fits of its series (one undo step restores both). The workspace never keeps
 * pointing at it: the next plot (else the previous one) takes its pane.
 */
export function removePlot(plotId: PlotId): void {
  const doc = useProjectStore.getState().doc
  if (!doc.plots.some((p) => p.id === plotId)) return
  const before = doc.plots.map((p) => p.id)
  const ok = commit('plot.remove', (d) => cascadeRemoval(d as ProjectDoc, { kind: 'plot', id: plotId }), {
    plotId,
    params: { name: labelOf(doc, plotId, pageTranslator()) },
  })
  if (ok) syncWorkspace(before)
}

/** Moves a tab to position `toIndex` (clamped to the tabs). */
export function movePlot(plotId: PlotId, toIndex: number): void {
  const doc = useProjectStore.getState().doc
  const label = labelOf(doc, plotId, pageTranslator())
  commit(
    'plot.reorder',
    (d) => {
      const from = d.plots.findIndex((p) => p.id === plotId)
      if (from < 0 || !Number.isInteger(toIndex)) return
      const to = Math.min(Math.max(toIndex, 0), d.plots.length - 1)
      if (to === from) return
      const [p] = d.plots.splice(from, 1)
      d.plots.splice(to, 0, p)
    },
    { plotId, params: { name: label } },
  )
}
