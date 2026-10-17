import { useMemo, type ReactNode } from 'react'
import { CircleDashed, TriangleAlert } from 'lucide-react'
import { recordBlocks, recordPosition } from '@/domain/derive/recordPosition'
import { CELL, type DatasetView } from '@/domain/derive/types'
import type { ImportDraft } from '@/domain/import/importPipeline'
import type { ColumnMeta } from '@/domain/model'
import { useT } from '@/i18n/I18nProvider'
import { recordLabel } from '@/lib/rowLabel'
import { cn } from '@/lib/utils'

/**
 * The first rows of a draft as the dataset will read them: each record labelled as in the source (row
 * number, sheet column of a transposed table, with its table in a stacked one), cell problems marked
 * with an icon plus text, never colour alone. `header` renders a column header (default: name and unit).
 */
export function PreviewTable({
  draft,
  view,
  rows,
  label,
  header,
  className,
}: {
  draft: ImportDraft
  view: DatasetView
  rows: number
  label: string
  header?: (column: ColumnMeta) => ReactNode
  className?: string
}) {
  const t = useT()
  const blocks = useMemo(() => recordBlocks(draft.rawTable.source.region), [draft])
  const shown = Math.min(rows, view.rowIds.length)
  return (
    <table className={cn('w-max min-w-full border-collapse text-sm', className)} aria-label={label}>
      <thead className="sticky top-0 z-(--z-sticky) bg-panel-sunken">
        <tr>
          <th
            scope="col"
            className="border-b border-border px-2 py-1.5 text-left text-xs font-normal text-muted-foreground"
          >
            {view.recordAxis === 'column' ? t('table.columnNumber') : t('table.rowNumber')}
          </th>
          {draft.columns.map((c) => (
            <th
              key={c.id}
              scope="col"
              className="min-w-24 border-b border-l border-border px-2 py-1.5 text-left align-top"
            >
              {header ? header(c) : <ColumnName column={c} />}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: shown }, (_, i) => {
          const where = blocks.length ? recordLabel(t, view, view.rowIds[i]!, blocks) : null
          return (
            <tr key={i} className="border-b border-border">
              <th
                scope="row"
                title={where ?? undefined}
                aria-label={where ?? undefined}
                className="num px-2 py-1 text-left font-mono text-xs font-normal text-muted-foreground"
              >
                {recordPosition(view, i).text}
              </th>
              {draft.columns.map((c) => {
                const pc = view.columns.get(c.id)
                const st = pc?.status[i] ?? CELL.missing
                const text = pc?.text[i] ?? ''
                const bad = st !== CELL.ok && st !== CELL.missing
                return (
                  <td
                    key={c.id}
                    className={cn(
                      'num border-l border-border px-2 py-1 font-mono text-xs whitespace-nowrap',
                      bad && 'bg-warning-surface text-warning',
                      st === CELL.missing && 'text-muted-foreground italic',
                    )}
                    title={
                      bad
                        ? t('import.cellInvalid')
                        : st === CELL.missing
                          ? t('import.cellMissing')
                          : undefined
                    }
                  >
                    {/* Icon plus text: the cell state never relies on colour alone. */}
                    {bad ? (
                      <TriangleAlert
                        role="img"
                        className="mr-1 inline size-3 align-[-2px]"
                        aria-label={t('table.invalidState')}
                      />
                    ) : null}
                    {st === CELL.missing && !text.trim() ? (
                      <CircleDashed
                        role="img"
                        className="inline size-3 align-[-2px]"
                        aria-label={t('table.missingState')}
                      />
                    ) : (
                      text
                    )}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ColumnName({ column }: { column: ColumnMeta }) {
  return (
    <span className="block max-w-48 truncate text-xs font-semibold" title={column.name}>
      {column.name}
      {column.unit ? <span className="ml-1 font-normal text-muted-foreground">({column.unit})</span> : null}
    </span>
  )
}
