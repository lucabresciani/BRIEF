import { lazy, Suspense, useEffect, useId } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useT } from '@/i18n/I18nProvider'
import { ui, useUiStore, type InspectorTab } from '@/state/uiStore'
import { visibleTabs } from './levels'
import { useProjectStore } from '@/state/projectStore'
import { useActivePlotId } from '@/state/workspace'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { usePlotLabels } from '@/features/plot/plotLabels'
import { PlotPanel } from './PlotPanel'
import { StylePanel } from './StylePanel'

// The Fit, Uncertainty and Statistics tabs are chunks of their own (the entry has a size budget) and
// are fetched as soon as the browser is idle, so the first switch to one does not wait for the network.
const loadFit = () => import('./FitPanel')
const loadUncertainty = () => import('./UncertaintyPanel')
const loadStats = () => import('./StatsPanel')
const FitPanel = lazy(() => loadFit().then((m) => ({ default: m.FitPanel })))
const UncertaintyPanel = lazy(() => loadUncertainty().then((m) => ({ default: m.UncertaintyPanel })))
const StatsPanel = lazy(() => loadStats().then((m) => ({ default: m.StatsPanel })))

function preloadTabs(): () => void {
  // A failed fetch is retried by the tab's own import when it is opened.
  const go = () => void Promise.all([loadFit(), loadUncertainty(), loadStats()]).catch(() => undefined)
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(go, { timeout: 2000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(go, 300)
  return () => clearTimeout(id)
}

export function Inspector() {
  const t = useT()
  const headingId = useId()
  const level = useUiStore((s) => s.level)
  const tab = useUiStore((s) => s.inspectorTab)
  const hasFit = useProjectStore((s) => s.doc.fits.length > 0)
  const tabs = visibleTabs(level, hasFit)
  const active = tabs.includes(tab) ? tab : 'plot'
  const plotId = useActivePlotId()
  const labels = usePlotLabels()
  const label = (plotId && labels.get(plotId)) || ''
  const plotCount = useProjectStore((s) => s.doc.plots.length)
  const split = useUiStore((s) => s.workspace.layout !== 'single')
  const wide = useMediaQuery('(min-width: 1024px)')
  // Which plot the panels edit, when that is not obvious: side-by-side panes, or (on a narrow screen,
  // where the plot is in another section) several plots.
  const showEditing = !!label && (wide ? split : plotCount > 1)
  // The plot name is set apart from the sentence around it, wherever the language puts it.
  const editing = t('inspector.editing').split('{name}')
  useEffect(preloadTabs, [])
  return (
    <aside aria-labelledby={headingId} className="flex h-full min-h-0 flex-col">
      {/* Panel sections use h3: this keeps the outline h2 → h3 like the data sidebar. */}
      <h2 id={headingId} className="sr-only">
        {t('inspector.label')}
      </h2>
      <Tabs
        value={active}
        onValueChange={(v) => ui.set({ inspectorTab: v as InspectorTab })}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        {showEditing ? (
          <p
            className="truncate border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
            title={label}
            data-testid="inspector-editing"
          >
            {editing[0]}
            <span className="font-medium text-foreground">{label}</span>
            {editing[1]}
          </p>
        ) : null}
        <div className="border-b border-border px-2 pt-2">
          <TabsList variant="line" className="h-8 w-full justify-start gap-0">
            {tabs.map((k) => (
              <TabsTrigger key={k} value={k} className="flex-none px-1.5 text-xs">
                {t(`inspector.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]]:overscroll-contain">
          <TabsContent value="plot">
            <PlotPanel />
          </TabsContent>
          <TabsContent value="fit">
            <Suspense fallback={null}>
              <FitPanel />
            </Suspense>
          </TabsContent>
          <TabsContent value="uncertainty">
            <Suspense fallback={null}>
              <UncertaintyPanel />
            </Suspense>
          </TabsContent>
          <TabsContent value="statistics">
            <Suspense fallback={null}>
              <StatsPanel />
            </Suspense>
          </TabsContent>
          <TabsContent value="style">
            <StylePanel />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </aside>
  )
}
