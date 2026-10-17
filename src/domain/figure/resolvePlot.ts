/**
 * PlotSpec → PlotView: the persisted spec keeps the options of EVERY plot type so that
 * switching type never resets the others; the view exposes only what the active type draws.
 * Memoised on the spec's identity (immer structural sharing): the same spec → the same PlotView.
 */
import type { PlotSpec, PlotView } from '@/domain/model'

const cache = new WeakMap<PlotSpec, PlotView>()

export function resolvePlot(spec: PlotSpec): PlotView {
  const hit = cache.get(spec)
  if (hit) return hit
  const common: PlotView['common'] = {
    id: spec.id,
    title: spec.title,
    xAxis: spec.xAxis,
    yAxis: spec.yAxis,
    legend: spec.legend,
    export: spec.export,
  }
  let view: PlotView
  switch (spec.type) {
    case 'scatter':
      view = { type: 'scatter', common, series: spec.series, options: spec.scatter }
      break
    case 'line':
      view = { type: 'line', common, series: spec.series, options: spec.line }
      break
    case 'bar':
      view = { type: 'bar', common, options: spec.bar }
      break
    case 'histogram':
      view = { type: 'histogram', common, options: spec.histogram }
      break
    case 'box':
      view = { type: 'box', common, options: spec.box }
      break
  }
  cache.set(spec, view)
  return view
}
