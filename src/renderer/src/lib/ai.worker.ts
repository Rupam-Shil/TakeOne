/**
 * The worker that owns transformers.js, Kokoro and Whisper. Model weights load here, inference
 * runs here, and the editor's main thread only exchanges small messages with it (ai-models.ts
 * defines the protocol; ai-client.ts is the main-thread side). Loaded models stay resident for
 * the life of the window.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { KokoroTTS } from 'kokoro-js'
import { KOKORO_MODEL, WHISPER_SIZES, downloadProgress, type AiProgress, type AiReply, type AiRequest, type KokoroVoice, type WhisperSize, type WhisperWord } from './ai-models'

const port = self as unknown as DedicatedWorkerGlobalScope
const reply = (msg: AiReply, transfer: Transferable[] = []) => port.postMessage(msg, transfer)

type ProgressListener = (p: AiProgress) => void

let configured = false
/**
 * Points transformers.js at the ONNX runtime shipped with the app and at the browser cache.
 * Workers have no document, so the main thread passes the wasm base URL in the init message.
 */
function configureTransformers(wasmBaseUrl: string) {
  if (configured) return
  configured = true
  env.allowLocalModels = false
  env.useBrowserCache = true
  const wasm = env.backends.onnx.wasm
  if (wasm) wasm.wasmPaths = wasmBaseUrl
}

// Calling `pipeline` through its overloads makes TypeScript build a union of every pipeline type;
// a narrowed signature keeps the one we use.
const loadAsr = pipeline as unknown as (task: 'automatic-speech-recognition', model: string, options: object) => Promise<AutomaticSpeechRecognitionPipeline>

// A model loads once, but the request that triggered the load (and any that join while it runs)
// each want the download progress, so listeners are collected per model until it is ready.
let kokoro: Promise<KokoroTTS> | null = null
let kokoroListeners = new Set<ProgressListener>()

function loadKokoro(onProgress: ProgressListener) {
  if (!kokoro) {
    kokoroListeners.add(onProgress)
    kokoro = KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: downloadProgress((fraction, phase) => kokoroListeners.forEach((l) => l({ fraction, phase }))),
    })
      .then((tts) => {
        kokoroListeners.forEach((l) => l({ fraction: 1, phase: 'ready' }))
        kokoroListeners = new Set()
        return tts
      })
      .catch((e) => {
        kokoro = null
        kokoroListeners = new Set()
        throw e
      })
  } else if (kokoroListeners.size) {
    kokoroListeners.add(onProgress)
  }
  return kokoro
}

/** Voices with a usable quality grade, English first. */
function kokoroVoices(tts: KokoroTTS): KokoroVoice[] {
  const all = Object.entries(tts.voices as Record<string, { name: string; language: string; gender: string; overallGrade?: string }>).map(([id, v]) => ({
    id,
    name: v.name,
    language: v.language,
    gender: v.gender,
    grade: v.overallGrade ?? '',
  }))
  const rank = (g: string) => ({ A: 0, 'A-': 1, 'B+': 2, B: 3, 'B-': 4, 'C+': 5, C: 6, 'C-': 7 })[g] ?? 8
  return all
    .filter((v) => rank(v.grade) <= 6)
    .sort((a, b) => (a.language.startsWith('en') === b.language.startsWith('en') ? rank(a.grade) - rank(b.grade) : a.language.startsWith('en') ? -1 : 1))
}

const whisper = new Map<WhisperSize, Promise<AutomaticSpeechRecognitionPipeline>>()
const whisperListeners = new Map<WhisperSize, Set<ProgressListener>>()

function loadWhisper(size: WhisperSize, onProgress: ProgressListener) {
  let p = whisper.get(size)
  const listeners = whisperListeners.get(size) ?? new Set<ProgressListener>()
  whisperListeners.set(size, listeners)
  if (!p) {
    listeners.add(onProgress)
    p = loadAsr('automatic-speech-recognition', WHISPER_SIZES[size].model, {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
      device: 'wasm',
      progress_callback: downloadProgress((fraction, phase) => listeners.forEach((l) => l({ fraction, phase }))),
    })
      .then((asr) => {
        listeners.forEach((l) => l({ fraction: 1, phase: 'ready' }))
        listeners.clear()
        return asr
      })
      .catch((e) => {
        whisper.delete(size)
        listeners.clear()
        throw e
      })
    whisper.set(size, p)
  } else if (listeners.size) {
    listeners.add(onProgress)
  }
  return p
}

/** Ids whose results are no longer wanted. Checked at the points where work can stop early. */
const cancelled = new Set<number>()
const cancelledError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' })

async function transcribe(id: number, size: WhisperSize, language: string | null, audio: Float32Array, onProgress: ProgressListener): Promise<WhisperWord[]> {
  const asr = await loadWhisper(size, onProgress)
  if (cancelled.has(id)) throw cancelledError()
  onProgress({ fraction: 0.02, phase: 'transcribe' })
  const totalSec = audio.length / 16000
  let lastChunkEnd = 0
  const result = await asr(audio, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    language: language ?? undefined,
    task: 'transcribe',
    // transformers.js reports finished chunks; use their end time as progress and as a cancel point.
    chunk_callback: (chunk: { tokens?: unknown; stride?: number[] }) => {
      if (cancelled.has(id)) throw cancelledError()
      const stride = chunk.stride ?? []
      if (stride.length >= 1) {
        lastChunkEnd += stride[0] - (stride[1] ?? 0) - (stride[2] ?? 0)
        onProgress({ fraction: Math.min(0.98, lastChunkEnd / Math.max(1, totalSec)), phase: 'transcribe' })
      }
    },
  } as never)
  const out = Array.isArray(result) ? result[0] : result
  const chunks = (out as { chunks?: { text: string; timestamp: [number, number | null] }[] }).chunks ?? []
  const words: WhisperWord[] = []
  for (const c of chunks) {
    const text = c.text.trim()
    if (!text) continue
    const start = c.timestamp[0] ?? (words[words.length - 1]?.end ?? 0)
    const end = c.timestamp[1] ?? start + 0.3
    words.push({ text, start, end: Math.max(end, start + 0.05) })
  }
  onProgress({ fraction: 1, phase: 'transcribe' })
  return words
}

async function handle(req: Exclude<AiRequest, { type: 'cancel' }>): Promise<{ result: unknown; transfer?: Transferable[] }> {
  const onProgress: ProgressListener = (progress) => reply({ id: req.id, type: 'progress', progress })
  switch (req.type) {
    case 'init':
      configureTransformers(req.wasmBaseUrl)
      return { result: undefined }
    case 'kokoro.voices':
      return { result: kokoroVoices(await loadKokoro(onProgress)) }
    case 'kokoro.speak': {
      const tts = await loadKokoro(onProgress)
      if (cancelled.has(req.id)) throw cancelledError()
      const audio = await tts.generate(req.text, { voice: req.voice as never, speed: req.speed })
      const samples = audio.audio as Float32Array
      return { result: { audio: samples, sampleRate: audio.sampling_rate }, transfer: [samples.buffer] }
    }
    case 'whisper.transcribe':
      return { result: await transcribe(req.id, req.size, req.language, req.audio, onProgress) }
  }
}

port.addEventListener('message', (e: MessageEvent<AiRequest>) => {
  const req = e.data
  if (req.type === 'cancel') {
    cancelled.add(req.target)
    return
  }
  handle(req)
    .then((out) => {
      if (cancelled.delete(req.id)) return
      reply({ id: req.id, type: 'result', result: out.result }, out.transfer)
    })
    .catch((err: unknown) => {
      cancelled.delete(req.id)
      reply({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
    })
})
