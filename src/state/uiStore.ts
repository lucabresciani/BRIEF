import { create } from 'zustand'
import type { DatasetId, Issue, PlotId, RowId, WorkspaceState } from '@/domain/model'
import type { Selection } from '@/domain/derive/types'
import { readPreference, writePreference } from '@/platform/preferences'

export type Level = 'beginner' | 'intermediate' | 'advanced'
export type InspectorTab = 'plot' | 'fit' | 'uncertainty' | 'statistics' | 'style'
export type DragMode = 'zoom' | 'pan' | 'select' | 'lasso'
export type DialogName =
  | 'paste'
  | 'examples'
  | 'import'
  | 'sheetPicker'
  | 'notebook'
  | 'export'
  | 'exclusion'
  | 'settings'
  | 'derived'
  | 'projects'
  | null
/** ok = storage available, nothing written yet; pending = a change waits for autosave; saved = written. */
export type StorageStatus =
  'unknown' | 'ok' | 'pending' | 'saving' | 'saved' | 'unavailable' | 'quota' | 'retry'

/** Current zoom of the plot in data units (log axes already converted back to linear values). */
export interface ViewState {
  x: readonly [number, number] | null
  y: readonly [number, number] | null
}

/** A zoom as Plotly reported it, with the layout uirevision it belongs to (a new revision autoscales). */
export type RecordedView = ViewState & { rev: string }

export type Layout = WorkspaceState['layout']
export const PANE_COUNT: Readonly<Record<Layout, number>> = { single: 1, columns: 2, grid: 4 }
export const INITIAL_WORKSPACE: WorkspaceState = { layout: 'single', panes: [null], focused: 0 }

/**
 * `panes` cut or padded (with empty panes) to `count`. A shrinking layout keeps the focused plot on
 * screen: it takes the last remaining pane when its own pane goes.
 */
export function fitPanes(
  panes: readonly (PlotId | null)[],
  focused: number,
  count: number,
): { panes: (PlotId | null)[]; focused: number } {
  if (panes.length <= count) {
    const out = [...panes]
    while (out.length < count) out.push(null)
    return { panes: out, focused: Math.min(Math.max(focused, 0), count - 1) }
  }
  if (focused < count) return { panes: panes.slice(0, count), focused: Math.max(focused, 0) }
  return { panes: [...panes.slice(0, count - 1), panes[focused]], focused: count - 1 }
}

interface UiState {
  selection: Selection | null
  hoverRow: { datasetId: DatasetId; rowId: RowId; origin: 'plot' | 'table' } | null
  dragmode: DragMode
  /**
   * Which plots are on screen. The plot of the focused pane is the active plot: the toolbar and the
   * inspector edit it. Switching it is a view change, never an edit of the document (no undo step).
   */
  workspace: WorkspaceState
  /** Zoom of each plot, kept while its tab is hidden. */
  views: Readonly<Record<PlotId, RecordedView>>
  /** Incremented by "Reset view" of each plot: part of its axis uirevisions. */
  viewResets: Readonly<Record<PlotId, number>>
  inspectorTab: InspectorTab
  tableOpen: boolean
  helpOpen: boolean
  historyOpen: boolean
  dialog: DialogName
  level: Level
  hints: boolean
  storage: StorageStatus
  /** Banner after a fast-path import: "Imported X: n notes · Review". */
  importNotice: { datasetId: DatasetId; name: string; issues: Issue[] } | null
  dismissedRecommendations: readonly string[]
  walkthrough: { id: 'ohm' | 'freeFall'; step: number } | null
  /** Mobile/tablet section shown when the workspace collapses. */
  mobileSection: 'data' | 'plot' | 'analysis' | 'table'
}

const PREFS_KEY = 'brief.prefs'
const FORMER_PREFS_KEY = 'sde.prefs'

function loadPrefs(): Partial<Pick<UiState, 'level' | 'hints' | 'tableOpen'>> {
  try {
    const raw = readPreference(PREFS_KEY, FORMER_PREFS_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<Pick<UiState, 'level' | 'hints' | 'tableOpen'>> = {}
    if (p.level === 'beginner' || p.level === 'intermediate' || p.level === 'advanced') out.level = p.level
    if (typeof p.hints === 'boolean') out.hints = p.hints
    if (typeof p.tableOpen === 'boolean') out.tableOpen = p.tableOpen
    return out
  } catch {
    return {}
  }
}

export const useUiStore = create<UiState>(() => ({
  selection: null,
  hoverRow: null,
  dragmode: 'zoom',
  workspace: INITIAL_WORKSPACE,
  views: {},
  viewResets: {},
  inspectorTab: 'plot',
  tableOpen: true,
  helpOpen: false,
  historyOpen: false,
  dialog: null,
  level: 'intermediate',
  hints: true,
  storage: 'unknown',
  importNotice: null,
  dismissedRecommendations: [],
  walkthrough: null,
  mobileSection: 'plot',
  ...loadPrefs(),
}))

useUiStore.subscribe((s, prev) => {
  if (s.level === prev.level && s.hints === prev.hints && s.tableOpen === prev.tableOpen) return
  writePreference(PREFS_KEY, JSON.stringify({ level: s.level, hints: s.hints, tableOpen: s.tableOpen }))
})

export const ui = {
  set: useUiStore.setState,
  get: useUiStore.getState,
  openDialog: (dialog: DialogName) => useUiStore.setState({ dialog }),
  closeDialog: () => useUiStore.setState({ dialog: null }),
  select: (selection: Selection | null) => useUiStore.setState({ selection }),
  clearSelection: () => useUiStore.setState({ selection: null }),

  /** An empty pane cannot take the focus while another pane shows a plot (it would leave no active plot). */
  focusPane: (index: number) =>
    useUiStore.setState((s) => {
      const { panes, focused } = s.workspace
      if (!Number.isInteger(index) || index < 0 || index >= panes.length || index === focused) return s
      if (panes[index] === null && panes.some((p) => p !== null)) return s
      return { workspace: { ...s.workspace, focused: index } }
    }),

  /**
   * Brings a plot on screen and focuses its pane: into `pane` when given (a plot shown elsewhere swaps
   * places with the plot it displaces, so a plot is never in two panes), else where it already is, else
   * into the first empty pane, else into the focused pane.
   */
  showPlot: (id: PlotId, pane?: number) =>
    useUiStore.setState((s) => {
      const ws = s.workspace
      const panes = [...ws.panes]
      const at = panes.indexOf(id)
      const empty = panes.indexOf(null)
      const target =
        pane !== undefined && Number.isInteger(pane) && pane >= 0 && pane < panes.length
          ? pane
          : at >= 0
            ? at
            : empty >= 0
              ? empty
              : ws.focused
      if (at === target && ws.focused === target) return s
      if (at >= 0 && at !== target) panes[at] = panes[target]
      panes[target] = id
      return { workspace: { ...ws, panes, focused: target } }
    }),

  /** Empty panes of a larger layout are filled by the workspace sync (it knows the document's plots). */
  setLayout: (layout: Layout) =>
    useUiStore.setState((s) => {
      const ws = s.workspace
      if (ws.layout === layout || !(layout in PANE_COUNT)) return s
      return { workspace: { layout, ...fitPanes(ws.panes, ws.focused, PANE_COUNT[layout]) } }
    }),

  /**
   * "Reset view" of one plot. Without an id every plot is reset (a project was loaded): every plot that
   * may hold a zoom has an entry in `views`, so bumping those counters is enough.
   */
  resetView: (plotId?: PlotId) =>
    useUiStore.setState((s) => {
      if (plotId !== undefined) {
        const views = { ...s.views }
        delete views[plotId]
        return { views, viewResets: { ...s.viewResets, [plotId]: (s.viewResets[plotId] ?? 0) + 1 } }
      }
      const viewResets = { ...s.viewResets }
      for (const id of Object.keys(s.views) as PlotId[]) viewResets[id] ??= 0
      for (const id of Object.keys(viewResets) as PlotId[]) viewResets[id] += 1
      return { views: {}, viewResets }
    }),

  setView: (plotId: PlotId, view: RecordedView) =>
    useUiStore.setState((s) => ({ views: { ...s.views, [plotId]: view } })),
}
