/**
 * Before the app was named BRIEF, it stored projects in an IndexedDB database named after its former
 * name, with the same layout (one "kv" object store, written by idb-keyval). storage.ts copies those
 * records into the current database once; these helpers read and delete the old database with the
 * plain IndexedDB API, which, unlike idb-keyval, can tell a missing database without creating it.
 */
export const FORMER_DATABASE = 'scientific-data-explorer'
const STORE = 'kv'

/**
 * Every record of the former database, in key order: none when there is no such database, null when
 * it cannot be read (worth trying again later).
 */
export function readFormerRecords(
  idb: IDBFactory | undefined = globalThis.indexedDB,
): Promise<[IDBValidKey, unknown][] | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      if (!idb) throw new Error('no IndexedDB')
      request = idb.open(FORMER_DATABASE)
    } catch {
      resolve(null)
      return
    }
    let missing = false
    // Opening without a version upgrades only a database that does not exist yet: aborting that
    // upgrade fails the request and leaves no empty database behind.
    request.onupgradeneeded = () => {
      missing = true
      request.transaction?.abort()
    }
    request.onerror = (event) => {
      event.preventDefault()
      resolve(missing ? [] : null)
    }
    request.onsuccess = () => {
      const db = request.result
      const finish = (records: [IDBValidKey, unknown][] | null) => {
        // Closed at once: an open connection would hold up the deletion that follows the copy.
        db.close()
        resolve(records)
      }
      // Without the store (a database left empty by a browser), there is nothing to read.
      if (!db.objectStoreNames.contains(STORE)) return finish([])
      try {
        const tx = db.transaction(STORE, 'readonly')
        const keys = tx.objectStore(STORE).getAllKeys()
        const values = tx.objectStore(STORE).getAll()
        tx.oncomplete = () => finish(keys.result.map((key, i) => [key, values.result[i]]))
        tx.onerror = tx.onabort = () => finish(null)
      } catch {
        finish(null)
      }
    }
  })
}

/**
 * Deletes the former database. Resolves true once it is gone, false if that failed or must wait for
 * another tab that still has it open (the browser then deletes it when that tab closes).
 */
export function deleteFormerDatabase(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (!idb) throw new Error('no IndexedDB')
      const request = idb.deleteDatabase(FORMER_DATABASE)
      request.onsuccess = () => resolve(true)
      request.onerror = (event) => {
        event.preventDefault()
        resolve(false)
      }
      request.onblocked = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}
