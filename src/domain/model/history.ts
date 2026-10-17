import type { DatasetId, PlotId } from './ids'

export type OperationKind =
  | 'dataset.import'
  | 'dataset.remove'
  | 'dataset.rename'
  | 'dataset.layout'
  | 'column.edit'
  | 'column.parse'
  | 'column.derive'
  | 'column.remove'
  | 'plot.create'
  | 'plot.remove'
  | 'plot.rename'
  | 'plot.duplicate'
  | 'plot.reorder'
  | 'plot.type'
  | 'plot.axis'
  | 'plot.style'
  | 'plot.options'
  | 'plot.viewToLimits'
  | 'series.map'
  | 'series.add'
  | 'series.remove'
  | 'series.visibility'
  | 'series.split'
  | 'fit.add'
  | 'fit.edit'
  | 'fit.remove'
  | 'uncertainty.set'
  | 'exclusion.add'
  | 'exclusion.remove'
  | 'filter.set'
  | 'notebook.create'
  | 'notebook.edit'
  | 'notebook.rows'
  | 'project.rename'
  | 'project.settings'

/** Transparent record of the operations applied, shown in the history and saved with the project. Labels are i18n keys. */
export interface OperationLogEntry {
  id: string
  at: string
  op: OperationKind
  label: { key: string; params?: Readonly<Record<string, string | number>> }
  datasetId: DatasetId | null
  /** The plot the operation acted on; null for project-wide operations and v1 entries. */
  plotId: PlotId | null
}
