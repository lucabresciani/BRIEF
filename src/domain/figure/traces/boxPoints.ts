/**
 * Observations of a box plot as an overlaid scatter at numeric box positions, with a DETERMINISTIC
 * jitter derived from the RowId (the same row is always drawn at the same place; customdata[0] = RowId).
 * points 'all' → every observation; 'outliers' → only outlier candidates (outside the Tukey fences);
 * 'none' → none. A group too small for a box (n < 4) always shows its observations, otherwise it would
 * not be visible at all.
 */
import type { DatasetView } from '@/domain/derive/types'
import type { NumberFormatLocale } from '@/domain/format/number'
import type { BoxOptions, ColumnId, DatasetId } from '@/domain/model'
import { isOutsideFences } from '@/domain/stats/quantile'
import type { Translate } from '../context'
import { escapePlotText } from '../escape'
import { recordField, valueText } from '../labels'
import { type AxisScale, type LogTally, drawableOn } from '../logDomain'
import {
  type BuiltTrace,
  type ScatterTrace,
  type TraceRole,
  hashUnit,
  recordTemplate,
  selectionStyle,
  seriesMarker,
  traceUid,
  unitSuffix,
} from './common'
import type { BoxGroup } from './box'

export const JITTER = 0.3

export function jitterOf(rowId: number): number {
  return (hashUnit(rowId) - 0.5) * JITTER
}

/** Observations at box / bar positions (also used for the bar plot's individual observations). */
export function observationsTrace(input: {
  owner: string
  role: TraceRole
  datasetId: DatasetId
  view: DatasetView
  valueId: ColumnId
  groups: readonly BoxGroup[]
  include: (g: BoxGroup, k: number) => boolean
  name: string
  valueName: string
  unit: string | null
  color: string
  /** Colour by group (box colorByGroup, bar colorByCategory); `color` otherwise. */
  colorOf?: (g: BoxGroup) => string
  size: number
  yScale: AxisScale
  tally: LogTally
  t: Translate
  loc: NumberFormatLocale
}): BuiltTrace | null {
  const { view, t, loc } = input
  const col = view.columns.get(input.valueId)
  const x: number[] = []
  const y: number[] = []
  const rowIds: number[] = []
  const customdata: (string | number)[][] = []
  const colors: string[] = []
  for (const g of input.groups) {
    const color = input.colorOf?.(g) ?? input.color
    g.values.forEach((v, k) => {
      if (!input.include(g, k)) return
      const row = g.rowIds[k]
      if (!drawableOn(v, input.yScale)) {
        input.tally.hide(row)
        return
      }
      const outlier = g.stats !== null && isOutsideFences(v, g.stats.fences)
      x.push(g.position + jitterOf(row))
      y.push(v)
      rowIds.push(row)
      colors.push(color)
      customdata.push([
        row,
        recordField(view, row, t),
        escapePlotText(g.label),
        escapePlotText(valueText(col, g.idx[k], loc)),
        outlier ? ` · ${escapePlotText(t('table.outlierCandidate'))}` : '',
      ])
    })
  }
  if (x.length === 0) return null
  const uid = traceUid(input.owner, input.role)
  const trace: ScatterTrace = {
    type: 'scatter',
    uid,
    name: escapePlotText(input.name),
    showlegend: false,
    mode: 'markers',
    x,
    y,
    customdata,
    marker: {
      ...seriesMarker(input.color, 'circle', input.size, false),
      ...(input.colorOf ? { color: colors } : {}),
    },
    hovertemplate:
      `<b>%{customdata[2]}</b><br>${escapePlotText(input.valueName)} = %{customdata[3]}${unitSuffix(input.unit)}` +
      `<br>${recordTemplate(t, '%{customdata[1]}', view)}%{customdata[4]}<extra></extra>`,
    ...selectionStyle(input.size),
  }
  return { trace, uid, rowIds, datasetId: input.datasetId, markers: x.length }
}

/** Which observations of a group the box plot draws. */
export function boxPointFilter(points: BoxOptions['points']): (g: BoxGroup, k: number) => boolean {
  return (g, k) => {
    if (g.stats === null) return true
    if (points === 'all') return true
    if (points === 'none') return false
    return isOutsideFences(g.values[k], g.stats.fences)
  }
}
