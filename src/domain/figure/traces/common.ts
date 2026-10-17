/**
 * Pieces shared by the trace builders. Every trace object is created fresh on each call (Plotly
 * mutates traces, e.g. writing selectedpoints back), with plain number[] arrays.
 */
import type { Data, ScatterData } from 'plotly.js'
import type { DatasetView, ErrorBarArrays, RecordAxis } from '@/domain/derive/types'
import type { DatasetId, MarkerSymbol } from '@/domain/model'
import type { Translate } from '../context'
import { escapePlotText } from '../escape'

export interface BuiltTrace {
  trace: Data
  uid: string
  /** Selectable traces: one RowId per point (−1 = not a row). */
  rowIds?: number[]
  /** Points that stand for several rows (bins, group means, mean bars). */
  members?: number[][]
  datasetId?: DatasetId
  /** Markers drawn (W_MANY_POINTS counts them). */
  markers: number
}

/** Trace roles: uid = `${owner}__${role}` (owner = series id, or plot id for bar / histogram / box). */
export type TraceRole =
  | 'points'
  | 'excluded'
  | 'fit'
  | 'fitExtrapolation'
  | 'band'
  | 'bandLower'
  | 'predictionBand'
  | 'predictionBandLower'
  | 'residuals'
  | 'groupMeans'
  | 'boxPoints'
  | 'boxStats'
  | 'bar'
  | 'barPoints'
  | 'histogram'
  | 'box'
  /** Data-free traces that only hold the one legend entry standing for every group of a split series. */
  | 'fitLegend'
  | 'bandLegend'
  | 'predictionBandLegend'
  | 'groupMeansLegend'

/**
 * Separator between owner id and role. Plotly builds CSS class selectors from trace uids ('.cb' + uid),
 * so the uid must be a valid CSS identifier: no ':' (ids are [A-Za-z0-9_-] with single underscores).
 */
export const UID_SEP = '__'
/** `${owner}__${role}`, or `${owner}__${group uid}__${role}` for a trace of one group (split series, groupBy). */
export const traceUid = (owner: string, role: TraceRole, group?: string) =>
  group ? `${owner}${UID_SEP}${group}${UID_SEP}${role}` : `${owner}${UID_SEP}${role}`
/** Owner (series or plot id) of a trace uid; group traces belong to their series. */
export const uidOwner = (uid: string) => uid.split(UID_SEP)[0]

export type ScatterTrace = Partial<ScatterData>
export type ScatterMarker = NonNullable<ScatterTrace['marker']>
export type ScatterLine = NonNullable<ScatterTrace['line']>

/** Unit as " unit" (escaped) for hover text; '' without a unit. */
export const unitSuffix = (unit: string | null) => (unit ? ` ${escapePlotText(unit)}` : '')

/** "Row {row}" (or "Column {column}" for a transposed block) with a hovertemplate field in place of the position. */
export function rowTemplate(t: Translate, field: string, axis: RecordAxis = 'row'): string {
  const MARK = 'ROWFIELD7f3a'
  const text =
    axis === 'column' ? t('figure.hover.column', { column: MARK }) : t('figure.hover.row', { row: MARK })
  return escapePlotText(text).replace(MARK, field)
}

/** The hover line of a record whose field holds recordField(): "Row 5", or the whole line of a stacked dataset. */
export function recordTemplate(
  t: Translate,
  field: string,
  view: Pick<DatasetView, 'recordAxis' | 'recordBlocks'>,
): string {
  return view.recordBlocks?.length ? field : rowTemplate(t, field, view.recordAxis)
}

export interface PlotlyErrorBar {
  type: 'data'
  array: number[]
  arrayminus?: number[]
  symmetric: boolean
  visible: boolean
  thickness: number
  width: number
  color: string
}

/**
 * Plotly error bar from ErrorBarArrays restricted to the trace's points (`idx` = indices into the
 * arrays, −1 = a line break). NaN → no bar (never 0). Asymmetric bars pass both arrays explicitly.
 * `visible` false keeps the arrays (hiding bars never changes them).
 */
export function errorBar(
  bars: Pick<ErrorBarArrays, 'plus' | 'minus'> | null,
  idx: readonly number[],
  visible: boolean,
  color: string,
): PlotlyErrorBar | undefined {
  if (!bars) return undefined
  const take = (a: Float64Array) => idx.map((i) => (i < 0 ? NaN : a[i]))
  const out: PlotlyErrorBar = {
    type: 'data',
    array: take(bars.plus),
    symmetric: bars.minus === null,
    visible,
    thickness: 1.25,
    width: 3,
    color,
  }
  if (bars.minus) out.arrayminus = take(bars.minus)
  return out
}

/** Marker of a data series: filled with a thin white outline, or hollow ("-open" symbols). */
export function seriesMarker(
  color: string,
  symbol: MarkerSymbol,
  size: number,
  open: boolean,
): ScatterMarker {
  return {
    color,
    size,
    symbol: open ? `${symbol}-open` : symbol,
    line: open ? { color, width: 1.5 } : { color: '#ffffff', width: 0.5 },
  }
}

/** Selection styling: unselected points fade, selected ones grow slightly. */
export function selectionStyle(size: number) {
  return { selected: { marker: { opacity: 1, size: size + 2 } }, unselected: { marker: { opacity: 0.25 } } }
}

/** 32-bit integer hash → [0, 1): deterministic jitter from a RowId (same row, same position). */
export function hashUnit(n: number): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
