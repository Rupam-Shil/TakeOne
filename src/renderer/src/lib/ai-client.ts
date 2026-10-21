import type { AiProgress, AiReply, AiRequest, AiRequestType, AiResults } from './ai-models'

/**
 * Main-thread side of the model worker: one lazily started worker per window, and a promise per
 * request. Replies are matched by id; progress messages stream to the request's callback.
 */

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (p: AiProgress) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

export const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' })
export const isAbortError = (e: unknown) => e instanceof Error && e.name === 'AbortError'

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' })
  w.addEventListener('message', (e: MessageEvent<AiReply>) => {
    const msg = e.data
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.type === 'progress') return p.onProgress?.(msg.progress)
    pending.delete(msg.id)
    if (msg.type === 'result') p.resolve(msg.result)
    else p.reject(new Error(msg.message))
  })
  // The worker itself failed (script error, out of memory): fail everything in flight and start a fresh one next time.
  w.addEventListener('error', (e) => {
    const error = new Error(e.message || 'The speech model worker stopped unexpectedly')
    for (const p of pending.values()) p.reject(error)
    pending.clear()
    w.terminate()
    if (worker === w) worker = null
  })
  worker = w
  // Workers have no document, so the ORT wasm location is resolved here and handed over.
  const init: AiRequest = { id: 0, type: 'init', wasmBaseUrl: new URL('ort/', document.baseURI).href }
  w.postMessage(init)
  return w
}

type Requestable = Exclude<AiRequestType, 'init' | 'cancel'>

/** Sends one request and resolves with its typed result. Aborting the signal rejects at once and tells the worker to drop the work. */
export function aiRequest<T extends Requestable>(
  type: T,
  payload: Omit<Extract<AiRequest, { type: T }>, 'id' | 'type'>,
  opts: { onProgress?: (p: AiProgress) => void; signal?: AbortSignal; transfer?: Transferable[] } = {},
): Promise<AiResults[T]> {
  return new Promise<AiResults[T]>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(abortError())
    const w = getWorker()
    const id = nextId++
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress: opts.onProgress })
    opts.signal?.addEventListener(
      'abort',
      () => {
        if (!pending.delete(id)) return
        const cancel: AiRequest = { id: nextId++, type: 'cancel', target: id }
        w.postMessage(cancel)
        reject(abortError())
      },
      { once: true },
    )
    w.postMessage({ id, type, ...payload } as AiRequest, opts.transfer ?? [])
  })
}
