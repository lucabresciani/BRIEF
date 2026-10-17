import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCHEMA_VERSION, type RawTable } from '@/domain/model'
import { checkRefs } from '@/domain/model/integrity'
import { rawTableFromJSON } from '@/domain/project/deserialize'
import type * as PersistenceModule from './persistence'
import type * as ProjectStoreModule from './projectStore'
import type * as UiStoreModule from './uiStore'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form project JSON
type Json = any

/** idb-keyval over a Map, with structured clones as IndexedDB stores them. */
const db = vi.hoisted(() => new Map<string, unknown>())
/** Number of setMany transactions (one per save). */
const saves = vi.hoisted(() => ({ n: 0 }))
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  get: async (k: string) => structuredClone(db.get(k)),
  getMany: async (ks: string[]) => ks.map((k) => structuredClone(db.get(k))),
  setMany: async (entries: [string, unknown][]) => {
    saves.n++
    for (const [k, v] of entries) db.set(k, structuredClone(v))
  },
  update: async (k: string, fn: (v: unknown) => unknown) => void db.set(k, structuredClone(fn(db.get(k)))),
  del: async (k: string) => void db.delete(k),
  delMany: async (ks: string[]) => ks.forEach((k) => db.delete(k)),
  keys: async () => [...db.keys()],
}))

const fixture = (name: string): Json =>
  JSON.parse(readFileSync(resolve('tests/fixtures/projects', name), 'utf8'))
const V1 = fixture('v1-ok.sciplot')
const V2 = fixture('v2-multiplot.sciplot')
const ID = V1.project.id as string

/** Writes a project record the way a given version of the app did. */
function store(file: Json, schemaVersion: number, extra: Record<string, unknown> = {}) {
  for (const t of file.rawTables) db.set(`p:${file.project.id}:raw:${t.id}`, rawTableFromJSON(t) as RawTable)
  db.set(`p:${file.project.id}:doc`, {
    schemaVersion,
    doc: file.project,
    log: file.operationLog,
    savedAt: file.savedAt,
    ...extra,
  })
  db.set('index', [
    { id: file.project.id, name: file.project.name, updatedAt: file.project.updatedAt, datasets: 3 },
  ])
}

let persistence: typeof PersistenceModule
let projectStore: typeof ProjectStoreModule
let uiStore: typeof UiStoreModule

beforeEach(async () => {
  db.clear()
  saves.n = 0
  vi.stubGlobal('indexedDB', {})
  vi.stubGlobal('navigator', {}) // no Web Locks: every tab may write
  vi.resetModules()
  persistence = await import('./persistence')
  projectStore = await import('./projectStore')
  uiStore = await import('./uiStore')
})
afterEach(() => vi.unstubAllGlobals())

const state = () => projectStore.useProjectStore.getState()

describe('IndexedDB records of schema 1', () => {
  it('are migrated (only missing fields added), repaired, then restored', async () => {
    const v1 = structuredClone(V1)
    v1.project.activePlotId = 'plt_gone' // a broken reference: records are never validated
    store(v1, 1)
    expect(await persistence.openStoredProject(ID)).toBe(true)
    const { doc, loadedLog, loadedWorkspace, readOnly } = state()
    expect(readOnly).toBe(false)
    const plot = doc.plots[0]
    expect(plot.name).toBe('')
    expect(plot.series.map((s) => s.split)).toEqual([null, null])
    expect(plot.histogram).toMatchObject({ groupBy: null, groupMode: 'overlay' })
    expect(plot.box.colorByGroup).toBe(false)
    expect(plot.bar.colorByCategory).toBe(false)
    expect(doc.fits.map((f) => [f.style, f.perGroup])).toEqual([
      [{ color: { mode: 'series' }, dash: 'auto', width: 2 }, false],
      [{ color: { mode: 'series' }, dash: 'auto', width: 2 }, false],
    ])
    expect(doc.activePlotId).toBe(plot.id) // repaired
    expect(checkRefs(doc)).toEqual([])
    expect(loadedLog).toHaveLength(V1.operationLog.length)
    expect(loadedLog.every((e) => e.plotId === null)).toBe(true)
    expect(loadedWorkspace).toBeNull()
  })

  it('the next autosave writes the record back as schema 2', async () => {
    store(structuredClone(V1), 1)
    await persistence.openStoredProject(ID)
    await persistence.flushAutosave()
    const rec = db.get(`p:${ID}:doc`) as Json
    expect(rec.schemaVersion).toBe(2)
    // A v1 record has no workspace: its one plot is laid out in a single pane.
    expect(rec.workspace).toEqual({ layout: 'single', panes: [V1.project.plots[0].id], focused: 0 })
    expect(rec.doc.plots[0].name).toBe('')
    expect(rec.log[0].plotId).toBeNull()
  })

  it('a damaged record is not restored, and nothing throws', async () => {
    store(structuredClone(V1), 1)
    db.set(`p:${ID}:doc`, { schemaVersion: 1, doc: { datasets: 'not a list' }, log: [] })
    const before = state().doc
    expect(await persistence.openStoredProject(ID)).toBe(false)
    expect(state().doc).toBe(before)
  })
})

describe('IndexedDB records of schema 2 and later', () => {
  it('the record schema is the project schema: a record is migrated as a file of its version', async () => {
    // persistence.ts hands the record version to migrateDoc/migrateLog as a project schema version.
    const { STORAGE_SCHEMA } = await import('@/platform/storage')
    expect(STORAGE_SCHEMA).toBe(SCHEMA_VERSION)
  })

  it('a schema 2 record is restored as stored and keeps its workspace across saves', async () => {
    const workspace = V2.workspace
    store(structuredClone(V2), 2, { workspace })
    expect(await persistence.openStoredProject(ID)).toBe(true)
    expect(state().doc.plots.map((p) => p.id)).toEqual(V2.project.plots.map((p: Json) => p.id))
    expect(state().loadedWorkspace).toEqual(workspace)
    await persistence.flushAutosave()
    expect((db.get(`p:${ID}:doc`) as Json).workspace).toEqual(workspace)
  })

  it('a record of a newer schema is refused and never overwritten', async () => {
    store(structuredClone(V2), 3)
    const before = state().doc
    expect(await persistence.openStoredProject(ID)).toBe(false)
    expect(state().doc).toBe(before)
    expect((db.get(`p:${ID}:doc`) as Json).schemaVersion).toBe(3)
  })
})

describe('the workspace and the active plot', () => {
  const [P0, P1] = V2.project.plots.map((p: Json) => p.id as string)
  const record = () => db.get(`p:${ID}:doc`) as Json

  it('are restored from the record and reconciled with its plots', async () => {
    const workspace = { layout: 'grid', panes: [P1, 'plt_gone', P1, null], focused: 1 }
    store(structuredClone(V2), 2, { workspace })
    expect(await persistence.openStoredProject(ID)).toBe(true)
    expect(uiStore.ui.get().workspace).toEqual({ layout: 'grid', panes: [P1, P0, null, null], focused: 0 })
    expect(state().loadedWorkspace).toEqual(workspace) // as stored
  })

  it('switching plots never edits the document; the switch is written with the next save', async () => {
    store(structuredClone(V2), 2, { workspace: V2.workspace })
    await persistence.openStoredProject(ID)
    const { ui } = uiStore
    expect(ui.get().workspace.panes[ui.get().workspace.focused]).toBe(P1)
    const doc = state().doc
    ui.focusPane(0)
    ui.setLayout('single')
    expect(state().doc).toBe(doc)
    expect(state().doc.activePlotId).toBe(P1) // the document keeps what was loaded
    expect(state().past).toEqual([])
    await persistence.flushAutosave()
    expect(record().workspace).toEqual({ layout: 'single', panes: [P0], focused: 0 })
    expect(record().doc.activePlotId).toBe(P0) // injected at save time only
    expect(state().doc).toBe(doc)
  })

  it('a workspace change alone is saved quietly when the page hides, and only once', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const win = new EventTarget()
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', win)
    store(structuredClone(V2), 2, { workspace: V2.workspace })
    await persistence.startPersistence()
    const { ui } = uiStore
    expect(ui.get().workspace).toEqual(V2.workspace)
    const before = saves.n
    ui.showPlot(P0)
    await Promise.resolve()
    expect(ui.get().storage).toBe('ok') // no saving indicator, no autosave scheduled
    expect(saves.n).toBe(before)

    win.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(record().workspace.focused).toBe(0))
    expect(record().doc.activePlotId).toBe(P0)
    expect(saves.n).toBe(before + 1)
    expect(ui.get().storage).toBe('ok')

    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('pagehide'))
    await new Promise((r) => setTimeout(r, 0))
    expect(saves.n).toBe(before + 1) // nothing changed since
  })

  it('never shows "saved" while an edit made during a save still waits for its own save', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
    vi.stubGlobal('window', new EventTarget())
    store(structuredClone(V2), 2, { workspace: V2.workspace })
    await persistence.startPersistence()
    const { commit } = projectStore
    const retitle = (title: string) =>
      commit('plot.style', (d) => {
        d.plots[0].title = title
      })
    retitle('First')
    const first = persistence.flushAutosave()
    retitle('Second') // typed while the first save is being written
    await first
    expect(record().doc.plots[0].title).toBe('First')
    expect(uiStore.ui.get().storage).toBe('pending')
    await persistence.flushAutosave()
    expect(record().doc.plots[0].title).toBe('Second')
    expect(uiStore.ui.get().storage).toBe('saved')
  })

  it('a workspace change is written once when visibilitychange and pagehide fire together', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const win = new EventTarget()
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', win)
    store(structuredClone(V2), 2, { workspace: V2.workspace })
    await persistence.startPersistence()
    const before = saves.n
    uiStore.ui.showPlot(P0)
    // A closing tab: the browser fires both events back to back, before the first write ends.
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(record().workspace.focused).toBe(0))
    await new Promise((r) => setTimeout(r, 0))
    expect(saves.n).toBe(before + 1)
  })

  it('the .sciplot file carries the workspace on screen and the active plot', async () => {
    store(structuredClone(V2), 2, { workspace: V2.workspace })
    await persistence.openStoredProject(ID)
    uiStore.ui.focusPane(0)
    const { currentProjectFile } = await import('./actions/project')
    const file = JSON.parse(await currentProjectFile())
    expect(file.workspace).toEqual({ layout: 'columns', panes: [P0, P1], focused: 0 })
    expect(file.project.activePlotId).toBe(P0)
    expect(state().doc.activePlotId).toBe(P1)
  })

  it('open as a copy keeps the plots as they are laid out on screen', async () => {
    store(structuredClone(V2), 2, { workspace: V2.workspace })
    await persistence.openStoredProject(ID)
    uiStore.ui.focusPane(0)
    await persistence.openAsCopy('Copy')
    expect(state().doc.id).not.toBe(ID)
    expect(uiStore.ui.get().workspace).toEqual({ layout: 'columns', panes: [P0, P1], focused: 0 })
  })
})
