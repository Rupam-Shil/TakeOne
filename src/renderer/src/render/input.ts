import type { ClickEvent, CursorImage, KeyEvent, RecordingEvents, RecordingMeta } from '@shared/recording'

export interface Move {
  t: number // ms
  x: number // recording pixels
  y: number
}

export interface Click {
  t: number
  x: number
  y: number
  button: ClickEvent['button']
  type: 'down' | 'up'
}

export interface Key {
  t: number
  type: 'down' | 'up'
  key?: string
  modifiers: string[]
  keyCode: number
  isRepeat?: boolean
}

/** Recording input normalised to recording-pixel coordinates and milliseconds. */
export interface InputData {
  moves: Move[]
  clicks: Click[]
  keys: Key[]
  cursorChanges: { t: number; id: string }[]
  cursorImages: Record<string, CursorImage>
  markers: number[]
  durationMs: number
  /** Points → recording pixels. */
  scale: number
  hasEvents: boolean
}

export function emptyInput(durationMs: number, scale = 2): InputData {
  return { moves: [], clicks: [], keys: [], cursorChanges: [], cursorImages: {}, markers: [], durationMs, scale, hasEvents: false }
}

/** Converts helper output (global points, seconds) into recording pixels and ms. */
export function normalizeInput(meta: RecordingMeta, events: RecordingEvents | null): InputData {
  const durationMs = meta.duration * 1000
  if (!events) return emptyInput(durationMs, meta.scale)
  const { videoSize, captureRect } = meta
  const frames = events.windowFrames ?? []

  // Window recordings follow the window as it moves; displays and areas stay fixed.
  const rectAt = (tSec: number) => {
    if (!frames.length) return captureRect
    let f = frames[0]
    for (const w of frames) {
      if (w[0] <= tSec) f = w
      else break
    }
    return { x: f[1], y: f[2], width: f[3], height: f[4] }
  }
  const toPx = (tSec: number, x: number, y: number) => {
    const r = rectAt(tSec)
    return { x: ((x - r.x) / r.width) * videoSize.width, y: ((y - r.y) / r.height) * videoSize.height }
  }

  const moves: Move[] = []
  // Thin to ~240 Hz and ≥ 0.5px so long recordings stay light without losing motion detail.
  let last: Move | null = null
  for (const [t, x, y] of events.mouse) {
    const p = toPx(t, x, y)
    const m = { t: t * 1000, x: p.x, y: p.y }
    if (last && m.t - last.t < 4 && Math.abs(m.x - last.x) + Math.abs(m.y - last.y) < 0.5) continue
    moves.push(m)
    last = m
  }
  const clicks: Click[] = events.clicks.map((c) => {
    const p = toPx(c.t, c.x, c.y)
    return { t: c.t * 1000, x: p.x, y: p.y, button: c.button, type: c.type }
  })
  const keys: Key[] = (events.keys as KeyEvent[])
    .filter((k) => k.type !== 'modifiers')
    .map((k) => ({ t: k.t * 1000, type: k.type as 'down' | 'up', key: k.key, modifiers: k.modifiers, keyCode: k.keyCode, isRepeat: k.isRepeat }))

  return {
    moves: moves.sort((a, b) => a.t - b.t),
    clicks: clicks.sort((a, b) => a.t - b.t),
    keys: keys.sort((a, b) => a.t - b.t),
    cursorChanges: events.cursors.map((c) => ({ t: c.t * 1000, id: c.id })),
    cursorImages: events.cursorImages,
    markers: (events.markers ?? []).map((t) => t * 1000),
    durationMs,
    scale: meta.scale,
    hasEvents: moves.length > 0,
  }
}
