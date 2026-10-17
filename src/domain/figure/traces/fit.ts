/**
 * Fitted curve of an XY series: 200 x values over the x range of the FITTED sample (geometric spacing
 * on a log x axis), evaluated with predict() from fit/band.ts (polynomials in the scaled basis,
 * log-linear models through the basis in log space), in the colour, dash and width of fitAppearance.
 * With curveRange 'extend' the parts beyond the data are drawn in the extrapolation dash
 * (W_EXTRAPOLATION). Non-finite predictions break the line (W_CURVE_TRUNCATED); values ≤ 0 on a log y
 * axis are simply not drawable.
 */
import type { FitOk } from '@/domain/derive/types'
import { predict } from '@/domain/fit/band'
import { issue } from '@/domain/model'
import type { FitSpec, Issue, LineDash } from '@/domain/model'
import { escapePlotText } from '../escape'
import { modelLabel } from '../labels'
import { type AxisScale, drawableOn } from '../logDomain'
import type { FitAppearance } from '../palette'
import { type BuiltTrace, type ScatterTrace, unitSuffix } from './common'
import { type SeriesEnv, envTitle, envUid } from './scatter'

export const CURVE_POINTS = 200

export interface CurveGrid {
  /** Extrapolated part below the data (ends at `data[0]`), the data range, the part above it. */
  left: number[]
  data: number[]
  right: number[]
  /** Ascending x over the whole drawn span (for the bands). */
  xs: number[]
}

function spaced(a: number, b: number, n: number, log: boolean): number[] {
  if (n < 2 || a === b) return a === b ? [a] : [a, b]
  const out: number[] = []
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1)
    out.push(log ? Math.exp(Math.log(a) + f * (Math.log(b) - Math.log(a))) : a + f * (b - a))
  }
  out[0] = a
  out[n - 1] = b
  return out
}

/**
 * Curve abscissae. null when nothing can be drawn (no finite x, or a log x axis with no x > 0).
 * On a log x axis the solid part starts at the smallest positive fitted x and an extension can only
 * reach positive x.
 */
export function curveGrid(fit: FitOk, spec: FitSpec, xScale: AxisScale): CurveGrid | null {
  const log = xScale === 'log'
  let lo = Infinity
  let hi = -Infinity
  for (const x of fit.residualX) {
    if (!drawableOn(x, xScale)) continue
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  if (!(lo <= hi)) return null
  const span = (a: number, b: number) => (log ? Math.log(b) - Math.log(a) : b - a)
  const dataSpan = span(lo, hi)
  const sideCount = (len: number) =>
    dataSpan > 0 ? Math.max(20, Math.min(400, Math.round((CURVE_POINTS * len) / dataSpan))) : 50
  const data = spaced(lo, hi, CURVE_POINTS, log)
  let left: number[] = []
  let right: number[] = []
  if (spec.curveRange.mode === 'extend') {
    const a = Math.min(spec.curveRange.min, spec.curveRange.max)
    const b = Math.max(spec.curveRange.min, spec.curveRange.max)
    if (Number.isFinite(a) && a < lo && (!log || a > 0)) left = spaced(a, lo, sideCount(span(a, lo)), log)
    if (Number.isFinite(b) && b > hi) right = spaced(hi, b, sideCount(span(hi, b)), log)
  }
  const xs = [...left.slice(0, -1), ...data, ...right.slice(1)]
  return { left, data, right, xs }
}

export function fitTraces(
  env: SeriesEnv,
  fit: FitOk,
  grid: CurveGrid,
  look: FitAppearance,
): { traces: BuiltTrace[]; issues: Issue[] } {
  const { s, ctx } = env
  const { t } = ctx
  let truncated = false
  const evaluate = (xs: readonly number[]) =>
    xs.map((x) => {
      if (Number.isNaN(x)) return NaN // a line break, not a prediction
      const v = predict(fit, x)
      if (!Number.isFinite(v)) {
        truncated = true
        return NaN
      }
      return drawableOn(v, env.scales.y) ? v : NaN
    })
  const label = t('legend.fit', { model: modelLabel(fit.model, t), series: envTitle(env) })
  const hovertemplate =
    `<b>${escapePlotText(label)}</b><br>${escapePlotText(s.xColumn.name)} = %{x}${unitSuffix(s.xColumn.unit)}<br>` +
    `${escapePlotText(t('figure.hover.predicted', { y: s.yColumn.name }))} = %{y}${unitSuffix(s.yColumn.unit)}<extra></extra>`
  const make = (role: 'fit' | 'fitExtrapolation', x: number[], y: number[], dash: LineDash): BuiltTrace => {
    const uid = envUid(env, role)
    const trace: ScatterTrace = {
      type: 'scatter',
      uid,
      name: escapePlotText(label),
      legendgroup: s.spec.id,
      // The fits of a split series' groups share one legend entry (a data-free trace).
      showlegend: role === 'fit' && !env.group,
      visible: env.visible,
      mode: 'lines',
      x,
      y,
      line: { color: look.color, width: look.width, dash },
      connectgaps: false,
      hovertemplate,
    }
    return { trace, uid, markers: 0 }
  }
  const traces = [make('fit', [...grid.data], evaluate(grid.data), look.dash)]
  const issues: Issue[] = []
  if (grid.left.length > 0 || grid.right.length > 0) {
    // Both extrapolated sides in one trace, separated by a break; each touches the fitted part.
    const x = [...grid.left, ...(grid.left.length && grid.right.length ? [NaN] : []), ...grid.right]
    traces.push(make('fitExtrapolation', x, evaluate(x), look.extrapolationDash))
    // Named by its series: the groups of a split series share the curve range and its pattern.
    issues.push(issue('W_EXTRAPOLATION', { series: env.seriesName, pattern: look.extrapolationDash }))
  }
  if (truncated) issues.push(issue('W_CURVE_TRUNCATED', { series: envTitle(env) }))
  return { traces, issues }
}
