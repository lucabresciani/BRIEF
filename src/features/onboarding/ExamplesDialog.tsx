import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/i18n/I18nProvider'
import { ui, useUiStore } from '@/state/uiStore'
import { ExampleList } from './ExampleList'

export function ExamplesDialog() {
  const t = useT()
  const open = useUiStore((s) => s.dialog === 'examples')
  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeDialog()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('examples.title')}</DialogTitle>
          <DialogDescription>{t('examples.lead')}</DialogDescription>
        </DialogHeader>
        <ExampleList onLoaded={() => ui.closeDialog()} />
      </DialogContent>
    </Dialog>
  )
}
