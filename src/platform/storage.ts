import { createStore, get, getMany, setMany, del, delMany, keys, update, type UseStore } from 'idb-keyval'
import type { OperationLogEntry, ProjectDoc, RawTable, WorkspaceState } from '@/domain/model'
import { deleteFormerDatabase, readFormerRecords } from './formerDatabase'

/**
 * Local project storage in IndexedDB (structured clone keeps typed arrays intact).
 * Keys are per project, so one project can never delete another's data:
 *   index                → ProjectIndexEntry[]
 *   p:<id>:doc           → { schemaVersion, doc, log, workspace, savedAt }
 *   p:<id>:raw:<rawId>   → RawTable (immutable, written once)
 *   adopted              → ISO date, once the database of the former name is adopted (see below)
 * Every failure is classified so the UI can explain it; nothing here throws to the caller.
 * Records of an older schema are returned as they are: migrating them needs the domain, which this
 * layer may not import (src/state/persistence.ts does it).
 */
export const STORAGE_SCHEMA = 2

/** A stored project as read back, before migration: `doc` and `log` have the shape of `version`. */
export interface StoredProjectRecord {
  version: number
  doc: unknown
  log: unknown
  /** null in records of schema 1 and when nothing was laid out. */
  workspace: WorkspaceState | null
  rawTables: Record<string, RawTable>
}

export interface ProjectIndexEntry {
  id: string
  name: string
  updatedAt: string
  datasets: number
}

export type StorageError = 'unavailable' | 'quota' | 'unknown'
export type StorageResult<T> = { ok: true; value: T } | { ok: false; error: StorageError }

const DATABASE = 'brief'
/** Written once the records of the former database are adopted (or there were none). */
const ADOPTED = 'adopted'
const ADOPT_LOCK = 'brief:storage:adopt'

let store: UseStore | null = null
/** The first probe, shared by every caller: a page opens the database once. */
let probe: Promise<boolean> | null = null

function classify(err: unknown): StorageError {
  const name = (err as { name?: string })?.name ?? ''
  if (name === 'QuotaExceededError' || /quota/i.test(String((err as Error)?.message))) return 'quota'
  if (
    name === 'SecurityError' ||
    name === 'InvalidStateError' ||
    name === 'UnknownError' ||
    name === 'NotFoundError'
  )
    return 'unavailable'
  return 'unknown'
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'UnknownError' })), ms),
    ),
  ])
}

/** Opens the database once; private windows or blocked site data make it unavailable. */
export function probeStorage(): Promise<boolean> {
  probe ??= openStore()
  return probe
}

async function openStore(): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined')
      throw Object.assign(new Error('no indexedDB'), { name: 'SecurityError' })
    const s = createStore(DATABASE, 'kv')
    const adopted = await withTimeout(get(ADOPTED, s), 3000)
    if (adopted === undefined) await adoptFormerRecords(s)
    store = s
    return true
  } catch {
    store = null
    return false
  }
}

/**
 * Projects saved before the app was named BRIEF are in the database of its former name. Until they
 * are adopted (ADOPTED is written), every start copies the former records this database lacks, adds
 * their entries to the index, and deletes the former database once all of them are confirmed here.
 * Records saved here in the meantime (after a copy failed, for example on a full disk) are kept as
 * they are. Tabs take turns (Web Lock), so tabs opened together copy once. A failure leaves the
 * former database as it was, for the next start.
 */
async function adoptFormerRecords(s: UseStore): Promise<void> {
  const adopt = async () => {
    // Another tab may have adopted them while this one waited for the lock.
    if ((await get(ADOPTED, s)) !== undefined) return
    const records = await withTimeout(readFormerRecords(), 10_000)
    if (!records) return
    const before = new Set((await keys(s)).map(String))
    await setMany(
      records.filter(([key]) => key !== 'index' && !before.has(String(key))),
      s,
    )
    const formerIndex = records.find(([key]) => key === 'index')?.[1]
    if (Array.isArray(formerIndex) && formerIndex.length)
      await updateIndex(s, (index) => [
        ...index,
        ...(formerIndex as ProjectIndexEntry[]).filter((e) => !index.some((f) => f.id === e.id)),
      ])
    const here = new Set((await keys(s)).map(String))
    if (!records.every(([key]) => key === 'index' || here.has(String(key)))) return
    await setMany([[ADOPTED, new Date().toISOString()]], s)
    if (records.length) await deleteFormerDatabase()
  }
  try {
    const locks = (globalThis.navigator as (Navigator & { locks?: LockManager }) | undefined)?.locks
    await (locks ? locks.request(ADOPT_LOCK, adopt) : adopt())
  } catch {
    // The former records stay where they are, to be copied at the next start.
  }
}

async function run<T>(fn: (s: UseStore) => Promise<T>): Promise<StorageResult<T>> {
  if (!(await probeStorage()) || !store) return { ok: false, error: 'unavailable' }
  try {
    return { ok: true, value: await fn(store) }
  } catch (err) {
    return { ok: false, error: classify(err) }
  }
}

const writtenRaw = new Set<string>()

/**
 * The index is shared by every tab: it is changed only inside one read-write transaction, so two tabs
 * saving or deleting at the same time never drop each other's entries.
 */
function updateIndex(
  s: UseStore,
  change: (index: ProjectIndexEntry[]) => ProjectIndexEntry[],
): Promise<void> {
  return update<ProjectIndexEntry[]>('index', (index) => change(index ?? []), s)
}

/**
 * Saves one project: its new raw tables and its document in one transaction, then its index entry.
 * The document is written first, so a failed index update can only leave a stale entry that the
 * next save corrects, never an entry without a document.
 */
export async function saveProject(
  doc: ProjectDoc,
  log: readonly OperationLogEntry[],
  rawTables: Readonly<Record<string, RawTable>>,
  opts: { workspace?: WorkspaceState | null } = {},
): Promise<StorageResult<void>> {
  return run(async (s) => {
    const referenced = doc.datasets.flatMap((d) => (d.origin === 'import' ? [d.rawTableId] : []))
    const entries: [IDBValidKey, unknown][] = []
    for (const rawId of referenced) {
      const key = `p:${doc.id}:raw:${rawId}`
      if (writtenRaw.has(key)) continue
      const raw = rawTables[rawId]
      if (raw) entries.push([key, raw])
    }
    entries.push([
      `p:${doc.id}:doc`,
      {
        schemaVersion: STORAGE_SCHEMA,
        doc,
        log,
        workspace: opts.workspace ?? null,
        savedAt: new Date().toISOString(),
      },
    ])
    await setMany(entries, s)
    for (const [k] of entries) if (String(k).includes(':raw:')) writtenRaw.add(String(k))
    const entry = { id: doc.id, name: doc.name, updatedAt: doc.updatedAt, datasets: doc.datasets.length }
    await updateIndex(s, (index) => [entry, ...index.filter((e) => e.id !== doc.id)])
  })
}

export async function listProjects(): Promise<StorageResult<ProjectIndexEntry[]>> {
  return run(async (s) => {
    const index = (await get<ProjectIndexEntry[]>('index', s)) ?? []
    return [...index].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  })
}

/** Raw table ids of the imported datasets of a stored document, whatever its schema version. */
function referencedRawIds(doc: unknown): string[] {
  const datasets = typeof doc === 'object' && doc !== null ? (doc as { datasets?: unknown }).datasets : null
  if (!Array.isArray(datasets)) return []
  return datasets.flatMap((d: unknown) => {
    const ds = d as { origin?: unknown; rawTableId?: unknown } | null
    return ds?.origin === 'import' && typeof ds.rawTableId === 'string' ? [ds.rawTableId] : []
  })
}

/** null when there is no such project, or it was saved by a newer schema (never overwritten by this tab). */
export async function loadProject(id: string): Promise<StorageResult<StoredProjectRecord | null>> {
  return run(async (s) => {
    const rec = await get<{
      schemaVersion: unknown
      doc: unknown
      log?: unknown
      workspace?: WorkspaceState | null
    }>(`p:${id}:doc`, s)
    const version = rec?.schemaVersion
    if (!rec || typeof version !== 'number' || !Number.isInteger(version) || version > STORAGE_SCHEMA)
      return null
    const rawIds = referencedRawIds(rec.doc)
    const raws = await getMany<RawTable>(
      rawIds.map((r) => `p:${id}:raw:${r}`),
      s,
    )
    const rawTables: Record<string, RawTable> = {}
    rawIds.forEach((r, i) => {
      if (raws[i]) {
        rawTables[r] = raws[i]
        writtenRaw.add(`p:${id}:raw:${r}`)
      }
    })
    // A dataset whose raw table is missing cannot be restored: drop the project rather than show wrong data.
    if (rawIds.some((r) => !rawTables[r])) return null
    return { version, doc: rec.doc, log: rec.log ?? [], workspace: rec.workspace ?? null, rawTables }
  })
}

/** Removes the index entry first: a failure after it leaves unlisted data, never a listed project without it. */
export async function deleteProject(id: string): Promise<StorageResult<void>> {
  return run(async (s) => {
    await updateIndex(s, (index) => index.filter((e) => e.id !== id))
    const all = (await keys(s)).map(String).filter((k) => k.startsWith(`p:${id}:`))
    await delMany(all, s)
    for (const k of all) writtenRaw.delete(k)
  })
}

/** Removes raw tables no longer referenced by the saved document (only called when undo history is empty). */
export async function collectGarbage(doc: ProjectDoc): Promise<StorageResult<number>> {
  return run(async (s) => {
    const keep = new Set(
      doc.datasets.flatMap((d) => (d.origin === 'import' ? [`p:${doc.id}:raw:${d.rawTableId}`] : [])),
    )
    const stale = (await keys(s)).map(String).filter((k) => k.startsWith(`p:${doc.id}:raw:`) && !keep.has(k))
    for (const k of stale) {
      await del(k, s)
      writtenRaw.delete(k)
    }
    return stale.length
  })
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    return e && e.usage !== undefined && e.quota !== undefined ? { used: e.usage, quota: e.quota } : null
  } catch {
    return null
  }
}
