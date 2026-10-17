import type { Config, Data, Layout } from 'plotly.js'
import type { DerivedProject } from '@/domain/derive/pipeline'
import type { Selection } from '@/domain/derive/types'
import type { NumberFormatLocale } from '@/domain/format/number'
import type { Issue, ProjectDoc } from '@/domain/model'
import type { FigureSelectionMap } from './selectionMap'

/**
 * What a figure reads of a derivation: one plot, the views and samples of the data, and the document
 * slice its texts name (dataset names, exclusions, filters). A DerivedProject is one.
 */
export type FigureInput = Pick<
  DerivedProject,
  'views' | 'plot' | 'plotView' | 'series' | 'axisScales' | 'columnSample'
> & { doc: Pick<ProjectDoc, 'datasets' | 'exclusions' | 'filters'> }

/** i18n function: key + params → text (tests pass a fake returning `${key}|${JSON.stringify(params)}`). */
export type Translate = (key: string, params?: Record<string, string | number>) => string

export interface FigureContext {
  mode: 'screen' | 'export'
  lang: 'en' | 'it'
  loc: NumberFormatLocale
  t: Translate
  selection: Selection | null
  dragmode: 'zoom' | 'pan' | 'select' | 'lasso'
  viewResetCounter: number
  fontFamily: string
  advanced: boolean
  /** Export only. */
  size?: { width: number; height: number }
  /**
   * Screen only: the height of the pane the figure is drawn in (CSS px), when known. A short pane
   * gets a compact residual panel (smaller ticks, no residual axis title) so both panels stay legible.
   */
  paneHeight?: number
  /** Screen only: the width of that pane (CSS px), when known. A narrow pane keeps its legend above the plot. */
  paneWidth?: number
}

export interface FigureOut {
  data: Data[]
  layout: Partial<Layout>
  config: Partial<Config>
  selectionMap: FigureSelectionMap
  /** Export caption lines (equation with PDG-formatted parameters, n, exclusions, uncertainty definition, "pointwise" band label). */
  caption: string[]
  /** ALWAYS present when the sample is filtered/excluded or a fit is shown: "n = 9 of 10 · 1 excluded · linear fit". */
  indicator: string | null
  /**
   * Figure-level issues: W_LOG_AXIS_HIDDEN, W_LOG_AXIS_BARS_CLIPPED, I_DATE_AXIS_LINEAR, W_MANY_POINTS,
   * W_EXTRAPOLATION, W_CURVE_TRUNCATED, E_* for unconfigured plots.
   */
  issues: Issue[]
  /** aria-label summary: type, variables + units, n, fit summary. */
  a11y: string
}
