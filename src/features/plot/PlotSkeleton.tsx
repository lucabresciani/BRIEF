import { useT } from '@/i18n/I18nProvider'

/** Loading state shaped like the plot (axes frame), not a spinner in the middle of the canvas. */
export function PlotSkeleton() {
  const t = useT()
  return (
    <div className="flex h-full w-full flex-col p-6" role="status" aria-label={t('plot.loadingPlot')}>
      <div className="relative flex-1 border-b border-l border-border-strong">
        <div className="absolute inset-0 grid grid-rows-4 opacity-60">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-border" />
          ))}
        </div>
      </div>
      <span className="mt-2 text-xs text-muted-foreground">{t('plot.loadingPlot')}</span>
    </div>
  )
}
