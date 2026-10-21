import { aiRequest } from './ai-client'
import { floatToWav, type KokoroVoice, type LoadPhase } from './ai-models'

export { KOKORO_DOWNLOAD_MB, KOKORO_MODEL, type KokoroVoice } from './ai-models'

/**
 * Kokoro, as seen from the main thread. The model itself lives in the AI worker; these are thin
 * calls over its message protocol, kept to the shapes the panels already use.
 */

/** What the main thread knows about the loaded model: its usable voices. */
export interface KokoroHandle {
  voices: KokoroVoice[]
}

type Progress = (fraction: number, phase: LoadPhase) => void

let loaded = false
let handle: Promise<KokoroHandle> | null = null
let listeners = new Set<Progress>()

export function isKokoroLoaded() {
  return loaded
}

/** Loads the model once (in the worker); progress reports the first-time download. */
export function getKokoro(onProgress?: Progress): Promise<KokoroHandle> {
  if (onProgress && !loaded) listeners.add(onProgress)
  handle ??= aiRequest('kokoro.voices', {}, { onProgress: (p) => listeners.forEach((l) => l(p.fraction, p.phase === 'ready' ? 'ready' : 'download')) })
    .then((voices) => {
      loaded = true
      listeners.forEach((l) => l(1, 'ready'))
      listeners = new Set()
      return { voices }
    })
    .catch((e: unknown) => {
      handle = null
      listeners = new Set()
      throw e
    })
  return handle
}

/** Voices with a usable quality grade, English first (the worker does the grading). */
export function kokoroVoices(k: KokoroHandle): KokoroVoice[] {
  return k.voices
}

export interface SpokenClip {
  wav: ArrayBuffer
  durationMs: number
}

/** Synthesises one clip. `speed` 1 is natural; 0.8–1.3 are comfortable. Aborting `signal` rejects at once. */
export async function speakWithKokoro(text: string, voice: string, speed = 1, onProgress?: Progress, signal?: AbortSignal): Promise<SpokenClip> {
  const { audio, sampleRate } = await aiRequest(
    'kokoro.speak',
    { text, voice, speed },
    { signal, onProgress: (p) => onProgress?.(p.fraction, p.phase === 'ready' ? 'ready' : 'download') },
  )
  loaded = true
  return { wav: floatToWav(audio, sampleRate), durationMs: (audio.length / sampleRate) * 1000 }
}
