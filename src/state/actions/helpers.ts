import type { Draft } from 'immer'
import { SERIES_COLORS } from '@/domain/figure/palette'
import { plotLabel } from '@/domain/figure/labels'
import type { PlotId, PlotSpec, ProjectDoc, SeriesId } from '@/domain/model'
import { makeTranslator, type Translator } from '@/i18n/translate'

export function plotDraft(
  d: Draft<ProjectDoc>,
  plotId: PlotId | null | undefined,
): Draft<PlotSpec> | undefined {
  return plotId ? d.plots.find((p) => p.id === plotId) : undefined
}

export function seriesDraft(d: Draft<ProjectDoc>, id: SeriesId) {
  for (const p of d.plots) {
    const s = p.series.find((x) => x.id === id)
    if (s) return s
  }
  return undefined
}

/** The plot a series belongs to (series ids are unique across plots). */
export function plotOfSeries(doc: Pick<ProjectDoc, 'plots'>, id: SeriesId): PlotSpec | undefined {
  return doc.plots.find((p) => p.series.some((s) => s.id === id))
}

/** Nothing plotted yet: no series and no dataset chosen for bars, histogram or box plot. */
export function isEmptyPlot(p: PlotSpec | Draft<PlotSpec>): boolean {
  return p.series.length === 0 && !p.bar.datasetId && !p.histogram.datasetId && !p.box.datasetId
}

/**
 * Texts written into the document or the history (an automatic plot label, the "(copy)" suffix) are in
 * the language of the page, which I18nProvider keeps on <html lang>.
 */
export function pageTranslator(): Translator {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : ''
  return makeTranslator(lang === 'it' ? 'it' : 'en')
}

/** The label of a plot as its tab shows it ('' when it is not in the document). */
export function labelOf(doc: Pick<ProjectDoc, 'plots' | 'datasets'>, plotId: PlotId, t: Translator): string {
  const i = doc.plots.findIndex((p) => p.id === plotId)
  return i < 0 ? '' : plotLabel(doc.plots[i], i, doc.datasets, t)
}

/**
 * Palette slot of a new series: the first SERIES_COLORS slot that no series of the plot uses (an index
 * past the palette counts as the slot it cycles to). With every slot taken the colours go round again
 * in series order, as the 'auto' symbols do, so colour × symbol pairs keep differing.
 */
export function nextPaletteIndex(plot: { series: readonly { style: { paletteIndex: number } }[] }): number {
  const n = SERIES_COLORS.length
  const used = new Set(plot.series.map((s) => s.style.paletteIndex % n))
  for (let i = 0; i < n; i++) if (!used.has(i)) return i
  return plot.series.length % n
}
