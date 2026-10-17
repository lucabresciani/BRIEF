import { FileUp } from 'lucide-react'
import { useT } from '@/i18n/I18nProvider'

/** Shown while a file is dragged over the window; the whole window is the drop target. */
export function DropOverlay() {
  const t = useT()
  return (
    <div
      className="pointer-events-none fixed inset-0 z-(--z-overlay) flex animate-in items-center justify-center bg-background/80 p-6 duration-150 fade-in-0"
      aria-hidden
    >
      <div className="flex items-center gap-3 rounded-lg border-2 border-dashed border-primary bg-background px-6 py-5 text-sm font-medium text-primary">
        <FileUp className="size-5" aria-hidden />
        {t('empty.dropNow')}
      </div>
    </div>
  )
}
