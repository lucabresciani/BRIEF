/// <reference lib="webworker" />
import { handleRequest } from './handlers'
import type { WorkerRequest } from './protocol'

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const res = await handleRequest(e.data)
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(res)
}
