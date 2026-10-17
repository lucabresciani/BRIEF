import type { Draft } from 'immer'
import {
  DEFAULT_FIT_STYLE,
  newId,
  type DatasetId,
  type ExclusionId,
  type ExclusionReason,
  type Filter,
  type FilterId,
  type FitId,
  type FitModel,
  type FitSpec,
  type PlotId,
  type RowId,
  type SeriesId,
  type UncertaintySpec,
  type XUncertaintySpec,
} from '@/domain/model'
import { commit, useProjectStore } from '../projectStore'
import { plotOfSeries, seriesDraft } from './helpers'

const ownerOf = (seriesId: SeriesId) => plotOfSeries(useProjectStore.getState().doc, seriesId)?.id ?? null
const ownerOfFit = (fitId: FitId) => {
  const fit = useProjectStore.getState().doc.fits.find((f) => f.id === fitId)
  return fit ? ownerOf(fit.seriesId) : null
}

// ---- Fits -------------------------------------------------------------------------------------

export function addFit(seriesId: SeriesId, model: FitModel, modelName: string): FitId {
  const id = newId<'FitId'>('fit') as FitId
  commit(
    'fit.add',
    (d) => {
      // At most one fit per series: adding replaces the model of the existing one.
      const existing = d.fits.find((f) => f.seriesId === seriesId)
      if (existing) {
        existing.model = model
        return
      }
      d.fits.push({
        id,
        seriesId,
        model,
        confidence: 0.95,
        show: { curve: true, confidenceBand: false, predictionBand: false, residuals: true },
        curveRange: { mode: 'data' },
        style: { ...DEFAULT_FIT_STYLE, color: { ...DEFAULT_FIT_STYLE.color } },
        perGroup: false,
      })
      // Only the plot of this series gains a residual panel.
      const plot = d.plots.find((p) => p.series.some((s) => s.id === seriesId))
      if (plot) plot.scatter.residualPanel = true
    },
    { params: { model: modelName }, plotId: ownerOf(seriesId) },
  )
  return useProjectStore.getState().doc.fits.find((f) => f.seriesId === seriesId)?.id ?? id
}

export function updateFit(
  fitId: FitId,
  patch: Partial<Omit<FitSpec, 'id' | 'seriesId'>>,
  coalesce?: string,
): void {
  commit(
    'fit.edit',
    (d) => {
      const f = d.fits.find((x) => x.id === fitId)
      if (!f) return
      if (patch.model) f.model = patch.model
      if (patch.confidence) f.confidence = patch.confidence
      if (patch.show) Object.assign(f.show, patch.show)
      if (patch.curveRange) f.curveRange = patch.curveRange
      if (patch.style) f.style = structuredClone(patch.style)
      if (patch.perGroup !== undefined) f.perGroup = patch.perGroup
    },
    { coalesceKey: coalesce ? `fit:${fitId}:${coalesce}` : undefined, plotId: ownerOfFit(fitId) },
  )
}

export function removeFit(fitId: FitId): void {
  commit(
    'fit.remove',
    (d) => {
      d.fits = d.fits.filter((f) => f.id !== fitId)
    },
    { plotId: ownerOfFit(fitId) },
  )
}

/** The residual panel of one plot (the other plots keep theirs). */
export function setResidualPanel(plotId: PlotId, on: boolean): void {
  commit(
    'plot.options',
    (d) => {
      const p = d.plots.find((x) => x.id === plotId)
      if (p) p.scatter.residualPanel = on
    },
    { plotId },
  )
}

// ---- Uncertainty --------------------------------------------------------------------------------

export function setErrorBars(
  seriesId: SeriesId,
  axis: 'x' | 'y',
  spec: UncertaintySpec,
  coalesce?: string,
): void {
  commit(
    'uncertainty.set',
    (d) => {
      const s = seriesDraft(d, seriesId)
      if (!s) return
      if (axis === 'x') s.errorBars.x = spec as Draft<XUncertaintySpec>
      else s.errorBars.y = spec as Draft<UncertaintySpec>
      s.errorBars.visible = true
    },
    {
      params: { axis: axis.toUpperCase() },
      coalesceKey: coalesce ? `bars:${seriesId}:${axis}:${coalesce}` : undefined,
      plotId: ownerOf(seriesId),
    },
  )
}

export function setErrorBarsVisible(seriesId: SeriesId, visible: boolean): void {
  commit(
    'uncertainty.set',
    (d) => {
      const s = seriesDraft(d, seriesId)
      if (s) s.errorBars.visible = visible
    },
    { params: { axis: 'X/Y' }, plotId: ownerOf(seriesId) },
  )
}

// ---- Exclusions (non-destructive) ---------------------------------------------------------------

export function excludeRows(
  datasetId: DatasetId,
  rowIds: readonly RowId[],
  reason: ExclusionReason,
  note: string,
): void {
  if (!rowIds.length) return
  commit(
    'exclusion.add',
    (d) => {
      const already = new Set(d.exclusions.filter((e) => e.datasetId === datasetId).flatMap((e) => e.rowIds))
      const fresh = rowIds.filter((r) => !already.has(r))
      if (!fresh.length) return
      d.exclusions.push({
        id: newId<'ExclusionId'>('exc') as ExclusionId,
        datasetId,
        rowIds: [...fresh].sort((a, b) => a - b),
        reason,
        note: note.trim(),
        createdAt: new Date().toISOString(),
      })
    },
    { datasetId, params: { n: rowIds.length, reason } },
  )
}

export function restoreRows(datasetId: DatasetId, rowIds: readonly RowId[]): void {
  const set = new Set<number>(rowIds)
  commit(
    'exclusion.remove',
    (d) => {
      for (const e of d.exclusions)
        if (e.datasetId === datasetId) e.rowIds = e.rowIds.filter((r) => !set.has(r))
      d.exclusions = d.exclusions.filter((e) => e.rowIds.length > 0)
    },
    { datasetId, params: { n: rowIds.length } },
  )
}

export function restoreAll(datasetId: DatasetId): void {
  const n = useProjectStore
    .getState()
    .doc.exclusions.filter((e) => e.datasetId === datasetId)
    .reduce((a, e) => a + e.rowIds.length, 0)
  commit(
    'exclusion.remove',
    (d) => {
      d.exclusions = d.exclusions.filter((e) => e.datasetId !== datasetId)
    },
    { datasetId, params: { n } },
  )
}

// ---- Filters (inclusive bounds) -----------------------------------------------------------------

/** Omit distributed over the Filter union (plain Omit would lose the discriminant). */
export type NewFilter = Filter extends infer F ? (F extends Filter ? Omit<F, 'id'> : never) : never

export function addFilter(filter: NewFilter): FilterId {
  const id = newId<'FilterId'>('flt') as FilterId
  commit('filter.set', (d) => void d.filters.push({ ...filter, id } as Draft<Filter>), {
    datasetId: filter.datasetId,
  })
  return id
}

export function updateFilter(id: FilterId, patch: Partial<Filter>, coalesce?: string): void {
  commit(
    'filter.set',
    (d) => {
      const f = d.filters.find((x) => x.id === id)
      if (f) Object.assign(f, patch)
    },
    { coalesceKey: coalesce ? `filter:${id}:${coalesce}` : undefined },
  )
}

export function removeFilter(id: FilterId): void {
  commit('filter.set', (d) => {
    d.filters = d.filters.filter((f) => f.id !== id)
  })
}

export function resetFilters(datasetId: DatasetId): void {
  commit(
    'filter.set',
    (d) => {
      d.filters = d.filters.filter((f) => f.datasetId !== datasetId)
    },
    { datasetId },
  )
}
