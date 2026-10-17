import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RawTable } from '@/domain/model'
import { importText } from '@/domain/import/importPipeline'
import { rawTableFromJSON } from '@/domain/project/deserialize'
import type * as PersistenceModule from './persistence'
import type * as ProjectStoreModule from './projectStore'
import type * as DatasetActions from './actions/dataset'
import type * as DataStoreModule from './dataStore'
import type * as UiStoreModule from './uiStore'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form project JSON
type Json = any

/**
 * idb-keyval over a Map. Every call yields to the event loop, as an IndexedDB transaction does, and a
 * test can act while a record is being read (onGet).
 */
const db = vi.hoisted(() => new Map<string, unknown>())
const hooks = vi.hoisted(() => ({ onGet: null as ((key: string) => void) | null }))
vi.mock('idb-keyval', () => {
  const later = () => new Promise((r) => setTimeout(r, 0))
  return {
    createStore: () => ({}),
    get: async (k: string) => {
      await later()
      hooks.onGet?.(k)
      return structuredClone(db.get(k))
    },
    getMany: async (ks: string[]) => (await later(), ks.map((k) => structuredClone(db.get(k)))),
    setMany: async (entries: [string, unknown][]) => {
      await later()
      for (const [k, v] of entries) db.set(k, structuredClone(v))
    },
    update: async (k: string, fn: (v: unknown) => unknown) => {
      await later()
      db.set(k, structuredClone(fn(structuredClone(db.get(k)))))
    },
    del: async (k: string) => (await later(), void db.delete(k)),
    delMany: async (ks: string[]) => (await later(), ks.forEach((k) => db.delete(k))),
    keys: async () => (await later(), [...db.keys()]),
  }
})

const V2: Json = JSON.parse(readFileSync(resolve('tests/fixtures/projects', 'v2-multiplot.sciplot'), 'utf8'))
const ID = V2.project.id as string

/** Writes a project record as the app does, listed first in the index. */
function store(file: Json) {
  for (const t of file.rawTables) db.set(`p:${file.project.id}:raw:${t.id}`, rawTableFromJSON(t) as RawTable)
  db.set(`p:${file.project.id}:doc`, {
    schemaVersion: 2,
    doc: file.project,
    log: file.operationLog,
    workspace: file.workspace,
    savedAt: file.savedAt,
  })
  const index = (db.get('index') ?? []) as Json[]
  db.set('index', [
    { id: file.project.id, name: file.project.name, updatedAt: file.project.updatedAt, datasets: 2 },
    ...index,
  ])
}

let persistence: typeof PersistenceModule
let projectStore: typeof ProjectStoreModule
let datasets: typeof DatasetActions
let dataStore: typeof DataStoreModule
let uiStore: typeof UiStoreModule

beforeEach(async () => {
  db.clear()
  hooks.onGet = null
  vi.stubGlobal('indexedDB', {})
  vi.stubGlobal('navigator', {}) // no Web Locks: every tab may write
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  vi.stubGlobal('window', new EventTarget())
  vi.resetModules()
  persistence = await import('./persistence')
  projectStore = await import('./projectStore')
  datasets = await import('./actions/dataset')
  dataStore = await import('./dataStore')
  uiStore = await import('./uiStore')
})
afterEach(() => vi.unstubAllGlobals())

const state = () => projectStore.useProjectStore.getState()
const record = (id: string) => db.get(`p:${id}:doc`) as Json
const retitle = (title: string) =>
  projectStore.commit('plot.style', (d) => {
    d.plots[0].title = title
  })

function pasteTable() {
  const r = importText('t (s),x (m)\n0,1.5\n1,2.5\n2,3.5\n', { kind: 'clipboard', fileName: null })
  if (!r.ok) throw new Error(r.error.code)
  datasets.importDraft(r.value)
}

describe('autosave while a save is being written', () => {
  it('a flush asked for during a save resolves once the newer change is written too', async () => {
    store(structuredClone(V2))
    await persistence.openStoredProject(ID)
    retitle('First')
    void persistence.flushAutosave()
    retitle('Second') // typed while the first save is written
    await persistence.flushAutosave()
    expect(record(ID).doc.plots[0].title).toBe('Second')
  })

  it('opening another stored project first writes the last edit of the current one', async () => {
    const other = structuredClone(V2)
    other.project.id = 'prj_other'
    store(other)
    store(structuredClone(V2))
    await persistence.openStoredProject(ID)
    retitle('First')
    void persistence.flushAutosave()
    retitle('Second')
    expect(await persistence.openStoredProject('prj_other')).toBe(true)
    expect(state().doc.id).toBe('prj_other')
    expect(record(ID).doc.plots[0].title).toBe('Second')
    expect(record('prj_other').doc.plots[0].title).toBe(V2.project.plots[0].title)
  })
})

describe('open as a copy', () => {
  it('the copy carries the operations of this session in its log', async () => {
    store(structuredClone(V2))
    await persistence.openStoredProject(ID)
    retitle('Edited')
    const log = projectStore.operationLog()
    expect(log.at(-1)?.op).toBe('plot.style')
    projectStore.setReadOnly(true)
    await persistence.openAsCopy('Copy')
    expect(state().doc.id).not.toBe(ID)
    expect(projectStore.operationLog()).toEqual(log)
  })
})

describe('restoring the last project at startup', () => {
  it('never replaces a table pasted while the stored project was being read, and saves the paste', async () => {
    store(structuredClone(V2))
    hooks.onGet = (key) => {
      if (key !== `p:${ID}:doc`) return
      hooks.onGet = null
      pasteTable()
    }
    await persistence.startPersistence()
    const doc = state().doc
    expect(doc.id).not.toBe(ID)
    expect(doc.datasets).toHaveLength(1)
    const raw = doc.datasets[0]!.origin === 'import' ? doc.datasets[0]!.rawTableId : null
    expect(raw && dataStore.useDataStore.getState().rawTables[raw]).toBeTruthy()
    expect(uiStore.ui.get().storage).toBe('pending')
    await persistence.flushAutosave()
    expect(record(doc.id).doc.datasets).toHaveLength(1)
    expect(record(ID).doc.id).toBe(ID) // the stored project is left as it was
  })

  it('restores the stored project when nothing happened meanwhile', async () => {
    store(structuredClone(V2))
    await persistence.startPersistence()
    expect(state().doc.id).toBe(ID)
    expect(state().readOnly).toBe(false)
  })
})

describe('the tab lock at startup', () => {
  it('a project opened while the first lock is being taken gets a lock of its own', async () => {
    const requested: string[] = []
    let firstAsked!: () => void
    const asked = new Promise<void>((r) => (firstAsked = r))
    let letFirstThrough!: () => void
    const gate = new Promise<void>((r) => (letFirstThrough = r))
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, _opts: unknown, cb: (lock: object | null) => unknown) => {
          requested.push(name)
          if (requested.length === 1) {
            firstAsked()
            await gate
          }
          return cb({ name })
        },
      },
    })
    const starting = persistence.startPersistence()
    await asked
    // A .sciplot dropped on the page while the lock of the blank project is requested.
    projectStore.loadProject(projectStore.emptyProject('Opened'))
    const opened = state().doc.id
    letFirstThrough()
    await starting
    await new Promise((r) => setTimeout(r, 0))
    expect(requested).toContain(`brief:project:${opened}`)
    expect(state().readOnly).toBe(false)
  })
})
