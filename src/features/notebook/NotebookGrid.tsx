import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Trash2, TriangleAlert } from 'lucide-react'
import type { NotebookDataset, RowId } from '@/domain/model'
import { CELL, type DatasetView } from '@/domain/derive/types'
import { IconButton } from '@/components/app/IconButton'
import { useT } from '@/i18n/I18nProvider'
import {
  addNotebookRows,
  pasteNotebookBlock,
  removeNotebookRow,
  setNotebookCell,
} from '@/state/actions/notebook'
import { cn } from '@/lib/utils'

/**
 * Lab notebook: type measurements while the experiment runs; the plot updates as you type.
 * Enter moves down (adding a row at the end), Tab moves right; pasting several cells fills a block.
 */
export function NotebookGrid({ dataset, view }: { dataset: NotebookDataset; view: DatasetView }) {
  const t = useT()
  const gridRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const cols = dataset.columns

  const focusCell = (r: number, c: number) => {
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)?.focus()
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (r === dataset.rowIds.length - 1) addNotebookRows(dataset.id, 1)
      focusCell(r + 1, c)
    } else if (e.key === 'ArrowDown' && r < dataset.rowIds.length - 1) {
      e.preventDefault()
      focusCell(r + 1, c)
    } else if (e.key === 'ArrowUp' && r > 0) {
      e.preventDefault()
      focusCell(r - 1, c)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.trim())) return // a single value: let the input handle it
    e.preventDefault()
    const grid = text
      .replace(/\r/g, '')
      .split('\n')
      .filter((line, i, all) => line.length > 0 || i < all.length - 1)
      .map((line) => line.split('\t'))
    pasteNotebookBlock(dataset.id, r, c, grid)
  }

  const template = `3.5rem repeat(${cols.length}, minmax(7rem, 1fr)) 2.25rem`
  const invalidHintId = `${uid}-invalid`
  return (
    // scroll-pt-8: cells focused by keyboard scroll into view below the sticky header, not under it.
    <div
      className="min-h-0 flex-1 scroll-pt-8 overflow-auto overscroll-contain"
      data-paste-scope
      ref={gridRef}
    >
      <div
        role="grid"
        aria-label={dataset.name}
        aria-rowcount={dataset.rowIds.length + 1}
        className="min-w-fit"
      >
        <div
          role="row"
          className="sticky top-0 z-(--z-sticky) grid border-b border-border bg-panel-sunken text-xs"
          style={{ gridTemplateColumns: template }}
        >
          <div role="columnheader" className="px-2 py-1.5 text-muted-foreground">
            {t('table.rowNumber')}
          </div>
          {cols.map((c) => (
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
          <div role="columnheader" aria-label={t('notebook.removeRow')} />
        </div>
        {dataset.rowIds.map((rowId, r) => {
          const vi = view.rowIndex.get(rowId)
          return (
            <div
              role="row"
              key={rowId}
              className="group grid border-b border-border"
              style={{ gridTemplateColumns: template }}
            >
              <div
                role="rowheader"
                className="num flex items-center px-2 font-mono text-xs text-muted-foreground"
              >
                {r + 1}
              </div>
              {cols.map((c, ci) => {
                const status =
                  vi === undefined ? CELL.missing : (view.columns.get(c.id)?.status[vi] ?? CELL.missing)
                const text = dataset.cells[c.id]?.[r] ?? ''
                const invalid = text.trim() !== '' && status !== CELL.ok && status !== CELL.missing
                return (
                  <div role="gridcell" key={c.id} className="relative border-l border-border">
                    <input
                      data-r={r}
                      data-c={ci}
                      aria-label={t('notebook.cellLabel', { column: c.name, row: r + 1 })}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? invalidHintId : undefined}
                      title={invalid ? t('notebook.invalidCell') : undefined}
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      // No outline-none here: it would zero --tw-outline-style and hide the focus ring.
                      className={cn(
                        'num h-8 w-full bg-transparent px-2 font-mono text-sm focus:bg-selection focus-visible:outline-2 focus-visible:-outline-offset-2',
                        invalid && 'pr-6 text-warning',
                      )}
                      value={text}
                      onChange={(e) => setNotebookCell(dataset.id, rowId as RowId, c.id, e.target.value)}
                      onKeyDown={(e) => onKeyDown(e, r, ci)}
                      onPaste={(e) => onPaste(e, r, ci)}
                    />
                    {invalid ? (
                      <TriangleAlert
                        className="pointer-events-none absolute top-2.5 right-1.5 size-3 text-warning"
                        aria-hidden
                      />
                    ) : null}
                  </div>
                )
              })}
              <div
                role="gridcell"
                className="flex items-center justify-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
              >
                <IconButton
                  label={`${t('notebook.removeRow')} ${r + 1}`}
                  size="icon-xs"
                  onClick={() => removeNotebookRow(dataset.id, rowId as RowId)}
                >
                  <Trash2 aria-hidden />
                </IconButton>
              </div>
            </div>
          )
        })}
      </div>
      <p className="px-2.5 py-2 text-xs text-muted-foreground">{t('notebook.pasteHint')}</p>
      <span id={invalidHintId} hidden>
        {t('notebook.invalidCell')}
      </span>
    </div>
  )
}
