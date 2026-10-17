/**
 * POINTWISE bands of a fit (fit/band.ts): the confidence band of the fitted mean, and on request the
 * prediction band for one new observation. They are not simultaneous bands; the legend and caption say
 * "pointwise". Drawn as a lower + upper pair filled 'tonexty' (the lower trace must come first), both
 * in the series colour: the confidence band filled at 12 %, the prediction band at 6 % inside a dotted
 * outline. With several series in the plot the legend entry names its series.
 * Exact fits have no estimable scatter (NaN bounds): no band is drawn rather than a zero-width one.
 *
 * 'tonexty' cannot fill across a gap in only one of the two traces: Plotly closes the fill with
 * straight edges that invent a limit. So the pair shares one mask (a limit that is not finite hides
 * both), and a finite limit ≤ 0 on a log y axis is passed as it is, never as NaN. Plotly draws such a
 * value far below the axis and leaves it out of the autorange, so the band is filled down to the
 * bottom edge, which is where it really goes (a log axis cannot show ≤ 0).
 */
import type { FitOk } from '@/domain/derive/types'
import { band } from '@/domain/fit/band'
import { escapePlotText } from '../escape'
import { drawableOn } from '../logDomain'
import { withAlpha } from '../palette'
import { type BuiltTrace, type ScatterLine, type ScatterTrace, type TraceRole } from './common'
import type { CurveGrid } from './fit'
import { type SeriesEnv, envTitle, envUid } from './scatter'

export function bandTraces(
  env: SeriesEnv,
  fit: FitOk,
  grid: CurveGrid,
  kind: 'confidence' | 'prediction',
): BuiltTrace[] {
  const { s, ctx } = env
  const b = band(fit, grid.xs, kind)
  const both = (k: number) => Number.isFinite(b.lower[k]) && Number.isFinite(b.upper[k])
  const lower = b.lower.map((v, k) => (both(k) ? v : NaN))
  const upper = b.upper.map((v, k) => (both(k) ? v : NaN))
  // Nothing visible (no finite limits, or a band entirely ≤ 0 on a log axis): no band, no legend entry.
  if (!upper.some((v) => drawableOn(v, env.scales.y))) return []
  const level = Math.round(fit.provenance.confidence * 100)
  const name = escapePlotText(
    env.several || env.group
      ? ctx.t(`legend.band.${kind}Of`, { level, series: envTitle(env) })
      : ctx.t(`legend.band.${kind}`, { level }),
  )
  const confidence = kind === 'confidence'
  const line: ScatterLine = confidence
    ? { color: env.color, width: 0 }
    : { color: env.color, width: 1, dash: 'dot' }
  const make = (role: TraceRole, y: number[], filled: boolean): BuiltTrace => {
    const uid = envUid(env, role)
    const trace: ScatterTrace = {
      type: 'scatter',
      uid,
      name,
      legendgroup: s.spec.id,
      // The bands of a split series' groups share one legend entry per kind (a data-free trace).
      showlegend: filled && !env.group,
      visible: env.visible,
      mode: 'lines',
      x: [...grid.xs],
      y,
      line,
      connectgaps: false,
      hoverinfo: 'skip',
    }
    if (filled) {
      trace.fill = 'tonexty'
      trace.fillcolor = withAlpha(env.color, confidence ? 0.12 : 0.06)
    }
    return { trace, uid, markers: 0 }
  }
  return [
    make(confidence ? 'bandLower' : 'predictionBandLower', lower, false),
    make(confidence ? 'band' : 'predictionBand', upper, true),
  ]
}
