import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as LocksModule from './locks'

/** Minimal Web Locks: exclusive locks, ifAvailable, waiting requests that an AbortSignal can cancel. */
class FakeLocks {
  held = new Set<string>()
  private waiting = new Map<string, (() => void)[]>()

  async request(
    name: string,
    opts: { ifAvailable?: boolean; signal?: AbortSignal },
    cb: (lock: { name: string } | null) => unknown,
  ): Promise<unknown> {
    if (opts.ifAvailable && this.held.has(name)) return cb(null)
    while (this.held.has(name)) {
      await new Promise<void>((resolve, reject) => {
        this.waiting.set(name, [...(this.waiting.get(name) ?? []), resolve])
        opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    }
    this.held.add(name)
    try {
      return await cb({ name })
    } finally {
      this.held.delete(name)
      this.waiting.get(name)?.shift()?.()
    }
  }

  /** Another tab takes the lock and keeps it until the returned function is called. */
  otherTab(name: string): () => void {
    let letGo = () => {}
    void this.request(name, {}, () => new Promise<void>((r) => (letGo = r)))
    return () => letGo()
  }
}

let locks: FakeLocks
let mod: typeof LocksModule
const NAME = (id: string) => `brief:project:${id}`
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(async () => {
  locks = new FakeLocks()
  vi.stubGlobal('navigator', { locks })
  vi.resetModules()
  mod = await import('./locks')
})
afterEach(() => vi.unstubAllGlobals())

describe('project lock', () => {
  it('two simultaneous requests for the same project share one lock (React dev mode starts twice)', async () => {
    expect(await Promise.all([mod.acquireProjectLock('p'), mod.acquireProjectLock('p')])).toEqual([
      true,
      true,
    ])
    expect(await mod.acquireProjectLock('p')).toBe(true)
    expect([...locks.held]).toEqual([NAME('p')])
  })

  it('is refused while another tab writes the project, and taken over when that tab lets go', async () => {
    const letGo = locks.otherTab(NAME('p'))
    await tick()
    expect(await mod.acquireProjectLock('p')).toBe(false)
    const waiting = mod.waitForProjectLock('p')
    letGo()
    expect(await waiting).toBe(true)
    expect(await mod.acquireProjectLock('p')).toBe(true)
  })

  it('opening another project (a copy) cancels the wait and holds only the new lock', async () => {
    locks.otherTab(NAME('p'))
    await tick()
    const waiting = mod.waitForProjectLock('p')
    expect(await mod.acquireProjectLock('copy')).toBe(true)
    expect(await waiting).toBe(false)
    expect(locks.held.has(NAME('copy'))).toBe(true)
  })

  it('tells whether another tab holds a project, without counting this tab or taking the lock', async () => {
    const letGo = locks.otherTab(NAME('elsewhere'))
    await tick()
    await mod.acquireProjectLock('mine')
    expect(await mod.isProjectLockedElsewhere('elsewhere')).toBe(true)
    expect(await mod.isProjectLockedElsewhere('mine')).toBe(false)
    expect(await mod.isProjectLockedElsewhere('free')).toBe(false)
    expect(locks.held.has(NAME('free'))).toBe(false)
    letGo()
    await tick()
    expect(await mod.isProjectLockedElsewhere('elsewhere')).toBe(false)
  })

  it('switching project releases the previous lock for other tabs', async () => {
    await mod.acquireProjectLock('a')
    await mod.acquireProjectLock('b')
    await tick()
    expect(locks.held.has(NAME('a'))).toBe(false)
    expect(locks.held.has(NAME('b'))).toBe(true)
  })
})
