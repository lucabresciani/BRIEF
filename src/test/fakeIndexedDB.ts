/**
 * Just enough of IndexedDB for src/platform/formerDatabase.ts: named databases of key/value object
 * stores, events fired on a later task as a browser fires them, values stored as structured clones.
 * Opening a missing database runs an upgrade that creates it unless the upgrade is aborted; deleting
 * a database that still has an open connection is blocked.
 */
export interface FakeIndexedDB {
  factory: IDBFactory
  /** database → object store → records */
  databases: Map<string, Map<string, Map<IDBValidKey, unknown>>>
  /** Connections opened and not closed yet, per database. */
  openConnections: (name: string) => number
  /** Times each database was opened. */
  opens: (name: string) => number
}

const later = (fn: () => void) => setTimeout(fn, 0)

function event(target: unknown) {
  return { target, preventDefault() {} }
}

export function fakeIndexedDB(): FakeIndexedDB {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>()
  const connections = new Map<string, number>()
  const openCount = new Map<string, number>()

  function connect(name: string) {
    connections.set(name, (connections.get(name) ?? 0) + 1)
    let closed = false
    const stores = () => databases.get(name) ?? new Map<string, Map<IDBValidKey, unknown>>()
    return {
      objectStoreNames: { contains: (store: string) => stores().has(store) },
      close() {
        if (closed) return
        closed = true
        connections.set(name, (connections.get(name) ?? 1) - 1)
      },
      transaction(storeName: string) {
        const records = stores().get(storeName)
        if (!records) throw Object.assign(new Error(storeName), { name: 'NotFoundError' })
        const tx: Record<string, unknown> & { oncomplete?: () => void } = {}
        const request = (result: () => unknown) => {
          const r: { result?: unknown } = {}
          later(() => (r.result = result()))
          return r
        }
        const sortedKeys = () => [...records.keys()].sort()
        tx.objectStore = () => ({
          getAllKeys: () => request(sortedKeys),
          getAll: () => request(() => sortedKeys().map((k) => structuredClone(records.get(k)))),
        })
        // Completes after its requests, which are made in the same task as the transaction.
        later(() => later(() => tx.oncomplete?.()))
        return tx
      },
    }
  }

  const factory = {
    open(name: string) {
      openCount.set(name, (openCount.get(name) ?? 0) + 1)
      const request: Record<string, unknown> & {
        onupgradeneeded?: (e: unknown) => void
        onsuccess?: (e: unknown) => void
        onerror?: (e: unknown) => void
      } = {}
      later(() => {
        if (!databases.has(name)) {
          let aborted = false
          request.transaction = { abort: () => (aborted = true) }
          request.onupgradeneeded?.(event(request))
          request.transaction = null
          if (aborted) {
            request.error = Object.assign(new Error('aborted'), { name: 'AbortError' })
            request.onerror?.(event(request))
            return
          }
          databases.set(name, new Map())
        }
        request.result = connect(name)
        request.onsuccess?.(event(request))
      })
      return request
    },
    deleteDatabase(name: string) {
      const request: Record<string, unknown> & {
        onsuccess?: (e: unknown) => void
        onblocked?: (e: unknown) => void
      } = {}
      later(() => {
        if ((connections.get(name) ?? 0) > 0) {
          request.onblocked?.(event(request))
          return
        }
        databases.delete(name)
        request.onsuccess?.(event(request))
      })
      return request
    },
  } as unknown as IDBFactory

  return {
    factory,
    databases,
    openConnections: (name) => connections.get(name) ?? 0,
    opens: (name) => openCount.get(name) ?? 0,
  }
}

/** One database with one "kv" store holding `records`, as idb-keyval writes it. */
export function withKeyValueDatabase(fake: FakeIndexedDB, name: string, records: Record<string, unknown>) {
  fake.databases.set(name, new Map([['kv', new Map(Object.entries(records))]]))
}
