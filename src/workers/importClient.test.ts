import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from './importClient'
import type { WorkerRequest, WorkerResponse } from './protocol'

/** The main-thread fallback: records what it was asked, answers with an empty draft result. */
const fallback = {
  calls: [] as { type: string; byteLength: number | null }[],
  failToLoad: false,
}
function handlersModule() {
  if (fallback.failToLoad) throw new Error('chunk failed to load')
  return {
    handleRequest: async (req: WorkerRequest): Promise<WorkerResponse> => {
      fallback.calls.push({ type: req.type, byteLength: 'bytes' in req ? req.bytes.byteLength : null })
      return answer(req)
    },
  }
}

function answer(req: WorkerRequest): WorkerResponse {
  const result = {
    ok: false as const,
    error: { code: 'E_EMPTY_INPUT' as const, severity: 'error' as const },
    warnings: [],
  }
  return req.type === 'importRegions'
    ? { requestId: req.requestId, type: 'drafts', result }
    : { requestId: req.requestId, type: 'draft', result }
}

/** A dedicated worker that only records: the test decides when (and whether) it answers. */
class FakeWorker extends EventTarget {
  static all: FakeWorker[] = []
  posted: { msg: WorkerRequest; transfer: Transferable[] }[] = []
  listeners = 0
  terminated = false
  constructor() {
    super()
    FakeWorker.all.push(this)
  }
  override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
    this.listeners++
    super.addEventListener(...args)
  }
  postMessage(msg: WorkerRequest, transfer: Transferable[] = []) {
    // As the browser does: transferred buffers are detached from the sender.
    this.posted.push({ msg: structuredClone(msg, { transfer }), transfer })
  }
  terminate() {
    this.terminated = true
  }
  reply(res: WorkerResponse) {
    this.dispatchEvent(new MessageEvent('message', { data: res }))
  }
  replyAll() {
    for (const { msg } of this.posted.splice(0)) this.reply(answer(msg))
  }
}

let client: typeof ClientModule
async function loadClient() {
  vi.resetModules()
  vi.doMock('./handlers', handlersModule)
  client = await import('./importClient')
}
const bytes = () => new Uint8Array([1, 2, 3, 4]).buffer
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(async () => {
  FakeWorker.all = []
  fallback.calls = []
  fallback.failToLoad = false
  vi.stubGlobal('Worker', FakeWorker)
  await loadClient()
})
afterEach(() => vi.unstubAllGlobals())

describe('import worker client', () => {
  it('registers its error listeners once per worker, however many requests it serves', async () => {
    for (let i = 0; i < 5; i++) {
      const r = client.parseText('a\n1', { kind: 'clipboard', fileName: null })
      FakeWorker.all[0]!.replyAll()
      await r
    }
    expect(FakeWorker.all).toHaveLength(1)
    // message + error + messageerror; never one more per request.
    expect(FakeWorker.all[0]!.listeners).toBe(3)
    expect((FakeWorker.all[0] as unknown as { onerror?: unknown }).onerror).toBeUndefined()
  })

  it('a worker error answers every request in flight on the main thread', async () => {
    const a = client.parseText('a\n1', { kind: 'clipboard', fileName: null })
    const b = client.reparseBytes(bytes(), 'b.csv')
    await tick()
    FakeWorker.all[0]!.dispatchEvent(new Event('error'))
    const [ra, rb] = await Promise.all([a, b])
    expect(fallback.calls.map((c) => c.type)).toEqual(['parseText', 'parseFile'])
    for (const r of [ra, rb]) expect(r.warnings.map((w) => w.code)).toContain('W_WORKER_FALLBACK')
    expect(FakeWorker.all[0]!.terminated).toBe(true)
  })

  it('an answer that cannot be received (messageerror) does not leave the request hanging', async () => {
    const r = client.parseText('a\n1', { kind: 'clipboard', fileName: null })
    await tick()
    FakeWorker.all[0]!.dispatchEvent(new MessageEvent('messageerror'))
    expect((await r).warnings.map((w) => w.code)).toContain('W_WORKER_FALLBACK')
  })

  it('file bytes are transferred as one copy; the caller keeps its own', async () => {
    const mine = bytes()
    const r = client.reparseBytes(mine, 'data.csv')
    const { msg, transfer } = FakeWorker.all[0]!.posted[0]!
    expect(transfer).toHaveLength(1)
    expect(transfer[0]).not.toBe(mine)
    expect((msg as { bytes: ArrayBuffer }).bytes.byteLength).toBe(4)
    expect(mine.byteLength).toBe(4)
    FakeWorker.all[0]!.replyAll()
    await r
  })

  it('the main-thread fallback reads the caller bytes even after the transfer detached the copy', async () => {
    const r = client.importRegions(bytes(), 'book.xlsx', { sheetName: 'S', mode: 'separate', regions: [] })
    await tick()
    FakeWorker.all[0]!.dispatchEvent(new Event('error'))
    await r
    expect(fallback.calls).toEqual([{ type: 'importRegions', byteLength: 4 }])
  })

  it('a fallback chunk that fails to load is an internal error, never a rejected promise', async () => {
    vi.stubGlobal('Worker', undefined) // no worker at all: straight to the main thread
    fallback.failToLoad = true
    await loadClient()
    const r = await client.parseText('a\n1', { kind: 'clipboard', fileName: null })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error.code).toBe('E_INTERNAL_GUARD')
  })

  it('cancelling answers the requests in flight as cancelled', async () => {
    const r = client.parseText('a\n1', { kind: 'clipboard', fileName: null })
    client.cancelImports()
    const res = await r
    expect(!res.ok && res.error.params?.reason).toBe('cancelled')
  })
})
