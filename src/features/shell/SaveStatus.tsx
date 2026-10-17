import { CloudOff, HardDrive, Loader2, Lock } from 'lucide-react'
import { useT } from '@/i18n/I18nProvider'
import { useUiStore } from '@/state/uiStore'
import { useProjectStore } from '@/state/projectStore'

/**
 * Where the work is: saved in this browser, saving, or not saved (with the reason). Not a live region:
 * it mounts and unmounts on every autosave (announcing "Saving…" after each edit would be noise) and is
 * hidden below xl; the actionable failures are announced by StorageBanner.
 */
export function SaveStatus() {
  const t = useT()
  const storage = useUiStore((s) => s.storage)
  const readOnly = useProjectStore((s) => s.readOnly)
  const hasData = useProjectStore((s) => s.doc.datasets.length > 0)
  if (!hasData && !readOnly) return null
  let icon = <HardDrive className="size-3.5" aria-hidden />
  let text = t('save.savedLocally')
  let tone = 'text-muted-foreground'
  if (readOnly) {
    icon = <Lock className="size-3.5" aria-hidden />
    text = t('save.readOnly')
    tone = 'text-warning'
  } else if (storage === 'saving' || storage === 'pending') {
    icon = <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
    text = t('save.saving')
  } else if (storage === 'unavailable' || storage === 'quota' || storage === 'retry') {
    icon = <CloudOff className="size-3.5" aria-hidden />
    text = t(
      storage === 'quota' ? 'save.storageFull' : storage === 'retry' ? 'save.retrying' : 'save.notSaved',
    )
    tone = 'text-warning'
  } else if (storage === 'unknown' || storage === 'ok') {
    return null
  }
  return (
    <span className={`hidden items-center gap-1 text-xs whitespace-nowrap xl:flex ${tone}`}>
      {icon}
      {text}
    </span>
  )
}
