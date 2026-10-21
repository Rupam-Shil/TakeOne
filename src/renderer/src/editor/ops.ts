import { current, isDraft } from 'immer'
import {
  MIN_DURATION,
  NEW_ITEM_DURATION,
  defaultSlice,
  uid,
  type LayoutSegment,
  type LayoutType,
  type Mask,
  type ProjectConfig,
  type Slice,
  type TextOverlay,
  type VoiceOver,
  type Zoom,
} from '@shared/project'

export type TrackKind = 'zooms' | 'layouts' | 'masks' | 'texts' | 'voiceOvers'
type Item = { id: string; start: number; end: number }

const MIN: Record<TrackKind, number> = { zooms: MIN_DURATION.zoom, layouts: MIN_DURATION.layout, masks: MIN_DURATION.mask, texts: MIN_DURATION.text, voiceOvers: 100 }

const sortByStart = <T extends Item>(a: T[]) => a.sort((x, y) => x.start - y.start)

/** Free gap around `t` in a non-overlapping, sorted collection. */
export function freeRangeAt(items: Item[], t: number, duration: number): [number, number] | null {
  let lo = 0
  let hi = duration
  for (const it of items) {
    if (t >= it.start && t < it.end) return null
    if (it.end <= t) lo = Math.max(lo, it.end)
    if (it.start > t) hi = Math.min(hi, it.start)
  }
  return [lo, hi]
}

export function addItem<K extends TrackKind>(draft: ProjectConfig, kind: K, t: number, duration: number, make: (start: number, end: number) => ProjectConfig['timeline'][K][number]) {
  const items = draft.timeline[kind] as Item[]
  const free = freeRangeAt(items, t, duration)
  if (!free) return null
  const [lo, hi] = free
  if (hi - lo < MIN[kind]) return null
  let start = Math.max(lo, t)
  let end = Math.min(hi, start + NEW_ITEM_DURATION)
  if (end - start < MIN[kind]) start = Math.max(lo, end - NEW_ITEM_DURATION)
  end = Math.min(hi, Math.max(end, start + MIN[kind]))
  const item = make(Math.round(start), Math.round(end))
  ;(items as unknown[]).push(item)
  sortByStart(items)
  return item
}

export function newZoom(start: number, end: number, level: number, last?: Partial<Zoom>): Zoom {
  return {
    id: uid(),
    start,
    end,
    level: last?.level ?? level,
    mode: 'auto',
    target: { x: 0.5, y: 0.5 },
    presentation: last?.presentation ?? 'screen',
    loupeRadius: last?.loupeRadius ?? 0.35,
    instant: last?.instant ?? false,
    disabled: false,
  }
}

export const newLayout = (start: number, end: number, layout: LayoutType): LayoutSegment => ({ id: uid(), start, end, layout, disabled: false })

export const newMask = (start: number, end: number, last?: Partial<Mask>): Mask => ({
  id: uid(),
  start,
  end,
  type: last?.type ?? 'blur',
  rect: { x: 0.35, y: 0.35, width: 0.3, height: 0.2 },
  blur: last?.blur ?? 24,
  opacity: last?.opacity ?? 0.5,
  radius: 10,
  disabled: false,
})

export const newText = (start: number, end: number): TextOverlay => ({
  id: uid(),
  start,
  end,
  text: 'Your title',
  position: { x: 0.5, y: 0.14 },
  size: 0.06,
  color: '#ffffff',
  background: 'rgba(15,16,20,0.78)',
  weight: 600,
  disabled: false,
})

export function findItem(draft: ProjectConfig, kind: TrackKind, id: string): Item | undefined {
  return (draft.timeline[kind] as Item[]).find((i) => i.id === id)
}

export function removeItem(draft: ProjectConfig, kind: TrackKind, id: string) {
  const arr = draft.timeline[kind] as Item[]
  const i = arr.findIndex((x) => x.id === id)
  if (i >= 0) arr.splice(i, 1)
}

/** Moves/resizes an item, clamped between its neighbours. */
export function setItemRange(draft: ProjectConfig, kind: TrackKind, id: string, start: number, end: number, duration: number) {
  const arr = sortByStart(draft.timeline[kind] as Item[])
  const i = arr.findIndex((x) => x.id === id)
  if (i < 0) return
  // Voiceovers are as long as their audio: they can move but not stretch.
  if (kind === 'voiceOvers') {
    const len = arr[i].end - arr[i].start
    if (end - start !== len) end = start + len
  }
  const lo = i > 0 ? arr[i - 1].end : 0
  const hi = i < arr.length - 1 ? arr[i + 1].start : duration
  const len = end - start
  let s = Math.max(lo, start)
  let e = Math.min(hi, end)
  // Moving keeps the length when it hits a neighbour.
  if (Math.abs(len - (arr[i].end - arr[i].start)) < 0.5) {
    if (s !== start) e = Math.min(hi, s + len)
    if (e !== end) s = Math.max(lo, e - len)
  }
  if (e - s < MIN[kind]) return
  arr[i].start = Math.round(s)
  arr[i].end = Math.round(e)
  if ('generated' in arr[i]) (arr[i] as Zoom).generated = false
}

/** Plain deep copy of a draft (or plain object) — drafts are proxies and can't be structuredClone'd. */
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(isDraft(x) ? current(x as object) : x))

export function splitItemAt(draft: ProjectConfig, kind: TrackKind, t: number): string | null {
  const arr = draft.timeline[kind] as Item[]
  const it = arr.find((x) => t > x.start && t < x.end)
  if (!it) return null
  if (t - it.start < MIN[kind] || it.end - t < MIN[kind]) throw new Error('The part you want to cut is too short')
  const copy = { ...plain(it), id: uid(), start: Math.round(t) }
  it.end = Math.round(t)
  ;(arr as unknown[]).push(copy)
  sortByStart(arr)
  return copy.id
}

export function duplicateItem(draft: ProjectConfig, kind: TrackKind, id: string, duration: number) {
  const arr = draft.timeline[kind] as Item[]
  const it = arr.find((x) => x.id === id)
  if (!it) return null
  const len = it.end - it.start
  const sorted = sortByStart([...arr])
  // Next free gap after the item that fits it.
  let cursor = it.end
  for (const other of sorted) {
    if (other.end <= cursor) continue
    if (other.start - cursor >= len) break
    cursor = Math.max(cursor, other.end)
  }
  if (cursor + Math.min(len, MIN[kind]) > duration) return null
  const copy = { ...plain(it), id: uid(), start: cursor, end: Math.min(duration, cursor + len) }
  ;(arr as unknown[]).push(copy)
  sortByStart(arr)
  return copy.id
}

// Slices (clip track) ---------------------------------------------------------------------------

const sortedSlices = (d: ProjectConfig) => d.timeline.slices.sort((a, b) => a.start - b.start)

export function splitSliceAt(draft: ProjectConfig, t: number): string | null {
  const s = draft.timeline.slices.find((x) => t > x.start && t < x.end)
  if (!s) return null
  if (t - s.start < MIN_DURATION.slice || s.end - t < MIN_DURATION.slice) throw new Error('The part you want to cut is too short')
  const copy: Slice = { ...s, id: uid(), start: Math.round(t) }
  s.end = Math.round(t)
  draft.timeline.slices.push(copy)
  sortedSlices(draft)
  return copy.id
}

export function removeSlice(draft: ProjectConfig, id: string) {
  if (draft.timeline.slices.length <= 1) throw new Error("You can't remove the last part of the video")
  draft.timeline.slices = draft.timeline.slices.filter((s) => s.id !== id)
  pruneCutItems(draft)
}

export function trimSlice(draft: ProjectConfig, id: string, edge: 'start' | 'end', t: number, duration: number) {
  const arr = sortedSlices(draft)
  const i = arr.findIndex((s) => s.id === id)
  if (i < 0) return
  const s = arr[i]
  if (edge === 'start') {
    const lo = i > 0 ? arr[i - 1].end : 0
    s.start = Math.round(Math.min(Math.max(lo, t), s.end - MIN_DURATION.slice))
  } else {
    const hi = i < arr.length - 1 ? arr[i + 1].start : duration
    s.end = Math.round(Math.max(Math.min(hi, t), s.start + MIN_DURATION.slice))
  }
}

/** "X": remove from the playhead back to the previous cut (or the start of the slice). */
export function rippleDeleteBack(draft: ProjectConfig, t: number) {
  const s = draft.timeline.slices.find((x) => t > x.start && t <= x.end)
  if (!s) return
  if (t - s.start < MIN_DURATION.slice) return
  if (s.end - t < MIN_DURATION.slice) {
    removeSlice(draft, s.id)
    return
  }
  s.start = Math.round(t)
  pruneCutItems(draft)
}

/** Removes [start, end] (source ms) from the kept slices, splitting where needed. */
export function cutRange(draft: ProjectConfig, start: number, end: number) {
  const out: Slice[] = []
  for (const s of sortedSlices(draft)) {
    if (end <= s.start || start >= s.end) {
      out.push(s)
      continue
    }
    if (start - s.start >= MIN_DURATION.slice) out.push({ ...s, end: Math.round(start) })
    if (s.end - end >= MIN_DURATION.slice) out.push({ ...s, id: uid(), start: Math.round(end) })
  }
  if (!out.length) throw new Error("You can't delete the whole video")
  draft.timeline.slices = out
  pruneCutItems(draft)
}

/** Drops zooms/layouts/masks/texts that now sit entirely inside cut regions. */
export function pruneCutItems(draft: ProjectConfig) {
  const kept = draft.timeline.slices
  const visible = (it: Item) => kept.some((s) => it.end > s.start && it.start < s.end)
  draft.timeline.zooms = draft.timeline.zooms.filter(visible)
  draft.timeline.layouts = draft.timeline.layouts.filter(visible)
  draft.timeline.masks = draft.timeline.masks.filter(visible)
  draft.timeline.texts = draft.timeline.texts.filter(visible)
}

/** Places a voiceover at `start` (source ms), pushing it past any voiceover it would overlap. */
export function insertVoiceOver(draft: ProjectConfig, vo: Omit<VoiceOver, 'end'>) {
  const list = draft.timeline.voiceOvers.sort((a, b) => a.start - b.start)
  let start = vo.start
  for (const other of list) if (start < other.end && start + vo.duration > other.start) start = other.end
  const item: VoiceOver = { ...vo, start: Math.round(start), end: Math.round(start + vo.duration) }
  list.push(item)
  list.sort((a, b) => a.start - b.start)
  return item
}

export function resetCuts(draft: ProjectConfig, duration: number) {
  draft.timeline.slices = [defaultSlice(0, duration)]
}

/** Speeds up [start, end] by splitting the slice it falls in. */
export function speedUpRange(draft: ProjectConfig, start: number, end: number, speed: number) {
  for (const t of [start, end]) {
    try {
      splitSliceAt(draft, t)
    } catch {
      /* edge already near a cut */
    }
  }
  for (const s of draft.timeline.slices) if (s.start >= start - 1 && s.end <= end + 1) s.speed = speed
}

export const SPEED_PRESETS = [0.5, 0.75, 1, 1.2, 1.4, 1.6, 1.8, 2, 3, 4, 8, 16, 24]
export const VOLUME_PRESETS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
