/**
 * The analysis mask (sample level 1 of pipeline.ts): why each row of a DatasetView is or is not analysed.
 * ONLY analysis reasons: axis scale, plot type, visibility, style, selection and fit domain never enter
 * here. Precedence (first applicable reason, counted once): missing > invalid > excluded > filtered, so
 * nActive + Σ counts = nTotal (blank rows are already outside the view).
 */
import { INACTIVE } from '@/domain/model'
import type { ColumnId, Exclusion, Filter, InactiveReason } from '@/domain/model'
import { CELL, isMissingStatus } from './types'
import type { AnalysisSample, DatasetView, ParsedColumn } from './types'

/** True when row i of `col` passes the filter; a missing / unreadable value never passes. */
function passes(filter: Filter, col: ParsedColumn | undefined, i: number): boolean {
  if (!col || col.status[i] !== CELL.ok) return false
  if (filter.type === 'range') {
    const v = col.values[i]
    if (!Number.isFinite(v)) return false
    if (filter.min !== null && v < filter.min) return false
    if (filter.max !== null && v > filter.max) return false
    return true
  }
  const label = col.categories
    ? col.categories.codes[i] >= 0
      ? col.categories.labels[col.categories.codes[i]]
      : null
    : col.text[i]?.trim()
  return label !== null && label !== undefined && filter.keep.includes(label)
}

/**
 * Sample over `columns` (all must be usable for a row to be active). A column absent from the view
 * counts as missing on every row. Only exclusions and ENABLED filters of this dataset apply.
 */
export function analysisSample(
  view: DatasetView,
  columns: readonly ColumnId[],
  exclusions: readonly Exclusion[],
  filters: readonly Filter[],
): AnalysisSample {
  const n = view.rowIds.length
  const reason = new Uint8Array(n)
  const cols = columns.map((id) => view.columns.get(id))

  const excluded = new Set<number>()
  for (const e of exclusions) if (e.datasetId === view.datasetId) for (const r of e.rowIds) excluded.add(r)
  const active = filters.filter((f) => f.enabled && f.datasetId === view.datasetId)
  const filterCols = active.map((f) => view.columns.get(f.column))

  const counts: Record<InactiveReason, number> = { missing: 0, invalid: 0, excluded: 0, filtered: 0 }
  for (let i = 0; i < n; i++) {
    let missing = false
    let invalid = false
    for (const c of cols) {
      if (!c) {
        missing = true
        break
      }
      const s = c.status[i]
      if (isMissingStatus(s)) {
        missing = true
        break
      }
      if (s !== CELL.ok) invalid = true
    }
    if (missing) {
      reason[i] = INACTIVE.missing
      counts.missing++
    } else if (invalid) {
      reason[i] = INACTIVE.invalid
      counts.invalid++
    } else if (excluded.has(view.rowIds[i])) {
      reason[i] = INACTIVE.excluded
      counts.excluded++
    } else if (active.some((f, k) => !passes(f, filterCols[k], i))) {
      reason[i] = INACTIVE.filtered
      counts.filtered++
    }
  }
  const nActive = n - counts.missing - counts.invalid - counts.excluded - counts.filtered
  return { rowIds: view.rowIds, reason, nTotal: n, nActive, counts }
}
