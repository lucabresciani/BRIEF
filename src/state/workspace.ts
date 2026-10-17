import type { PlotId, ProjectDoc, WorkspaceState } from '@/domain/model'
import { useProjectStore } from './projectStore'
import { fitPanes, PANE_COUNT, ui, useUiStore, type Layout } from './uiStore'

/**
 * The workspace (which plots are on screen) lives in the UI store, next to the document and outside
 * undo. These functions keep it consistent with the document's plots.
 */

const isLayout = (v: unknown): v is Layout => typeof v === 'string' && Object.hasOwn(PANE_COUNT, v)

/**
 * A workspace that fits the plots `plotIds` (document order). Total: a stored workspace is never
 * validated (IndexedDB records), so anything malformed falls back to the single layout.
 * - plots no longer in the document leave their pane empty, and a plot appears in one pane only (the
 *   focused pane keeps its plot, else the first pane showing it);
 * - the panes are cut or padded to the layout, keeping the focused plot on screen;
 * - an empty focused pane shows `preferred` (or moves to the pane that shows it), then every empty
 *   pane takes the next plot not on screen;
 * - the focus never rests on an empty pane while another pane shows a plot.
 */
export function reconcileWorkspace(
  ws: WorkspaceState | null | undefined,
  plotIds: readonly PlotId[],
  preferred?: PlotId | null,
): WorkspaceState {
  const known = new Set(plotIds)
  const layout = isLayout(ws?.layout) ? ws.layout : 'single'
  const stored: unknown[] = Array.isArray(ws?.panes) ? ws.panes : []
  const panes = stored.map((p) => (typeof p === 'string' && known.has(p as PlotId) ? (p as PlotId) : null))
  const raw = ws?.focused
  let focused = typeof raw === 'number' && Number.isInteger(raw) ? raw : 0
  focused = Math.min(Math.max(focused, 0), Math.max(panes.length - 1, 0))

  const seen = new Set<PlotId>()
  for (const i of [focused, ...panes.keys()]) {
    const p = panes[i]
    if (!p) continue
    if (seen.has(p) && i !== focused) panes[i] = null
    seen.add(p)
  }

  const fitted = fitPanes(panes, focused, PANE_COUNT[layout])
  const out = fitted.panes
  focused = fitted.focused
  if (out[focused] === null && preferred && known.has(preferred)) {
    const at = out.indexOf(preferred)
    if (at >= 0) focused = at
    else out[focused] = preferred
  }
  const rest = [...new Set(plotIds)].filter((id) => !out.includes(id))
  for (let i = 0; i < out.length && rest.length; i++) if (out[i] === null) out[i] = rest.shift()!
  if (out[focused] === null) {
    const first = out.findIndex((p) => p !== null)
    if (first >= 0) focused = first
  }
  return { layout, panes: out, focused }
}

export const sameWorkspace = (a: WorkspaceState, b: WorkspaceState) =>
  a.layout === b.layout &&
  a.focused === b.focused &&
  a.panes.length === b.panes.length &&
  a.panes.every((p, i) => p === b.panes[i])

/**
 * The active plot: the plot of the focused pane. When the workspace does not describe this document
 * (not initialised yet, or tests that load a project directly) the document's own activePlotId, else
 * its first plot. null only when there is no plot.
 */
export function resolveActivePlot(
  doc: Pick<ProjectDoc, 'plots' | 'activePlotId'>,
  ws: WorkspaceState,
): PlotId | null {
  const has = (id: PlotId | null | undefined): id is PlotId => !!id && doc.plots.some((p) => p.id === id)
  const focused = ws.panes[ws.focused]
  if (has(focused)) return focused
  if (has(doc.activePlotId)) return doc.activePlotId
  return doc.plots[0]?.id ?? null
}

/** Outside React. */
export function getActivePlotId(): PlotId | null {
  return resolveActivePlot(useProjectStore.getState().doc, ui.get().workspace)
}

export function useActivePlotId(): PlotId | null {
  const ws = useUiStore((s) => s.workspace)
  return useProjectStore((s) => resolveActivePlot(s.doc, ws))
}

function setWorkspace(next: WorkspaceState): void {
  if (!sameWorkspace(ui.get().workspace, next)) ui.set({ workspace: next })
}

/**
 * After a project is loaded: its stored workspace (or a single pane on its activePlotId), reconciled
 * with its plots. Call it after every load (restore, open file, open stored project, new project, open
 * as a copy).
 */
export function initWorkspace(doc: ProjectDoc, stored?: WorkspaceState | null): void {
  const ids = doc.plots.map((p) => p.id)
  const base = stored ?? { layout: 'single', panes: [doc.activePlotId], focused: 0 }
  setWorkspace(reconcileWorkspace(base, ids, doc.activePlotId))
}

/** The plot that takes the place of a deleted one: the next plot, else the previous one. */
function neighbour(gone: PlotId, before: readonly PlotId[], after: ReadonlySet<PlotId>): PlotId | null {
  const i = before.indexOf(gone)
  if (i < 0) return null
  for (let k = i + 1; k < before.length; k++) if (after.has(before[k])) return before[k]
  for (let k = i - 1; k >= 0; k--) if (after.has(before[k])) return before[k]
  return null
}

/**
 * Reconciles the workspace with the current plots. `before` (the plot ids before the change) lets the
 * neighbour of a deleted focused plot take its pane, as closing a tab selects the next one.
 */
export function syncWorkspace(before?: readonly PlotId[]): void {
  const ids = useProjectStore.getState().doc.plots.map((p) => p.id)
  const ws = ui.get().workspace
  const focused = ws.panes[ws.focused]
  const preferred =
    focused && before && !ids.includes(focused) ? neighbour(focused, before, new Set(ids)) : null
  setWorkspace(reconcileWorkspace(ws, ids, preferred))
}

/** The document and workspace as they are saved: the active plot is written into the document only here. */
export function projectForSave(doc: ProjectDoc): { doc: ProjectDoc; workspace: WorkspaceState } {
  const workspace = reconcileWorkspace(
    ui.get().workspace,
    doc.plots.map((p) => p.id),
    doc.activePlotId,
  )
  const active = resolveActivePlot(doc, workspace)
  return { doc: active === doc.activePlotId ? doc : { ...doc, activePlotId: active }, workspace }
}

let stopSync: (() => void) | null = null

/**
 * Keeps the workspace consistent for the life of the page: a new project id initialises it from the
 * stored workspace, a change of the plots (an edit, undo, redo) or of the workspace itself (a larger
 * layout) reconciles it. Idempotent; returns the function that stops it (tests).
 */
export function startWorkspaceSync(): () => void {
  if (stopSync) return stopSync
  const offProject = useProjectStore.subscribe((s, prev) => {
    if (s.doc.id !== prev.doc.id) initWorkspace(s.doc, s.loadedWorkspace)
    else if (s.doc.plots !== prev.doc.plots) syncWorkspace(prev.doc.plots.map((p) => p.id))
  })
  const offUi = useUiStore.subscribe((s, prev) => {
    if (s.workspace !== prev.workspace) syncWorkspace()
  })
  stopSync = () => {
    offProject()
    offUi()
    stopSync = null
  }
  return stopSync
}
