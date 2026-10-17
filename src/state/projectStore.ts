import './immerSetup'
import { applyPatches, produceWithPatches, type Draft, type Patch } from 'immer'
import { create } from 'zustand'
import {
  newId,
  type DatasetId,
  type OperationKind,
  type OperationLogEntry,
  type PlotId,
  type ProjectDoc,
  type ProjectId,
  type WorkspaceState,
} from '@/domain/model'
import { INITIAL_WORKSPACE, ui } from './uiStore'

/** Runtime-only: patches are never saved (the project file keeps the operation log). */
export interface HistoryEntry extends OperationLogEntry {
  patches: Patch[]
  inverse: Patch[]
  coalesceKey: string | null
  time: number
}

export interface CommitOptions {
  /** Consecutive commits with the same key within COALESCE_MS merge into one undo step (typing, sliders). */
  coalesceKey?: string
  datasetId?: DatasetId | null
  /** The plot the operation acts on: undoing or redoing it brings that plot on screen. */
  plotId?: PlotId | null
  params?: Readonly<Record<string, string | number>>
}

const COALESCE_MS = 600
const HISTORY_LIMIT = 200

export interface ProjectState {
  doc: ProjectDoc
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** Log entries loaded with a project file (before this session). */
  loadedLog: OperationLogEntry[]
  /**
   * This session's operations that left the undo history (it keeps the last HISTORY_LIMIT steps): they
   * can no longer be undone, so they stay in the operation log for good. Append-only.
   */
  settledLog: OperationLogEntry[]
  /** Plot layout loaded with the project; the live workspace is in the UI store (initWorkspace). */
  loadedWorkspace: WorkspaceState | null
  /** Read-only when another tab owns the project (Web Locks). */
  readOnly: boolean
}

export function emptyProject(name = ''): ProjectDoc {
  const now = new Date().toISOString()
  return {
    id: newId<'ProjectId'>('prj') as ProjectId,
    name,
    createdAt: now,
    updatedAt: now,
    datasets: [],
    plots: [],
    activePlotId: null,
    fits: [],
    exclusions: [],
    filters: [],
    numberFormat: { decimal: 'auto' },
  }
}

export const useProjectStore = create<ProjectState>(() => ({
  doc: emptyProject(),
  past: [],
  future: [],
  loadedLog: [],
  settledLog: [],
  loadedWorkspace: null,
  readOnly: false,
}))

const logEntry = ({ id, at, op, label, datasetId, plotId }: HistoryEntry): OperationLogEntry => ({
  id,
  at,
  op,
  label,
  datasetId,
  plotId,
})

/**
 * The single way to change the project document. Records an undoable, labelled operation.
 * Returns false when the recipe changed nothing (no history entry is created).
 */
export function commit(
  op: OperationKind,
  recipe: (draft: Draft<ProjectDoc>) => void,
  opts: CommitOptions = {},
): boolean {
  const state = useProjectStore.getState()
  if (state.readOnly) return false
  const [next, patches, inverse] = produceWithPatches(state.doc, (d) => {
    recipe(d)
    d.updatedAt = new Date().toISOString()
  })
  // Only the timestamp changed → nothing to record.
  if (patches.every((p) => p.path.length === 1 && p.path[0] === 'updatedAt')) return false

  const now = Date.now()
  const last = state.past[state.past.length - 1]
  if (opts.coalesceKey && last && last.coalesceKey === opts.coalesceKey && now - last.time < COALESCE_MS) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...patches],
      // Undo must revert the newest change first.
      inverse: [...inverse, ...last.inverse],
      time: now,
      label: { key: `history.ops.${op}`, params: opts.params },
    }
    useProjectStore.setState({ doc: next, past: [...state.past.slice(0, -1), merged], future: [] })
    return true
  }

  const entry: HistoryEntry = {
    id: newId('op'),
    at: new Date(now).toISOString(),
    op,
    label: { key: `history.ops.${op}`, params: opts.params },
    datasetId: opts.datasetId ?? null,
    plotId: opts.plotId ?? null,
    patches,
    inverse,
    coalesceKey: opts.coalesceKey ?? null,
    time: now,
  }
  const past = [...state.past, entry]
  const settled = past.length > HISTORY_LIMIT ? past.splice(0, past.length - HISTORY_LIMIT) : []
  useProjectStore.setState({
    doc: next,
    past,
    future: [],
    ...(settled.length ? { settledLog: [...state.settledLog, ...settled.map(logEntry)] } : {}),
  })
  return true
}

/** What undo or redo changed must be visible: a plot that is on no pane is brought on screen. */
function reveal(entry: HistoryEntry): void {
  const id = entry.plotId
  if (!id || !useProjectStore.getState().doc.plots.some((p) => p.id === id)) return
  if (!ui.get().workspace.panes.includes(id)) ui.showPlot(id)
}

export function undo(): HistoryEntry | null {
  const s = useProjectStore.getState()
  const entry = s.past[s.past.length - 1]
  if (!entry || s.readOnly) return null
  useProjectStore.setState({
    doc: applyPatches(s.doc, entry.inverse),
    past: s.past.slice(0, -1),
    future: [...s.future, entry],
  })
  reveal(entry)
  return entry
}

export function redo(): HistoryEntry | null {
  const s = useProjectStore.getState()
  const entry = s.future[s.future.length - 1]
  if (!entry || s.readOnly) return null
  useProjectStore.setState({
    doc: applyPatches(s.doc, entry.patches),
    past: [...s.past, entry],
    future: s.future.slice(0, -1),
  })
  reveal(entry)
  return entry
}

/**
 * Replace the whole project (open file, restore from storage, new project). Clears undo history and the
 * previous project's panes; the caller then lays out the new one with initWorkspace (workspace.ts).
 */
export function loadProject(
  doc: ProjectDoc,
  log: OperationLogEntry[] = [],
  readOnly = false,
  workspace: WorkspaceState | null = null,
): void {
  ui.set({ workspace: INITIAL_WORKSPACE })
  useProjectStore.setState({
    doc,
    past: [],
    future: [],
    loadedLog: log,
    settledLog: [],
    loadedWorkspace: workspace,
    readOnly,
  })
}

/**
 * Effective operation log: loaded entries, then every operation of this session that is still in effect
 * (the ones beyond the undo limit included; undone ones are not).
 */
export function operationLog(s: ProjectState = useProjectStore.getState()): OperationLogEntry[] {
  return [...s.loadedLog, ...s.settledLog, ...s.past.map(logEntry)]
}

export function setReadOnly(readOnly: boolean): void {
  useProjectStore.setState({ readOnly })
}
