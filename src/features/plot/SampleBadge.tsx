import { Filter } from 'lucide-react'
import { useT } from '@/i18n/I18nProvider'
import { issueTitle } from '@/i18n/translate'
import type { PlotId } from '@/domain/model'
import { useDerivedPlot } from '@/state/derived'
import { Toggletip } from '@/components/app/Feedback'

/** Always visible when the analysed sample of a plot is smaller than the data: "n = 9 of 10". */
export function SampleBadge({ plotId }: { plotId: PlotId }) {
  const t = useT()
  const derived = useDerivedPlot(plotId)
  const s = derived.series.find((x) => x.spec.visible) ?? derived.series[0]
  if (!s) return null
  const { nActive, nTotal, counts } = s.data.sample
  if (nActive === nTotal) return null
  const detail = issueTitle(t, {
    code: 'I_ROWS_INACTIVE',
    params: {
      n: nActive,
      total: nTotal,
      missing: counts.missing + counts.invalid,
      excluded: counts.excluded,
      filtered: counts.filtered,
    },
  })
  return (
    <Toggletip
      side="bottom"
      trigger={
        // A real button: focusable, and its name carries the detail for screen readers.
        <button
          type="button"
          className="num inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-panel px-1.5 font-mono text-xs text-foreground transition-colors duration-(--dur-press) hover:border-border-strong data-popup-open:border-border-strong"
        />
      }
      content={detail}
    >
      <Filter className="size-3 text-muted-foreground" aria-hidden />
      <span>{t('fit.nOf', { n: nActive, total: nTotal })}</span>
      <span className="sr-only">{detail}</span>
    </Toggletip>
  )
}
