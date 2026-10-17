import type { ColumnId, DatasetId, RawTableId, RowId } from './ids'
import type { Issue } from './issues'

export type ColumnKind = 'numeric' | 'categorical' | 'datetime' | 'text'
/** How decimal separators are read. In 'mixed', ambiguous tokens such as "1,234" are invalid. */
export type DecimalMode = 'dot' | 'comma' | 'mixed'
/** Spreadsheet percent cells: 'display' = 12 (as shown, "12 %"), 'fraction' = 0.12 (stored value). */
export type PercentMode = 'display' | 'fraction'
export type ColumnRole = 'measurement' | 'uncertainty' | 'group' | 'identifier' | 'ignore'

export interface ColumnParseSettings {
  kind: ColumnKind
  decimal: DecimalMode
  percent: PercentMode
}

export interface ColumnDetection extends ColumnParseSettings {
  confidence: 'high' | 'low'
  /** Why the column was read this way ("read with '.' as decimal because …"). */
  explanations: readonly Issue[]
}

/** Derived columns (non-destructive transformations). Inputs are other columns of the same dataset. */
export type TransformSpec =
  | { op: 'ln' | 'log10' | 'sqrt' | 'reciprocal' | 'square'; input: ColumnId }
  | { op: 'affine'; input: ColumnId; a: number; b: number } // a·x + b
  | { op: 'difference' | 'ratio' | 'product'; left: ColumnId; right: ColumnId }

export type ColumnSource =
  { type: 'raw'; index: number } | { type: 'notebook' } | { type: 'derived'; spec: TransformSpec }

export interface ColumnMeta {
  id: ColumnId
  source: ColumnSource
  name: string
  unit: string | null
  unitSource: 'header' | 'unitsRow' | 'cells' | 'user' | null
  role: ColumnRole
  /** Suggestion only (e.g. "u(y)" → uncertainty of y); never applied automatically. */
  uncertaintyOf: ColumnId | null
  /** Snapshot of what the importer detected (explainability). */
  detected: ColumnDetection
  /** User corrections; effective settings = { ...detected, ...override }. */
  override: Partial<ColumnParseSettings>
}

export interface DatasetLayout {
  /** Grid row used as header (null = no header, generated names). */
  headerRow: number | null
  /** Grid row holding units (null = none). */
  unitsRow: number | null
  /** First and last grid rows (inclusive) holding data. */
  dataStartRow: number
  dataEndRow: number
}

export type ExampleId = 'free-fall' | 'ohm' | 'cooling' | 'beer-lambert' | 'pendulum'

interface DatasetBase {
  id: DatasetId
  name: string
  createdAt: string
  example: { id: ExampleId } | null
  columns: ColumnMeta[]
  /** Notes kept from the file (preamble lines). */
  notes: string[]
}

export interface ImportedDataset extends DatasetBase {
  origin: 'import'
  rawTableId: RawTableId
  layout: DatasetLayout
}

export interface NotebookDataset extends DatasetBase {
  origin: 'notebook'
  rowIds: RowId[]
  /** Typed text, aligned with rowIds; editable with undo. Keyed by column id. */
  cells: Record<string, string[]>
  nextRowId: number
}

export type Dataset = ImportedDataset | NotebookDataset

export function effectiveSettings(c: ColumnMeta): ColumnParseSettings {
  return {
    kind: c.override.kind ?? c.detected.kind,
    decimal: c.override.decimal ?? c.detected.decimal,
    percent: c.override.percent ?? c.detected.percent,
  }
}
