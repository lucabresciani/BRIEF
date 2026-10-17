import type { ColumnId, DatasetId, ExclusionId, FilterId, RowId } from './ids'

export type ExclusionReason = 'outlier-candidate' | 'measurement-problem' | 'out-of-scope' | 'other'

/**
 * Non-destructive exclusion of observations from the analysis. Applies to the whole dataset
 * (all its series); the confirmation text states this. Reason 'outlier-candidate' requires a note.
 */
export interface Exclusion {
  id: ExclusionId
  datasetId: DatasetId
  rowIds: RowId[]
  reason: ExclusionReason
  note: string
  createdAt: string
}

/** Filters keep only matching rows; bounds are INCLUSIVE [min, max]. */
export type Filter =
  | {
      id: FilterId
      datasetId: DatasetId
      enabled: boolean
      type: 'range'
      column: ColumnId
      min: number | null
      max: number | null
    }
  | {
      id: FilterId
      datasetId: DatasetId
      enabled: boolean
      type: 'category'
      column: ColumnId
      keep: string[]
    }

/**
 * Why a row is not in the analysed sample. ONLY analysis reasons: a log axis or a fit domain are
 * never reasons to drop a row from the sample. Precedence = numeric order.
 */
export const INACTIVE = { active: 0, missing: 1, invalid: 2, excluded: 3, filtered: 4 } as const
export type InactiveReason = Exclude<keyof typeof INACTIVE, 'active'>
