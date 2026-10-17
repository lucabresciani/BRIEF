import { Lightbulb, X } from 'lucide-react'
import { recommend, type Recommendation } from '@/domain/recommend/recommend'
import { IconButton } from '@/components/app/IconButton'
import { useT } from '@/i18n/I18nProvider'
import type { ColumnId, Dataset, PlotId } from '@/domain/model'
import { useDerivedPlot } from '@/state/derived'
import { useProjectStore } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'
import { setPlotType } from '@/state/actions/plot'
import { setErrorBars } from '@/state/actions/analysis'

/**
 * The recommendation's parameters with column ids replaced by the column names. Columns the user has
 * mapped since (axes, histogram or box column, grouping) replace the ones the recommendation chose, so
 * the text always describes what the plot shows.
 */
function params(
  rec: Recommendation,
  dataset: Dataset,
  current: Partial<Record<'x' | 'y' | 'column' | 'group', ColumnId | null>>,
): Record<string, string | number> {
  const name = (id: string) => dataset.columns.find((c) => c.id === id)?.name ?? id
  return Object.fromEntries(
    Object.entries(rec.params).map(([k, v]) => {
      const now = current[k as keyof typeof current]
      return [k, now ? name(now) : typeof v === 'string' ? name(v) : v]
    }),
  )
}

/**
 * Transparent, data-structure-based suggestion shown once per dataset. It explains why a plot is
 * useful; next steps (line plot, a linear fit, error bars from a u(y) column) are offered, never applied.
 */
export function RecommendationBanner({ plotId }: { plotId: PlotId }) {
  const t = useT()
  const derived = useDerivedPlot(plotId)
  const plot = derived.plot
  const fits = useProjectStore((s) => s.doc.fits)
  const datasets = useProjectStore((s) => s.doc.datasets)
  const hints = useUiStore((s) => s.hints)
  const dismissed = useUiStore((s) => s.dismissedRecommendations)
  const level = useUiStore((s) => s.level)
  const xy = plot?.type === 'scatter' || plot?.type === 'line'
  const first = xy ? derived.series[0] : undefined
  // The dataset this plot draws with its current type (a series is kept when the type changes).
  const datasetId = !plot
    ? null
    : xy
      ? (first?.spec.datasetId ?? null)
      : plot.type === 'histogram'
        ? plot.histogram.datasetId
        : plot.type === 'box'
          ? plot.box.datasetId
          : plot.bar.datasetId
  const dataset = datasets.find((d) => d.id === datasetId)
  const view = datasetId ? derived.views.get(datasetId) : undefined
  if (!hints || !dataset || !view || !plot || dismissed.includes(dataset.id)) return null

  const rec = recommend(dataset, view)
  const current =
    plot.type === 'histogram'
      ? { column: plot.histogram.value }
      : plot.type === 'box'
        ? { column: plot.box.value, group: plot.box.groupBy }
        : first
          ? { x: first.spec.x, y: first.spec.y }
          : {}
  // Only what concerns this plot's type: the recommendation itself on its own type (or on the line
  // plot it offers), the switch to an alternative, and the fit and error-bar steps on x–y plots.
  const own = rec.plotType === plot.type
  const offered = rec.alternatives.some((a) => a.plotType === plot.type)
  const message = own
    ? t(rec.messageKey, params(rec, dataset, current))
    : offered && plot.type === 'line'
      ? t('recommend.line', params(rec, dataset, current))
      : null
  const alternatives = own ? rec.alternatives.filter((a) => a.plotType !== plot.type) : []
  const hasFit = first ? fits.some((f) => f.seriesId === first.spec.id) : false
  // The suggested column is the uncertainty of the recommended y: offer it only while the first series
  // still plots that y, and never on a derived axis (no propagation; the pipeline would refuse it).
  const uCol =
    rec.uncertaintyColumn &&
    first &&
    rec.columns.y === first.spec.y &&
    first.yColumn.source.type !== 'derived'
      ? dataset.columns.find((c) => c.id === rec.uncertaintyColumn && c.source.type !== 'derived')
      : undefined
  const yHasBars = first ? first.spec.errorBars.y.kind !== 'none' : true
  const offerBars = !!(uCol && first && !yHasBars)
  const offerFit = !!(rec.suggestFit && !hasFit && first)
  if (message === null && !alternatives.length && !offerBars && !offerFit) return null

  return (
    <div
      className="flex items-start gap-2 border-b border-border bg-info-surface px-3 py-2 text-xs"
      role="note"
    >
      <Lightbulb className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {message !== null ? <p className="text-foreground">{message}</p> : null}
        {alternatives.map((a) => (
          <p key={a.plotType} className="text-muted-foreground">
            {t(a.messageKey)}{' '}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => setPlotType(a.plotType, plot.id)}
            >
              {t('plot.switchTo', { type: t(`plot.types.${a.plotType}`) })}
            </button>
          </p>
        ))}
        {offerBars && uCol && first ? (
          <p className="text-muted-foreground">
            {t('recommend.uncertainty', { column: uCol.name, y: first.yColumn.name })}{' '}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() =>
                setErrorBars(first.spec.id, 'y', {
                  kind: 'measurement',
                  origin: 'user',
                  source: { type: 'column', column: uCol.id },
                  meaning: { type: 'unspecified' },
                })
              }
            >
              {t('recommend.useAsErrorBars')}
            </button>
          </p>
        ) : null}
        {offerFit ? (
          <p className="text-muted-foreground">
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() =>
                ui.set({ inspectorTab: 'fit', level: level === 'beginner' ? 'intermediate' : level })
              }
            >
              {t('plot.nextStepFit')}
            </button>
          </p>
        ) : null}
      </div>
      <IconButton
        size="icon-xs"
        label={t('plot.dismiss')}
        onClick={() => ui.set({ dismissedRecommendations: [...dismissed, dataset.id] })}
      >
        <X aria-hidden />
      </IconButton>
    </div>
  )
}
