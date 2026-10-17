import type { Draft } from 'immer'
import { buildDatasetView } from '@/domain/derive/datasetView'
import type { ImportDraft } from '@/domain/import/importPipeline'
import { cascadeRemoval, repairRefs } from '@/domain/model/integrity'
import { initialPlot } from '@/domain/recommend/recommend'
import {
  newId,
  type ColumnId,
  type ColumnMeta,
  type ColumnParseSettings,
  type Dataset,
  type DatasetId,
  type ExampleId,
  type ImportedDataset,
  type PlotId,
  type PlotSpec,
  type ProjectDoc,
  type RawTable,
  type RowId,
  type SeriesId,
} from '@/domain/model'
import { addRawTable, getRawTables } from '../dataStore'
import { commit, useProjectStore } from '../projectStore'
import { ui } from '../uiStore'
import { getActivePlotId } from '../workspace'
import { isEmptyPlot, nextPaletteIndex, plotDraft } from './helpers'

export function datasetFromDraft(
  draft: ImportDraft,
  name: string,
  example: ExampleId | null,
): ImportedDataset {
  return {
    id: newId<'DatasetId'>('ds') as DatasetId,
    name,
    createdAt: new Date().toISOString(),
    example: example ? { id: example } : null,
    columns: draft.columns,
    notes: draft.notes,
    origin: 'import',
    rawTableId: draft.rawTable.id,
    layout: draft.layout,
  }
}

/** History label of an import: the dataset names, the first two and a count past three. */
function importedNames(names: readonly string[]): string {
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

/**
 * Commit an import of one or more tables in ONE undo step: stores the immutable raw tables, adds a
 * dataset per table and plots the first one with its recommended plot (never a fit). That plot fills
 * the active plot when nothing is plotted on it yet (its id and name are kept), else it is a new plot
 * named after the dataset (the first plot of a project keeps the automatic name), and it is shown.
 * A later table whose columns have the same names as the first plot's x and y is overlaid on it as an
 * extra series; the others are only added as datasets. Tables merged on import (a stacked region) are
 * plotted split by their first label column (initialPlot decides whether it has a useful number of values).
 */
export function importDrafts(
  drafts: readonly ImportDraft[],
  opts: { names?: readonly (string | undefined)[]; example?: ExampleId | null } = {},
): DatasetId[] {
  if (!drafts.length) return []
  for (const draft of drafts) addRawTable(draft.rawTable)
  const datasets = drafts.map((draft, i) =>
    datasetFromDraft(draft, opts.names?.[i] ?? draft.suggestedName, opts.example ?? null),
  )
  const first = datasets[0]
  const newPlotId = newId<'PlotId'>('plot') as PlotId
  const labelIndex = drafts[0].rawTable.source.region?.labelColumns[0]
  const splitBy =
    labelIndex === undefined
      ? null
      : (first.columns.find(
          (c) => c.source.type === 'raw' && c.source.index === labelIndex && c.role === 'group',
        )?.id ?? null)
  const { plot } = initialPlot(
    first,
    buildDatasetView(first, drafts[0].rawTable),
    newPlotId,
    newId<'SeriesId'>('ser') as SeriesId,
    { splitBy },
  )
  const lead = plot.series[0]
  if (lead && (plot.type === 'scatter' || plot.type === 'line')) {
    const xName = first.columns.find((c) => c.id === lead.x)?.name
    const yName = first.columns.find((c) => c.id === lead.y)?.name
    for (const ds of datasets.slice(1)) {
      const x = ds.columns.find((c) => c.name === xName && c.role !== 'ignore')
      const y = ds.columns.find((c) => c.name === yName && c.role !== 'ignore')
      if (!x || !y) continue
      plot.series.push({
        ...lead,
        id: newId<'SeriesId'>('ser') as SeriesId,
        datasetId: ds.id,
        x: x.id,
        y: y.id,
        style: { ...lead.style, paletteIndex: nextPaletteIndex(plot) },
        // A split names a column of the first dataset only.
        split: null,
      })
    }
  }

  // An active plot with nothing on it yet is filled in place rather than left empty beside a new tab.
  const activeId = getActivePlotId()
  const active = useProjectStore.getState().doc.plots.find((p) => p.id === activeId)
  const target = active && isEmptyPlot(active) ? active.id : newPlotId
  const ok = commit(
    'dataset.import',
    (d) => {
      d.datasets.push(...(datasets as Draft<Dataset>[]))
      const current = plotDraft(d, target)
      if (current) Object.assign(current, { ...plot, id: current.id, name: current.name })
      else d.plots.push({ ...plot, name: d.plots.length ? first.name : '' } as Draft<PlotSpec>)
    },
    { datasetId: first.id, plotId: target, params: { name: importedNames(datasets.map((ds) => ds.name)) } },
  )
  if (ok) ui.showPlot(target)
  const noticed = opts.example ? -1 : drafts.findIndex((dr) => dr.issues.length > 0)
  if (noticed >= 0)
    ui.set({
      importNotice: {
        datasetId: datasets[noticed].id,
        name: datasets[noticed].name,
        issues: drafts[noticed].issues,
      },
    })
  ui.set({ selection: null })
  return datasets.map((ds) => ds.id)
}

/** Commit an import of one table (see importDrafts). */
export function importDraft(
  draft: ImportDraft,
  opts: { name?: string; example?: ExampleId | null } = {},
): DatasetId {
  return importDrafts([draft], { names: [opts.name], example: opts.example })[0]
}

/**
 * Re-read an imported dataset with new import settings (header row, separator…), or with tables cut out
 * of a sheet again ("Review" in the sheet picker). Undoable. References that no longer have a target
 * (a series on a column that is gone) are repaired, never pointed at another column.
 */
export function replaceDatasetFromDraft(datasetId: DatasetId, draft: ImportDraft): void {
  const oldRaw = rawTableFor(datasetId)
  addRawTable(draft.rawTable)
  // Cut out of a sheet: a table's columns and rows are not where they were (label columns added or
  // removed, other tables chosen), so position alone would move a series or an exclusion to another
  // column or record. Columns are matched by name first, and records by their table and sheet row.
  const regions = !!draft.rawTable.source.region || !!oldRaw?.source.region
  const records = regions && oldRaw ? recordMap(oldRaw, draft.rawTable) : null
  commit(
    'dataset.layout',
    (d) => {
      const ds = d.datasets.find((x) => x.id === datasetId)
      if (!ds || ds.origin !== 'import') return
      const raw = ds.columns.filter((c) => c.source.type === 'raw')
      const used = new Set<Draft<ColumnMeta>>()
      const take = (o: Draft<ColumnMeta> | undefined) => {
        if (o) used.add(o)
        return o
      }
      const kept = new Set(draft.columns.map((c) => normName(c.name)))
      const matches = draft.columns.map((c) =>
        regions ? take(raw.find((o) => !used.has(o) && normName(o.name) === normName(c.name))) : undefined,
      )
      // Otherwise the column at the same position (a header row changed: the names are new), unless that
      // column's name is still in the table, somewhere else.
      const atIndex = (index: number) =>
        raw.find(
          (o) =>
            !used.has(o) &&
            o.source.type === 'raw' &&
            o.source.index === index &&
            !(regions && kept.has(normName(o.name))),
        )
      const columns = draft.columns.map((c, i) => {
        const old = matches[i] ?? (c.source.type === 'raw' ? take(atIndex(c.source.index)) : undefined)
        return old
          ? { ...c, id: old.id, role: old.role, unit: old.unitSource === 'user' ? old.unit : c.unit }
          : c
      })
      ds.columns = [
        ...columns,
        ...ds.columns.filter((c) => c.source.type === 'derived'),
      ] as Draft<ColumnMeta>[]
      ds.rawTableId = draft.rawTable.id
      ds.layout = draft.layout
      ds.notes = draft.notes
      if (records)
        for (const e of d.exclusions)
          if (e.datasetId === datasetId)
            e.rowIds = e.rowIds.flatMap((r) => {
              const to = records.get(r)
              return to === undefined ? [] : [to]
            })
      repairRefs(d as ProjectDoc)
    },
    { datasetId, params: { name: findDataset(datasetId)?.name ?? '' } },
  )
  const sel = ui.get().selection
  if (records && sel?.datasetId === datasetId) ui.clearSelection()
}

const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Rows of two tables cut out of the same sheet that are the same record: same table (A1 range) and same
 * sheet row (sheet column for transposed tables). Rows outside every table (none) are not mapped.
 */
function recordMap(from: RawTable, to: RawTable): Map<RowId, RowId> {
  const keys = (t: RawTable) => {
    const out = new Map<string, number>()
    for (const b of t.source.region?.blocks ?? [])
      for (let r = b.firstRow; r < b.firstRow + b.rowCount; r++) out.set(`${b.range}#${t.sourceRow[r]}`, r)
    return out
  }
  const next = keys(to)
  const map = new Map<RowId, RowId>()
  for (const [key, r] of keys(from)) {
    const target = next.get(key)
    if (target !== undefined) map.set(r as RowId, target as RowId)
  }
  return map
}

export function findDataset(id: DatasetId) {
  return useProjectStore.getState().doc.datasets.find((d) => d.id === id)
}

export function removeDataset(id: DatasetId): void {
  const name = findDataset(id)?.name ?? ''
  commit('dataset.remove', (d) => cascadeRemoval(d as ProjectDoc, { kind: 'dataset', id }), {
    datasetId: id,
    params: { name },
  })
  const sel = ui.get().selection
  if (sel?.datasetId === id) ui.clearSelection()
}

export function renameDataset(id: DatasetId, name: string): void {
  commit(
    'dataset.rename',
    (d) => {
      const ds = d.datasets.find((x) => x.id === id)
      if (ds) ds.name = name
    },
    { datasetId: id, params: { name }, coalesceKey: `dataset.rename:${id}` },
  )
}

export function updateColumn(
  datasetId: DatasetId,
  columnId: ColumnId,
  patch: Partial<Pick<ColumnMeta, 'name' | 'unit' | 'role' | 'uncertaintyOf'>>,
): void {
  const col = findDataset(datasetId)?.columns.find((c) => c.id === columnId)
  commit(
    'column.edit',
    (d) => {
      const c = d.datasets.find((x) => x.id === datasetId)?.columns.find((x) => x.id === columnId)
      if (!c) return
      if (patch.name !== undefined) c.name = patch.name
      if (patch.unit !== undefined) {
        c.unit = patch.unit
        c.unitSource = 'user'
      }
      if (patch.role !== undefined) c.role = patch.role
      if (patch.uncertaintyOf !== undefined) c.uncertaintyOf = patch.uncertaintyOf
    },
    {
      datasetId,
      params: { name: patch.name ?? col?.name ?? '' },
      coalesceKey: `column.edit:${columnId}:${Object.keys(patch).join()}`,
    },
  )
}

export function setColumnParse(
  datasetId: DatasetId,
  columnId: ColumnId,
  override: Partial<ColumnParseSettings>,
): void {
  const col = findDataset(datasetId)?.columns.find((c) => c.id === columnId)
  commit(
    'column.parse',
    (d) => {
      const c = d.datasets.find((x) => x.id === datasetId)?.columns.find((x) => x.id === columnId)
      if (c) c.override = { ...c.override, ...override }
    },
    { datasetId, params: { name: col?.name ?? '' } },
  )
}

export function removeColumn(datasetId: DatasetId, columnId: ColumnId): void {
  const col = findDataset(datasetId)?.columns.find((c) => c.id === columnId)
  commit(
    'column.remove',
    (d) => cascadeRemoval(d as ProjectDoc, { kind: 'column', datasetId, id: columnId }),
    {
      datasetId,
      params: { name: col?.name ?? '' },
    },
  )
}

export function rawTableFor(datasetId: DatasetId) {
  const ds = findDataset(datasetId)
  return ds?.origin === 'import' ? (getRawTables()[ds.rawTableId] ?? null) : null
}
