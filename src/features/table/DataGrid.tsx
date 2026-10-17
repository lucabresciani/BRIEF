import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Ban, CircleDashed, CircleSlash, TriangleAlert } from 'lucide-react'
import { asRowId, INACTIVE, type Dataset } from '@/domain/model'
import { CELL, type DatasetView } from '@/domain/derive/types'
import { recordPosition } from '@/domain/derive/recordPosition'
import { useT } from '@/i18n/I18nProvider'
import { useDerived } from '@/state/derived'
import { ui, useUiStore } from '@/state/uiStore'
import { cn } from '@/lib/utils'
import { datasetBlocks, recordLabel } from '@/lib/rowLabel'

const ROW_H = 28
/** Sticky header row (2 × 6 px padding + 16 px line + 1 px border): rows scrolled into view must clear it. */
const HEADER_H = 29

/**
 * Virtualised, read-only grid of the measurements as imported. Rows keep their file row number (the sheet
 * column of a table transposed on import, and the table of a stacked dataset in their label),
 * cell problems are marked with an icon (not colour only), excluded rows stay visible.
 * Click selects, Shift+click selects a range, Ctrl/Cmd+click toggles; arrows move, Space toggles.
 */
export function DataGrid({ dataset, view }: { dataset: Dataset; view: DatasetView }) {
  const t = useT()
  const derived = useDerived()
  const selection = useUiStore((s) => s.selection)
  const hoverRow = useUiStore((s) => s.hoverRow)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridId = useId()
  const [cursorState, setCursor] = useState(0)
  const columns = useMemo(() => dataset.columns.filter((c) => c.role !== 'ignore'), [dataset.columns])
  const sample = useMemo(
    () =>
      derived.columnSample(
        dataset.id,
        columns.filter((c) => c.role === 'measurement').map((c) => c.id),
      ),
    [derived, dataset.id, columns],
  )
  const excluded = useMemo(
    () =>
      new Set<number>(
        derived.doc.exclusions.filter((e) => e.datasetId === dataset.id).flatMap((e) => e.rowIds),
      ),
    [derived.doc.exclusions, dataset.id],
  )
  const selected = selection?.datasetId === dataset.id ? selection.rowIds : null
  // Stacked tables: the same row number occurs in each table, so the row header names its table.
  // The dataset (not only its id) changes when it is re-read from a new raw table.
  const blocks = useMemo(() => datasetBlocks(dataset.id), [dataset])
  const n = view.rowIds.length
  // The dataset can be re-read with fewer rows: the keyboard cursor never points past the last one.
  const cursor = Math.max(0, Math.min(cursorState, n - 1))

  const virtual = useVirtualizer({
    count: n,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    // The rows start below the sticky header, so the last HEADER_H px of the viewport hold no row:
    // without this, scrolling to the cursor row (align end) leaves it hidden below the fold.
    scrollPaddingEnd: HEADER_H,
    overscan: 12,
    useFlushSync: false,
    initialRect: { width: 800, height: 300 },
  })

  // Plot → table: scroll to the first selected row when the selection comes from the plot.
  useEffect(() => {
    if (!selected || selection?.origin !== 'plot') return
    const first = [...selected]
      .map((r) => view.rowIndex.get(r) ?? -1)
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0]
    if (first !== undefined) virtual.scrollToIndex(first, { align: 'auto' })
  }, [selected, selection?.origin, view.rowIndex, virtual])

  const select = (index: number, mode: 'single' | 'range' | 'toggle') => {
    const rowId = view.rowIds[index]
    const cur = selected ? new Set(selected) : new Set<number>()
    let next: Set<number>
    if (mode === 'toggle') {
      next = cur
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
    } else if (
      mode === 'range' &&
      selection?.anchor !== null &&
      selection?.anchor !== undefined &&
      selection.datasetId === dataset.id
    ) {
      const a = view.rowIndex.get(selection.anchor) ?? index
      next = new Set<number>()
      for (let i = Math.min(a, index); i <= Math.max(a, index); i++) next.add(view.rowIds[i])
    } else {
      next = cur.size === 1 && cur.has(rowId) ? new Set() : new Set([rowId])
    }
    setCursor(index)
    ui.select(
      next.size
        ? {
            datasetId: dataset.id,
            rowIds: next,
            origin: 'table',
            anchor: mode === 'range' && selection?.anchor ? selection.anchor : asRowId(rowId),
          }
        : null,
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.max(0, Math.min(n - 1, cursor + (e.key === 'ArrowDown' ? 1 : -1)))
      setCursor(next)
      virtual.scrollToIndex(next, { align: 'auto' })
      if (e.shiftKey) select(next, 'range')
      ui.set({ hoverRow: { datasetId: dataset.id, rowId: asRowId(view.rowIds[next]), origin: 'table' } })
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      select(cursor, 'toggle')
    } else if (e.key === 'Escape') {
      ui.clearSelection()
    }
  }

  const gridTemplate = `4.5rem repeat(${columns.length}, minmax(6.5rem, 1fr))`
  const items = virtual.getVirtualItems()
  // Focus stays on the grid; the keyboard cursor row is exposed to assistive technology as the active descendant.
  const activeRowId = items.some((vi) => vi.index === cursor) ? `${gridId}-row-${cursor}` : undefined

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onMouseLeave={() => hoverRow?.origin === 'table' && ui.set({ hoverRow: null })}
    >
      <div
        ref={scrollRef}
        role="grid"
        aria-label={t('table.title')}
        aria-rowcount={n + 1}
        aria-colcount={columns.length + 1}
        aria-multiselectable="true"
        aria-activedescendant={activeRowId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="group/grid min-h-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-offset-[-2px]"
      >
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-(--z-sticky) grid border-b border-border bg-panel-sunken text-xs"
          style={{ gridTemplateColumns: gridTemplate, minWidth: 'fit-content' }}
        >
          <div role="columnheader" className="px-2 py-1.5 text-muted-foreground">
            {view.recordAxis === 'column' ? t('table.columnNumber') : t('table.rowNumber')}
          </div>
          {columns.map((c) => (
            <div
              role="columnheader"
              key={c.id}
              className="truncate border-l border-border px-2 py-1.5 font-medium"
              title={c.name}
            >
              {c.name}
              {c.unit ? <span className="ml-1 font-normal text-muted-foreground">({c.unit})</span> : null}
            </div>
          ))}
        </div>
        {n === 0 ? <p className="p-3 text-sm text-muted-foreground">{t('table.empty')}</p> : null}
        <div style={{ height: virtual.getTotalSize(), position: 'relative', minWidth: 'fit-content' }}>
          {items.map((vi) => {
            const i = vi.index
            const rowId = view.rowIds[i]
            const isSel = selected?.has(rowId) ?? false
            const isExcl = excluded.has(rowId)
            const reason = sample?.reason[i] ?? 0
            const isHover = hoverRow?.datasetId === dataset.id && hoverRow.rowId === rowId
            return (
              <div
                key={vi.key}
                id={`${gridId}-row-${i}`}
                role="row"
                aria-rowindex={i + 2}
                aria-selected={isSel}
                data-row-id={rowId}
                onMouseEnter={() =>
                  ui.set({ hoverRow: { datasetId: dataset.id, rowId: asRowId(rowId), origin: 'table' } })
                }
                onClick={(e) =>
                  select(i, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')
                }
                className={cn(
                  'absolute top-0 left-0 grid w-full cursor-default border-b border-border text-sm select-none',
                  isSel
                    ? 'bg-selection'
                    : isHover
                      ? 'bg-accent'
                      : i === cursor
                        ? 'bg-panel'
                        : 'bg-background',
                  // Keyboard cursor: a visible ring while the grid has keyboard focus (the tint alone is ~1.05:1).
                  i === cursor &&
                    'group-focus-visible/grid:outline-2 group-focus-visible/grid:-outline-offset-2 group-focus-visible/grid:outline-ring',
                  isExcl && 'text-muted-foreground',
                )}
                style={{
                  height: ROW_H,
                  transform: `translateY(${vi.start}px)`,
                  gridTemplateColumns: gridTemplate,
                }}
              >
                <div
                  role="rowheader"
                  // A name replaces the content, so it says the state its icons say (excluded, filtered out).
                  aria-label={
                    blocks.length
                      ? [
                          recordLabel(t, view, rowId, blocks),
                          isExcl
                            ? t('table.excludedState')
                            : reason === INACTIVE.filtered
                              ? t('table.filteredState')
                              : null,
                        ]
                          .filter(Boolean)
                          .join(', ') || undefined
                      : undefined
                  }
                  title={blocks.length ? (recordLabel(t, view, rowId, blocks) ?? undefined) : undefined}
                  className={cn(
                    'num flex items-center gap-1 px-2 font-mono text-xs',
                    isSel ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span>{recordPosition(view, i).text}</span>
                  {isExcl ? (
                    <Ban className="size-3" role="img" aria-label={t('table.excludedState')} />
                  ) : null}
                  {!isExcl && reason === INACTIVE.filtered ? (
                    <CircleSlash className="size-3" role="img" aria-label={t('table.filteredState')} />
                  ) : null}
                </div>
                {columns.map((c) => {
                  const pc = view.columns.get(c.id)
                  const status = pc?.status[i] ?? CELL.missing
                  const text = pc?.text[i] ?? ''
                  const bad =
                    status === CELL.invalid ||
                    status === CELL.separatorConflict ||
                    status === CELL.unexpectedUnit ||
                    status === CELL.domain ||
                    status === CELL.sheetError
                  const missing = status === CELL.missing
                  return (
                    <div
                      role="gridcell"
                      key={c.id}
                      className={cn(
                        'num flex items-center gap-1 truncate border-l border-border px-2 font-mono',
                        isExcl && 'line-through decoration-muted-foreground/60',
                        bad && 'text-warning',
                      )}
                      title={
                        bad ? t('import.cellInvalid') : missing ? t('import.cellMissing') : text || undefined
                      }
                    >
                      {bad ? (
                        <TriangleAlert
                          className="size-3 shrink-0"
                          role="img"
                          aria-label={t('table.invalidState')}
                        />
                      ) : null}
                      {missing && !text.trim() ? (
                        <CircleDashed
                          className="size-3 text-muted-foreground"
                          role="img"
                          aria-label={t('table.missingState')}
                        />
                      ) : (
                        <span className={cn('min-w-0 truncate', missing && 'text-muted-foreground italic')}>
                          {text}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
