import { RotateCcw, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { issue } from '@/domain/model'
import { useT } from '@/i18n/I18nProvider'
import { issueTitle } from '@/i18n/translate'
import { downloadText } from '@/platform/download'
import { safeFileName } from '@/domain/export/filename'
import { currentProjectFile } from '@/state/actions/project'
import { useProjectStore } from '@/state/projectStore'

export function AreaError({ reset, error }: { reset: () => void; error: Error }) {
  const t = useT()
  return (
    <div role="alert" className="flex h-full min-h-40 flex-col items-start justify-center gap-3 p-6">
      <div>
        <p className="text-sm font-semibold">{t('errors.areaTitle')}</p>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('errors.areaLead')}</p>
        <p className="mt-2 font-mono text-xs wrap-anywhere text-muted-foreground">{error.message}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={reset}>
          <RotateCcw aria-hidden />
          {t('errors.reloadArea')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const name = useProjectStore.getState().doc.name || 'project'
            try {
              downloadText(
                await currentProjectFile(),
                safeFileName(name, 'sciplot'),
                'application/octet-stream',
              )
            } catch (err) {
              // The state that broke the area can break the file too: say so instead of doing nothing.
              const reason = err instanceof Error ? err.message : String(err)
              toast.add({ title: issueTitle(t, issue('E_EXPORT_FAILED', { reason })), type: 'error' })
            }
          }}
        >
          <Download aria-hidden />
          {t('errors.downloadProject')}
        </Button>
      </div>
    </div>
  )
}
