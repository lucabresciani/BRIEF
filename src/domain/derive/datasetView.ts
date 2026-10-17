/**
 * Dataset (+ its immutable RawTable) → DatasetView: the parsed, non-blank data rows every analysis,
 * table and figure reads. Nothing here is stored; parsed columns are cached on the identity
 * of their immutable inputs (RawColumn / notebook cells array) plus a settings hash, so an unrelated
 * edit (renaming a column or its unit, styling a plot) returns the very same ParsedColumn objects.
 */
import { referenceUnit } from '@/domain/import/columnInfer'
import { columnUnit } from '@/domain/import/layout'
import { NATIVE, effectiveSettings } from '@/domain/model'
import type {
  ColumnId,
  ColumnMeta,
  Dataset,
  ImportedDataset,
  NotebookDataset,
  RawTable,
  TransformSpec,
} from '@/domain/model'
import { KeyedWeakCache } from './memo'
import { parseColumn } from './parseColumn'
import { recordBlocks, type RecordBlock } from './recordPosition'
import { applyTransform, transformInputs } from './transforms'
import type { DatasetView, ParsedColumn } from './types'

interface RowsInfo {
  rowIds: Int32Array
  rowIndex: ReadonlyMap<number, number>
  blankRows: Int32Array
  sourceRow: Int32Array
}

const EMPTY_ROWS: RowsInfo = {
  rowIds: new Int32Array(0),
  rowIndex: new Map(),
  blankRows: new Int32Array(0),
  sourceRow: new Int32Array(0),
}

const importedRowsCache = new KeyedWeakCache<RawTable, RowsInfo>()
const blocksCache = new WeakMap<RawTable, readonly RecordBlock[]>()
const NO_BLOCKS: readonly RecordBlock[] = []

/** The tables a raw table was stacked from, one array per raw table (the views compare it by identity). */
function blocksOf(raw: RawTable | null | undefined): readonly RecordBlock[] {
  if (!raw || (raw.source.region?.blocks.length ?? 0) < 2) return NO_BLOCKS
  let blocks = blocksCache.get(raw)
  if (!blocks) blocksCache.set(raw, (blocks = recordBlocks(raw.source.region)))
  return blocks
}
const notebookRowsCache = new WeakMap<object, RowsInfo>()
const parsedCache = new KeyedWeakCache<object, { rows: Int32Array; col: ParsedColumn }>()
const derivedCache = new KeyedWeakCache<
  object,
  { rows: Int32Array; inputs: readonly (ParsedColumn | undefined)[]; col: ParsedColumn }
>()

const indexOf = (rowIds: Int32Array): Map<number, number> => {
  const m = new Map<number, number>()
  for (let i = 0; i < rowIds.length; i++) m.set(rowIds[i], i)
  return m
}

/**
 * Imported data rows: grid rows dataStartRow..dataEndRow (RowId = grid index), minus rows whose cells
 * are ALL empty after trim (blankRows: kept in the raw data, outside nTotal, I_BLANK_ROWS).
 */
function importedRows(raw: RawTable, layout: ImportedDataset['layout']): RowsInfo {
  const start = Math.max(0, Math.floor(layout.dataStartRow))
  const end = Math.min(raw.rowCount - 1, Math.floor(layout.dataEndRow))
  return importedRowsCache.getOrCompute(raw, `${start}:${end}`, () => {
    if (!(end >= start)) return EMPTY_ROWS
    const data: number[] = []
    const blank: number[] = []
    for (let r = start; r <= end; r++) {
      let empty = true
      for (const c of raw.columns) {
        const t = c.text[r]
        if (t !== undefined && t.trim() !== '') {
          empty = false
          break
        }
      }
      ;(empty ? blank : data).push(r)
    }
    const rowIds = Int32Array.from(data)
    const sourceRow = new Int32Array(rowIds.length)
    for (let i = 0; i < rowIds.length; i++) sourceRow[i] = raw.sourceRow[rowIds[i]] ?? rowIds[i] + 1
    return { rowIds, rowIndex: indexOf(rowIds), blankRows: Int32Array.from(blank), sourceRow }
  })
}

/** Notebook rows: every row of dataset.rowIds in order; the number shown is the 1-based position. */
function notebookRows(ds: NotebookDataset): RowsInfo {
  const hit = notebookRowsCache.get(ds.rowIds)
  if (hit) return hit
  const rowIds = Int32Array.from(ds.rowIds)
  const sourceRow = new Int32Array(rowIds.length)
  for (let i = 0; i < rowIds.length; i++) sourceRow[i] = i + 1
  const info = { rowIds, rowIndex: indexOf(rowIds), blankRows: new Int32Array(0), sourceRow }
  notebookRowsCache.set(ds.rowIds, info)
  return info
}

const settingsHash = (meta: ColumnMeta) => {
  const s = effectiveSettings(meta)
  return `${meta.id}|${s.kind}|${s.decimal}|${s.percent}`
}
const unitHash = (unit: string | null) => (unit === null ? '\u0000' : unit)

/**
 * Imported cells are checked against the unit read from the file at import (header "(unit)", units row,
 * or the unit carried by most cells: the same rule as the importer), NOT against the editable unit label:
 * correcting or clearing a column's unit is a metadata edit and never changes which cells are valid.
 */
function parseImportedColumn(
  raw: RawTable,
  rows: RowsInfo,
  meta: ColumnMeta,
  index: number,
  layout: ImportedDataset['layout'],
) {
  const rawCol = Number.isInteger(index) && index >= 0 ? raw.columns[index] : undefined
  const key: object = rawCol ?? raw
  const hash = `${index}|${settingsHash(meta)}|${layout.headerRow}|${layout.unitsRow}`
  const hit = parsedCache.get(key, hash)
  if (hit && hit.rows === rows.rowIds) return hit.col
  const n = rows.rowIds.length
  const texts = new Array<string>(n)
  for (let i = 0; i < n; i++) texts[i] = rawCol?.text[rows.rowIds[i]] ?? ''
  let native: { kind: Uint8Array; num: Float64Array } | null = null
  if (rawCol?.native) {
    const kind = new Uint8Array(n)
    const num = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      // A native array shorter than the text column: read the text (never invent an empty cell).
      kind[i] = rawCol.native.kind[rows.rowIds[i]] ?? NATIVE.text
      num[i] = rawCol.native.num[rows.rowIds[i]] ?? NaN
    }
    native = { kind, num }
  }
  const spaceGrouping = raw.source.delimiter !== 'none'
  const at = (r: number | null) => (r !== null && rawCol ? (rawCol.text[r] ?? '') : null)
  const fileUnit = columnUnit(at(layout.headerRow), at(layout.unitsRow)).unit
  const col = parseColumn(meta.id, texts, effectiveSettings(meta), native, {
    rowIds: rows.rowIds,
    unit: referenceUnit(texts, native, fileUnit, { spaceGrouping }),
    spaceGrouping,
  })
  parsedCache.set(key, hash, { rows: rows.rowIds, col })
  return col
}

function parseNotebookColumn(ds: NotebookDataset, rows: RowsInfo, meta: ColumnMeta) {
  const cells = ds.cells[meta.id] as readonly string[] | undefined
  const key: object = cells ?? ds.rowIds
  // Typed cells are checked against the column's declared unit (the user defines a notebook column).
  const hash = `${settingsHash(meta)}|${unitHash(meta.unit)}`
  const hit = parsedCache.get(key, hash)
  if (hit && hit.rows === rows.rowIds) return hit.col
  const n = rows.rowIds.length
  let texts: readonly string[]
  if (cells && cells.length === n) texts = cells
  else {
    const padded = new Array<string>(n)
    for (let i = 0; i < n; i++) padded[i] = cells?.[i] ?? ''
    texts = padded
  }
  const col = parseColumn(meta.id, texts, effectiveSettings(meta), null, {
    rowIds: rows.rowIds,
    unit: meta.unit,
  })
  parsedCache.set(key, hash, { rows: rows.rowIds, col })
  return col
}

/**
 * Builds the view. Imported: raw columns via ColumnMeta.source.index (an absent index → all ''),
 * native cells aligned; a missing RawTable gives a view with no rows (never an exception).
 * Notebook: rowIds + cells[columnId] (rows are never dropped as blank: they are being typed).
 * Derived columns are computed after the raw/notebook ones with applyTransform, resolving inputs that
 * are themselves derived regardless of their order (a cycle leaves the input absent → missing).
 */
export function buildDatasetView(dataset: Dataset, raw: RawTable | null): DatasetView {
  const rows =
    dataset.origin === 'import'
      ? raw
        ? importedRows(raw, dataset.layout)
        : EMPTY_ROWS
      : notebookRows(dataset)
  const parsed = new Map<ColumnId, ParsedColumn>()
  const derivedSpecs = new Map<ColumnId, TransformSpec>()

  for (const meta of dataset.columns) {
    const src = meta.source
    if (src.type === 'derived') {
      derivedSpecs.set(meta.id, src.spec)
      continue
    }
    if (dataset.origin === 'import') {
      // A non-raw source in an imported dataset (inconsistent document) reads as an absent raw column.
      const index = src.type === 'raw' ? src.index : -1
      const col = raw
        ? parseImportedColumn(raw, rows, meta, index, dataset.layout)
        : parseColumn(meta.id, [], effectiveSettings(meta), null, { rowIds: rows.rowIds })
      parsed.set(meta.id, col)
    } else {
      parsed.set(meta.id, parseNotebookColumn(dataset, rows, meta))
    }
  }

  const inProgress = new Set<ColumnId>()
  const resolve = (id: ColumnId): ParsedColumn | undefined => {
    const done = parsed.get(id)
    if (done) return done
    const spec = derivedSpecs.get(id)
    if (!spec || inProgress.has(id)) return undefined
    inProgress.add(id)
    const inputs = transformInputs(spec).map(resolve)
    inProgress.delete(id)
    const key: object = inputs[0] ?? rows.rowIds
    const hash = `${id}|${JSON.stringify(spec)}`
    const hit = derivedCache.get(key, hash)
    let col: ParsedColumn
    if (hit && hit.rows === rows.rowIds && hit.inputs.every((c, k) => c === inputs[k])) col = hit.col
    else {
      const byId = new Map(transformInputs(spec).map((cid, k) => [cid, inputs[k]] as const))
      col = applyTransform(spec, (cid) => byId.get(cid), id, rows.rowIds)
      derivedCache.set(key, hash, { rows: rows.rowIds, inputs, col })
    }
    parsed.set(id, col)
    return col
  }
  for (const id of derivedSpecs.keys()) resolve(id)

  const columns = new Map<ColumnId, ParsedColumn>()
  const columnOrder: ColumnId[] = []
  for (const meta of dataset.columns) {
    const col = parsed.get(meta.id)
    if (!col) continue
    columns.set(meta.id, col)
    columnOrder.push(meta.id)
  }

  return {
    datasetId: dataset.id,
    rowIds: rows.rowIds,
    rowIndex: rows.rowIndex,
    blankRows: rows.blankRows,
    sourceRow: rows.sourceRow,
    // A transposed block: each record was a sheet column, and sourceRow holds that column's number.
    recordAxis: dataset.origin === 'import' && raw?.source.region?.orientation === 'rows' ? 'column' : 'row',
    recordBlocks: dataset.origin === 'import' ? blocksOf(raw) : NO_BLOCKS,
    columns,
    columnOrder,
  }
}
