import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/i18n/I18nProvider'
import { ui, useUiStore } from '@/state/uiStore'
import { DataSidebar } from '@/features/data/DataSidebar'
import { PlotArea } from '@/features/plot/PlotArea'
import { Inspector } from '@/features/inspector/Inspector'
import { TablePanel } from '@/features/table/TablePanel'

type SectionKey = 'data' | 'plot' | 'analysis' | 'table'

/**
 * Tablet / phone layout: one section at a time, and one plot at a time (the tabs scroll). The plot
 * stays mounted (only hidden) so it keeps its state and size when switching back.
 */
export function MobileSections() {
  const t = useT()
  const section = useUiStore((s) => s.mobileSection)
  const labels: Record<SectionKey, string> = {
    data: t('data.title'),
    plot: t('plot.region'),
    analysis: t('inspector.label'),
    table: t('table.title'),
  }
  return (
    <Tabs
      value={section}
      onValueChange={(v) => ui.set({ mobileSection: v as SectionKey, tableOpen: true })}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <TabsList
        variant="line"
        className="h-10 w-full shrink-0 justify-start overflow-x-auto overscroll-x-contain border-b border-border bg-panel px-2"
      >
        {(Object.keys(labels) as SectionKey[]).map((k) => (
          <TabsTrigger key={k} value={k} className="flex-none px-3 text-sm">
            {labels[k]}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="relative min-h-0 flex-1">
        <div
          className={section === 'plot' ? 'h-full' : 'invisible absolute inset-0'}
          aria-hidden={section !== 'plot'}
        >
          <PlotArea split={false} />
        </div>
        <TabsContent value="data" className="h-full overflow-auto overscroll-contain bg-panel">
          <DataSidebar />
        </TabsContent>
        <TabsContent value="analysis" className="h-full overflow-auto overscroll-contain bg-panel">
          <Inspector />
        </TabsContent>
        <TabsContent value="table" className="h-full">
          <TablePanel />
        </TabsContent>
      </div>
    </Tabs>
  )
}
