import type { FitId, SeriesId } from './ids'
import type { LineDash } from './plot'
import type { ConfidenceLevel } from './uncertainty'

export type FitModel =
  | { type: 'linear' }
  /** Explicit degree; UI caps it per disclosure level, the core supports up to 10 (NIST Filip). */
  | { type: 'polynomial'; degree: number }
  /** "Exponential (least squares on ln y)": y = a·e^(b·x), requires y > 0. */
  | { type: 'exponential' }
  /** "Power law (least squares on ln y vs ln x)": y = a·x^b, requires x > 0 and y > 0. */
  | { type: 'power' }

/** How the fit curve is drawn. 'series' / 'auto' follow the series, chosen so the fit stays distinguishable. */
export interface FitStyle {
  color: { mode: 'series' } | { mode: 'palette'; index: number }
  dash: LineDash | 'auto'
  width: number
}

export interface FitSpec {
  id: FitId
  seriesId: SeriesId
  model: FitModel
  /** 0.95 by default; 0.90 / 0.99 only in Advanced. */
  confidence: ConfidenceLevel
  show: { curve: boolean; confidenceBand: boolean; predictionBand: boolean; residuals: boolean }
  /** 'extend' draws the curve beyond the data, styled as extrapolation. */
  curveRange: { mode: 'data' } | { mode: 'extend'; min: number; max: number }
  style: FitStyle
  /** With a split series: one fit per group instead of one for the whole series. */
  perGroup: boolean
}

export const DEFAULT_FIT_STYLE: FitStyle = { color: { mode: 'series' }, dash: 'auto', width: 2 }

export function modelParameterCount(m: FitModel): number {
  switch (m.type) {
    case 'linear':
    case 'exponential':
    case 'power':
      return 2
    case 'polynomial':
      return m.degree + 1
  }
}
