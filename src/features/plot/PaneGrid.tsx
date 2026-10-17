import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useUiStore } from '@/state/uiStore'
import { PlotPane } from './PlotPane'

/**
 * The panes of the plot area: one, two side by side, or a 2 × 2 grid, with resizable splits. `split`
 * false (narrow screens) shows the focused pane alone whatever the stored layout, which comes back
 * on a wide screen. A plot is in one pane at most (the workspace sync keeps it so).
 */
export function PaneGrid({ split }: { split: boolean }) {
  const ws = useUiStore((s) => s.workspace)
  const layout = split ? ws.layout : 'single'
  const pane = (i: number) => (
    <PlotPane index={i} plotId={ws.panes[i] ?? null} split={layout !== 'single'} focused={ws.focused === i} />
  )
  const row = (first: number, id: string) => (
    <ResizablePanelGroup orientation="horizontal" id={id}>
      <ResizablePanel id={`${id}-a`} minSize="20%">
        {pane(first)}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id={`${id}-b`} minSize="20%">
        {pane(first + 1)}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
  return (
    <div className="min-h-0 flex-1">
      {layout === 'single' ? (
        pane(ws.focused)
      ) : layout === 'columns' ? (
        row(0, 'panes')
      ) : (
        <ResizablePanelGroup orientation="vertical" id="pane-rows">
          <ResizablePanel id="pane-rows-top" minSize="25%">
            {row(0, 'panes-top')}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="pane-rows-bottom" minSize="25%">
            {row(2, 'panes-bottom')}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
