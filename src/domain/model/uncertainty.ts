import type { ColumnId } from './ids'

/**
 * What an error bar represents. These quantities answer different questions and are never
 * interchangeable:
 * - measurement: instrumental or user-provided uncertainty of each observation;
 * - sd:  spread of replicate observations (sample SD, n − 1);
 * - sem: uncertainty of a group mean (SD/√n);
 * - ci:  confidence interval of a group mean (t-based, stated level).
 * Uncertainty is never inferred from the number of decimals.
 */
export type ConfidenceLevel = 0.9 | 0.95 | 0.99

/** For measurement uncertainty: standard (k = 1), expanded U = k·u, or not stated by the user. */
export type MeasurementMeaning =
  { type: 'standard' } | { type: 'expanded'; k: number } | { type: 'unspecified' }

export type MeasurementSource =
  | { type: 'absolute'; value: number } // same unit as the column, ≥ 0
  | { type: 'percent'; percent: number } // |v|·p/100
  | { type: 'column'; column: ColumnId } // same dataset; raw/notebook columns only
  | { type: 'columnAsymmetric'; plus: ColumnId; minus: ColumnId }

export type ReplicateGrouping = { by: 'sameX' } | { by: 'column'; column: ColumnId }

export type UncertaintySpec =
  | { kind: 'none' }
  | {
      kind: 'measurement'
      origin: 'instrument' | 'user'
      source: MeasurementSource
      meaning: MeasurementMeaning
    }
  | { kind: 'sd'; grouping: ReplicateGrouping }
  | { kind: 'sem'; grouping: ReplicateGrouping }
  | { kind: 'ci'; grouping: ReplicateGrouping; level: ConfidenceLevel; method: 't' }

/** Replicate statistics only make sense on the response axis. */
export type XUncertaintySpec = Extract<UncertaintySpec, { kind: 'none' | 'measurement' }>

export type GroupSpreadSpec =
  { kind: 'none' } | { kind: 'sd' } | { kind: 'sem' } | { kind: 'ci'; level: ConfidenceLevel; method: 't' }

export const NO_UNCERTAINTY: { kind: 'none' } = { kind: 'none' }
