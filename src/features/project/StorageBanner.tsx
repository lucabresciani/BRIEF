import { CloudOff, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/I18nProvider'
import { issueHint, issueTitle } from '@/i18n/translate'
import { useProjectStore } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'
import { disableAutosave, openAsCopy } from '@/state/persistence'
import { saveProjectFile } from './projectFile'

/** Explains why work is not being saved locally, with the way out (file, copy, cleanup). */
export function StorageBanner() {
  const t = useT()
  const storage = useUiStore((s) => s.storage)
  const readOnly = useProjectStore((s) => s.readOnly)
  const hasData = useProjectStore((s) => s.doc.datasets.length > 0)
  if (readOnly) {
    return (
      <div
        className="flex flex-wrap items-center gap-2 border-b border-border bg-warning-surface px-3 py-1.5 text-xs"
        role="status"
      >
        <Lock className="size-3.5 text-warning" aria-hidden />
        <span className="min-w-0 flex-1">{issueTitle(t, { code: 'I_PROJECT_READ_ONLY' })}</span>
        <Button
          size="xs"
          variant="outline"
          className="bg-background"
          onClick={() => {
            const name = useProjectStore.getState().doc.name || t('app.untitled')
            void openAsCopy(`${name} ${t('save.copySuffix')}`)
          }}
        >
          {t('save.openAsCopy')}
        </Button>
      </div>
    )
  }
  if (!hasData || (storage !== 'unavailable' && storage !== 'quota')) return null
  const code = storage === 'quota' ? 'E_STORAGE_QUOTA' : 'E_STORAGE_UNAVAILABLE'
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border bg-warning-surface px-3 py-1.5 text-xs"
      role="alert"
    >
      <CloudOff className="size-3.5 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{issueTitle(t, { code })}</span> {issueHint(t, { code })}
      </span>
      <Button size="xs" variant="outline" className="bg-background" onClick={() => void saveProjectFile(t)}>
        {t('topbar.saveProject')}
      </Button>
      {storage === 'quota' ? (
        <>
          <Button size="xs" variant="ghost" onClick={() => ui.openDialog('projects')}>
            {t('topbar.recentProjects')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              disableAutosave()
              ui.set({ storage: 'unavailable' })
            }}
          >
            {t('save.continueWithoutAutosave')}
          </Button>
        </>
      ) : null}
    </div>
  )
}
