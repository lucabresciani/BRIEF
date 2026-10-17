/**
 * One tab writes a project at a time (Web Locks). Other tabs open it read-only and may open a copy;
 * a read-only tab waits in the background and can write again as soon as the other tab lets go.
 * Browsers without Web Locks simply skip the check.
 */
let release: (() => void) | null = null
let heldFor: string | null = null
/** A request in progress: callers asking for the same project share it instead of racing each other. */
let inflight: { id: string; promise: Promise<boolean> } | null = null
/** The background wait of a read-only tab (at most one). */
let waiter: AbortController | null = null

const lockName = (projectId: string) => `brief:project:${projectId}`
const lockManager = () => (navigator as Navigator & { locks?: LockManager }).locks

/** Keeps the granted lock until releaseProjectLock (or the tab closes). */
function hold(projectId: string): Promise<void> {
  heldFor = projectId
  return new Promise<void>((r) => {
    release = () => {
      heldFor = null
      release = null
      r()
    }
  })
}

function cancelWait(): void {
  waiter?.abort()
  waiter = null
}

/** Takes the lock if no other tab holds it. Resolves false when another tab is writing the project. */
export function acquireProjectLock(projectId: string): Promise<boolean> {
  if (heldFor === projectId) return Promise.resolve(true)
  if (inflight?.id === projectId) return inflight.promise
  cancelWait()
  releaseProjectLock()
  const locks = lockManager()
  if (!locks) return Promise.resolve(true)
  const promise = new Promise<boolean>((resolve) => {
    void locks.request(lockName(projectId), { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false)
        return undefined
      }
      resolve(true)
      return hold(projectId)
    })
  }).finally(() => {
    if (inflight?.promise === promise) inflight = null
  })
  inflight = { id: projectId, promise }
  return promise
}

/**
 * Waits until the other tab releases the project (closed, or opened something else), then holds the
 * lock. Resolves false if the wait is cancelled: taking any other lock cancels it.
 */
export function waitForProjectLock(projectId: string): Promise<boolean> {
  cancelWait()
  const locks = lockManager()
  if (!locks) return Promise.resolve(false)
  const ctrl = new AbortController()
  waiter = ctrl
  return new Promise<boolean>((resolve) => {
    locks
      .request(lockName(projectId), { signal: ctrl.signal }, (lock) => {
        if (!lock || waiter !== ctrl) {
          resolve(false)
          return undefined
        }
        waiter = null
        releaseProjectLock()
        resolve(true)
        return hold(projectId)
      })
      .catch(() => resolve(false))
  })
}

export function releaseProjectLock(): void {
  release?.()
}

/**
 * True while another tab holds the project: it is open there and its next autosave would write it
 * back. This tab's own lock does not count, and without Web Locks nothing is known (false).
 */
export async function isProjectLockedElsewhere(projectId: string): Promise<boolean> {
  if (heldFor === projectId) return false
  const locks = lockManager()
  if (!locks) return false
  try {
    // A free lock is taken and released at once; a held one is not waited for.
    return await locks.request(lockName(projectId), { ifAvailable: true }, (lock) => lock === null)
  } catch {
    return false
  }
}

// During development a hot update re-runs this module; the old copy's lock would otherwise stay held.
import.meta.hot?.dispose(() => {
  cancelWait()
  releaseProjectLock()
})
