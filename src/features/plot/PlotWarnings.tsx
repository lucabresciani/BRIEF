import { useState } from 'react'
import { Info, TriangleAlert } from 'lucide-react'
import type { Issue, PlotId, RowId } from '@/domain/model'
import { IssueList } from '@/components/app/Feedback'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n/I18nProvider'
import { ui } from '@/state/uiStore'
import { useDerivedPlot } from '@/state/derived'
import { cn } from '@/lib/utils'

/**
 * Figure warnings (log axis hiding points, many points, extrapolation…), next to the plot they concern.
 * `compact`: a chip in a pane header that opens the list (side-by-side panes have no room for a band).
 */
export function PlotWarnings({
  plotId,
  issues,
  compact = false,
}: {
  plotId: PlotId
  issues: readonly Issue[]
  compact?: boolean
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const derived = useDerivedPlot(plotId)
  if (!issues.length) return null
  const datasetId = derived.series[0]?.spec.datasetId ?? null
  const showRows = (rows: readonly RowId[]) => {
    if (datasetId)
      ui.set({
        selection: { datasetId, rowIds: new Set(rows), origin: 'table', anchor: null },
        tableOpen: true,
      })
  }
  if (compact) {
    const warning = issues.some((i) => i.severity === 'warning')
    const Icon = warning ? TriangleAlert : Info
    return (
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                'num inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-xs transition-colors duration-(--dur-press)',
                warning
                  ? 'border-warning/30 bg-warning-surface text-warning hover:border-warning/60'
                  : 'border-border bg-panel text-foreground hover:border-border-strong',
              )}
            />
          }
        >
          <Icon className="size-3" aria-hidden />
          {t('plot.pane.warnings', { n: issues.length })}
        </PopoverTrigger>
        <PopoverContent align="end" className="max-h-80 w-80 overflow-y-auto overscroll-contain">
          <IssueList issues={issues} compact onShowRows={showRows} />
        </PopoverContent>
      </Popover>
    )
  }
  const shown = expanded ? issues : issues.slice(0, 2)
  return (
    <div className="border-b border-border px-2.5 py-2">
      <IssueList issues={shown} compact onShowRows={showRows} />
      {issues.length > 2 ? (
        <button
          type="button"
          className="mt-1 inline-flex min-h-6 items-center text-xs text-primary hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? t('common.less') : `${t('common.more')} (${issues.length - 2})`}
        </button>
      ) : null}
    </div>
  )
}
