import { useState } from 'react'
import {
  Calendar,
  ChartScatter,
  ChevronDown,
  FileSearch,
  Hash,
  MoreHorizontal,
  Pencil,
  Plus,
  Sigma,
  Tags,
  Trash2,
  TriangleAlert,
  Type,
  FunctionSquare,
} from 'lucide-react'
import { effectiveSettings, type ColumnMeta, type Dataset, type DatasetId } from '@/domain/model'
import type { DatasetView } from '@/domain/derive/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Section } from '@/components/app/Section'
import { confirmAction } from '@/components/app/confirmStore'
import { useT } from '@/i18n/I18nProvider'
import { useDerived } from '@/state/derived'
import { ui, useUiStore } from '@/state/uiStore'
import { removeDataset, renameDataset } from '@/state/actions/dataset'
import { createPlot } from '@/state/actions/plot'
import { useProjectStore } from '@/state/projectStore'
import { canReview, importFromFile, reviewImport } from '@/features/import/importFlow'
import { DATA_FILE_ACCEPT, pickFile } from '@/platform/files'
import { ColumnEditor } from './ColumnEditor'
import { FiltersSection } from './FiltersSection'
import { columnLabel } from '@/features/inspector/columnOptions'
import { cn } from '@/lib/utils'
import { plotDatasetIds } from '@/features/plot/plotLabels'

export function DataSidebar() {
  const t = useT()
  const derived = useDerived()
  const level = useUiStore((s) => s.level)
  const selection = useUiStore((s) => s.selection)
  const datasets = derived.doc.datasets
  const [activeId, setActiveId] = useState<DatasetId | null>(null)
  const active =
    datasets.find((d) => d.id === activeId) ??
    datasets.find((d) => d.id === selection?.datasetId) ??
    // The focused plot's dataset, whatever its type (box, bar and histogram plots have no x–y series).
    datasets.find((d) => d.id === plotDatasetIds(derived.plot)[0]) ??
    datasets[0]

  return (
    <aside aria-label={t('data.title')} className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-semibold">{t('data.title')}</h2>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="xs" variant="ghost" />}>
            <Plus aria-hidden />
            {t('data.addDataset')}
            <ChevronDown className="size-3" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem onClick={() => ui.openDialog('paste')}>
              {t('topbar.importPaste')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const f = await pickFile(DATA_FILE_ACCEPT)
                if (f) void importFromFile(t, f)
              }}
            >
              {t('topbar.importFile')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => ui.openDialog('examples')}>
              {t('topbar.importExample')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => ui.openDialog('notebook')}>
              {t('topbar.importNotebook')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:overscroll-contain">
        <Section title={t('data.datasets')}>
          <ul className="flex flex-col gap-1">
            {datasets.map((d) => (
              <DatasetRow
                key={d.id}
                dataset={d}
                view={derived.views.get(d.id)}
                active={d.id === active?.id}
                onSelect={() => setActiveId(d.id)}
              />
            ))}
          </ul>
        </Section>
        {active ? (
          <Section title={t('data.columns')}>
            <ul className="-mx-1 flex flex-col">
              {active.columns.map((c) => (
                <ColumnRow key={c.id} dataset={active} column={c} view={derived.views.get(active.id)} />
              ))}
            </ul>
            {level === 'advanced' ? (
              <Button
                size="sm"
                variant="outline"
                className="self-start bg-background"
                onClick={() => ui.set({ dialog: 'derived' })}
              >
                <FunctionSquare aria-hidden />
                {t('data.addDerived')}
              </Button>
            ) : null}
          </Section>
        ) : null}
        {active && level !== 'beginner' ? <FiltersSection dataset={active} /> : null}
        {active && active.notes.length ? (
          <Section title={t('import.notes')} collapsible defaultOpen={false}>
            <pre className="max-h-40 overflow-auto overscroll-contain rounded-sm bg-background p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {active.notes.join('\n')}
            </pre>
          </Section>
        ) : null}
      </ScrollArea>
    </aside>
  )
}

function DatasetRow({
  dataset,
  view,
  active,
  onSelect,
}: {
  dataset: Dataset
  view?: DatasetView
  active: boolean
  onSelect: () => void
}) {
  const t = useT()
  const readOnly = useProjectStore((s) => s.readOnly)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(dataset.name)
  const rows = view?.rowIds.length ?? 0
  const meta = (
    <>
      <span className="num block text-xs text-muted-foreground">
        {t('data.rowsColumns', { rows, cols: dataset.columns.length })}
      </span>
      {dataset.example ? (
        <Badge
          variant="outline"
          className="mt-1 h-5 border-warning/40 bg-warning-surface px-1.5 text-[11px] font-normal text-warning"
        >
          {t('app.exampleBadge')}
        </Badge>
      ) : null}
    </>
  )
  return (
    <li
      className={cn(
        'group flex items-start gap-1 rounded-md border px-2 py-1.5',
        active ? 'border-border-strong bg-background' : 'border-transparent hover:bg-accent',
      )}
    >
      {/* The rename field sits outside the select button: an input nested in a button is invalid and unreliable. */}
      {renaming ? (
        <div className="min-w-0 flex-1">
          <input
            autoFocus
            aria-label={t('data.renameDataset')}
            autoComplete="off"
            className="h-6 w-full rounded-sm border border-input bg-background px-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false)
              if (name.trim() && name.trim() !== dataset.name) renameDataset(dataset.id, name.trim())
              else setName(dataset.name)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setName(dataset.name)
                setRenaming(false)
              }
            }}
          />
          {meta}
        </div>
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onSelect}
          aria-current={active ? 'true' : undefined}
        >
          <span className="block truncate text-sm font-medium" title={dataset.name}>
            {dataset.name}
          </span>
          {meta}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="icon-xs" variant="ghost" aria-label={`${t('common.more')}: ${dataset.name}`} />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil aria-hidden />
            {t('common.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={readOnly} onClick={() => createPlot({ datasetId: dataset.id })}>
            <ChartScatter aria-hidden />
            {t('data.newPlotFrom')}
          </DropdownMenuItem>
          {canReview(dataset.id) ? (
            <DropdownMenuItem onClick={() => void reviewImport(t, dataset.id)}>
              <FileSearch aria-hidden />
              {t('import.review')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              if (
                await confirmAction({
                  title: t('data.removeDataset'),
                  body: t('data.removeDatasetConfirm', { name: dataset.name }),
                  confirm: t('common.remove'),
                  destructive: true,
                })
              )
                removeDataset(dataset.id)
            }}
          >
            <Trash2 aria-hidden />
            {t('data.removeDataset')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

const KIND_ICON = { numeric: Hash, categorical: Tags, datetime: Calendar, text: Type } as const

function ColumnRow({ dataset, column, view }: { dataset: Dataset; column: ColumnMeta; view?: DatasetView }) {
  const t = useT()
  const s = effectiveSettings(column)
  const Icon =
    column.source.type === 'derived'
      ? FunctionSquare
      : column.role === 'uncertainty'
        ? Sigma
        : KIND_ICON[s.kind]
  const report = view?.columns.get(column.id)?.report
  const bad = report ? report.nMissing + report.nInvalid + report.nSheetError : 0
  const roleLabel = column.role !== 'measurement' ? t(`import.roles.${column.role}`) : null
  // The trigger's name carries everything the row shows (kind icon, role, problem count), not just the name.
  const triggerLabel = [
    `${t('data.editColumn')}: ${columnLabel(column)}`,
    t(`import.kinds.${s.kind}`),
    roleLabel,
    bad > 0 ? t('data.missingValues', { n: bad }) : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <li>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-accent data-popup-open:bg-accent"
              aria-label={triggerLabel}
            />
          }
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm" title={columnLabel(column)}>
            {column.name}
            {column.unit ? <span className="ml-1 text-xs text-muted-foreground">({column.unit})</span> : null}
          </span>
          {roleLabel ? <span className="shrink-0 text-[11px] text-muted-foreground">{roleLabel}</span> : null}
          {bad > 0 ? (
            <span
              className="num inline-flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-warning"
              title={t('data.missingValues', { n: bad })}
            >
              <TriangleAlert className="size-3" aria-hidden />
              {bad}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          className="w-80"
          aria-label={`${t('data.editColumn')}: ${column.name}`}
        >
          <ColumnEditor dataset={dataset} column={column} report={report} />
        </PopoverContent>
      </Popover>
    </li>
  )
}
