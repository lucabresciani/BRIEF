import type { ImportDraft, ImportOverrides } from '@/domain/import/importPipeline'
import type { RegionImportSpec } from '@/domain/import/regionImport'
import { LIMITS } from '@/domain/import/limits'
import { issue, type Issue, type Result, type SourceKind } from '@/domain/model'
import type * as Handlers from './handlers'
import type { OpenedProject, WorkerRequest, WorkerResponse } from './protocol'

/** null: the worker could not answer, so the request is re-run on the main thread. */
type Pending = { resolve: (r: WorkerResponse | null) => void }

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, Pending>()

/** Answers every request in flight (null = run it on the main thread instead). */
function settleAll(res: (id: number) => WorkerResponse | null): void {
  const all = [...pending]
  pending.clear()
  for (const [id, p] of all) p.resolve(res(id))
}

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    const w = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
    w.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.requestId)
      if (p) {
        pending.delete(e.data.requestId)
        p.resolve(e.data)
      }
    })
    // One listener per worker, never one per request: a worker that failed to start or crashed, or an
    // answer that could not be received (messageerror carries no request id), sends every request in
    // flight to the main thread, and later requests go there directly.
    const fail = () => {
      if (worker !== w) return
      workerBroken = true
      w.terminate()
      worker = null
      settleAll(() => null)
    }
    w.addEventListener('error', fail)
    w.addEventListener('messageerror', fail)
    worker = w
    return w
  } catch {
    workerBroken = true
    return null
  }
}

type RequestBody = WorkerRequest extends infer R
  ? R extends WorkerRequest
    ? Omit<R, 'requestId'>
    : never
  : never

/**
 * The message posted to the worker. File bytes are copied once and the copy is transferred (a plain
 * postMessage would clone them as well): the caller keeps its own bytes for later re-reads, and the
 * main-thread fallback still has them if the worker dies after the transfer detached the copy.
 */
function forWorker(req: WorkerRequest): [WorkerRequest, Transferable[]] {
  if (!('bytes' in req)) return [req, []]
  const copy = req.bytes.slice(0)
  return [{ ...req, bytes: copy }, [copy]]
}

let handlers: Promise<typeof Handlers> | null = null

async function runOnMainThread(req: WorkerRequest): Promise<WorkerResponse> {
  try {
    // Requests that fall back together share one load; a failed load is retried by the next request.
    const { handleRequest } = await (handlers ??= import('./handlers').catch((err: unknown) => {
      handlers = null
      throw err
    }))
    return await handleRequest(req)
  } catch (err) {
    // The fallback chunk itself failed to load (offline, or replaced by a new deployment).
    return {
      requestId: req.requestId,
      type: 'crash',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

async function send(req: RequestBody): Promise<{ res: WorkerResponse; fallback: boolean }> {
  const requestId = nextId++
  const full = { ...req, requestId } as WorkerRequest
  const w = getWorker()
  if (w) {
    const res = await new Promise<WorkerResponse | null>((resolve) => {
      pending.set(requestId, { resolve })
      try {
        const [msg, transfer] = forWorker(full)
        w.postMessage(msg, transfer)
      } catch {
        // Not cloneable: this request runs on the main thread, the worker stays usable.
        pending.delete(requestId)
        resolve(null)
      }
    })
    if (res) return { res, fallback: false }
  }
  return { res: await runOnMainThread(full), fallback: true }
}

/** Cancels every request in flight (the worker is restarted on the next request). */
export function cancelImports(): void {
  worker?.terminate()
  worker = null
  settleAll((id) => ({ requestId: id, type: 'crash', message: 'cancelled' }))
}

function withFallbackNote<T>(r: Result<T>, fallback: boolean): Result<T> {
  if (!fallback) return r
  const w: Issue = issue('W_WORKER_FALLBACK')
  return { ...r, warnings: [...r.warnings, w] }
}

function crashResult(message: string): Result<never> {
  return {
    ok: false,
    error: { ...issue('E_INTERNAL_GUARD', { reason: message }), code: 'E_INTERNAL_GUARD' },
    warnings: [],
  }
}

export async function parseText(
  text: string,
  source: { kind: SourceKind; fileName: string | null },
  overrides?: ImportOverrides,
): Promise<Result<ImportDraft>> {
  const { res, fallback } = await send({ type: 'parseText', text, source, overrides })
  if (res.type === 'draft') return withFallbackNote(res.result, fallback)
  return crashResult(res.type === 'crash' ? res.message : 'unexpected response')
}

/** Reads file bytes with the given settings. The bytes stay usable: the import keeps them for re-reads. */
export async function reparseBytes(
  bytes: ArrayBuffer,
  fileName: string,
  overrides?: ImportOverrides,
): Promise<Result<ImportDraft>> {
  const { res, fallback } = await send({ type: 'parseFile', bytes, fileName, overrides })
  if (res.type === 'draft') return withFallbackNote(res.result, fallback)
  return crashResult(res.type === 'crash' ? res.message : 'unexpected response')
}

/**
 * Blocks of one sheet → drafts (one per region, or one stacked draft). The bytes stay usable, as in
 * reparseBytes: the picker keeps them for further imports.
 */
export async function importRegions(
  bytes: ArrayBuffer,
  fileName: string,
  spec: RegionImportSpec,
  overrides?: ImportOverrides,
): Promise<Result<ImportDraft[]>> {
  const { res, fallback } = await send({ type: 'importRegions', bytes, fileName, spec, overrides })
  if (res.type === 'drafts') return withFallbackNote(res.result, fallback)
  return crashResult(res.type === 'crash' ? res.message : 'unexpected response')
}

export async function openProjectText(text: string): Promise<Result<OpenedProject>> {
  const { res } = await send({ type: 'openProject', text, maxBytes: LIMITS.maxProjectBytes })
  if (res.type === 'project') return res.result
  return crashResult(res.type === 'crash' ? res.message : 'unexpected response')
}
