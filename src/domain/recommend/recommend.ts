/**
 * Initial plot recommendation: a transparent suggestion derived from the STRUCTURE of the
 * data (column kinds, roles, names), never from the values' statistics. It never adds a fit and never
 * applies an uncertainty column: both are only offered (suggestFit, uncertaintyColumn).
 *
 * Usable quantities = columns with role 'measurement', effective kind 'numeric' and ≥ 2 valid values.
 * Identifier columns (trial, replicate) and groups are row labels, not quantities; uncertainty and
 * ignored columns are never plotted by default.
 * - ≥ 2 quantities (or a time-like column plus one quantity) → scatter (mode markers): x = the first
 *   time-like column, else the first quantity; y = the first other quantity. A time-like x adds the
 *   line plot as an alternative (proposed, not imposed).
 * - 1 quantity and a group column (role 'group' or categorical, with repeated labels) → box by group.
 * - 1 quantity → histogram.
 * - otherwise 'recommend.none'.
 */
import { DEFAULT_AXIS, DEFAULT_EXPORT, DEFAULT_SERIES_STYLE, effectiveSettings } from '@/domain/model'
import type {
  AxisSpec,
  ColumnId,
  ColumnMeta,
  Dataset,
  PlotId,
  PlotSpec,
  PlotType,
  SeriesId,
  XYSeriesSpec,
} from '@/domain/model'
import { CELL } from '@/domain/derive/types'
import type { DatasetView } from '@/domain/derive/types'

export interface Recommendation {
  plotType: PlotType
  /** 'recommend.scatter' | 'recommend.histogram' | 'recommend.box' | 'recommend.none' ('recommend.line' is only an alternative). */
  messageKey: string
  /** Column NAMES for the message: { x, y } (scatter), { column } (histogram), { column, group } (box). */
  params: Record<string, string | number>
  /** E.g. a time-like x → line plot ('recommend.alt.line'). */
  alternatives: { plotType: PlotType; messageKey: string }[]
  /** True for a scatter of two numeric measurement columns; a fit is never added automatically. */
  suggestFit: boolean
  /** A column whose role is 'uncertainty' of y (suggested at import, e.g. "u(y)"); never applied automatically. */
  uncertaintyColumn: ColumnId | null
  /** The chosen columns (ids), for initialPlot and the UI. */
  columns: { x: ColumnId | null; y: ColumnId | null; value: ColumnId | null; group: ColumnId | null }
}

const freshAxis = (): AxisSpec => ({ ...DEFAULT_AXIS, range: { mode: 'auto' } })

/** A plot with every per-type option set to a neutral default (no columns, no uncertainty, no fit). */
export function defaultPlotSpec(id: PlotId): PlotSpec {
  return {
    id,
    name: '',
    type: 'scatter',
    title: '',
    xAxis: freshAxis(),
    yAxis: freshAxis(),
    legend: { visible: true, position: 'auto' },
    series: [],
    // Excluded rows stay visible as hollow grey markers; the residual panel appears with a fit.
    scatter: { residualPanel: false, showExcluded: true },
    // Lines follow the recorded order (sorting could hide a hysteresis loop); markers keep observations visible.
    line: { markers: true, sortByX: false },
    // No spread bars until the user states which quantity they show (SD, SEM or CI).
    bar: {
      datasetId: null,
      category: null,
      value: null,
      showObservations: true,
      colorByCategory: false,
      aggregate: 'mean',
      spread: { kind: 'none' },
    },
    histogram: { datasetId: null, value: null, bins: { mode: 'auto' }, groupBy: null, groupMode: 'overlay' },
    box: { datasetId: null, value: null, groupBy: null, points: 'all', showMean: false, colorByGroup: false },
    export: { ...DEFAULT_EXPORT },
  }
}

const TIME_WORD = /^(?:time|tempo|date|datetime|timestamp)(?:$|[\s_.-])/i
/** Lower-case "t" is time; capital "T" is usually a temperature or a period, so it is not time-like. */
const TIME_LETTER = /^t(?:$|[\s_.-])/

function isTimeLike(meta: ColumnMeta): boolean {
  if (effectiveSettings(meta).kind === 'datetime') return true
  if (effectiveSettings(meta).kind !== 'numeric') return false
  const name = meta.name.trim()
  return TIME_WORD.test(name) || TIME_LETTER.test(name)
}

/** Rows with a readable finite value in this column. */
function validCount(view: DatasetView, id: ColumnId): number {
  const col = view.columns.get(id)
  if (!col) return 0
  let n = 0
  for (let i = 0; i < col.status.length; i++)
    if (col.status[i] === CELL.ok && Number.isFinite(col.values[i])) n++
  return n
}

/**
 * A grouping column for a box plot of `value`: role 'group' first, then categorical columns. It needs
 * ≥ 2 distinct labels among the rows where `value` is valid, and at least one label seen twice
 * (one observation per group would draw no box).
 */
function groupColumn(dataset: Dataset, view: DatasetView, value: ColumnId): ColumnMeta | null {
  const target = view.columns.get(value)
  if (!target) return null
  const usable = (c: ColumnMeta) => c.role !== 'uncertainty' && c.role !== 'ignore' && c.id !== value
  const candidates = [
    ...dataset.columns.filter((c) => usable(c) && c.role === 'group'),
    ...dataset.columns.filter(
      (c) => usable(c) && c.role !== 'group' && effectiveSettings(c).kind === 'categorical',
    ),
  ]
  for (const c of candidates) {
    const col = view.columns.get(c.id)
    if (!col) continue
    const counts = new Map<string | number, number>()
    for (let i = 0; i < col.status.length; i++) {
      if (target.status[i] !== CELL.ok || !Number.isFinite(target.values[i]) || col.status[i] !== CELL.ok)
        continue
      let key: string | number
      if (col.categories) {
        const code = col.categories.codes[i]
        if (code < 0) continue
        key = col.categories.labels[code]
      } else {
        if (!Number.isFinite(col.values[i])) continue
        key = col.values[i]
      }
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    if (counts.size >= 2 && [...counts.values()].some((k) => k >= 2)) return c
  }
  return null
}

/** The recommendation for a dataset (see the module comment for the rules). */
export function recommend(dataset: Dataset, view: DatasetView): Recommendation {
  const kind = (c: ColumnMeta) => effectiveSettings(c).kind
  const present = dataset.columns.filter(
    (c) => c.role !== 'uncertainty' && c.role !== 'ignore' && view.columns.has(c.id),
  )
  const quantities = present.filter(
    (c) => c.role === 'measurement' && kind(c) === 'numeric' && validCount(view, c.id) >= 2,
  )
  const timeLike = present.filter((c) => c.role !== 'group' && isTimeLike(c) && validCount(view, c.id) >= 2)

  const x = timeLike[0] ?? quantities[0]
  const y = x ? quantities.find((c) => c.id !== x.id) : undefined
  if (x && y) {
    const u = dataset.columns.find(
      (c) =>
        c.role === 'uncertainty' &&
        c.uncertaintyOf === y.id &&
        c.source.type !== 'derived' &&
        kind(c) === 'numeric' &&
        validCount(view, c.id) >= 1,
    )
    const timeX = isTimeLike(x)
    return {
      plotType: 'scatter',
      messageKey: 'recommend.scatter',
      params: { x: x.name, y: y.name },
      alternatives: timeX ? [{ plotType: 'line', messageKey: 'recommend.alt.line' }] : [],
      suggestFit: x.role === 'measurement' && kind(x) === 'numeric' && kind(y) === 'numeric',
      uncertaintyColumn: u?.id ?? null,
      columns: { x: x.id, y: y.id, value: null, group: null },
    }
  }

  const value = quantities[0]
  if (value) {
    const group = groupColumn(dataset, view, value.id)
    if (group)
      return {
        plotType: 'box',
        messageKey: 'recommend.box',
        params: { column: value.name, group: group.name },
        alternatives: [],
        suggestFit: false,
        uncertaintyColumn: null,
        columns: { x: null, y: null, value: value.id, group: group.id },
      }
    return {
      plotType: 'histogram',
      messageKey: 'recommend.histogram',
      params: { column: value.name },
      alternatives: [],
      suggestFit: false,
      uncertaintyColumn: null,
      columns: { x: null, y: null, value: value.id, group: null },
    }
  }

  return {
    plotType: 'scatter',
    messageKey: 'recommend.none',
    params: {},
    alternatives: [],
    suggestFit: false,
    uncertaintyColumn: null,
    columns: { x: null, y: null, value: null, group: null },
  }
}

/** Above this many groups a split series stays whole (the pipeline then warns, W_SPLIT_TOO_MANY_GROUPS). */
const MAX_SPLIT_GROUPS = 50

/** Distinct values of a column among the rows of the view; missing and unreadable cells are not values. */
function distinctValues(view: DatasetView, id: ColumnId): number {
  const col = view.columns.get(id)
  if (!col) return 0
  const seen = new Set<string | number>()
  for (let i = 0; i < col.status.length; i++) {
    if (col.status[i] !== CELL.ok) continue
    if (col.categories) {
      const code = col.categories.codes[i]
      if (code >= 0) seen.add(col.categories.labels[code])
    } else if (Number.isFinite(col.values[i])) seen.add(col.values[i])
  }
  return seen.size
}

/**
 * The first plot of a dataset: the recommended type, with the bar / histogram / box options already
 * pointing at the recommended columns so switching type works at once. Never a fit, never error bars
 * (the uncertainty column is only suggested). `splitBy` (the label column of tables merged on import)
 * splits the scatter into one curve per value when it has 2 to 50 values; rows without a value are
 * kept by the split as their own group, never dropped.
 */
export function initialPlot(
  dataset: Dataset,
  view: DatasetView,
  plotId: PlotId,
  seriesId: SeriesId,
  opts: { splitBy?: ColumnId | null } = {},
): { plot: PlotSpec; recommendation: Recommendation } {
  const recommendation = recommend(dataset, view)
  const plot = defaultPlotSpec(plotId)
  plot.type = recommendation.plotType
  const { x, y, value, group } = recommendation.columns
  const measured = y ?? value
  if (x && y) {
    const series: XYSeriesSpec = {
      id: seriesId,
      datasetId: dataset.id,
      name: null,
      x,
      y,
      visible: true,
      style: { ...DEFAULT_SERIES_STYLE, paletteIndex: 0 },
      errorBars: { x: { kind: 'none' }, y: { kind: 'none' }, visible: true },
      split: null,
    }
    const by = opts.splitBy
    const groups = by && by !== x && by !== y ? distinctValues(view, by) : 0
    if (by && groups >= 2 && groups <= MAX_SPLIT_GROUPS) series.split = { column: by, overrides: [] }
    plot.series = [series]
  }
  if (measured) {
    plot.histogram = { ...plot.histogram, datasetId: dataset.id, value: measured }
    plot.box = { ...plot.box, datasetId: dataset.id, value: measured, groupBy: group }
    // Bars need categories: the group column, else the x column (its distinct values).
    plot.bar = { ...plot.bar, datasetId: dataset.id, category: group ?? x, value: measured }
  }
  return { plot, recommendation }
}
