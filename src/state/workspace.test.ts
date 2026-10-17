import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultPlotSpec } from '@/domain/recommend/recommend'
import type { PlotId, ProjectDoc, WorkspaceState } from '@/domain/model'
import { commit, emptyProject, loadProject, undo, useProjectStore } from './projectStore'
import { INITIAL_WORKSPACE, ui } from './uiStore'
import {
  initWorkspace,
  projectForSave,
  reconcileWorkspace,
  resolveActivePlot,
  startWorkspaceSync,
  syncWorkspace,
} from './workspace'

const A = 'plot_a' as PlotId
const B = 'plot_b' as PlotId
const C = 'plot_c' as PlotId
const D = 'plot_d' as PlotId
const E = 'plot_e' as PlotId

const ws = (layout: WorkspaceState['layout'], panes: (PlotId | null)[], focused = 0): WorkspaceState => ({
  layout,
  panes,
  focused,
})

function project(ids: PlotId[], activePlotId: PlotId | null = null): ProjectDoc {
  return { ...emptyProject('W'), plots: ids.map((id) => defaultPlotSpec(id)), activePlotId }
}

const workspace = () => ui.get().workspace

let stop: (() => void) | null = null
beforeEach(() => {
  loadProject(emptyProject('W'))
  ui.set({ workspace: INITIAL_WORKSPACE, views: {}, viewResets: {} })
})
afterEach(() => {
  stop?.()
  stop = null
})

describe('reconcileWorkspace', () => {
  it('keeps a workspace that already fits the plots', () => {
    const w = ws('columns', [A, B], 1)
    expect(reconcileWorkspace(w, [A, B, C])).toEqual(w)
  })

  it('drops plots that are no longer in the document and fills their pane with a plot not on screen', () => {
    expect(reconcileWorkspace(ws('columns', [A, B], 0), [A, C])).toEqual(ws('columns', [A, C], 0))
    // Nothing left to show: the pane stays empty.
    expect(reconcileWorkspace(ws('columns', [A, B], 0), [A])).toEqual(ws('columns', [A, null], 0))
    expect(reconcileWorkspace(ws('single', [B]), [])).toEqual(ws('single', [null]))
  })

  it('a plot is in one pane only: the focused pane keeps it, else the first pane showing it', () => {
    expect(reconcileWorkspace(ws('grid', [A, B, A, C], 2), [A, B, C, D])).toEqual(ws('grid', [D, B, A, C], 2))
    expect(reconcileWorkspace(ws('columns', [A, A], 0), [A])).toEqual(ws('columns', [A, null], 0))
  })

  it('clamps the focus to the panes and never leaves it on an empty pane beside a plot', () => {
    expect(reconcileWorkspace(ws('columns', [A, B], 7), [A, B])).toEqual(ws('columns', [A, B], 1))
    expect(reconcileWorkspace(ws('columns', [A, B], -3), [A, B])).toEqual(ws('columns', [A, B], 0))
    expect(reconcileWorkspace(ws('columns', [A, B], 1.5), [A, B])).toEqual(ws('columns', [A, B], 0))
    // The focused plot is gone and nothing replaces it: the focus moves to the pane that shows a plot.
    expect(reconcileWorkspace(ws('columns', [A, B], 1), [A])).toEqual(ws('columns', [A, null], 0))
  })

  it('cuts or pads the panes to the layout, keeping the focused plot on screen', () => {
    expect(reconcileWorkspace(ws('grid', [A], 0), [A, B, C, D, E])).toEqual(ws('grid', [A, B, C, D], 0))
    expect(reconcileWorkspace(ws('grid', [A, B], 1), [A, B])).toEqual(ws('grid', [A, B, null, null], 1))
    expect(reconcileWorkspace(ws('single', [A, B, C, D], 2), [A, B, C, D])).toEqual(ws('single', [C], 0))
    expect(reconcileWorkspace(ws('columns', [A, B, C, D], 3), [A, B, C, D])).toEqual(ws('columns', [A, D], 1))
    expect(reconcileWorkspace(ws('columns', [A, B, C, D], 1), [A, B, C, D])).toEqual(ws('columns', [A, B], 1))
  })

  it('an empty focused pane shows the preferred plot, or takes the focus to the pane showing it', () => {
    expect(reconcileWorkspace(ws('single', [null]), [A, B, C], C)).toEqual(ws('single', [C]))
    expect(reconcileWorkspace(ws('columns', [B, null], 1), [A, B, C], B)).toEqual(ws('columns', [B, A], 0))
    // A focused pane that shows a plot is never replaced by the preferred one.
    expect(reconcileWorkspace(ws('single', [A]), [A, B], B)).toEqual(ws('single', [A]))
    // A preferred plot that is not in the document is ignored.
    expect(reconcileWorkspace(ws('single', [null]), [A, B], E)).toEqual(ws('single', [A]))
  })

  it('is total on a malformed stored workspace (IndexedDB records are never validated)', () => {
    const bad = [
      null,
      undefined,
      { layout: 'mosaic', panes: [A], focused: 0 },
      { layout: 'columns', panes: 'A,B', focused: 0 },
      { layout: 'grid', panes: [42, { id: A }, A, '__proto__'], focused: '1' },
      { layout: 'toString', panes: [A], focused: 0 },
    ] as unknown as WorkspaceState[]
    expect(reconcileWorkspace(bad[0], [A, B])).toEqual(ws('single', [A]))
    expect(reconcileWorkspace(bad[1], [])).toEqual(ws('single', [null]))
    expect(reconcileWorkspace(bad[2], [A, B])).toEqual(ws('single', [A]))
    expect(reconcileWorkspace(bad[3], [A, B])).toEqual(ws('columns', [A, B]))
    expect(reconcileWorkspace(bad[4], [A, B])).toEqual(ws('grid', [B, null, A, null], 0))
    expect(reconcileWorkspace(bad[5], [A])).toEqual(ws('single', [A]))
  })

  it('is idempotent', () => {
    const cases: [WorkspaceState, PlotId[]][] = [
      [ws('grid', [A, B, A, null], 3), [A, B, C]],
      [ws('columns', [E, D, C], 2), [C, D]],
      [ws('single', [null], 0), []],
    ]
    for (const [w, ids] of cases) {
      const once = reconcileWorkspace(w, ids)
      expect(reconcileWorkspace(once, ids)).toEqual(once)
    }
  })
})

describe('the active plot', () => {
  it('is the plot of the focused pane, else the document activePlotId, else the first plot', () => {
    const doc = project([A, B, C], B)
    expect(resolveActivePlot(doc, ws('columns', [A, C], 1))).toBe(C)
    // A workspace of another project (or not initialised yet) does not describe this document.
    expect(resolveActivePlot(doc, ws('single', [E]))).toBe(B)
    expect(resolveActivePlot({ ...doc, activePlotId: null }, INITIAL_WORKSPACE)).toBe(A)
    expect(resolveActivePlot(project([]), INITIAL_WORKSPACE)).toBeNull()
  })

  it('is written into the document only by projectForSave, with the reconciled workspace', () => {
    const doc = project([A, B, C], A)
    useProjectStore.setState({ doc })
    ui.set({ workspace: ws('columns', [B, C], 1) })
    const saved = projectForSave(doc)
    expect(saved.doc).toEqual({ ...doc, activePlotId: C })
    expect(saved.workspace).toEqual(ws('columns', [B, C], 1))
    expect(useProjectStore.getState().doc).toBe(doc) // the store is untouched
    // Nothing to inject: the same document object.
    ui.set({ workspace: ws('single', [A]) })
    expect(projectForSave(doc).doc).toBe(doc)
  })
})

describe('UI store actions', () => {
  beforeEach(() => ui.set({ workspace: ws('grid', [A, B, C, null], 0) }))

  it('focusPane moves the focus, never onto an empty pane beside plots or out of range', () => {
    ui.focusPane(2)
    expect(workspace().focused).toBe(2)
    ui.focusPane(3)
    ui.focusPane(4)
    ui.focusPane(-1)
    ui.focusPane(1.5)
    expect(workspace().focused).toBe(2)
  })

  it('showPlot focuses a plot already on screen, else uses an empty pane, else the focused pane', () => {
    ui.showPlot(C)
    expect(workspace()).toEqual(ws('grid', [A, B, C, null], 2))
    ui.showPlot(D)
    expect(workspace()).toEqual(ws('grid', [A, B, C, D], 3))
    ui.showPlot(E)
    expect(workspace()).toEqual(ws('grid', [A, B, C, E], 3))
  })

  it('showPlot into a given pane swaps with the plot it displaces (never two panes for one plot)', () => {
    ui.showPlot(C, 0)
    expect(workspace()).toEqual(ws('grid', [C, B, A, null], 0))
    ui.showPlot(D, 1)
    expect(workspace()).toEqual(ws('grid', [C, D, A, null], 1))
    ui.showPlot(E, 9) // no such pane: as without one
    expect(workspace()).toEqual(ws('grid', [C, D, A, E], 3))
  })

  it('setLayout keeps the focused plot on screen', () => {
    ui.focusPane(2)
    ui.setLayout('single')
    expect(workspace()).toEqual(ws('single', [C], 0))
    ui.setLayout('columns')
    expect(workspace()).toEqual(ws('columns', [C, null], 0))
  })

  it('views and resets are per plot; a reset without an id resets every plot that has a view', () => {
    ui.setView(A, { x: [0, 1], y: null, rev: 'r1' })
    ui.setView(B, { x: null, y: [2, 3], rev: 'r2' })
    ui.resetView(A)
    expect(ui.get().views).toEqual({ [B]: { x: null, y: [2, 3], rev: 'r2' } })
    expect(ui.get().viewResets).toEqual({ [A]: 1 })
    ui.resetView()
    expect(ui.get().views).toEqual({})
    expect(ui.get().viewResets).toEqual({ [A]: 2, [B]: 1 })
  })
})

describe('initWorkspace and the sync', () => {
  it('initWorkspace lays out a loaded project from its stored workspace, else on its activePlotId', () => {
    const doc = project([A, B, C], B)
    initWorkspace(doc, ws('columns', [C, E], 0))
    expect(workspace()).toEqual(ws('columns', [C, A], 0))
    initWorkspace(doc)
    expect(workspace()).toEqual(ws('single', [B]))
    initWorkspace(project([A, B]))
    expect(workspace()).toEqual(ws('single', [A]))
  })

  it('loading a project forgets the panes of the previous one', () => {
    ui.set({ workspace: ws('columns', [A, B], 1) })
    loadProject(project([A, B], A))
    expect(workspace()).toEqual(INITIAL_WORKSPACE)
    expect(resolveActivePlot(useProjectStore.getState().doc, workspace())).toBe(A)
  })

  it('syncWorkspace gives the pane of a deleted focused plot to the next plot, else the previous one', () => {
    loadProject(project([A, B, C]))
    ui.set({ workspace: ws('single', [B]) })
    const before = [A, B, C]
    commit('plot.remove', (d) => void d.plots.splice(1, 1))
    syncWorkspace(before)
    expect(workspace()).toEqual(ws('single', [C]))
    commit('plot.remove', (d) => void d.plots.splice(1, 1))
    syncWorkspace([A, C])
    expect(workspace()).toEqual(ws('single', [A]))
  })

  it('follows a new project id, the plots of the document and a larger layout', () => {
    stop = startWorkspaceSync()
    expect(startWorkspaceSync()).toBe(stop) // once per page
    // A new project: its stored workspace, reconciled.
    loadProject(project([A, B, C], A), [], false, ws('columns', [B, E], 0))
    expect(workspace()).toEqual(ws('columns', [B, A], 0))
    // An edit that removes the focused plot: its neighbour takes the pane.
    commit('plot.remove', (d) => void d.plots.splice(1, 1))
    expect(workspace()).toEqual(ws('columns', [C, A], 0))
    // Undo brings the plot back into the document; the panes are full, so it stays off screen.
    undo()
    expect(workspace()).toEqual(ws('columns', [C, A], 0))
    // A larger layout is filled with the plots not on screen.
    ui.setLayout('grid')
    expect(workspace()).toEqual(ws('grid', [C, A, B, null], 0))
    stop()
    stop = null
    ui.setLayout('single')
    ui.setLayout('columns')
    expect(workspace()).toEqual(ws('columns', [C, null], 0)) // no longer filled
  })
})
