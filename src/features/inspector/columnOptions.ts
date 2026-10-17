import { columnGroups, MAX_SPLIT_GROUPS } from '@/domain/derive/split'
import { CELL, type DatasetView, type ParsedColumn } from '@/domain/derive/types'
import { effectiveSettings, type ColumnId, type ColumnMeta, type Dataset } from '@/domain/model'
import type { ChoiceItem } from '@/components/app/Choice'
import type { Translator } from '@/i18n/translate'
import { issueTitle } from '@/i18n/translate'

export function columnLabel(c: ColumnMeta): string {
  return c.unit ? `${c.name} (${c.unit})` : c.name
}

export function isNumeric(c: ColumnMeta): boolean {
  return effectiveSettings(c).kind === 'numeric' || effectiveSettings(c).kind === 'datetime'
}

/** Column choices for an axis: non-numeric columns stay listed but disabled, with the reason. */
export function numericColumnItems(
  dataset: Dataset,
  view: DatasetView | undefined,
  t: Translator,
): ChoiceItem<ColumnId>[] {
  return dataset.columns
    .filter((c) => c.role !== 'ignore')
    .map((c) => {
      const parsed = view?.columns.get(c.id)
      const numeric = isNumeric(c)
      const valid = parsed?.report.nValid ?? 0
      let hint: string | undefined
      if (!numeric) hint = issueTitle(t, { code: 'E_COLUMN_NOT_NUMERIC', params: { column: c.name } })
      else if (valid === 0) hint = issueTitle(t, { code: 'W_ALL_MISSING', params: { column: c.name } })
      return { value: c.id, label: columnLabel(c), disabled: !numeric || valid === 0, hint }
    })
}

/** Value of the "no column" item of a column choice (never a ColumnId: ids are generated with a prefix). */
export const NO_COLUMN = '__none__' as ColumnId

const tooManyCache = new WeakMap<ParsedColumn, boolean>()

/**
 * Whether a column has more values than a split can draw, counted as columnGroups counts them (a label
 * or a finite number of a readable cell). Stops at the first value past the limit: the panels ask this
 * of every column, and grouping a measured column of a large table in full would block the page.
 */
function tooManyToSplit(pc: ParsedColumn): boolean {
  const known = tooManyCache.get(pc)
  if (known !== undefined) return known
  const codes = pc.categories?.codes
  const seen = new Set<number>()
  let many = false
  if (!pc.categories || pc.categories.labels.length > MAX_SPLIT_GROUPS)
    for (let i = 0; i < pc.values.length && !many; i++) {
      if (pc.status[i] !== CELL.ok) continue
      const v = codes ? codes[i] : pc.values[i]
      if (codes ? v < 0 : !Number.isFinite(v)) continue
      seen.add(v)
      many = seen.size > MAX_SPLIT_GROUPS
    }
  tooManyCache.set(pc, many)
  return many
}

/**
 * Column choices for splitting a series ("Split by") or grouping a histogram ("Group by"), after a
 * "none" item: any column the split can draw, i.e. with 1 to MAX_SPLIT_GROUPS values (labels, numbers
 * or dates; the pipeline's own grouping, so the counts match the figure). The others stay listed but
 * disabled, with the reason: too many values, no readable value, or plotted on an axis of the series.
 */
export function groupColumnItems(
  dataset: Dataset,
  view: DatasetView | undefined,
  t: Translator,
  opts: { none: string; axes?: { x: ColumnId; y: ColumnId } },
): ChoiceItem<ColumnId>[] {
  const items: ChoiceItem<ColumnId>[] = [{ value: NO_COLUMN, label: opts.none }]
  for (const c of dataset.columns) {
    if (c.role === 'ignore') continue
    const parsed = view?.columns.get(c.id)
    const many = parsed ? tooManyToSplit(parsed) : false
    const groups = parsed && !many ? columnGroups(parsed) : null
    let hint: string
    let disabled = true
    if (opts.axes && (c.id === opts.axes.x || c.id === opts.axes.y))
      hint = t('series.splitOnAxis', { axis: c.id === opts.axes.x ? 'x' : 'y' })
    else if (many || groups?.tooMany) hint = t('series.splitTooMany', { limit: MAX_SPLIT_GROUPS })
    else if (!groups || groups.distinct === 0) hint = t('series.splitNoValues')
    else {
      hint = t('series.splitGroups', { count: groups.groups.length })
      disabled = false
    }
    items.push({ value: c.id, label: columnLabel(c), disabled, hint })
  }
  return items
}

export function categoryColumnItems(dataset: Dataset): ChoiceItem<ColumnId>[] {
  return dataset.columns
    .filter((c) => c.role !== 'ignore')
    .map((c) => ({ value: c.id, label: columnLabel(c) }))
}
