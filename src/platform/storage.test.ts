import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectDoc } from '@/domain/model'
import { fakeIndexedDB, withKeyValueDatabase, type FakeIndexedDB } from '@/test/fakeIndexedDB'
import { FORMER_DATABASE } from './formerDatabase'
import type * as StorageModule from './storage'

/**
 * idb-keyval over one Map shared by "two tabs". Every call yields to the event loop first, as an
 * IndexedDB transaction does, so concurrent saves interleave; update() is one read-write transaction.
 * `failures.setMany` makes the next writes fail as a full disk does.
 */
const db = vi.hoisted(() => new Map<string, unknown>())
const failures = vi.hoisted(() => ({ setMany: 0 }))
vi.mock('idb-keyval', () => {
  const later = () => new Promise((r) => setTimeout(r, 0))
  return {
    createStore: () => ({}),
    get: async (k: string) => (await later(), structuredClone(db.get(k))),
    getMany: async (ks: string[]) => (await later(), ks.map((k) => structuredClone(db.get(k)))),
    setMany: async (entries: [string, unknown][]) => {
      await later()
      if (failures.setMany > 0) {
        failures.setMany--
        throw Object.assign(new Error('disk full'), { name: 'QuotaExceededError' })
      }
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

const doc = (id: string): ProjectDoc =>
  ({
    id,
    name: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    datasets: [],
    plots: [],
    activePlotId: null,
    fits: [],
    exclusions: [],
    filters: [],
    numberFormat: { decimal: 'auto' },
  }) as unknown as ProjectDoc

let storage: typeof StorageModule
const indexIds = () => ((db.get('index') ?? []) as { id: string }[]).map((e) => e.id).sort()

beforeEach(async () => {
  db.clear()
  failures.setMany = 0
  vi.stubGlobal('indexedDB', {})
  vi.resetModules()
  storage = await import('./storage')
})
afterEach(() => vi.unstubAllGlobals())

describe('the shared project index', () => {
  it('two tabs saving different projects at the same time both stay listed', async () => {
    const [a, b] = await Promise.all([
      storage.saveProject(doc('prj_a'), [], {}),
      storage.saveProject(doc('prj_b'), [], {}),
    ])
    expect(a.ok && b.ok).toBe(true)
    expect(indexIds()).toEqual(['prj_a', 'prj_b'])
  })

  it('deleting one project while another tab saves its own keeps the other entry', async () => {
    await storage.saveProject(doc('prj_a'), [], {})
    await Promise.all([storage.deleteProject('prj_a'), storage.saveProject(doc('prj_b'), [], {})])
    expect(indexIds()).toEqual(['prj_b'])
    expect(db.has('p:prj_a:doc')).toBe(false)
    expect(db.has('p:prj_b:doc')).toBe(true)
  })

  it('a save moves its entry to the front and never duplicates it', async () => {
    await storage.saveProject(doc('prj_a'), [], {})
    await storage.saveProject(doc('prj_b'), [], {})
    await storage.saveProject({ ...doc('prj_a'), name: 'renamed' }, [], {})
    expect(db.get('index')).toEqual([
      { id: 'prj_a', name: 'renamed', updatedAt: '2026-01-01T00:00:00.000Z', datasets: 0 },
      { id: 'prj_b', name: 'prj_b', updatedAt: '2026-01-01T00:00:00.000Z', datasets: 0 },
    ])
  })
})

describe('projects saved before the app was named BRIEF', () => {
  let idb: FakeIndexedDB
  const raw = { id: 'raw_1', values: new Float64Array([0.5, 1.5, 2.5]) }
  /** The database of the former name, as a user of that version left it: one project with data. */
  const formerRecords = () => ({
    index: [{ id: 'prj_old', name: 'Lab 3', updatedAt: '2026-09-01T00:00:00.000Z', datasets: 1 }],
    'p:prj_old:doc': {
      schemaVersion: 2,
      doc: {
        ...doc('prj_old'),
        name: 'Lab 3',
        datasets: [{ id: 'ds_1', origin: 'import', rawTableId: 'raw_1' }],
      },
      log: [],
      workspace: null,
      savedAt: '2026-09-01T00:00:00.000Z',
    },
    'p:prj_old:raw:raw_1': raw,
  })
  /** Another tab: a fresh copy of the module over the same databases. */
  const openTab = async () => (vi.resetModules(), await import('./storage'))

  beforeEach(() => {
    idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb.factory)
  })

  it('are listed and opened with their raw tables, then the former database is deleted', async () => {
    withKeyValueDatabase(idb, FORMER_DATABASE, formerRecords())
    expect(await storage.listProjects()).toEqual({
      ok: true,
      value: [expect.objectContaining({ id: 'prj_old', name: 'Lab 3' })],
    })
    const loaded = await storage.loadProject('prj_old')
    expect(loaded.ok && loaded.value?.rawTables).toEqual({ raw_1: raw })
    expect(loaded.ok && loaded.value?.rawTables.raw_1).toMatchObject({ values: expect.any(Float64Array) })
    expect(idb.databases.has(FORMER_DATABASE)).toBe(false)
    expect(idb.openConnections(FORMER_DATABASE)).toBe(0)
  })

  it('a first visit creates no database of the former name, and later starts do not look for it', async () => {
    expect(await storage.probeStorage()).toBe(true)
    expect(idb.databases.has(FORMER_DATABASE)).toBe(false)
    expect(await (await openTab()).probeStorage()).toBe(true)
    expect(idb.opens(FORMER_DATABASE)).toBe(1)
  })

  it('once adopted, a database of the former name is never read again', async () => {
    db.set('adopted', '2026-10-01T00:00:00.000Z')
    db.set('index', []) // every project deleted since
    withKeyValueDatabase(idb, FORMER_DATABASE, formerRecords())
    expect(await storage.listProjects()).toEqual({ ok: true, value: [] })
    expect(idb.opens(FORMER_DATABASE)).toBe(0)
    expect(idb.databases.has(FORMER_DATABASE)).toBe(true)
  })

  it('records saved in this version are never overwritten by the former ones', async () => {
    withKeyValueDatabase(idb, FORMER_DATABASE, formerRecords())
    // The same project, renamed in this version after a copy that failed.
    const { index, 'p:prj_old:doc': record, 'p:prj_old:raw:raw_1': table } = formerRecords()
    db.set('index', [{ ...index[0], name: 'Lab 3 (fixed)' }])
    db.set('p:prj_old:doc', { ...record, doc: { ...record.doc, name: 'Lab 3 (fixed)' } })
    db.set('p:prj_old:raw:raw_1', table)
    expect(await storage.listProjects()).toEqual({
      ok: true,
      value: [expect.objectContaining({ id: 'prj_old', name: 'Lab 3 (fixed)' })],
    })
    expect(await storage.loadProject('prj_old')).toMatchObject({
      ok: true,
      value: { doc: { name: 'Lab 3 (fixed)' } },
    })
    expect(idb.databases.has(FORMER_DATABASE)).toBe(false)
  })

  it('a former database that cannot be read is tried again at the next start', async () => {
    withKeyValueDatabase(idb, FORMER_DATABASE, formerRecords())
    const open = idb.factory.open.bind(idb.factory)
    idb.factory.open = (name: string) => {
      if (name === FORMER_DATABASE) throw Object.assign(new Error('blocked'), { name: 'UnknownError' })
      return open(name)
    }
    expect(await storage.listProjects()).toEqual({ ok: true, value: [] })
    idb.factory.open = open
    expect(await (await openTab()).listProjects()).toMatchObject({ ok: true, value: [{ id: 'prj_old' }] })
  })

  it('a former database whose projects were all deleted is adopted once, and deleted', async () => {
    withKeyValueDatabase(idb, FORMER_DATABASE, { index: [] })
    expect(await storage.listProjects()).toEqual({ ok: true, value: [] })
    expect(idb.databases.has(FORMER_DATABASE)).toBe(false)
    expect(db.has('adopted')).toBe(true)
  })

  it('a copy that fails (disk full) keeps the former database, and the next start copies it', async () => {
    withKeyValueDatabase(idb, FORMER_DATABASE, formerRecords())
    failures.setMany = 1
    expect(await storage.listProjects()).toEqual({ ok: true, value: [] })
    expect(idb.databases.has(FORMER_DATABASE)).toBe(true)
    const next = await openTab()
    expect(await next.listProjects()).toMatchObject({ ok: true, value: [{ id: 'prj_old' }] })
    expect(idb.databases.has(FORMER_DATABASE)).toBe(false)
  })

  it('a copy that fails, then a project saved in this version: the next start adds the former projects', async () => {
    withKeyValueDatabase(idb, FORMER_DATABASE, formerRecords())
    failures.setMany = 1
    expect(await storage.listProjects()).toEqual({ ok: true, value: [] })
    // The student carries on in this version, unaware of the projects that were not copied.
    expect((await storage.saveProject(doc('prj_new'), [], {})).ok).toBe(true)
    const next = await openTab()
    expect(await next.listProjects()).toMatchObject({
      ok: true,
      value: [{ id: 'prj_old' }, { id: 'prj_new' }],
    })
    expect((await next.loadProject('prj_old')).ok && (await next.loadProject('prj_old'))).toMatchObject({
      value: { rawTables: { raw_1: raw } },
    })
    expect(await next.loadProject('prj_new')).toMatchObject({ ok: true, value: { doc: { id: 'prj_new' } } })
    expect(idb.databases.has(FORMER_DATABASE)).toBe(false)
  })

  it('while a tab of the former version keeps it open, the copy is used and not made again', async () => {
    withKeyValueDatabase(idb, FORMER_DATABASE, formerRecords())
    const oldTab = idb.factory.open(FORMER_DATABASE)
    await new Promise((r) => (oldTab.onsuccess = r))
    expect(await storage.listProjects()).toMatchObject({ ok: true, value: [{ id: 'prj_old' }] })
    // Deleting it is blocked until that tab closes; nothing waits for it.
    expect(idb.databases.has(FORMER_DATABASE)).toBe(true)
    const next = await openTab()
    expect(await next.listProjects()).toMatchObject({ ok: true, value: [{ id: 'prj_old' }] })
    expect(idb.opens(FORMER_DATABASE)).toBe(2) // the old tab's and the first copy's
  })

  it('two tabs started together copy the former records once (they take turns with a Web Lock)', async () => {
    withKeyValueDatabase(idb, FORMER_DATABASE, formerRecords())
    const queues = new Map<string, Promise<unknown>>()
    const locks = {
      request(name: string, callback: () => Promise<unknown>) {
        const turn = (queues.get(name) ?? Promise.resolve()).then(callback)
        queues.set(
          name,
          turn.catch(() => undefined),
        )
        return turn
      },
    }
    vi.stubGlobal('navigator', { locks })
    const second = await openTab()
    expect(await Promise.all([storage.probeStorage(), second.probeStorage()])).toEqual([true, true])
    expect(idb.opens(FORMER_DATABASE)).toBe(1)
    expect(indexIds()).toEqual(['prj_old'])
  })
})
