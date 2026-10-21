import type { CaptionSettings, Transcript, TranscriptWord } from '@shared/project'
import { TimeMap } from './timemap'

export interface CaptionWord {
  text: string
  start: number
  end: number
}

export interface CaptionLine {
  start: number
  end: number
  /** Display until (hold 300ms after last word, but not past the next line). */
  until: number
  words: CaptionWord[]
}

export const FONT_STACKS: Record<CaptionSettings['font'], string> = {
  'sans-serif': '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
  serif: '"New York", "Iowan Old Style", Georgia, serif',
  mono: '"SF Mono", Menlo, monospace',
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null
function measurer() {
  measureCtx ??= new OffscreenCanvas(8, 8).getContext('2d')!
  return measureCtx
}

const isCut = (w: TranscriptWord, map: TimeMap) => map.toPlayback((w.start + w.end) / 2) === null

/**
 * Breaks transcript words into caption lines. A new line starts past 42 characters, past 80% of the
 * stage width, when a line would span over 7s, or after a pause longer than 1s.
 */
export function buildCaptionLines(transcript: Transcript | null, settings: CaptionSettings, map: TimeMap, stageAspect: number): CaptionLine[] {
  if (!transcript) return []
  const words = transcript.words.filter(
    (w) => !w.hidden && (settings.showSoundLabels || w.type !== 'sound-label') && !isCut(w, map) && w.text.trim(),
  )
  // Measure at a 1080px-tall reference stage; ratios make this resolution independent.
  const refH = 1080
  const refW = refH * stageAspect
  const fontPx = settings.size * refH
  const ctx = measurer()
  ctx.font = `600 ${fontPx}px ${FONT_STACKS[settings.font]}`
  const maxWidth = refW * 0.8

  const lines: CaptionLine[] = []
  let cur: CaptionWord[] = []
  const push = () => {
    if (!cur.length) return
    lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, until: 0, words: cur })
    cur = []
  }
  for (const w of words) {
    const word = { text: w.text.trim(), start: w.start, end: w.end }
    if (cur.length) {
      const text = [...cur, word].map((x) => x.text).join(' ')
      const last = cur[cur.length - 1]
      if (text.length > 42 || ctx.measureText(text).width > maxWidth || word.end - cur[0].start > 7000 || word.start - last.end > 1000) push()
    }
    cur.push(word)
  }
  push()
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1]
    lines[i].until = Math.min(lines[i].end + 300, next ? next.start : Infinity)
  }
  return lines
}

export function lineAt(lines: CaptionLine[], ms: number): CaptionLine | null {
  // Binary search by start time.
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].start <= ms) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (found < 0) return null
  const l = lines[found]
  return ms < l.until ? l : null
}

export function toSrt(lines: CaptionLine[], map: TimeMap): string {
  const fmt = (ms: number) => {
    const t = Math.max(0, Math.round(ms))
    const h = Math.floor(t / 3600000)
    const m = Math.floor((t % 3600000) / 60000)
    const s = Math.floor((t % 60000) / 1000)
    const mm = t % 1000
    const p = (n: number, l = 2) => String(n).padStart(l, '0')
    return `${p(h)}:${p(m)}:${p(s)},${p(mm, 3)}`
  }
  // Merge consecutive lines into ~3.5s blocks, on the playback timeline.
  const blocks: { start: number; end: number; text: string }[] = []
  for (const l of lines) {
    const start = map.toPlaybackNearest(l.start)
    const end = map.toPlaybackNearest(l.end)
    const text = l.words.map((w) => w.text).join(' ')
    const last = blocks[blocks.length - 1]
    if (last && end - last.start <= 3500 && start - last.end < 500) {
      last.end = end
      last.text += ' ' + text
    } else blocks.push({ start, end, text })
  }
  return blocks.map((b, i) => `${i + 1}\n${fmt(b.start)} --> ${fmt(b.end)}\n${b.text}\n`).join('\n')
}

export function toVtt(lines: CaptionLine[], map: TimeMap): string {
  return 'WEBVTT\n\n' + toSrt(lines, map).replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2')
}

export const FILLERS_TIER1 = new Set(['um', 'uh', 'er', 'ah', 'hmm', 'mhmm', 'mm', 'mmm', 'huh', 'uh-huh', 'erm', 'umm', 'uhh'])
export const FILLERS_TIER2 = ['like', 'you know', 'so', 'i mean', 'kind of', 'sort of', 'actually', 'basically', 'literally']

export const normalizeWord = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '')
