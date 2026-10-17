import { useEffect, useState } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useI18n } from '@/i18n/I18nProvider'
import { useProjectStore, undo, redo } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'
import { listenForGlobalPaste } from '@/platform/clipboard'
import { listenForFileDrop } from '@/platform/files'
import { listenForUndoRedo } from '@/platform/shortcuts'
import { importFromFile, importFromText } from '@/features/import/importFlow'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { AreaError } from '@/app/AreaError'
import { TopBar } from './TopBar'
import { EmptyWorkspace } from '@/features/onboarding/EmptyWorkspace'
import { DropOverlay } from '@/features/onboarding/DropOverlay'
import { PlotArea } from '@/features/plot/PlotArea'
import { DataSidebar } from '@/features/data/DataSidebar'
import { Inspector } from '@/features/inspector/Inspector'
import { TablePanel } from '@/features/table/TablePanel'
import { Dialogs } from './Dialogs'
import { ImportNotice } from '@/features/import/ImportNotice'
import { HelpPanel, HistoryPanel } from './sidePanels'
import { MobileSections } from './MobileSections'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { StorageBanner } from '@/features/project/StorageBanner'
import { SidePanelSheet } from './SidePanelSheet'

export function AppShell() {
  const { t } = useI18n()
  const hasData = useProjectStore((s) => s.doc.datasets.length > 0)
  const docId = useProjectStore((s) => s.doc.id)
  const [dragging, setDragging] = useState(false)
  const helpOpen = useUiStore((s) => s.helpOpen)
  const historyOpen = useUiStore((s) => s.historyOpen)
  const desktop = useMediaQuery('(min-width: 1024px)')
  const wide = desktop

  useEffect(() => listenForUndoRedo({ undo, redo }), [])
  useEffect(() => listenForGlobalPaste((text) => void importFromText(t, text)), [t])
  useEffect(() => listenForFileDrop((f) => void importFromFile(t, f), setDragging), [t])

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <a
        href={hasData ? '#plot' : '#main'}
        onClick={() => {
          // On tablet/phone the plot lives in a hidden section: show it so the link can land on it.
          if (hasData && !desktop) ui.set({ mobileSection: 'plot' })
        }}
        className="sr-only z-(--z-tooltip) rounded-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {hasData ? t('app.skipToPlot') : t('app.skipToContent')}
      </a>
      <TopBar />
      <StorageBanner />
      {hasData ? (
        <>
          <ImportNotice />
          <div className="flex min-h-0 flex-1">
            <main id="main" className="min-h-0 min-w-0 flex-1" key={docId}>
              <h1 className="sr-only" translate="no">
                {t('app.name')}
              </h1>
              {desktop ? <DesktopWorkspace /> : <MobileSections />}
            </main>
            {helpOpen || historyOpen ? (
              <aside
                className="hidden w-80 shrink-0 border-l border-border bg-panel lg:block"
                aria-label={helpOpen ? t('help.title') : t('history.title')}
              >
                {helpOpen ? <HelpPanel /> : <HistoryPanel />}
              </aside>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1">
          <EmptyWorkspace />
          {helpOpen ? (
            <aside
              className="hidden w-80 shrink-0 border-l border-border bg-panel lg:block"
              aria-label={t('help.title')}
            >
              <HelpPanel />
            </aside>
          ) : null}
        </div>
      )}
      {!wide && (helpOpen || historyOpen) ? <SidePanelSheet /> : null}
      <Dialogs />
      {dragging ? <DropOverlay /> : null}
    </div>
  )
}

function DesktopWorkspace() {
  const tableOpen = useUiStore((s) => s.tableOpen)
  const area = (node: React.ReactNode) => (
    <ErrorBoundary fallback={(reset, err) => <AreaError reset={reset} error={err} />}>{node}</ErrorBoundary>
  )
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel id="data" defaultSize="18%" minSize={220} maxSize="30%" className="bg-panel">
        {area(<DataSidebar />)}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="center" defaultSize="57%" minSize="35%">
        <ResizablePanelGroup orientation="vertical" className="h-full">
          <ResizablePanel id="plot-panel" defaultSize={tableOpen ? '66%' : '100%'} minSize="35%">
            {area(<PlotArea split />)}
          </ResizablePanel>
          {tableOpen ? (
            <>
              <ResizableHandle />
              <ResizablePanel id="table" defaultSize="34%" minSize={120}>
                {area(<TablePanel />)}
              </ResizablePanel>
            </>
          ) : (
            <div className="shrink-0 border-t border-border">
              <TablePanel collapsed />
            </div>
          )}
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="inspector" defaultSize="25%" minSize={290} maxSize="38%" className="bg-panel">
        {area(<Inspector />)}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
