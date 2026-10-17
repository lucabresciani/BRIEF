import type { ColumnId, DatasetId, PlotId, SeriesId } from './ids'
import type { GroupSpreadSpec, UncertaintySpec, XUncertaintySpec } from './uncertainty'

export type PlotType = 'scatter' | 'line' | 'bar' | 'histogram' | 'box'

export interface AxisSpec {
  /** null → column name / unit. */
  label: string | null
  unit: string | null
  /** Acts ONLY on the figure: never changes the analysed sample. */
  scale: 'linear' | 'log'
  /** Values in data units (log axes converted to log10 only inside the figure builder). */
  range: { mode: 'auto' } | { mode: 'fixed'; min: number; max: number }
  showGrid: boolean
}

export type MarkerSymbol = 'circle' | 'square' | 'diamond' | 'triangle-up' | 'triangle-down' | 'cross' | 'x'
export type LineDash = 'solid' | 'dash' | 'dot' | 'dashdot' | 'longdash' | 'longdashdot'

export interface SeriesStyle {
  paletteIndex: number
  symbol: MarkerSymbol | 'auto'
  open: boolean
  markerSize: number
  lineDash: LineDash | 'auto'
  lineWidth: number
}

/**
 * One curve per value of `column`. Overrides are an array, not a record keyed by group value,
 * so that a value such as "__proto__" can never become an object key.
 */
export interface SplitSpec {
  column: ColumnId
  overrides: { key: string; paletteIndex: number | null; symbol: MarkerSymbol | 'auto' }[]
}

export interface XYSeriesSpec {
  id: SeriesId
  datasetId: DatasetId
  /** null → "<y name>" or "<dataset> · <y name>" when several datasets are shown. */
  name: string | null
  x: ColumnId
  y: ColumnId
  /** false → shown as 'legendonly' on screen and omitted from exports; its fit is still computed. */
  visible: boolean
  style: SeriesStyle
  errorBars: { x: XUncertaintySpec; y: UncertaintySpec; visible: boolean }
  /** null → a single curve. */
  split: SplitSpec | null
}

export type LegendPosition = 'auto' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'outside'
export interface LegendSpec {
  visible: boolean
  position: LegendPosition
}

export interface ScatterOptions {
  residualPanel: boolean
  showExcluded: boolean
}
/** Line plots: NaN gaps are breaks, never interpolated. */
export interface LineOptions {
  markers: boolean
  sortByX: boolean
}

interface BarBase {
  datasetId: DatasetId | null
  category: ColumnId | null
  value: ColumnId | null
  showObservations: boolean
  colorByCategory: boolean
}
/** Bars always start at 0; value axis is linear only. */
export type BarOptions =
  | (BarBase & { aggregate: 'mean'; spread: GroupSpreadSpec })
  | (BarBase & { aggregate: 'none'; uncertainty: XUncertaintySpec })

export interface HistogramOptions {
  datasetId: DatasetId | null
  value: ColumnId | null
  bins:
    | { mode: 'auto' }
    | { mode: 'count'; count: number }
    | { mode: 'width'; width: number; start: number | null }
  /** One histogram per group, on the same bin edges. */
  groupBy: ColumnId | null
  groupMode: 'overlay' | 'stack'
}

export interface BoxOptions {
  datasetId: DatasetId | null
  value: ColumnId | null
  groupBy: ColumnId | null
  points: 'all' | 'outliers' | 'none'
  showMean: boolean
  colorByGroup: boolean
}

export interface PlotExportSettings {
  widthPx: number
  heightPx: number
  scale: 1 | 2 | 3
  caption: boolean
  includeResiduals: boolean
}

/** Persisted. Keeps the options of ALL plot types so switching type never resets the others. */
export interface PlotSpec {
  id: PlotId
  /** Tab label; '' → automatic (title, then "y vs x", then "Plot n"). */
  name: string
  type: PlotType
  title: string
  xAxis: AxisSpec
  yAxis: AxisSpec
  legend: LegendSpec
  series: XYSeriesSpec[]
  scatter: ScatterOptions
  line: LineOptions
  bar: BarOptions
  histogram: HistogramOptions
  box: BoxOptions
  export: PlotExportSettings
}

type PlotCommon = Pick<PlotSpec, 'id' | 'title' | 'xAxis' | 'yAxis' | 'legend' | 'export'>
/** Derived by resolvePlot; what buildFigure consumes. */
export type PlotView =
  | { type: 'scatter'; common: PlotCommon; series: XYSeriesSpec[]; options: ScatterOptions }
  | { type: 'line'; common: PlotCommon; series: XYSeriesSpec[]; options: LineOptions }
  | { type: 'bar'; common: PlotCommon; options: BarOptions }
  | { type: 'histogram'; common: PlotCommon; options: HistogramOptions }
  | { type: 'box'; common: PlotCommon; options: BoxOptions }

export const DEFAULT_AXIS: AxisSpec = {
  label: null,
  unit: null,
  scale: 'linear',
  range: { mode: 'auto' },
  showGrid: true,
}
export const DEFAULT_SERIES_STYLE: SeriesStyle = {
  paletteIndex: 0,
  symbol: 'auto',
  open: false,
  markerSize: 7,
  lineDash: 'auto',
  lineWidth: 1.5,
}
export const DEFAULT_EXPORT: PlotExportSettings = {
  widthPx: 1000,
  heightPx: 650,
  scale: 3,
  caption: true,
  includeResiduals: true,
}
