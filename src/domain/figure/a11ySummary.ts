/**
 * Text alternative of the figure (aria-label of the plot container, role="img"): plot type, the
 * variables with units, n, the groups of a split series or grouped histogram, and the fit summary
 * (model, parameters ± SE, R²; one per group when fitted per group). Plain text.
 */
import type { FitOk } from '@/domain/derive/types'
import { formatR2 } from '@/domain/format/number'
import {
  fitShown,
  groupCounts,
  groupFits,
  parameterText,
  reportedParameters,
  shownSeries,
  singleSample,
} from './caption'
import type { FigureContext, FigureInput } from './context'
import { groupLabel } from './groups'
import { figureSeriesLabels, modelLabel, plotTitles } from './labels'

export function a11ySummary(
  derived: FigureInput,
  ctx: FigureContext,
  extras?: { bins?: number; groups?: number; bars?: number },
): string {
  const { t, loc } = ctx
  const plot = derived.plot
  if (!plot) return t('figure.a11y.empty')
  const type = t(`plot.types.${plot.type}`)
  if (plot.type === 'scatter' || plot.type === 'line') {
    const shown = shownSeries(derived)
    if (shown.length === 0) return t('figure.a11y.empty')
    const titles = plotTitles(derived, shown, t)
    const parts = [t('figure.a11y.xy', { type, x: titles.x, y: titles.y })]
    const labels = figureSeriesLabels(derived, t)
    const fitParams = (fit: FitOk) => ({
      model: modelLabel(fit.model, t),
      params: reportedParameters(fit)
        .map((p) => parameterText(p, loc))
        .join('; '),
      r2: formatR2(fit.r2, loc, ctx.advanced),
    })
    for (const s of shown) {
      parts.push(
        t('figure.a11y.series', { name: labels.get(s.spec.id) ?? s.yColumn.name, n: s.data.sample.nActive }),
      )
      if (s.split)
        parts.push(t('figure.a11y.split', { column: s.split.column.name, groups: groupCounts(s, t) }))
      if (fitShown(s, derived, ctx.mode)) parts.push(t('figure.a11y.fit', fitParams(s.fit)))
      for (const g of groupFits(s, derived, ctx.mode))
        if (g.fit?.status === 'ok')
          parts.push(t('figure.a11y.groupFit', { group: groupLabel(g, t), ...fitParams(g.fit) }))
    }
    return parts.join(' ')
  }
  const single = singleSample(derived)
  if (!single) return t('figure.a11y.empty')
  const titles = plotTitles(derived, [], t)
  const n = single.sample.nActive
  if (plot.type === 'histogram') {
    const text = t('figure.a11y.histogram', { type, column: titles.x, n, bins: extras?.bins ?? 0 })
    const o = plot.histogram
    const by = derived.doc.datasets.find((d) => d.id === o.datasetId)?.columns.find((c) => c.id === o.groupBy)
    if (!by || extras?.groups === undefined) return text
    return `${text} ${t('figure.a11y.groupedBy', { column: by.name, count: extras.groups })}`
  }
  if (plot.type === 'box')
    return t('figure.a11y.box', { type, column: titles.y, group: titles.x, n, groups: extras?.groups ?? 0 })
  return t('figure.a11y.bar', { type, value: titles.y, category: titles.x, n, bars: extras?.bars ?? 0 })
}
