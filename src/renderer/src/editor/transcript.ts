import { MIN_DURATION, defaultSlice, uid, type ProjectConfig, type Slice, type TranscriptWord } from '@shared/project'
import { FILLERS_TIER1, FILLERS_TIER2, normalizeWord } from '@/render/captions'
import type { TimeMap } from '@/render/timemap'
import { cutRange } from './ops'

export type Token = { kind: 'word'; word: TranscriptWord } | { kind: 'gap'; start: number; end: number }

/** Words plus visible pause tokens for gaps of a second or more. */
export function buildTokens(words: TranscriptWord[]): Token[] {
  const out: Token[] = []
  words.forEach((w, i) => {
    const prev = words[i - 1]
    if (prev && w.start - prev.end >= 1000) out.push({ kind: 'gap', start: prev.end, end: w.start })
    out.push({ kind: 'word', word: w })
  })
  return out
}

export const isCut = (start: number, end: number, map: TimeMap) => map.toPlayback((start + end) / 2) === null

export const fillerTier = (text: string): 0 | 1 | 2 => {
  const n = normalizeWord(text)
  if (FILLERS_TIER1.has(n)) return 1
  if (FILLERS_TIER2.includes(n)) return 2
  return 0
}

/**
 * Cut ranges for deleting runs of words. Each cut starts 40ms early; if the previous kept word is
 * under 60ms away it meets it halfway, otherwise it stays at least 30ms clear (same at the end).
 */
export function cutsForWords(all: TranscriptWord[], remove: Set<number>): [number, number][] {
  const cuts: [number, number][] = []
  let i = 0
  while (i < all.length) {
    if (!remove.has(all[i].index)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < all.length && remove.has(all[j + 1].index)) j++
    const first = all[i]
    const last = all[j]
    const prev = all[i - 1]
    const next = all[j + 1]
    let start = first.start - 40
    if (prev) start = first.start - prev.end < 60 ? (prev.end + first.start) / 2 : Math.max(start, prev.end + 30)
    let end = last.end + 40
    if (next) end = next.start - last.end < 60 ? (last.end + next.start) / 2 : Math.min(end, next.start - 30)
    cuts.push([Math.max(0, start), end])
    i = j + 1
  }
  // Merge cuts that nearly touch.
  const merged: [number, number][] = []
  for (const c of cuts) {
    const last = merged[merged.length - 1]
    if (last && c[0] - last[1] < 60) last[1] = Math.max(last[1], c[1])
    else merged.push([...c])
  }
  return merged
}

export function deleteWords(draft: ProjectConfig, indices: number[]) {
  const words = draft.transcript?.words
  if (!words) return 0
  const cuts = cutsForWords(words, new Set(indices))
  for (const [a, b] of cuts.reverse()) cutRange(draft, a, b)
  return cuts.length
}

/** Puts a source range back into the kept slices (±40ms), merging with neighbours. */
export function restoreRange(draft: ProjectConfig, start: number, end: number, duration: number) {
  const a = Math.max(0, start - 40)
  const b = Math.min(duration, end + 40)
  const slices = [...draft.timeline.slices].sort((x, y) => x.start - y.start)
  const touching = slices.filter((s) => s.end >= a - 1 && s.start <= b + 1)
  const rest = slices.filter((s) => !touching.includes(s))
  const base: Slice = touching[0] ?? defaultSlice(a, b)
  const merged: Slice = {
    ...base,
    id: touching[0]?.id ?? uid(),
    start: Math.min(a, ...touching.map((s) => s.start)),
    end: Math.max(b, ...touching.map((s) => s.end)),
  }
  draft.timeline.slices = [...rest, merged].sort((x, y) => x.start - y.start)
}

export function setHidden(draft: ProjectConfig, indices: number[], hidden: boolean) {
  for (const w of draft.transcript?.words ?? []) if (indices.includes(w.index)) w.hidden = hidden
}

export function fillerIndices(words: TranscriptWord[], map: TimeMap) {
  return words.filter((w) => fillerTier(w.text) === 1 && !isCut(w.start, w.end, map)).map((w) => w.index)
}

/** Shortens every pause longer than 200ms to 200ms, leaving 100ms of breath on each side. */
export function tightenPauses(draft: ProjectConfig, map: TimeMap, only?: [number, number]) {
  const words = (draft.transcript?.words ?? []).filter((w) => !isCut(w.start, w.end, map))
  const cuts: [number, number][] = []
  for (let i = 1; i < words.length; i++) {
    const gapStart = words[i - 1].end
    const gapEnd = words[i].start
    if (only && (gapStart < only[0] - 1 || gapEnd > only[1] + 1)) continue
    if (gapEnd - gapStart > 200 + MIN_DURATION.slice) cuts.push([gapStart + 100, gapEnd - 100])
  }
  for (const [a, b] of cuts.reverse()) {
    try {
      cutRange(draft, a, b)
    } catch {
      /* would remove everything */
    }
  }
  return cuts.length
}
