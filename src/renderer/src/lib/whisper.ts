import { mediaUrl } from '@shared/media'
import { abortError, aiRequest } from './ai-client'
import { decodeTo16k, type WhisperSize, type WhisperWord } from './ai-models'

export { WHISPER_SIZES, type WhisperSize, type WhisperWord } from './ai-models'

/**
 * Transcribes an audio file to words with timestamps (seconds). `language` is an ISO code like
 * "en", or null for auto. The audio is decoded here (workers have no OfflineAudioContext) and the
 * samples are handed to the AI worker, which runs Whisper and streams progress back.
 */
export async function transcribeWithWhisper(
  path: string,
  size: WhisperSize,
  language: string | null,
  onProgress: (fraction: number, phase: 'download' | 'transcribe') => void,
  signal?: AbortSignal,
): Promise<WhisperWord[]> {
  const audio = await decodeTo16k(mediaUrl(path))
  if (signal?.aborted) throw abortError()
  return aiRequest(
    'whisper.transcribe',
    { size, language, audio },
    {
      signal,
      transfer: [audio.buffer],
      onProgress: (p) => onProgress(p.phase === 'ready' ? 1 : p.fraction, p.phase === 'transcribe' ? 'transcribe' : 'download'),
    },
  )
}
