import { uid, type ProjectConfig, type TranscriptWord } from '@shared/project'
import { insertVoiceOver } from './ops'

/** A run of transcript words spoken as one unit, in source milliseconds. */
export interface Sentence {
  text: string
  start: number
  end: number
}

/** Break after this much silence between words. */
export const SENTENCE_GAP_MS = 700
/** Kokoro drifts on very long inputs; keep each clip to roughly this many characters. */
export const MAX_SENTENCE_CHARS = 400
/** A clip may run this much longer than the speech it replaces before it is sped up. */
const FIT_TOLERANCE = 1.15
const MAX_FIT_SPEED = 1.35

const isSoundLabel = (w: TranscriptWord) => w.type === 'sound-label' || /^[[(].*[\])]$/.test(w.text)
const endsSentence = (text: string) => /[.?!]["'”’)\]]*$/.test(text)

/** Joins words with spaces, pulling punctuation back against the word before it. */
export function joinWords(words: string[]) {
  return words
    .join(' ')
    .replace(/\s+([,.;:?!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Groups transcript words into sentences: a break after terminal punctuation, after a pause
 * longer than SENTENCE_GAP_MS, or once a sentence grows past MAX_SENTENCE_CHARS. Hidden words
 * and sound labels are skipped, as is anything `skip` rejects (e.g. words cut from the timeline).
 */
export function groupSentences(words: TranscriptWord[], skip?: (w: TranscriptWord) => boolean): Sentence[] {
  const usable = words.filter((w) => !w.hidden && !isSoundLabel(w) && w.text.trim() && !(skip && skip(w))).sort((a, b) => a.start - b.start)
  const out: Sentence[] = []
  let cur: TranscriptWord[] = []
  let chars = 0
  const flush = () => {
    if (!cur.length) return
    out.push({ text: joinWords(cur.map((w) => w.text)), start: cur[0].start, end: cur[cur.length - 1].end })
    cur = []
    chars = 0
  }
  for (let i = 0; i < usable.length; i++) {
    const w = usable[i]
    cur.push(w)
    chars += w.text.length + 1
    const next = usable[i + 1]
    const gap = next ? next.start - w.end : Infinity
    if (endsSentence(w.text) || gap > SENTENCE_GAP_MS || chars >= MAX_SENTENCE_CHARS) flush()
  }
  flush()
  return out
}

/** Speed that brings a clip back within the span it replaces, or null when it already fits. */
export function fitSpeed(durationMs: number, spanMs: number): number | null {
  if (spanMs <= 0 || durationMs <= spanMs * FIT_TOLERANCE) return null
  return Math.min(MAX_FIT_SPEED, durationMs / spanMs)
}

export interface RevoiceClip {
  sentence: Sentence
  file: string
  durationMs: number
}

export const isRevoiceClip = (v: { voice?: string; attach: string }) => v.attach === 'synced' && !!v.voice?.startsWith('kokoro:')

/**
 * Replaces a previous re-voice (if any) with the new clips, one synchronized voiceover per
 * sentence that silences the microphone while it plays. Meant to run inside a single update()
 * so the whole operation is one undo step.
 */
export function applyRevoice(draft: ProjectConfig, clips: RevoiceClip[], voice: string, muteMic = true) {
  draft.timeline.voiceOvers = draft.timeline.voiceOvers.filter((v) => !isRevoiceClip(v))
  for (const c of clips) {
    insertVoiceOver(draft, {
      id: uid(),
      start: c.sentence.start,
      duration: Math.round(c.durationMs),
      file: c.file,
      source: 'speech',
      text: c.sentence.text,
      voice,
      volume: 1,
      attach: 'synced',
      muteOriginal: true,
      disabled: false,
    })
  }
  if (muteMic) draft.style.audio.muteMic = true
}
