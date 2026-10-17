import type { ReactElement, ReactNode } from 'react'
import { Database, Square } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DatasetId } from '@/domain/model'
import { useT } from '@/i18n/I18nProvider'
import { useProjectStore } from '@/state/projectStore'
import { ui } from '@/state/uiStore'
import { createPlot } from '@/state/actions/plot'

/**
 * "New plot": an empty plot, or the suggested plot of a dataset. `pane`: the new plot goes into that
 * pane (an empty pane offering it), else where showPlot puts it. `tooltip`: for an icon-only trigger.
 */
export function NewPlotMenu({
  render,
  children,
  tooltip,
  pane,
  align = 'start',
}: {
  render: ReactElement
  children: ReactNode
  tooltip?: string
  pane?: number
  align?: 'start' | 'end'
}) {
  const t = useT()
  const datasets = useProjectStore((s) => s.doc.datasets)
  const readOnly = useProjectStore((s) => s.readOnly)
  const create = (datasetId?: DatasetId) => {
    const id = createPlot(datasetId ? { datasetId } : {})
    if (id && pane !== undefined) ui.showPlot(id, pane)
  }
  return (
    <DropdownMenu>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger render={<DropdownMenuTrigger render={render} disabled={readOnly} />}>
            {children}
          </TooltipTrigger>
          <TooltipContent side="bottom">{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger render={render} disabled={readOnly}>
          {children}
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align={align} className="min-w-52">
        <DropdownMenuItem onClick={() => create()}>
          <Square aria-hidden />
          {t('plot.tabs.emptyPlot')}
        </DropdownMenuItem>
        {datasets.length ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Database aria-hidden />
              {t('plot.tabs.fromDataset')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-72">
              {datasets.map((d) => (
                <DropdownMenuItem key={d.id} onClick={() => create(d.id)}>
                  <span className="truncate">{d.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
