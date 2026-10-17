import { Info, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/I18nProvider'
import { ui, useUiStore } from '@/state/uiStore'
import { canReview, reviewImport } from './importFlow'

/** Non-modal note after a fast-path import: what the importer noticed, with a way to review it. */
export function ImportNotice() {
  const t = useT()
  const notice = useUiStore((s) => s.importNotice)
  if (!notice) return null
  const text = t('import.reviewBanner', { name: notice.name, count: notice.issues.length })
  return (
    <div
      className="flex items-center gap-2 border-b border-border bg-info-surface px-3 py-1.5 text-xs"
      role="status"
    >
      <Info className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      {canReview(notice.datasetId) ? (
        <Button
          size="xs"
          variant="outline"
          className="bg-background"
          onClick={() => void reviewImport(t, notice.datasetId)}
        >
          {t('import.review')}
        </Button>
      ) : null}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={t('common.close')}
        onClick={() => ui.set({ importNotice: null })}
      >
        <X aria-hidden />
      </Button>
    </div>
  )
}
