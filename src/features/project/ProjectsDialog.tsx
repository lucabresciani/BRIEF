import { useEffect, useId, useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/app/IconButton'
import { IssueNote } from '@/components/app/Feedback'
import { confirmAction } from '@/components/app/confirmStore'
import { toast } from '@/components/ui/toast'
import { useI18n } from '@/i18n/I18nProvider'
import { intlLocale } from '@/i18n/locale'
import { isProjectLockedElsewhere } from '@/platform/locks'
import { deleteProject, listProjects, type ProjectIndexEntry } from '@/platform/storage'
import { openStoredProject } from '@/state/persistence'
import { useProjectStore } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'

export function ProjectsDialog() {
  const { t, lang } = useI18n()
  const open = useUiStore((s) => s.dialog === 'projects')
  const currentId = useProjectStore((s) => s.doc.id)
  const [items, setItems] = useState<ProjectIndexEntry[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const listId = useId()

  const refresh = async () => {
    const r = await listProjects()
    if (r.ok) {
      setItems(r.value)
      setUnavailable(false)
    } else {
      setItems([])
      setUnavailable(true)
    }
  }
  useEffect(() => {
    if (!open) return
    let alive = true
    void listProjects().then((r) => {
      if (!alive) return
      setItems(r.ok ? r.value : [])
      setUnavailable(!r.ok)
    })
    return () => {
      alive = false
    }
  }, [open])

  const fmt = new Intl.DateTimeFormat(intlLocale(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeDialog()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('topbar.recentProjects')}</DialogTitle>
          <DialogDescription>{t('app.privacy')}</DialogDescription>
        </DialogHeader>
        {unavailable ? <IssueNote issue={{ code: 'E_STORAGE_UNAVAILABLE', severity: 'error' }} /> : null}
        {items && !items.length && !unavailable ? (
          <p className="text-sm text-muted-foreground">{t('project.none')}</p>
        ) : null}
        {items && items.length ? (
          <ul className="flex max-h-80 flex-col divide-y divide-border overflow-auto overscroll-contain rounded-md border border-border">
            {items.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p
                    id={`${listId}-${p.id}`}
                    className="truncate text-sm font-medium"
                    title={p.name || t('app.untitled')}
                  >
                    {p.name || t('app.untitled')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('project.updated', { date: fmt.format(new Date(p.updatedAt)) })}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  className="bg-background"
                  disabled={p.id === currentId}
                  aria-describedby={`${listId}-${p.id}`}
                  onClick={async () => {
                    if (await openStoredProject(p.id)) {
                      ui.closeDialog()
                      toast.add({
                        title: t('project.opened', { name: p.name || t('app.untitled') }),
                        type: 'success',
                      })
                    }
                  }}
                >
                  <FolderOpen aria-hidden />
                  {t('project.openTitle')}
                </Button>
                <IconButton
                  label={t('project.delete')}
                  size="icon-xs"
                  disabled={p.id === currentId}
                  aria-describedby={`${listId}-${p.id}`}
                  onClick={async () => {
                    const name = p.name || t('app.untitled')
                    // The tab that has it open would write it back with its next autosave.
                    const openElsewhere = async () => {
                      if (!(await isProjectLockedElsewhere(p.id))) return false
                      toast.add({
                        title: t('project.openElsewhere', { name }),
                        description: t('project.openElsewhereHint'),
                        type: 'warning',
                      })
                      return true
                    }
                    if (await openElsewhere()) return
                    const confirmed = await confirmAction({
                      title: t('project.delete'),
                      body: t('project.deleteConfirm', { name }),
                      confirm: t('project.delete'),
                      destructive: true,
                    })
                    // Checked again: the project may have been opened while the question was shown.
                    if (!confirmed || (await openElsewhere())) return
                    await deleteProject(p.id)
                    void refresh()
                  }}
                >
                  <Trash2 aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
