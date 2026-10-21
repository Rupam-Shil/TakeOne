import { SPRINGS, type AnimationSettings, type CursorSettings, type Spring } from '@shared/project'
import type { Click, InputData, Move } from './input'
import { TimeMap } from './timemap'
import { STEP_MS, clamp, fitSpring, integrate, sample, steps } from './spring'

export interface CursorTrack {
  x: Float32Array
  y: Float32Array
  opacity: Float32Array
  scale: Float32Array
  rotation: Float32Array // radians
  typeAt(ms: number): string | null
  clicks: Click[]
  durationMs: number
}

const PRESS_SPRING: Spring = { stiffness: 900, damping: 45, mass: 1 }

/** Drops isolated outlier positions (tracking glitches), the "remove shake" setting. */
function removeSpikes(moves: Move[], threshold: number): Move[] {
  if (threshold <= 0 || moves.length < 3) return moves
  const d = (a: Move, b: Move) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  const out: Move[] = [moves[0]]
  for (let i = 1; i < moves.length - 1; i++) {
    const prev = out[out.length - 1]
    const cur = moves[i]
    const next = moves[i + 1]
    if (d(prev, cur) > threshold && d(cur, next) > threshold && d(prev, next) < threshold) continue
    out.push(cur)
  }
  out.push(moves[moves.length - 1])
  return out
}

export function buildCursorTrack(input: InputData, cursor: CursorSettings, anim: AnimationSettings, timeMap: TimeMap): CursorTrack {
  const durationMs = input.durationMs
  const n = steps(durationMs)
  const moves = removeSpikes(input.moves, cursor.removeShakePx * (input.scale / 2))
  const clicks = input.clicks
  const downs = clicks.filter((c) => c.type === 'down')

  const tx = new Float32Array(n)
  const ty = new Float32Array(n)
  const vis = new Float32Array(n)
  const pressed = new Float32Array(n)
  const springKind = new Uint8Array(n) // 0 user, 1 drag, 2 pre-click, 3 instant
  const fade = new Uint8Array(n) // 1 = typing fade

  const first = moves[0]
  const loopFrom = cursor.loopBeforeEndMs ? durationMs - cursor.loopBeforeEndMs : Infinity
  const stopFrom = cursor.stopMovementLastMs > 0 ? durationMs - cursor.stopMovementLastMs : Infinity

  let mi = 0
  let ci = 0
  let ki = 0
  let di = 0
  let down = false
  let downAt = -1
  let lastKeyDowns: number[] = []
  let lastMouseEventT = -Infinity
  let frozen: { x: number; y: number } | null = null
  let cx = first?.x ?? 0
  let cy = first?.y ?? 0

  for (let i = 0; i < n; i++) {
    const t = i * STEP_MS
    while (mi < moves.length && moves[mi].t <= t) {
      cx = moves[mi].x
      cy = moves[mi].y
      lastMouseEventT = moves[mi].t
      mi++
    }
    while (ci < clicks.length && clicks[ci].t <= t) {
      const c = clicks[ci]
      if (c.button === 'left') {
        down = c.type === 'down'
        downAt = down ? c.t : -1
      }
      cx = c.x
      cy = c.y
      lastMouseEventT = c.t
      ci++
    }
    while (ki < input.keys.length && input.keys[ki].t <= t) {
      const k = input.keys[ki]
      if (k.type === 'down' && !k.isRepeat) lastKeyDowns.push(k.t)
      ki++
    }
    lastKeyDowns = lastKeyDowns.filter((kt) => t - kt <= 1800)

    let x = cx
    let y = cy
    if (t >= loopFrom && first) {
      x = first.x
      y = first.y
    }
    if (t >= stopFrom) {
      frozen ??= { x, y }
      x = frozen.x
      y = frozen.y
    }
    tx[i] = x
    ty[i] = y

    const slice = timeMap.sliceAtSource(t)
    let visible = first && t >= first.t - 50 ? 1 : 0
    if (slice?.hideCursor) visible = 0
    if (cursor.hideWhenIdleMs) {
      const nextMove = mi < moves.length ? moves[mi].t : Infinity
      if (t - lastMouseEventT > cursor.hideWhenIdleMs && nextMove - t > 300) visible = 0
    }
    if (cursor.hideWhileTyping && lastKeyDowns.length >= 3 && lastMouseEventT < lastKeyDowns[lastKeyDowns.length - 1]) {
      visible = 0
      fade[i] = 1
    }
    vis[i] = visible
    pressed[i] = down ? 1 : 0

    if (!anim.cursorSpring || slice?.disableSmoothing) springKind[i] = 3
    else if (down && downAt >= 0 && t - downAt > 30) springKind[i] = 1
    else {
      while (di < downs.length && downs[di].t <= t) di++
      springKind[i] = di < downs.length && downs[di].t - t <= 175 ? 2 : 0
    }
  }

  const user = anim.cursorSpring
  const drag = fitSpring(SPRINGS.drag, 40)
  const springFor = (i: number): Spring | null => {
    switch (springKind[i]) {
      case 3:
        return null
      case 1:
        return drag
      case 2:
        return SPRINGS.preClick
      default:
        return user
    }
  }
  const x = integrate(tx, springFor, tx[0])
  const y = integrate(ty, springFor, ty[0])
  const opacity = integrate(vis, (i) => (fade[i] ? SPRINGS.typingFade : SPRINGS.opacity), vis[0])
  const scaleTarget = pressed.map((p) => (p ? 0.9 : 1))
  const scale = integrate(scaleTarget, () => PRESS_SPRING, 1)
  const rotation = buildRotation(cursor, tx, ty, input.scale, n)

  return {
    x,
    y,
    opacity,
    scale,
    rotation,
    typeAt: buildTypeResolver(input, cursor, moves),
    clicks,
    durationMs,
  }
}

function buildRotation(cursor: CursorSettings, tx: Float32Array, ty: Float32Array, scale: number, n: number): Float32Array {
  const base = (cursor.baseRotation * Math.PI) / 180
  const target = new Float32Array(n).fill(0)
  if (cursor.rotationMode === 'tilt' && cursor.tiltAmount > 0) {
    const tau = 120
    let v = 0
    for (let i = 1; i < n; i++) {
      const t = i * STEP_MS
      // Points per millisecond, so the feel doesn't depend on display density.
      let raw = (tx[i] - tx[i - 1]) / scale / STEP_MS
      if (Math.abs(raw) > 15) raw = 0 // teleport
      v += (raw - v) * (1 - Math.exp(-STEP_MS / tau))
      const deg = t < 500 ? 0 : clamp(v * 12 * cursor.tiltAmount, -20, 20)
      target[i] = (deg * Math.PI) / 180
    }
    return integrate(target, () => SPRINGS.tilt, 0).map((r) => r + base)
  }
  if (cursor.rotationMode === 'follow') {
    const neutral = (-112.5 * Math.PI) / 180
    let angle = 0
    for (let i = 1; i < n; i++) {
      const dx = tx[i] - tx[Math.max(0, i - 6)]
      const dy = ty[i] - ty[Math.max(0, i - 6)]
      const dist = Math.hypot(dx, dy) / scale
      if (i * STEP_MS > 500 && dist > 4) {
        let a = Math.atan2(dy, dx) - neutral
        a = Math.atan2(Math.sin(a), Math.cos(a))
        angle = clamp(a, (-135 * Math.PI) / 180, (135 * Math.PI) / 180) * 0.35
      }
      target[i] = angle
    }
    return integrate(target, () => SPRINGS.follow, 0).map((r) => r + base)
  }
  return target.fill(base)
}

/** Returns the cursor image id to show at a time, applying the "optimise cursor changes" rule. */
function buildTypeResolver(input: InputData, cursor: CursorSettings, moves: Move[]): (ms: number) => string | null {
  const changes = input.cursorChanges
  const images = input.cursorImages
  const arrowId = Object.entries(images).find(([, v]) => v.type === 'arrow')?.[0] ?? changes[0]?.id ?? null
  const rawAt = (ms: number) => {
    let id = changes[0]?.id ?? arrowId
    for (const c of changes) {
      if (c.t <= ms) id = c.id
      else break
    }
    return id
  }
  if (cursor.alwaysPointer) return () => arrowId
  if (!cursor.optimizeCursorTypes) return rawAt

  // Only switch shapes at meaningful moments: mouse down/up (and drag starts, which follow a down).
  const keyframes: { t: number; id: string | null }[] = [{ t: -Infinity, id: arrowId }]
  for (const c of input.clicks) {
    keyframes.push({ t: c.t, id: rawAt(c.t + 16) })
    if (c.type === 'up') {
      const shown = rawAt(c.t + 16)
      if (shown !== arrowId) {
        const moveAfter = moves.find((m) => m.t > c.t + 250 && Math.abs(m.x - c.x) + Math.abs(m.y - c.y) > 6)
        const nextClick = input.clicks.find((k) => k.t > c.t)
        if (moveAfter && (!nextClick || moveAfter.t < nextClick.t)) keyframes.push({ t: moveAfter.t, id: arrowId })
      }
    }
  }
  keyframes.sort((a, b) => a.t - b.t)
  return (ms: number) => {
    let id: string | null = arrowId
    for (const k of keyframes) {
      if (k.t <= ms) id = k.id
      else break
    }
    return id
  }
}

export function cursorAt(track: CursorTrack, ms: number) {
  return {
    x: sample(track.x, ms),
    y: sample(track.y, ms),
    opacity: clamp(sample(track.opacity, ms), 0, 1),
    scale: sample(track.scale, ms),
    rotation: sample(track.rotation, ms),
    id: track.typeAt(ms),
  }
}
