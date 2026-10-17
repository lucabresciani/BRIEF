/**
 * Translation between Plotly points (trace uid + point index) and RowIds, in both directions: plot →
 * table (box/lasso selection, click, hover) and table → plot (selectedpoints, hover).
 * A point is normally one row (customdata[0] = RowId); histogram bins, group means and mean bars stand
 * for SEVERAL rows ("members"). RowIds are unique only within a dataset, so the map also records the
 * dataset of each trace: a selection (always within one dataset) never highlights another dataset.
 */
import type { Selection, SelectionMap } from '@/domain/derive/types'
import type { DatasetId } from '@/domain/model'

export interface SelectionTrace {
  uid: string
  /** One RowId per point index; −1 for a point that is not a row (a line break) or stands for several. */
  rowIds: ArrayLike<number>
  /** Rows behind each point, for points that stand for several rows (bins, group means, mean bars). */
  members?: readonly (readonly number[])[]
  datasetId?: DatasetId | null
}

/** SelectionMap plus the multi-row points and the dataset of each trace (structurally a SelectionMap). */
export interface FigureSelectionMap extends SelectionMap {
  members: ReadonlyMap<string, readonly (readonly number[])[]>
  datasetOf: ReadonlyMap<string, DatasetId>
}

export function buildSelectionMap(traces: readonly SelectionTrace[]): FigureSelectionMap {
  const byTrace = new Map<string, Int32Array>()
  const byRow = new Map<number, { uid: string; pointIndex: number }[]>()
  const members = new Map<string, readonly (readonly number[])[]>()
  const datasetOf = new Map<string, DatasetId>()
  const link = (row: number, uid: string, pointIndex: number) => {
    if (!(Number.isInteger(row) && row >= 0)) return
    let list = byRow.get(row)
    if (!list) {
      list = []
      byRow.set(row, list)
    }
    list.push({ uid, pointIndex })
  }
  for (const t of traces) {
    byTrace.set(t.uid, Int32Array.from(t.rowIds))
    if (t.datasetId) datasetOf.set(t.uid, t.datasetId)
    if (t.members) {
      members.set(t.uid, t.members)
      t.members.forEach((rows, j) => {
        for (const r of rows) link(r, t.uid, j)
      })
    } else {
      for (let j = 0; j < t.rowIds.length; j++) link(t.rowIds[j], t.uid, j)
    }
  }
  return { byTrace, byRow, members, datasetOf }
}

const isRowId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

function membersOf(map: SelectionMap): ReadonlyMap<string, readonly (readonly number[])[]> | null {
  const m = (map as Partial<FigureSelectionMap>).members
  return m instanceof Map ? m : null
}

/**
 * RowIds of Plotly event points (selection, click, hover), without duplicates, in event order.
 * Multi-row points (bins, group means) give all their member rows; otherwise customdata[0] is the
 * RowId, with the map as fallback (pointIndex, else pointNumber). Points that are not rows are ignored.
 */
export function rowsFromPlotlyPoints(
  points: readonly {
    data?: { uid?: string }
    pointIndex?: number
    pointNumber?: number
    customdata?: unknown
  }[],
  map: SelectionMap,
): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  const add = (r: number) => {
    if (isRowId(r) && !seen.has(r)) {
      seen.add(r)
      out.push(r)
    }
  }
  const multi = membersOf(map)
  for (const p of points) {
    const uid = p.data?.uid
    const idx = typeof p.pointIndex === 'number' ? p.pointIndex : p.pointNumber
    const group = uid !== undefined && typeof idx === 'number' ? multi?.get(uid)?.[idx] : undefined
    if (group) {
      for (const r of group) add(r)
      continue
    }
    const cd = p.customdata
    if (Array.isArray(cd) && isRowId(cd[0])) {
      add(cd[0])
      continue
    }
    if (isRowId(cd)) {
      add(cd)
      continue
    }
    if (uid !== undefined && typeof idx === 'number') {
      const rows = map.byTrace.get(uid)
      if (rows && idx >= 0 && idx < rows.length) add(rows[idx])
    }
  }
  return out
}

/**
 * Plotly `selectedpoints` for one trace: null when there is no selection (NEVER [] — that would dim
 * every point), or when the trace is not part of the map or belongs to another dataset; otherwise the
 * indices of the trace's points whose row (or any member row) is selected — possibly [] (all dimmed).
 */
export function selectedIndicesForTrace(
  uid: string,
  selection: Selection | null,
  map: SelectionMap,
): number[] | null {
  if (!selection) return null
  const rows = map.byTrace.get(uid)
  if (!rows) return null
  const ds = (map as Partial<FigureSelectionMap>).datasetOf?.get(uid)
  if (ds !== undefined && ds !== selection.datasetId) return null
  const out: number[] = []
  const group = membersOf(map)?.get(uid)
  if (group) {
    group.forEach((m, j) => {
      if (m.some((r) => selection.rowIds.has(r))) out.push(j)
    })
    return out
  }
  for (let j = 0; j < rows.length; j++) if (rows[j] >= 0 && selection.rowIds.has(rows[j])) out.push(j)
  return out
}
