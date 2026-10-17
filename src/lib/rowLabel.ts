import { blockOf, recordBlocks, recordPositionOf, type RecordBlock } from '@/domain/derive/recordPosition'
import type { DatasetView } from '@/domain/derive/types'
import type { DatasetId, RawTable } from '@/domain/model'
import type { RowLabeler, Translator } from '@/i18n/translate'
import { getRawTables } from '@/state/dataStore'
import { useProjectStore } from '@/state/projectStore'

/**
 * How a record of a dataset is named to the user: its row in the file or sheet ("Row 12"), its sheet
 * column when the table was transposed on import ("Column D"), and in a dataset stacked from several
 * tables also the table it came from, because the same row number occurs in each ("plank 2 · row 5").
 */

const blocksCache = new WeakMap<RawTable, RecordBlock[]>()

/** The tables a dataset was stacked from ([] for one table, a typed table or an unknown dataset). */
export function datasetBlocks(datasetId: DatasetId): RecordBlock[] {
  const ds = useProjectStore.getState().doc.datasets.find((d) => d.id === datasetId)
  const raw = ds?.origin === 'import' ? getRawTables()[ds.rawTableId] : undefined
  if (!raw) return []
  let blocks = blocksCache.get(raw)
  if (!blocks) {
    blocks = recordBlocks(raw.source.region)
    blocksCache.set(raw, blocks)
  }
  return blocks
}

type LabelView = Pick<DatasetView, 'datasetId' | 'recordAxis' | 'sourceRow' | 'rowIndex'>

/**
 * RowId → the position printed in issue texts ("rows {rows}"): the row number, the column letters of a
 * transposed table, prefixed by the table in a stacked dataset ("plank 2 · 5"). `axis` lets the text
 * say "columns". `blocks` defaults to the dataset's own.
 */
export function viewRowLabel(
  view: LabelView | undefined,
  blocks: readonly RecordBlock[] = view ? datasetBlocks(view.datasetId) : [],
): RowLabeler | undefined {
  if (!view) return undefined
  const label = ((rowId: number) => {
    const p = recordPositionOf(view, rowId)
    const shown: string | number = p ? (p.axis === 'row' ? p.index : p.text) : rowId + 1
    const block = blockOf(blocks, rowId)
    return block ? `${block} · ${shown}` : shown
  }) as RowLabeler
  label.axis = view.recordAxis
  return label
}

/** "Row 12", "Column D", or "plank 2 · row 5" in a stacked dataset; null when the row is not in the view. */
export function recordLabel(
  t: Translator,
  view: LabelView,
  rowId: number,
  blocks: readonly RecordBlock[] = datasetBlocks(view.datasetId),
): string | null {
  const p = recordPositionOf(view, rowId)
  if (!p) return null
  const block = blockOf(blocks, rowId)
  const params = { axis: p.axis, pos: p.text }
  return block ? t('table.blockRecord', { ...params, block }) : t('table.record', params)
}

const MAX_LISTED = 12

/**
 * Several records, in source order: "Rows 3, 7", "Columns D, F", or per table in a stacked dataset
 * ("oak plank 1 · rows 5, 7; pine plank 1 · row 3"). At most 12 positions, then "…".
 */
export function recordsText(
  t: Translator,
  view: LabelView,
  rowIds: readonly number[],
  blocks: readonly RecordBlock[] = datasetBlocks(view.datasetId),
): string {
  const found = rowIds
    .map((r) => ({ r, i: view.rowIndex.get(r) }))
    .filter((x): x is { r: number; i: number } => x.i !== undefined)
    .sort((a, b) => a.i - b.i)
  const shown = found.slice(0, MAX_LISTED)
  const more = found.length > MAX_LISTED ? ', …' : ''
  const groups: { block: string | null; texts: string[] }[] = []
  for (const { r } of shown) {
    const block = blockOf(blocks, r)
    const text = recordPositionOf(view, r)!.text
    const last = groups[groups.length - 1]
    if (last && last.block === block) last.texts.push(text)
    else groups.push({ block, texts: [text] })
  }
  const axis = view.recordAxis
  return (
    groups
      .map((g) => {
        const params = { axis, count: g.texts.length, list: g.texts.join(', ') }
        return g.block === null
          ? t('table.records', params)
          : t('table.blockRecords', { ...params, block: g.block })
      })
      .join('; ') + more
  )
}
