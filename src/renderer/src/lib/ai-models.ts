/**
 * Shared pieces for the on-device models (Kokoro speech, Whisper transcription).
 *
 * Inference runs in a module worker (ai.worker.ts) so the editor never freezes; the main thread
 * talks to it through the message protocol below (see ai-client.ts). This module holds what both
 * sides share — the protocol, the model tables and small audio/cache helpers — and deliberately
 * does not import transformers.js, so it costs the main thread nothing.
 */

export const MODEL_CACHE = 'transformers-cache'

/** Kokoro 82M: natural, open-weight speech that runs on the user's Mac (about 90 MB, downloaded on first use). */
export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
export const KOKORO_DOWNLOAD_MB = 92

export interface KokoroVoice {
  id: string
  name: string
  language: string
  gender: string
  grade: string
}

/**
 * Whisper (OpenAI's open speech recogniser) in ONNX form; downloaded on first use.
 * The _timestamped exports keep cross-attentions, which word-level timestamps need.
 */
export const WHISPER_SIZES = {
  base: { model: 'onnx-community/whisper-base_timestamped', label: 'Whisper base', mb: 150, note: 'fast' },
  small: { model: 'onnx-community/whisper-small_timestamped', label: 'Whisper small', mb: 480, note: 'more accurate' },
} as const
export type WhisperSize = keyof typeof WHISPER_SIZES

export interface WhisperWord {
  text: string
  /** Seconds. */
  start: number
  end: number
}

export type LoadPhase = 'download' | 'ready'
export interface AiProgress {
  fraction: number
  phase: LoadPhase | 'transcribe'
}

/** Main thread → worker. Every request carries an id that its replies echo. */
export type AiRequest =
  | { id: number; type: 'init'; wasmBaseUrl: string }
  /** Loads Kokoro if needed and returns its usable voices. */
  | { id: number; type: 'kokoro.voices' }
  | { id: number; type: 'kokoro.speak'; text: string; voice: string; speed: number }
  /** 16 kHz mono samples, decoded on the main thread (workers have no OfflineAudioContext). */
  | { id: number; type: 'whisper.transcribe'; size: WhisperSize; language: string | null; audio: Float32Array }
  /** Drops the result of `target`; in-flight work stops at its next checkpoint. */
  | { id: number; type: 'cancel'; target: number }

export type AiRequestType = AiRequest['type']

export interface AiResults {
  init: void
  'kokoro.voices': KokoroVoice[]
  'kokoro.speak': { audio: Float32Array; sampleRate: number }
  'whisper.transcribe': WhisperWord[]
  cancel: void
}

/** Worker → main thread. */
export type AiReply =
  | { id: number; type: 'progress'; progress: AiProgress }
  | { id: number; type: 'result'; result: unknown }
  | { id: number; type: 'error'; message: string }

/** Bytes currently held for downloaded models, or null when the cache can't be read. */
export async function downloadedModelBytes(): Promise<number | null> {
  try {
    const cache = await caches.open(MODEL_CACHE)
    let total = 0
    for (const req of await cache.keys()) {
      const res = await cache.match(req)
      const len = res?.headers.get('content-length')
      if (len) total += Number(len)
      else if (res) total += (await res.clone().arrayBuffer()).byteLength
    }
    return total
  } catch {
    return null
  }
}

export async function deleteDownloadedModels() {
  try {
    await caches.delete(MODEL_CACHE)
  } catch {
    /* nothing cached */
  }
}

interface ProgressEvent {
  status: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
}

/** Folds transformers.js per-file progress events into one 0..1 download fraction. */
export function downloadProgress(onProgress: (fraction: number, phase: LoadPhase) => void) {
  const files = new Map<string, { loaded: number; total: number }>()
  return (e: ProgressEvent) => {
    if (e.status === 'ready') return onProgress(1, 'ready')
    if (!e.file) return
    if (e.status === 'initiate' || e.status === 'download' || e.status === 'progress') {
      files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 })
    } else if (e.status === 'done') {
      const f = files.get(e.file)
      if (f) f.loaded = f.total || f.loaded
    }
    let loaded = 0
    let total = 0
    for (const f of files.values()) {
      loaded += f.loaded
      total += f.total
    }
    onProgress(total ? Math.min(1, loaded / total) : 0, 'download')
  }
}

/** 16-bit PCM WAV from mono float samples. */
export function floatToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const out = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(out)
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  let o = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    o += 2
  }
  return out
}

/** Decodes any audio file to 16 kHz mono float samples (what Whisper expects). Main thread only. */
export async function decodeTo16k(path: string): Promise<Float32Array> {
  const res = await fetch(path)
  const bytes = await res.arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, 16000)
  const decoded = await ctx.decodeAudioData(bytes)
  const target = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
  const src = target.createBufferSource()
  src.buffer = decoded
  src.connect(target.destination)
  src.start()
  const rendered = await target.startRendering()
  // A copy, so the caller may transfer the buffer to a worker without touching the AudioBuffer's own store.
  return rendered.getChannelData(0).slice()
}
