import { ChartScatter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useI18n, useT } from '@/i18n/I18nProvider'
import { intlLocale } from '@/i18n/locale'
import type { PlotId } from '@/domain/model'
import { operationLog, useProjectStore } from '@/state/projectStore'
import { ui } from '@/state/uiStore'
import { usePlotLabels } from '@/features/plot/plotLabels'

/**
 * Transparent record of the operations that produced the current analysis. An operation on a plot
 * names it in a chip that brings the plot on screen (deleted plots have none).
 */
export function HistoryPanel() {
  const { t, lang } = useI18n()
  const state = useProjectStore()
  const labels = usePlotLabels()
  const log = operationLog(state).slice().reverse()
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), {
    timeStyle: 'short',
    dateStyle: 'short',
  })
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-semibold">{t('history.title')}</h2>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('common.close')}
          onClick={() => ui.set({ historyOpen: false })}
        >
          <X aria-hidden />
        </Button>
      </div>
      <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{t('history.lead')}</p>
      <ScrollArea className="min-h-0 flex-1">
        {log.length === 0 ? <p className="p-3 text-sm text-muted-foreground">{t('history.empty')}</p> : null}
        <ol className="flex flex-col">
          {log.map((e) => (
            <li key={e.id} className="border-b border-border px-3 py-2">
              <p className="text-sm wrap-break-word">{t(e.label.key, e.label.params)}</p>
              <div className="mt-0.5 flex min-w-0 items-center gap-2">
                <time dateTime={e.at} className="num shrink-0 text-xs text-muted-foreground">
                  {fmt.format(new Date(e.at))}
                </time>
                {e.plotId && labels.has(e.plotId) ? (
                  <PlotChip plotId={e.plotId} label={labels.get(e.plotId)!} />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </ScrollArea>
    </div>
  )
}

function PlotChip({ plotId, label }: { plotId: PlotId; label: string }) {
  const t = useT()
  return (
    <button
      type="button"
      title={t('history.showPlot', { name: label })}
      aria-label={t('history.showPlot', { name: label })}
      onClick={() => {
        ui.showPlot(plotId)
        // On a narrow screen the plot is in its own section.
        ui.set({ mobileSection: 'plot' })
      }}
      className="inline-flex h-6 min-w-0 items-center gap-1 rounded-sm border border-border bg-background px-1.5 text-xs text-muted-foreground transition-colors duration-(--dur-press) hover:border-border-strong hover:text-foreground"
    >
      <ChartScatter className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  )
}
