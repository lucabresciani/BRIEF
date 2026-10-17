/**
 * Points of an XY series: one marker per row of the ANALYSED sample (pairwise reason active) that the
 * axes can draw. Rows hidden by a log axis are counted (W_LOG_AXIS_HIDDEN), never silently dropped;
 * excluded / filtered rows have their own trace (excluded.ts). Error bars are the series' measurement
 * bars restricted to the drawn points; replicate bars live only on the group-means trace.
 */
import type { DerivedGroup, DerivedSeries } from '@/domain/derive/pipeline'
import { type AnalysisSample, RENDER } from '@/domain/derive/types'
import { INACTIVE } from '@/domain/model'
import type { LineDash, MarkerSymbol } from '@/domain/model'
import type { FigureContext } from '../context'
import { escapePlotText } from '../escape'
import { anyBar, barText, recordField, uncertaintyLabel, valueText } from '../labels'
import { type AxisScale, type LogTally, lowerEndClipped } from '../logDomain'
import {
  type BuiltTrace,
  type ScatterLine,
  type ScatterMarker,
  type ScatterTrace,
  type TraceRole,
  errorBar,
  recordTemplate,
  selectionStyle,
  seriesMarker,
  traceUid,
  unitSuffix,
} from './common'

/** What every trace of one XY series (or of one group of a split series) needs. */
export interface SeriesEnv {
  s: DerivedSeries
  /** Display name (plain text): the series label (seriesLabels), or the group label for a group. */
  name: string
  /** The series label, also when this env draws one group. */
  seriesName: string
  /** The group drawn (split series): its rows, masked sample, replicate statistics and fit; else null. */
  group: DerivedGroup | null
  /** The plot shows more than one series: the band and excluded legend entries name theirs. */
  several: boolean
  color: string
  symbol: MarkerSymbol
  dash: LineDash
  /** Screen: hidden series stay in the legend ('legendonly'); export omits them. */
  visible: true | 'legendonly'
  scales: { x: AxisScale; y: AxisScale }
  ctx: FigureContext
  /** null for hidden series: nothing they would draw is reported. */
  tally: LogTally | null
}

/** Indices into the series arrays in drawing order; −1 = a line break. */
export type PointOrder = readonly number[]

/** The analysed sample of what the env draws: the group's masked sample, else the series'. */
export const envSample = (env: SeriesEnv): AnalysisSample => env.group?.sample ?? env.s.data.sample

/** Indices into the series arrays the env draws from, ascending: the group's rows, else every row. */
export function envRows(env: SeriesEnv): ArrayLike<number> & Iterable<number> {
  if (env.group) return env.group.rows
  const n = env.s.data.rowIds.length
  return Array.from({ length: n }, (_, i) => i)
}

/** uid of a trace of the env: `${series}__${role}`, or `${series}__${group uid}__${role}`. */
export const envUid = (env: SeriesEnv, role: TraceRole) => traceUid(env.s.spec.id, role, env.group?.uid)

/** Name in hover titles and fit labels: "series · group" for a group, else the series name. */
export const envTitle = (env: SeriesEnv) => (env.group ? `${env.seriesName} · ${env.name}` : env.name)

/** Counts clipped lower bar ends of the drawn points (log axes). */
function tallyClipped(env: SeriesEnv, order: PointOrder): void {
  const { s, tally, scales } = env
  if (!tally || !s.spec.errorBars.visible) return
  const d = s.data
  for (const i of order) {
    if (i < 0) continue
    if (s.yBars && lowerEndClipped(d.y[i], s.yBars.plus[i], s.yBars.minus?.[i] ?? null, scales.y))
      tally.clip(d.rowIds[i])
    if (s.xBars && lowerEndClipped(d.x[i], s.xBars.plus[i], s.xBars.minus?.[i] ?? null, scales.x))
      tally.clip(d.rowIds[i])
  }
}

export interface XYTraceOptions {
  role: TraceRole
  name: string
  showlegend: boolean
  mode: 'markers' | 'lines' | 'lines+markers'
  marker: ScatterMarker
  /** Marker size used for the selection styling. */
  size: number
  barColor: string
  line?: ScatterLine
  /** Per point extra hover text (e.g. "excluded"), appended after the row number. */
  extra?: (i: number) => string
}

/**
 * A marker / line trace over the rows `order` (−1 = break). customdata per point = [RowId, source
 * position (row number, or column letters of a transposed block), x text, y text, y-bar text, x-bar
 * text, extra text] — all text escaped.
 */
export function xyTrace(env: SeriesEnv, order: PointOrder, opts: XYTraceOptions): BuiltTrace {
  const { s, ctx } = env
  const { loc, t } = ctx
  const d = s.data
  const xCol = s.view.columns.get(s.spec.x)
  const yCol = s.view.columns.get(s.spec.y)
  const bars = s.spec.errorBars
  const x: number[] = []
  const y: number[] = []
  const customdata: (string | number)[][] = []
  const rowIds: number[] = []
  let markers = 0
  for (const i of order) {
    if (i < 0) {
      x.push(NaN)
      y.push(NaN)
      customdata.push([-1, '', '', '', '', '', ''])
      rowIds.push(-1)
      continue
    }
    const row = d.rowIds[i]
    x.push(d.x[i])
    y.push(d.y[i])
    rowIds.push(row)
    markers++
    customdata.push([
      row,
      recordField(s.view, row, t),
      escapePlotText(valueText(xCol, i, loc)),
      escapePlotText(valueText(yCol, i, loc)),
      s.yBars ? escapePlotText(barText(s.yBars.plus[i], s.yBars.minus?.[i] ?? null, loc)) : '',
      s.xBars ? escapePlotText(barText(s.xBars.plus[i], s.xBars.minus?.[i] ?? null, loc)) : '',
      opts.extra ? escapePlotText(opts.extra(i)) : '',
    ])
  }
  tallyClipped(env, order)

  // Bars that are all missing or refused (E_DERIVED_UNCERTAINTY) draw nothing and are not labelled.
  const yBars = anyBar(s.yBars) ? s.yBars : null
  const xBars = anyBar(s.xBars) ? s.xBars : null
  const barLabels: string[] = []
  if (yBars && bars.visible) barLabels.push(`${s.yColumn.name}: ${uncertaintyLabel(yBars.descriptor, t)}`)
  if (xBars && bars.visible) barLabels.push(`${s.xColumn.name}: ${uncertaintyLabel(xBars.descriptor, t)}`)
  const hovertemplate =
    `<b>${escapePlotText(env.group ? `${env.seriesName} · ${opts.name}` : opts.name)}</b><br>` +
    `${escapePlotText(s.xColumn.name)} = %{customdata[2]}%{customdata[5]}${unitSuffix(s.xColumn.unit)}<br>` +
    `${escapePlotText(s.yColumn.name)} = %{customdata[3]}%{customdata[4]}${unitSuffix(s.yColumn.unit)}` +
    barLabels.map((l) => `<br><i>${escapePlotText(l)}</i>`).join('') +
    `<br>${recordTemplate(t, '%{customdata[1]}', s.view)}%{customdata[6]}<extra></extra>`

  const uid = envUid(env, opts.role)
  const trace: ScatterTrace = {
    type: 'scatter',
    uid,
    name: escapePlotText(opts.name),
    legendgroup: s.spec.id,
    showlegend: opts.showlegend,
    visible: env.visible,
    mode: opts.mode,
    x,
    y,
    customdata,
    hovertemplate,
    marker: opts.marker,
    ...selectionStyle(opts.size),
  }
  if (opts.line) trace.line = opts.line
  if (opts.mode !== 'markers') trace.connectgaps = false
  const ey = errorBar(yBars, order, bars.visible, opts.barColor)
  const ex = errorBar(xBars, order, bars.visible, opts.barColor)
  if (ey) trace.error_y = ey
  if (ex) trace.error_x = ex
  return { trace, uid, rowIds, datasetId: s.spec.datasetId, markers: env.visible === true ? markers : 0 }
}

/** Indices of the rows drawn as points: active in the pairwise sample and drawable on the axes. */
export function activeDrawn(env: SeriesEnv): number[] {
  const d = env.s.data
  const sample = envSample(env)
  const out: number[] = []
  for (const i of envRows(env)) {
    if (sample.reason[i] !== INACTIVE.active) continue
    if (d.render[i] !== RENDER.shown) {
      env.tally?.hide(d.rowIds[i])
      continue
    }
    if (Number.isFinite(d.x[i]) && Number.isFinite(d.y[i])) out.push(i)
  }
  return out
}

/** Scatter plot points (mode 'markers', always explicit: Plotly's default adds lines below 20 points). */
export function scatterPoints(env: SeriesEnv): BuiltTrace {
  const st = env.s.spec.style
  return xyTrace(env, activeDrawn(env), {
    role: 'points',
    name: env.name,
    showlegend: true,
    mode: 'markers',
    marker: seriesMarker(env.color, env.symbol, st.markerSize, st.open),
    size: st.markerSize,
    barColor: env.color,
  })
}
