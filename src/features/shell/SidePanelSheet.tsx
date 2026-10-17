import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/i18n/I18nProvider'
import { ui, useUiStore } from '@/state/uiStore'
import { HelpPanel, HistoryPanel } from './sidePanels'

/** Below the desktop breakpoint, help and history open as a side sheet instead of a column. */
export function SidePanelSheet() {
  const t = useT()
  const helpOpen = useUiStore((s) => s.helpOpen)
  return (
    <Dialog open onOpenChange={(o) => !o && ui.set({ helpOpen: false, historyOpen: false })}>
      <DialogContent
        showCloseButton={false}
        className="top-0 right-0 left-auto h-dvh max-h-dvh w-[min(22rem,100vw)] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{helpOpen ? t('help.title') : t('history.title')}</DialogTitle>
        {helpOpen ? <HelpPanel /> : <HistoryPanel />}
      </DialogContent>
    </Dialog>
  )
}
