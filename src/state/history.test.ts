import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commit,
  emptyProject,
  loadProject,
  operationLog,
  redo,
  undo,
  useProjectStore,
  setReadOnly,
  type HistoryEntry,
} from './projectStore'
import { addRawTable, useDataStore } from './dataStore'
import { importText } from '@/domain/import/importPipeline'
import type { DatasetId, PlotId, RawTable, RawTableId } from '@/domain/model'
import { makeTranslator } from '@/i18n/translate'
import { addFit, setResidualPanel, updateFit } from './actions/analysis'
import { importDraft, importDrafts } from './actions/dataset'
import { createNotebook } from './actions/notebook'
import {
  createPlot,
  duplicatePlot,
  movePlot,
  removePlot,
  renamePlot,
  setPlotOptions,
  setPlotType,
  setSeriesMapping,
  setTitle,
  updateAxis,
} from './actions/plot'
import { loadExample } from './actions/project'
import { INITIAL_WORKSPACE, ui } from './uiStore'
import { getActivePlotId } from './workspace'

beforeEach(() => {
  vi.useRealTimers()
  loadProject(emptyProject('Test'))
})

const doc = () => useProjectStore.getState().doc

describe('undo/redo history', () => {
  it('records labelled operations and undoes/redoes them', () => {
    commit('project.rename', (d) => void (d.name = 'A'), { params: { name: 'A' } })
    commit('project.rename', (d) => void (d.name = 'B'), { params: { name: 'B' } })
    expect(doc().name).toBe('B')
    expect(undo()?.op).toBe('project.rename')
    expect(doc().name).toBe('A')
    expect(undo()).not.toBeNull()
    expect(doc().name).toBe('Test')
    expect(undo()).toBeNull()
    redo()
    expect(doc().name).toBe('A')
  })

  it('a new commit clears the redo stack', () => {
    commit('project.rename', (d) => void (d.name = 'A'))
    undo()
    commit('project.rename', (d) => void (d.name = 'C'))
    expect(useProjectStore.getState().future).toHaveLength(0)
    expect(redo()).toBeNull()
  })

  it('does not record a commit that changes nothing', () => {
    expect(commit('project.rename', (d) => void (d.name = 'Test'))).toBe(false)
    expect(useProjectStore.getState().past).toHaveLength(0)
  })

  it('coalesces rapid edits with the same key into one step, undone in reverse order', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    commit('project.rename', (d) => void (d.name = 'T'), { coalesceKey: 'name' })
    vi.setSystemTime(1_000_200)
    commit('project.rename', (d) => void (d.name = 'Te'), { coalesceKey: 'name' })
    vi.setSystemTime(1_000_400)
    commit('project.rename', (d) => void (d.name = 'Tes'), { coalesceKey: 'name' })
    expect(useProjectStore.getState().past).toHaveLength(1)
    undo()
    expect(doc().name).toBe('Test')
    redo()
    expect(doc().name).toBe('Tes')
    vi.setSystemTime(1_005_000)
    commit('project.rename', (d) => void (d.name = 'Tess'), { coalesceKey: 'name' })
    expect(useProjectStore.getState().past).toHaveLength(2)
  })

  it('keeps at most 200 steps', () => {
    for (let i = 0; i < 230; i++) commit('project.rename', (d) => void (d.name = `n${i}`))
    expect(useProjectStore.getState().past).toHaveLength(200)
  })

  it('the operation log contains only effective operations and keeps loaded entries', () => {
    loadProject(emptyProject('X'), [
      {
        id: 'old',
        at: '2026-01-01T00:00:00Z',
        op: 'dataset.import',
        label: { key: 'history.ops.dataset.import' },
        datasetId: null,
        plotId: null,
      },
    ])
    commit('project.rename', (d) => void (d.name = 'Y'))
    commit('project.rename', (d) => void (d.name = 'Z'))
    undo()
    const log = operationLog()
    expect(log.map((e) => e.id)[0]).toBe('old')
    expect(log).toHaveLength(2)
    expect('patches' in log[1]).toBe(false)
    // Exactly the persisted fields, plotId included (the project schema requires it).
    expect(Object.keys(log[1]).sort()).toEqual(['at', 'datasetId', 'id', 'label', 'op', 'plotId'])
    expect(log[1].plotId).toBeNull()
  })

  it('keeps the workspace loaded with a project, and forgets it with the next project', () => {
    const workspace = { layout: 'single', panes: [null], focused: 0 } as const
    loadProject(emptyProject('W'), [], false, { ...workspace, panes: [...workspace.panes] })
    expect(useProjectStore.getState().loadedWorkspace).toEqual(workspace)
    commit('project.rename', (d) => void (d.name = 'W2'))
    expect(useProjectStore.getState().loadedWorkspace).toEqual(workspace) // not part of undo
    loadProject(emptyProject('V'))
    expect(useProjectStore.getState().loadedWorkspace).toBeNull()
  })

  it('never touches the raw data store', () => {
    const raw = { id: 'raw_1' as RawTableId } as unknown as RawTable
    addRawTable(raw)
    commit('project.rename', (d) => void (d.name = 'Q'))
    undo()
    redo()
    expect(useDataStore.getState().rawTables['raw_1']).toBe(raw)
  })

  it('refuses edits in read-only mode', () => {
    setReadOnly(true)
    expect(commit('project.rename', (d) => void (d.name = 'R'))).toBe(false)
    expect(doc().name).toBe('Test')
    setReadOnly(false)
  })
})

// ---- Several plots ------------------------------------------------------------------------------

const en = makeTranslator('en')
const said = (e: HistoryEntry | undefined) => (e ? en(e.label.key, e.label.params) : '')
const past = () => useProjectStore.getState().past
const plots = () => doc().plots
const plot = (id: PlotId) => doc().plots.find((p) => p.id === id)!
const fitsOf = (id: PlotId) => doc().fits.filter((f) => plot(id).series.some((s) => s.id === f.seriesId))
const panes = () => ui.get().workspace.panes

function draftOf(text: string) {
  const r = importText(text, { kind: 'clipboard', fileName: null })
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
const RUN_1 = 't (s),x (m)\n0,0.0\n1,1.1\n2,3.9\n3,9.2\n'
const RUN_2 = 't (s),x (m)\n0,0.1\n1,2.0\n2,8.1\n3,17.9\n'
const OTHER = 'a,b,c\n1,2,3\n4,5,6\n7,8,9\n'

describe('several plots', () => {
  beforeEach(() => ui.set({ workspace: INITIAL_WORKSPACE, views: {}, viewResets: {} }))
  afterEach(() => vi.unstubAllGlobals())

  it('createPlot adds an empty plot, or the recommended plot of a dataset named after it, and shows it', () => {
    expect(loadExample('ohm', 'Ohm')).toBe(true)
    const first = plots()[0].id
    const empty = createPlot()!
    expect(plots().map((p) => p.id)).toEqual([first, empty])
    expect(plot(empty)).toMatchObject({ name: '', type: 'scatter', series: [] })
    expect(getActivePlotId()).toBe(empty)
    expect(said(past().at(-1))).toBe('Created plot Plot 2')
    expect(past().at(-1)?.plotId).toBe(empty)

    const ds = doc().datasets[0].id
    const fromData = createPlot({ datasetId: ds })!
    expect(plot(fromData).name).toBe('Ohm')
    expect(plot(fromData).series.map((s) => s.datasetId)).toEqual([ds])
    expect(plot(fromData).series[0].id).not.toBe(plot(first).series[0].id)
    expect(said(past().at(-1))).toBe('Created plot Ohm')
    expect(past().at(-1)).toMatchObject({ datasetId: ds, plotId: fromData })
    undo()
    undo()
    expect(plots().map((p) => p.id)).toEqual([first])
  })

  it('duplicatePlot copies a plot with new series and fit ids: the two plots fit independently', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const series = plot(a).series[0].id
    const fit = addFit(series, { type: 'linear' }, 'linear')
    setTitle('Calibration', a)
    const exclusions = doc().exclusions
    const b = duplicatePlot(a)!
    expect(plots().map((p) => p.id)).toEqual([a, b])
    expect(plot(b).name).toBe('Calibration (copy)')
    expect(plot(b).title).toBe('Calibration')
    expect(plot(b).series[0].id).not.toBe(series)
    expect(plot(b).series[0]).toMatchObject({ x: plot(a).series[0].x, y: plot(a).series[0].y })
    const [copied] = fitsOf(b)
    expect(copied.id).not.toBe(fit)
    expect(copied.model).toEqual({ type: 'linear' })
    expect(doc().exclusions).toBe(exclusions) // shared per dataset, never copied
    expect(getActivePlotId()).toBe(b)
    expect(said(past().at(-1))).toBe('Duplicated plot Calibration')

    updateFit(copied.id, { model: { type: 'polynomial', degree: 2 } })
    expect(fitsOf(a)[0].model).toEqual({ type: 'linear' })
    expect(fitsOf(b)[0].model).toEqual({ type: 'polynomial', degree: 2 })
    undo()
    undo()
    expect(plots()).toHaveLength(1)
    expect(doc().fits.map((f) => f.id)).toEqual([fit])
  })

  it('a new plot or a copy never takes a tab label already in use', () => {
    loadExample('ohm', 'Ohm')
    const ds = doc().datasets[0].id
    const second = createPlot({ datasetId: ds })!
    const third = createPlot({ datasetId: ds })!
    expect([plot(second).name, plot(third).name]).toEqual(['Ohm', 'Ohm (2)'])
    const first = plots()[0].id
    const copies = [duplicatePlot(first)!, duplicatePlot(first)!].map((id) => plot(id).name)
    expect(copies.sort()).toEqual(['V vs I (copy)', 'V vs I (copy) (2)'])
    // An explicit name follows the same rule; an automatic name ('') stays automatic.
    expect(plot(createPlot({ name: 'Ohm' })!).name).toBe('Ohm (3)')
    expect(plot(createPlot()!).name).toBe('')
  })

  it('the copy is named in the language of the page', () => {
    vi.stubGlobal('document', { documentElement: { lang: 'it' } })
    loadExample('ohm', 'Ohm')
    const copy = duplicatePlot(plots()[0].id)!
    expect(plot(copy).name).toBe('V vs I (copia)')
    const entry = past().at(-1)!
    expect(makeTranslator('it')(entry.label.key, entry.label.params)).toBe('Duplicato il grafico V vs I')
  })

  it('removePlot takes the fits of its series; the workspace never points at it; undo restores both and shows it', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = duplicatePlot(a)!
    const c = createPlot()!
    addFit(plot(a).series[0].id, { type: 'linear' }, 'linear')
    addFit(plot(b).series[0].id, { type: 'linear' }, 'linear')
    ui.showPlot(b)
    removePlot(b)
    expect(plots().map((p) => p.id)).toEqual([a, c])
    expect(doc().fits).toHaveLength(1)
    expect(panes()).toEqual([c]) // the next tab takes its place
    expect(said(past().at(-1))).toBe('Deleted plot V vs I (copy)')

    undo()
    expect(plots().map((p) => p.id)).toEqual([a, b, c])
    expect(fitsOf(b)).toHaveLength(1)
    expect(panes()).toEqual([b])
    expect(getActivePlotId()).toBe(b)
    redo()
    expect(plots().map((p) => p.id)).toEqual([a, c])
  })

  it('undo and redo bring the plot they change on screen', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = createPlot()!
    setPlotType('line', a) // edited while b is shown
    expect(panes()).toEqual([b])
    undo()
    expect(plot(a).type).toBe('scatter')
    expect(panes()).toEqual([a])
    ui.showPlot(b)
    redo()
    expect(panes()).toEqual([a])
    // A plot already on screen stays where it is.
    ui.set({ workspace: { layout: 'columns', panes: [a, b], focused: 1 } })
    undo()
    expect(ui.get().workspace).toEqual({ layout: 'columns', panes: [a, b], focused: 1 })
  })

  it('switching plots, panes and layout is not an edit: no history entry, the same document', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = createPlot()!
    const before = doc()
    const steps = past().length
    ui.showPlot(a)
    ui.setLayout('columns')
    ui.showPlot(b, 1)
    ui.focusPane(0)
    ui.setView(a, { x: [0, 1], y: null, rev: 'r' })
    ui.resetView(a)
    expect(doc()).toBe(before)
    expect(past()).toHaveLength(steps)
  })

  it('renamePlot coalesces typing per plot, and its label is the new name', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = createPlot()!
    const steps = past().length
    renamePlot(a, 'R')
    vi.setSystemTime(2_000_100)
    renamePlot(a, 'R1')
    expect(past()).toHaveLength(steps + 1)
    vi.setSystemTime(2_000_200)
    renamePlot(b, 'S')
    vi.setSystemTime(2_000_300)
    renamePlot(a, 'R12')
    expect(past()).toHaveLength(steps + 3)
    expect(said(past().at(-1))).toBe('Renamed plot to R12')
    vi.setSystemTime(2_005_000)
    renamePlot(b, '')
    expect(said(past().at(-1))).toBe('Renamed plot to Plot 2') // back to the automatic label
    undo()
    undo()
    expect(plot(a).name).toBe('R1')
  })

  it('coalesce keys carry the plot: the same edit on two plots makes two undo steps', () => {
    vi.useFakeTimers()
    let now = 3_000_000
    vi.setSystemTime(now)
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = createPlot()!
    const steps = past().length
    const edits: ((id: PlotId) => void)[] = [
      (id) => setTitle('T', id),
      (id) => updateAxis('x', { label: 'L' }, { coalesce: 'label', plotId: id }),
      (id) => setPlotOptions('histogram', { bins: { mode: 'count', count: 5 } }, 'bins', id),
    ]
    for (const edit of edits) {
      edit(a)
      vi.setSystemTime((now += 50))
      edit(b)
      vi.setSystemTime((now += 50))
    }
    expect(past()).toHaveLength(steps + 6)
    expect(
      past()
        .slice(steps)
        .map((e) => e.plotId),
    ).toEqual([a, b, a, b, a, b])
    expect(plot(a).title).toBe('T')
    expect(plot(b).xAxis.label).toBe('L')
  })

  it('setResidualPanel turns the residual panel of one plot only; addFit only that of its own plot', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = duplicatePlot(a)!
    setResidualPanel(a, true)
    setResidualPanel(b, true)
    setResidualPanel(b, false)
    expect(plot(a).scatter.residualPanel).toBe(true)
    expect(plot(b).scatter.residualPanel).toBe(false)
    setResidualPanel(a, false)
    addFit(plot(b).series[0].id, { type: 'linear' }, 'linear')
    expect(plot(b).scatter.residualPanel).toBe(true)
    expect(plot(a).scatter.residualPanel).toBe(false)
    expect(past().at(-1)?.plotId).toBe(b)
  })

  it('setSeriesMapping resets only the view of its own plot', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = duplicatePlot(a)!
    const view = { x: [0, 1] as const, y: null, rev: 'r' }
    ui.setView(a, view)
    ui.setView(b, view)
    const s = plot(b).series[0]
    setSeriesMapping(s.id, { x: s.y, y: s.x }, { x: 'V', y: 'I' })
    expect(ui.get().views).toEqual({ [a]: view })
    expect(ui.get().viewResets).toEqual({ [b]: 1 })
    expect(past().at(-1)?.plotId).toBe(b)
  })

  it('an import fills an empty active plot (keeping its id and name), else opens a new tab named after it', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    expect(plot(a).name).toBe('') // the first plot of a project keeps the automatic label
    const series = plot(a).series
    loadExample('pendulum', 'Pendulum')
    expect(plots()).toHaveLength(2)
    const b = plots()[1].id
    expect(plot(b).name).toBe('Pendulum')
    expect(plot(a).series).toBe(series) // nothing appended to an unrelated plot
    expect(getActivePlotId()).toBe(b)
    expect(past().at(-1)?.plotId).toBe(b)

    const mine = createPlot({ name: 'Mine' })!
    const id = importDraft(draftOf(RUN_1), { name: 'Run 1' })
    expect(plots().map((p) => p.id)).toEqual([a, b, mine])
    expect(plot(mine).name).toBe('Mine')
    expect(plot(mine).series.map((s) => s.datasetId)).toEqual([id])
    expect(past().at(-1)?.plotId).toBe(mine)
    undo()
    expect(plot(mine).series).toEqual([])
    expect(plot(mine).name).toBe('Mine')
  })

  it('a notebook follows the same rule; one with a single column plots nothing', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const cols = [
      { name: 'm', unit: 'kg' },
      { name: 'x', unit: 'cm' },
    ]
    const nb = createNotebook('Spring', cols, 'dot')
    expect(plots()).toHaveLength(2)
    const b = plots()[1].id
    expect(plot(b).name).toBe('Spring')
    expect(plot(b).series.map((s) => s.datasetId)).toEqual([nb])
    expect(plot(a).series.map((s) => s.datasetId)).not.toContain(nb)
    expect(getActivePlotId()).toBe(b)

    const empty = createPlot({ name: 'Bench' })!
    const nb2 = createNotebook('Bench data', cols, 'dot')
    expect(plots()).toHaveLength(3)
    expect(plot(empty)).toMatchObject({ name: 'Bench', series: [{ datasetId: nb2 }] })

    createNotebook('Single', [{ name: 'T', unit: 's' }], 'dot')
    expect(plots()).toHaveLength(3)
    expect(getActivePlotId()).toBe(empty)
  })

  it('importDrafts is one undo step and one tab; tables with the same x and y names are overlaid', () => {
    loadExample('ohm', 'Ohm')
    const steps = past().length
    const ids = importDrafts([draftOf(RUN_1), draftOf(RUN_2), draftOf(OTHER)], {
      names: ['Run 1', 'Run 2', 'Other'],
    })
    expect(past()).toHaveLength(steps + 1)
    expect(said(past().at(-1))).toBe('Imported Run 1, Run 2, Other')
    expect(doc().datasets.map((d) => d.id)).toEqual([doc().datasets[0].id, ...ids])
    expect(plots()).toHaveLength(2)
    const tab = plots()[1]
    expect(tab.name).toBe('Run 1')
    expect(getActivePlotId()).toBe(tab.id)
    expect(tab.series.map((s) => s.datasetId)).toEqual([ids[0], ids[1]])
    expect(new Set(tab.series.map((s) => s.style.paletteIndex)).size).toBe(2)
    const names = (dsId: DatasetId, colIds: string[]) =>
      colIds.map(
        (c) =>
          doc()
            .datasets.find((d) => d.id === dsId)!
            .columns.find((x) => x.id === c)!.name,
      )
    expect(names(ids[1], [tab.series[1].x, tab.series[1].y])).toEqual(
      names(ids[0], [tab.series[0].x, tab.series[0].y]),
    )
    undo()
    expect(doc().datasets).toHaveLength(1)
    expect(plots()).toHaveLength(1)
    expect(importDrafts([])).toEqual([])
  })

  it('moves a plot, with its label in the history', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = createPlot({ name: 'B' })!
    const c = createPlot({ name: 'C' })!
    movePlot(c, 0)
    expect(plots().map((p) => p.id)).toEqual([c, a, b])
    expect(said(past().at(-1))).toBe('Moved plot C')
    const steps = past().length
    movePlot(c, -5) // already first: nothing to record
    movePlot(a, 99)
    expect(plots().map((p) => p.id)).toEqual([c, b, a])
    expect(past()).toHaveLength(steps + 1)
  })

  it('a read-only tab cannot create, duplicate, rename, move or delete plots, but can switch them', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = createPlot()!
    const before = doc()
    setReadOnly(true)
    expect(createPlot()).toBeNull()
    expect(duplicatePlot(a)).toBeNull()
    renamePlot(a, 'X')
    removePlot(a)
    movePlot(a, 1)
    expect(doc()).toBe(before)
    ui.showPlot(a)
    ui.setLayout('columns')
    expect(getActivePlotId()).toBe(a)
    expect(ui.get().workspace.layout).toBe('columns')
    setReadOnly(false)
    expect(plots().map((p) => p.id)).toEqual([a, b])
  })

  it('the plot of each operation is kept in the operation log', () => {
    loadExample('ohm', 'Ohm')
    const a = plots()[0].id
    const b = createPlot()!
    setTitle('Hello', b)
    commit('project.rename', (d) => void (d.name = 'P'))
    expect(operationLog().map((e) => [e.op, e.plotId])).toEqual([
      ['dataset.import', a],
      ['plot.create', b],
      ['plot.style', b],
      ['project.rename', null],
    ])
  })
})
