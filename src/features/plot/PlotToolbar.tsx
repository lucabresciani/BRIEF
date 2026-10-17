import {
  Download,
  Hand,
  Lasso,
  Minus,
  Plus,
  RotateCcw,
  SquareDashedMousePointer,
  ZoomIn,
  Crop,
} from 'lucide-react'
import type { PlotId, PlotType } from '@/domain/model'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { IconButton } from '@/components/app/IconButton'
import { Choice } from '@/components/app/Choice'
import { useT } from '@/i18n/I18nProvider'
import { useProjectStore } from '@/state/projectStore'
import { ui, useUiStore, type DragMode } from '@/state/uiStore'
import { setPlotType, viewToLimits } from '@/state/actions/plot'
import { SampleBadge } from './SampleBadge'
import { usePaneRegistry, usePaneViewRev } from './paneRegistry'

const MODES: { mode: DragMode; icon: typeof ZoomIn; key: 'zoom' | 'pan' | 'boxSelect' | 'lasso' }[] = [
  { mode: 'zoom', icon: ZoomIn, key: 'zoom' },
  { mode: 'pan', icon: Hand, key: 'pan' },
  { mode: 'select', icon: SquareDashedMousePointer, key: 'boxSelect' },
  { mode: 'lasso', icon: Lasso, key: 'lasso' },
]

/**
 * The one toolbar of the plot area: it acts on `plotId`, the plot of the focused pane (the drag mode
 * applies to every pane). A recorded zoom counts only while its pane still shows it (same uirevision).
 */
export function PlotToolbar({ plotId }: { plotId: PlotId | null }) {
  const t = useT()
  const plot = useProjectStore((s) => s.doc.plots.find((p) => p.id === plotId) ?? null)
  const panes = usePaneRegistry()
  const viewRev = usePaneViewRev(plotId)
  const dragmode = useUiStore((s) => s.dragmode)
  const recorded = useUiStore((s) => (plotId ? s.views[plotId] : undefined))
  const view = recorded && viewRev !== null && recorded.rev === viewRev ? recorded : null
  const types: PlotType[] = ['scatter', 'line', 'bar', 'histogram', 'box']
  const xyOnly = plot?.type === 'scatter' || plot?.type === 'line'

  return (
    <div
      role="toolbar"
      aria-label={t('plot.region')}
      className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2.5 py-1.5"
    >
      <Choice<PlotType>
        label={t('plot.type')}
        hideLabel
        value={plot?.type ?? null}
        onChange={(v) => plot && setPlotType(v, plot.id)}
        className="w-36"
        items={types.map((v) => ({ value: v, label: t(`plot.types.${v}`) }))}
        disabled={!plot}
      />
      <div className="h-5 w-px bg-border" aria-hidden />
      <ToggleGroup
        aria-label={t('plot.dragMode')}
        value={[dragmode]}
        onValueChange={(v) => {
          const m = v[0] as DragMode | undefined
          if (m) ui.set({ dragmode: m })
        }}
        size="sm"
      >
        {MODES.map(({ mode, icon: Icon, key }) => (
          <Tooltip key={mode}>
            <TooltipTrigger
              render={
                <ToggleGroupItem
                  value={mode}
                  aria-label={t(`plot.${key}`)}
                  disabled={(mode === 'select' || mode === 'lasso') && !plot}
                  className="size-7 px-0"
                />
              }
            >
              <Icon className="size-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t(`plot.${key}`)}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <div className="flex items-center">
        <IconButton label={t('plot.zoomIn')} onClick={() => panes.canvas(plotId)?.zoom(0.7)} disabled={!plot}>
          <Plus aria-hidden />
        </IconButton>
        <IconButton
          label={t('plot.zoomOut')}
          onClick={() => panes.canvas(plotId)?.zoom(1 / 0.7)}
          disabled={!plot}
        >
          <Minus aria-hidden />
        </IconButton>
        <IconButton
          label={t('plot.resetView')}
          onClick={() => plotId && ui.resetView(plotId)}
          disabled={!plot}
        >
          <RotateCcw aria-hidden />
        </IconButton>
        {xyOnly ? (
          <IconButton
            label={t('plot.viewToLimits')}
            onClick={() => view && viewToLimits(view, plotId)}
            disabled={!view?.x && !view?.y}
          >
            <Crop aria-hidden />
          </IconButton>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {plotId ? <SampleBadge plotId={plotId} /> : null}
        <IconButton
          label={t('plot.exportFigure')}
          onClick={() => ui.openDialog('export')}
          disabled={!plot}
          variant="outline"
          className="bg-background"
        >
          <Download aria-hidden />
        </IconButton>
      </div>
    </div>
  )
}
