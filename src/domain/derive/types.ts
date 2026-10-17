/**
 * Derived data: ALWAYS computed from RawTable + ProjectDoc, NEVER stored as truth.
 * Raw data → parsed columns → analysis sample → statistics / fits → figure.
 */
import type {
  ColumnId,
  ColumnParseSettings,
  ConfidenceLevel,
  DatasetId,
  FitId,
  FitModel,
  InactiveReason,
  Issue,
  ReasonCode,
  RowId,
  SeriesId,
  UncertaintySpec,
} from '@/domain/model'
import type { RecordBlock } from './recordPosition'

/** Per-cell parse status (no enum: erasableSyntaxOnly). */
export const CELL = {
  ok: 0,
  missing: 1,
  sheetError: 2,
  invalid: 3,
  separatorConflict: 4,
  unexpectedUnit: 5,
  domain: 6,
} as const
export type CellStatus = (typeof CELL)[keyof typeof CELL]

/** A cell without a value: empty, a missing-value token or a spreadsheet error, never an invalid one. */
export const isMissingStatus = (s: number): boolean => s === CELL.missing || s === CELL.sheetError

/** Figure-only mask: points hidden from the drawing (never from the analysis). */
export const RENDER = { shown: 0, logDomain: 1 } as const

/**
 * Reason of a row that belongs to another group in the masked sample of one group of a split series
 * (DerivedGroup.sample). Deliberately NOT an INACTIVE reason: such a row is never counted (not in nTotal
 * nor in counts), it simply is not part of that group's sample.
 */
export const GROUP_OUTSIDE = 255

export interface ParseReport {
  nRows: number
  nValid: number
  nMissing: number
  nSheetError: number
  nInvalid: number
  invalidExamples: { rowId: RowId; text: string; code: ReasonCode }[]
  missingTokens: string[]
}

export interface ParsedColumn {
  columnId: ColumnId
  /** Effective settings = override ?? detected. */
  settings: ColumnParseSettings
  /** Aligned with DatasetView.rowIds. NaN wherever status ≠ ok: a missing value never becomes 0. */
  values: Float64Array
  status: Uint8Array
  /** Categorical / text columns: label index per row (−1 = missing) and labels. */
  categories: { codes: Int32Array; labels: string[] } | null
  /** Display text per row (the original token). */
  text: readonly string[]
  report: ParseReport
}

/**
 * What one record (a row of the view) was in the source: a row of the file or sheet, or a sheet column
 * when the block was transposed on import (variables in rows on the sheet).
 */
export type RecordAxis = 'row' | 'column'

export interface DatasetView {
  datasetId: DatasetId
  /** Non-blank data rows, in display order. */
  rowIds: Int32Array
  /** RowId → index in rowIds. */
  rowIndex: ReadonlyMap<number, number>
  /** Entirely empty rows: kept in the raw data, outside nTotal (I_BLANK_ROWS). */
  blankRows: Int32Array
  /**
   * Source position of each record, aligned with rowIds: the 1-based row number as in the file / sheet,
   * or with recordAxis 'column' the 1-based sheet column number (A = 1). See recordPosition.ts.
   */
  sourceRow: Int32Array
  /** 'column' for a table transposed on import (RawSource.region.orientation 'rows'), else 'row'. */
  recordAxis: RecordAxis
  /**
   * The tables of a dataset stacked from several sheet tables (recordBlocks), where the same row or
   * column occurs once per table; empty or absent otherwise. Same array while the raw table is the same.
   */
  recordBlocks?: readonly RecordBlock[]
  columns: ReadonlyMap<ColumnId, ParsedColumn>
  /** Column order as in the dataset. */
  columnOrder: readonly ColumnId[]
}

/** Analysis mask per row of the DatasetView (reason codes from INACTIVE; precedence missing > invalid > excluded > filtered). */
export interface AnalysisSample {
  rowIds: Int32Array
  reason: Uint8Array
  nTotal: number
  nActive: number
  counts: Record<InactiveReason, number>
}

export interface ColumnSummary {
  columnId: ColumnId
  /** Active rows with a valid value in THIS column. */
  n: number
  nMissing: number
  nInvalid: number
  nExcluded: number
  nFiltered: number
  mean: number | null
  median: number | null
  sd: number | null
  sem: number | null
  ci: readonly [number, number] | null
  tCritical: number | null
  min: number | null
  max: number | null
  range: number | null
  q1: number | null
  q3: number | null
  iqr: number | null
  fences: readonly [number, number] | null
  /** Adjacent values: most extreme observations within the Tukey fences. */
  whiskers: readonly [number, number] | null
  outlierCandidates: readonly RowId[]
  warnings: readonly Issue[]
}

export interface SeriesData {
  seriesId: SeriesId
  datasetId: DatasetId
  /** All non-blank rows of the dataset (aligned arrays). */
  rowIds: Int32Array
  x: Float64Array
  y: Float64Array
  /** Pairwise sample: rows where x AND y are valid and the row is active. The only input of fits. */
  sample: AnalysisSample
  /** RENDER per row: points ≤ 0 on a log axis are hidden ONLY in the figure. */
  render: Uint8Array
}

export interface ErrorBarArrays {
  /** Half-length above (or symmetric). NaN = no bar. */
  plus: Float64Array
  /** Half-length below; null = symmetric. If one side of an asymmetric pair is missing → NaN on both. */
  minus: Float64Array | null
  /** CELL status per row: ok | missing | invalid (negative / non-finite; never abs()). */
  status: Uint8Array
  descriptor: UncertaintyDescriptor
  issues: Issue[]
}

export interface UncertaintyDescriptor {
  kind: UncertaintySpec['kind']
  /** i18n key for the legend/caption label, e.g. 'uncertainty.label.sem'. */
  labelKey: string
  params: Record<string, string | number>
}

export interface GroupSummary {
  key: string
  x: number | null
  rowIds: RowId[]
  n: number
  mean: number
  sd: number | null
  sem: number | null
  ciHalf: number | null
  t: number | null
}

export interface FitParameter {
  symbol: string
  value: number
  se: number | null
  ci: readonly [number, number] | null
  unit: string | null
  /** Log-linear models: the CI of a is asymmetric (exp of the CI of ln a). */
  note?: 'asymmetric-ci'
}

export interface FitProvenance {
  algorithm: 'ols-linear-centred@1' | 'ols-householder-scaled@1' | 'ols-loglinear@1'
  rowIdsUsed: readonly RowId[]
  nUsed: number
  nTotal: number
  inactive: Readonly<Record<InactiveReason, number>>
  /** Fits always use individual observations, never group means. */
  usesGroupMeans: false
  confidence: ConfidenceLevel
  tCritical: number | null
}

/**
 * Everything needed to evaluate the curve and its pointwise bands without re-fitting.
 * Added by module D (fit) for numerically stable bands:
 * - linear / logLinear: xScale = max|X − X̄| and suu = Σ((X − X̄)/xScale)², so Sxx = xScale²·suu never
 *   under/overflows (|x| ≈ 1e-170); n is provenance.nUsed, s is FitOk.s.
 * - scaledPoly: r = upper-triangular R (p×p) of the Householder QR in the t basis; bands solve Rᵀw = v₀.
 */
export type FitBasis =
  | { kind: 'linear'; b0: number; b1: number; xbar: number; sxx: number; xScale: number; suu: number }
  /** t = (x − m)/h, predictions by Horner in the t basis with coefficients c (scaled by sy). */
  | {
      kind: 'scaledPoly'
      m: number
      h: number
      sy: number
      c: readonly number[]
      r: readonly (readonly number[])[]
    }
  /** X = x (exponential) or ln x (power); ln ŷ = lnA + b·X. */
  | {
      kind: 'logLinear'
      lnA: number
      b: number
      x: 'identity' | 'ln'
      xbar: number
      xScale: number
      suu: number
    }

export interface EquationTokens {
  form: 'original' | 'centred'
  x0: number | null
  terms: readonly { coef: FitParameter; power: number }[]
}

export interface FitOk {
  status: 'ok'
  fitId: FitId
  model: FitModel
  params: readonly FitParameter[]
  basis: FitBasis
  /** Covariance of the reported parameters (original parameterisation). */
  covariance: readonly (readonly number[])[]
  df: number
  /** Residual standard error (y units; ln y units for log-linear models). */
  s: number
  rss: number
  r2: number | null
  adjR2: number | null
  /** What R² refers to: y, or ln y for log-linear models. */
  r2Of: 'y' | 'lnY'
  seSource: 'residual-scatter'
  /** Only when the series has u(y): neutral comparison, no χ². */
  uComparison: { s: number; medianU: number } | null
  /** Internal (gates and warnings), never shown. */
  kappa1: number
  maxLeverage: { h: number; rows: readonly RowId[] }
  exactFit: boolean
  /** Aligned with provenance.rowIdsUsed. Log-linear: ln y − ln ŷ. */
  residuals: Float64Array
  /** Residual x values aligned with residuals. */
  residualX: Float64Array
  /** Residual signs ordered by x (ties by RowId); |r| ≤ 1e-12·s skipped. */
  residualSignRuns: string
  equation: EquationTokens
  warnings: readonly Issue[]
  provenance: FitProvenance
}

export type FitErrorCode =
  | 'E_TOO_FEW_POINTS'
  | 'E_TOO_FEW_DISTINCT_X'
  | 'E_CONSTANT_X'
  | 'E_X_EFFECTIVELY_CONSTANT'
  | 'E_ILL_CONDITIONED'
  | 'E_LOG_DOMAIN_FIT'
  | 'E_OVERFLOW'
  | 'E_COLUMN_NOT_NUMERIC'

export interface FitError {
  status: 'error'
  fitId: FitId
  model: FitModel
  error: Issue & { code: FitErrorCode }
  provenance: Partial<FitProvenance>
}

export type FitResult = FitOk | FitError

/** Maps between Plotly (trace uid, pointIndex) and RowId, in both directions. */
export interface SelectionMap {
  byTrace: ReadonlyMap<string, Int32Array>
  byRow: ReadonlyMap<number, readonly { uid: string; pointIndex: number }[]>
}

/** A selection is always within one dataset. */
export interface Selection {
  datasetId: DatasetId
  rowIds: ReadonlySet<number>
  origin: 'plot' | 'table'
  anchor: RowId | null
}
