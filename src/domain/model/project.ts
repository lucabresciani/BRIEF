import type { Dataset } from './dataset'
import type { Exclusion, Filter } from './filter'
import type { FitSpec } from './fit'
import type { OperationLogEntry } from './history'
import type { PlotId, ProjectId } from './ids'
import type { PlotSpec } from './plot'
import type { RawSource } from './raw'

export interface ProjectDoc {
  id: ProjectId
  name: string
  createdAt: string
  updatedAt: string
  datasets: Dataset[]
  /** Each plot has its own type, series, fits and style; datasets, exclusions and filters are shared. */
  plots: PlotSpec[]
  activePlotId: PlotId | null
  /** At most one fit per series. */
  fits: FitSpec[]
  exclusions: Exclusion[]
  filters: Filter[]
  /** Display of numbers: 'auto' follows the UI language. */
  numberFormat: { decimal: 'auto' | 'dot' | 'comma' }
}

/** 1 = one plot per project; 2 = several plots, split series, fit styles, sheet regions. */
export const SCHEMA_VERSION = 2 as const

/**
 * Which plots are on screen and how they are laid out. A view preference, not analysis: it is stored
 * NEXT TO the document (top level of the .sciplot file, IndexedDB record), never inside ProjectDoc,
 * so it is not part of undo. `panes` holds one plot id (or null = empty pane) per visible pane.
 */
export interface WorkspaceState {
  layout: 'single' | 'columns' | 'grid'
  panes: (PlotId | null)[]
  /** Index into `panes` of the pane being edited. */
  focused: number
}

/** On-disk JSON of a RawTable (typed arrays → arrays, NaN → explicit null). */
export interface RawTableJSON {
  id: string
  source: RawSource
  rowCount: number
  sourceRow: number[]
  columns: { text: string[]; native: { kind: number[]; num: (number | null)[] } | null }[]
  tokenIssues: unknown[]
}

/** The .sciplot file (UTF-8 JSON). Version 1 files are migrated on open (src/domain/project/migrate.ts). */
export interface ProjectFile {
  format: 'sciplot'
  schemaVersion: typeof SCHEMA_VERSION
  appVersion: string
  savedAt: string
  project: ProjectDoc
  /** Only the raw tables referenced by the project. */
  rawTables: RawTableJSON[]
  /** Effective operations (undone ones are removed); patches are never saved. */
  operationLog: OperationLogEntry[]
  /** Absent in v1 files and when nothing was laid out yet. */
  workspace?: WorkspaceState
}
