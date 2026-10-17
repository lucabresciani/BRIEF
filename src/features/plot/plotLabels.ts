import { useMemo } from 'react'
import { flushSync } from 'react-dom'
import { plotLabel } from '@/domain/figure/labels'
import type { DatasetId, PlotId, PlotSpec } from '@/domain/model'
import { useT } from '@/i18n/I18nProvider'
import { useProjectStore } from '@/state/projectStore'

/** Tab label of every plot, in the UI language. */
export function usePlotLabels(): ReadonlyMap<PlotId, string> {
  const t = useT()
  const plots = useProjectStore((s) => s.doc.plots)
  const datasets = useProjectStore((s) => s.doc.datasets)
  return useMemo(
    () => new Map(plots.map((p, i) => [p.id, plotLabel(p, i, datasets, t)] as const)),
    [plots, datasets, t],
  )
}

/** The datasets a plot draws with its current type (a selection elsewhere does not concern it). */
export function plotDatasetIds(plot: PlotSpec | null | undefined): readonly DatasetId[] {
  if (!plot) return []
  switch (plot.type) {
    case 'scatter':
    case 'line':
      return [...new Set(plot.series.map((s) => s.datasetId))]
    case 'bar':
      return plot.bar.datasetId ? [plot.bar.datasetId] : []
    case 'histogram':
      return plot.histogram.datasetId ? [plot.histogram.datasetId] : []
    case 'box':
      return plot.box.datasetId ? [plot.box.datasetId] : []
  }
}

/** Element ids linking a tab to the pane that shows its plot (aria-controls / aria-labelledby). */
export const tabId = (plotId: PlotId) => `plot-tab-${plotId}`
export const paneId = (index: number) => `plot-pane-${index}`

/**
 * A text field being edited elsewhere (the inspector) commits on blur. Blurring it before another plot
 * becomes the active one (a pane taking the focus, a tab pressed) commits the edit to the plot it was
 * typed for, not to the plot shown next. `within`: an element whose own fields are left alone.
 * The commit is rendered at once: batched with the switch, a field whose value is the same for both
 * plots (two untitled plots) would never see its saved value and would keep the draft for the next plot.
 */
export function commitPendingEdit(within: HTMLElement | null): void {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || within?.contains(el)) return
  if (el.matches('input, textarea, [contenteditable="true"]')) flushSync(() => el.blur())
}
