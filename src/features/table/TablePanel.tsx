import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import type { DatasetId } from '@/domain/model'
import { Button } from '@/components/ui/button'
import { Choice } from '@/components/app/Choice'
import { useT } from '@/i18n/I18nProvider'
import { useDerived } from '@/state/derived'
import { ui, useUiStore } from '@/state/uiStore'
import { addNotebookRows } from '@/state/actions/notebook'
import { DataGrid } from './DataGrid'
import { NotebookGrid } from '@/features/notebook/NotebookGrid'
import { plotDatasetIds } from '@/features/plot/plotLabels'

/** Bottom panel: inspection of the measurements behind the plot (editable only for lab notebooks). */
export function TablePanel({ collapsed = false }: { collapsed?: boolean }) {
  const t = useT()
  const derived = useDerived()
  const selection = useUiStore((s) => s.selection)
  const [choice, setChoice] = useState<DatasetId | null>(null)
  const datasets = derived.doc.datasets
  const dataset =
    datasets.find((d) => d.id === choice) ??
    datasets.find((d) => d.id === selection?.datasetId) ??
    // The focused plot's dataset, whatever its type (box, bar and histogram plots have no x–y series).
    datasets.find((d) => d.id === plotDatasetIds(derived.plot)[0]) ??
    datasets[0]
  const view = dataset ? derived.views.get(dataset.id) : undefined

  return (
    <section aria-label={t('table.region')} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-panel px-2.5">
        <h2 className="text-sm font-semibold">{t('table.title')}</h2>
        {datasets.length > 1 && dataset ? (
          <Choice<DatasetId>
            label={t('common.dataset')}
            hideLabel
            className="w-44"
            value={dataset.id}
            onChange={(v) => {
              setChoice(v)
              ui.set({ selection: null })
            }}
            items={datasets.map((d) => ({ value: d.id, label: d.name }))}
          />
        ) : dataset ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={dataset.name}>
            {dataset.name}
          </span>
        ) : null}
        {view ? (
          <span className="num text-xs text-muted-foreground">
            {t('data.rowsColumns', { rows: view.rowIds.length, cols: dataset!.columns.length })}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {dataset?.origin === 'notebook' && !collapsed ? (
            <Button
              size="xs"
              variant="outline"
              className="bg-background"
              onClick={() => addNotebookRows(dataset.id, 1)}
            >
              <Plus aria-hidden />
              {t('notebook.addRow')}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={!collapsed}
            onClick={() => ui.set({ tableOpen: collapsed })}
          >
            {collapsed ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
            {collapsed ? t('table.show') : t('table.hide')}
          </Button>
        </div>
      </div>
      {!collapsed && dataset && view ? (
        dataset.origin === 'notebook' ? (
          <NotebookGrid dataset={dataset} view={view} />
        ) : (
          // A grid per dataset: the cursor, scroll position and measurements of one never carry over.
          <DataGrid key={dataset.id} dataset={dataset} view={view} />
        )
      ) : null}
    </section>
  )
}
