/**
 * The one legend entry that stands for a kind of trace drawn once per group of a split series ("linear
 * fit, each group", the bands, the group means). It is a data-free trace in a neutral colour, so the
 * entry is not mistaken for the first group's; it draws nothing, is never hovered or selected, and its
 * uid belongs to the series (a legend click toggles the series, like any of its entries).
 */
import { escapePlotText } from '../escape'
import { type BuiltTrace, type ScatterLine, type ScatterMarker, type ScatterTrace, traceUid } from './common'
import type { SeriesEnv } from './scatter'

export function legendProxy(
  env: SeriesEnv,
  role: 'fitLegend' | 'bandLegend' | 'predictionBandLegend' | 'groupMeansLegend',
  name: string,
  look: { line?: ScatterLine; fillcolor?: string; marker?: ScatterMarker },
): BuiltTrace {
  const uid = traceUid(env.s.spec.id, role)
  const trace: ScatterTrace = {
    type: 'scatter',
    uid,
    name: escapePlotText(name),
    legendgroup: env.s.spec.id,
    showlegend: true,
    visible: env.visible,
    mode: look.marker ? 'markers' : 'lines',
    x: [null],
    y: [null],
    hoverinfo: 'skip',
  }
  if (look.line) trace.line = look.line
  if (look.marker) trace.marker = look.marker
  if (look.fillcolor) {
    trace.fill = 'toself'
    trace.fillcolor = look.fillcolor
  }
  return { trace, uid, markers: 0 }
}
