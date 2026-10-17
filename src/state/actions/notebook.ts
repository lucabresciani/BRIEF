import type { Draft } from 'immer'
import { defaultPlotSpec } from '@/domain/recommend/recommend'
import {
  DEFAULT_SERIES_STYLE,
  NO_UNCERTAINTY,
  newId,
  type ColumnId,
  type ColumnMeta,
  type Dataset,
  type DatasetId,
  type DecimalMode,
  type NotebookDataset,
  type PlotId,
  type PlotSpec,
  type RowId,
  type SeriesId,
} from '@/domain/model'
import { commit, useProjectStore } from '../projectStore'
import { ui } from '../uiStore'
import { getActivePlotId } from '../workspace'
import { isEmptyPlot, plotDraft } from './helpers'

const START_ROWS = 3

/**
 * Lab notebook: a small editable table whose columns are declared numeric at creation. Typed text is
 * stored as-is (undoable); invalid cells are flagged and left out of the analysis, never coerced.
 */
export function createNotebook(
  name: string,
  columns: { name: string; unit: string | null }[],
  decimal: DecimalMode,
): DatasetId {
  const id = newId<'DatasetId'>('ds') as DatasetId
  const metas: ColumnMeta[] = columns.map((c) => ({
    id: newId<'ColumnId'>('col') as ColumnId,
    source: { type: 'notebook' },
    name: c.name,
    unit: c.unit,
    unitSource: c.unit ? 'user' : null,
    role: 'measurement',
    uncertaintyOf: null,
    detected: { kind: 'numeric', decimal, percent: 'display', confidence: 'high', explanations: [] },
    override: {},
  }))
  const rowIds = Array.from({ length: START_ROWS }, (_, i) => i as RowId)
  const dataset: NotebookDataset = {
    id,
    name,
    createdAt: new Date().toISOString(),
    example: null,
    columns: metas,
    notes: [],
    origin: 'notebook',
    rowIds,
    cells: Object.fromEntries(metas.map((m) => [m.id, rowIds.map(() => '')])),
    nextRowId: START_ROWS,
  }
  // Same rule as an import: an empty active plot is filled in place, else the notebook gets its own tab.
  const activeId = getActivePlotId()
  const active = useProjectStore.getState().doc.plots.find((p) => p.id === activeId)
  const plotted = metas.length >= 2
  const target = plotted
    ? active && isEmptyPlot(active)
      ? active.id
      : (newId<'PlotId'>('plot') as PlotId)
    : null
  const ok = commit(
    'notebook.create',
    (d) => {
      d.datasets.push(dataset as Draft<Dataset>)
      if (!target) return
      const plot = defaultPlotSpec(target)
      plot.series = [
        {
          id: newId<'SeriesId'>('ser') as SeriesId,
          datasetId: id,
          name: null,
          x: metas[0].id,
          y: metas[1].id,
          visible: true,
          style: { ...DEFAULT_SERIES_STYLE },
          errorBars: { x: NO_UNCERTAINTY, y: NO_UNCERTAINTY, visible: true },
          split: null,
        },
      ]
      const current = plotDraft(d, target)
      if (current) Object.assign(current, { ...plot, name: current.name })
      else d.plots.push({ ...plot, name: d.plots.length ? name : '' } as Draft<PlotSpec>)
    },
    { datasetId: id, plotId: target, params: { name } },
  )
  if (ok && target) ui.showPlot(target)
  return id
}

function notebook(d: { datasets: unknown[] }, id: DatasetId) {
  const ds = (d.datasets as NotebookDataset[]).find((x) => x.id === id)
  return ds && ds.origin === 'notebook' ? ds : undefined
}

export function setNotebookCell(datasetId: DatasetId, rowId: RowId, columnId: ColumnId, text: string): void {
  commit(
    'notebook.edit',
    (d) => {
      const nb = notebook(d, datasetId)
      if (!nb) return
      const i = nb.rowIds.indexOf(rowId)
      const col = nb.cells[columnId]
      if (i < 0 || !col) return
      col[i] = text
    },
    { datasetId, coalesceKey: `nb:${datasetId}:${rowId}:${columnId}` },
  )
}

export function addNotebookRows(datasetId: DatasetId, count = 1): RowId[] {
  const added: RowId[] = []
  commit(
    'notebook.rows',
    (d) => {
      const nb = notebook(d, datasetId)
      if (!nb) return
      for (let k = 0; k < count; k++) {
        const rid = nb.nextRowId++ as RowId
        nb.rowIds.push(rid)
        for (const c of nb.columns) (nb.cells[c.id] ??= []).push('')
        added.push(rid)
      }
    },
    { datasetId },
  )
  return added
}

export function removeNotebookRow(datasetId: DatasetId, rowId: RowId): void {
  commit(
    'notebook.rows',
    (d) => {
      const nb = notebook(d, datasetId)
      if (!nb) return
      const i = nb.rowIds.indexOf(rowId)
      if (i < 0) return
      nb.rowIds.splice(i, 1)
      for (const c of nb.columns) nb.cells[c.id]?.splice(i, 1)
      // Exclusions that pointed at the removed row are cleaned up as well.
      for (const e of (d as { exclusions: { datasetId: DatasetId; rowIds: RowId[] }[] }).exclusions)
        if (e.datasetId === datasetId) e.rowIds = e.rowIds.filter((r) => r !== rowId)
    },
    { datasetId },
  )
}

/** Paste a block of cells (from the clipboard) starting at a cell; adds rows as needed. */
export function pasteNotebookBlock(
  datasetId: DatasetId,
  startRowIndex: number,
  startColIndex: number,
  grid: string[][],
): void {
  commit(
    'notebook.edit',
    (d) => {
      const nb = notebook(d, datasetId)
      if (!nb) return
      const cols = nb.columns.slice(startColIndex)
      for (let r = 0; r < grid.length; r++) {
        const target = startRowIndex + r
        while (nb.rowIds.length <= target) {
          nb.rowIds.push(nb.nextRowId++ as RowId)
          for (const c of nb.columns) (nb.cells[c.id] ??= []).push('')
        }
        for (let c = 0; c < Math.min(cols.length, grid[r].length); c++)
          nb.cells[cols[c].id][target] = grid[r][c].trim()
      }
    },
    { datasetId },
  )
}
