import { uid, type Rect01, type Spring, type Zoom } from '@shared/project'
import type { InputData } from './input'
import { STEP_MS, clamp, integrate, sample, steps } from './spring'

/** Auto-zoom ranges from clicks: each click spans [t−300, t+2500]; ranges closer than 2.5s merge. */
export function generateAutoZooms(input: InputData, level: number): Zoom[] {
  const dur = input.durationMs
  const ranges: [number, number][] = input.clicks
    .filter((c) => c.type === 'down' && c.t < dur - 1000)
    .map((c) => [Math.max(c.t - 300, 1), Math.min(c.t + 2500, dur - 800)] as [number, number])
    .filter(([a, b]) => b - a > 100)
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] - last[1] < 2500) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged.map(([start, end]) => ({
    id: uid(),
    start: Math.round(start),
    end: Math.round(end),
    level,
    mode: 'auto' as const,
    target: { x: 0.5, y: 0.5 },
    presentation: 'screen' as const,
    loupeRadius: 0.35,
    instant: false,
    disabled: false,
    generated: true,
  }))
}

export interface CameraTrack {
  /** Viewport centre inside the cropped screen (0..1). */
  vx: Float32Array
  vy: Float32Array
  scale: Float32Array
  /** Glass loupe: 0..1 visibility, centre and radius. */
  loupe: Float32Array
  lx: Float32Array
  ly: Float32Array
  loupeRadius: Float32Array
}

interface Group {
  start: number
  end: number
  cx: number
  cy: number
}

/**
 * Groups cursor samples in time order while their bounding box fits in half the zoomed viewport,
 * then targets the time-weighted centre of whichever group is active.
 */
function cursorGroups(input: InputData, zoom: Zoom, crop: Rect01, video: { width: number; height: number }): Group[] {
  const cropW = crop.width * video.width
  const cropH = crop.height * video.height
  const maxW = cropW / zoom.level / 2
  const maxH = cropH / zoom.level / 2
  const samples: { t: number; x: number; y: number }[] = []
  let mi = 0
  let last = input.moves[0]
  for (let t = zoom.start; t <= zoom.end; t += 10) {
    while (mi < input.moves.length && input.moves[mi].t <= t) last = input.moves[mi++]
    if (last) samples.push({ t, x: last.x, y: last.y })
  }
  const groups: Group[] = []
  let cur: { pts: typeof samples; minX: number; maxX: number; minY: number; maxY: number } | null = null
  const flush = () => {
    if (!cur || !cur.pts.length) return
    let wx = 0
    let wy = 0
    let wt = 0
    for (let i = 0; i < cur.pts.length; i++) {
      const w = (cur.pts[i + 1]?.t ?? cur.pts[i].t + 10) - cur.pts[i].t
      wx += cur.pts[i].x * w
      wy += cur.pts[i].y * w
      wt += w
    }
    groups.push({ start: cur.pts[0].t, end: cur.pts[cur.pts.length - 1].t, cx: wx / wt, cy: wy / wt })
  }
  for (const p of samples) {
    if (!cur) {
      cur = { pts: [p], minX: p.x, maxX: p.x, minY: p.y, maxY: p.y }
      continue
    }
    const minX = Math.min(cur.minX, p.x)
    const maxX = Math.max(cur.maxX, p.x)
    const minY = Math.min(cur.minY, p.y)
    const maxY = Math.max(cur.maxY, p.y)
    if (maxX - minX > maxW || maxY - minY > maxH) {
      flush()
      cur = { pts: [p], minX: p.x, maxX: p.x, minY: p.y, maxY: p.y }
    } else {
      cur.pts.push(p)
      Object.assign(cur, { minX, maxX, minY, maxY })
    }
  }
  flush()
  return groups
}

export function buildCameraTrack(opts: {
  zooms: Zoom[]
  input: InputData
  crop: Rect01
  video: { width: number; height: number }
  spring: Spring
  startEarly: boolean
  durationMs: number
  avoidEmpty?: boolean
}): CameraTrack {
  const { input, crop, video, spring } = opts
  const n = steps(opts.durationMs)
  const zooms = opts.zooms.filter((z) => !z.disabled).sort((a, b) => a.start - b.start)
  const tvx = new Float32Array(n).fill(0.5)
  const tvy = new Float32Array(n).fill(0.5)
  const ts = new Float32Array(n).fill(1)
  const tl = new Float32Array(n).fill(0)
  const tlx = new Float32Array(n).fill(0.5)
  const tly = new Float32Array(n).fill(0.5)
  const tlr = new Float32Array(n).fill(0.35)
  const instant = new Uint8Array(n)

  const toCrop = (x: number, y: number) => ({
    x: (x / video.width - crop.x) / crop.width,
    y: (y / video.height - crop.y) / crop.height,
  })

  let prevEnd = 0
  for (const z of zooms) {
    const start = opts.startEarly && !z.instant ? Math.max(z.start - 350, prevEnd) : z.start
    prevEnd = z.end
    const groups = z.mode === 'auto' && input.hasEvents ? cursorGroups(input, z, crop, video) : []
    const i0 = Math.max(0, Math.floor(start / STEP_MS))
    const i1 = Math.min(n - 1, Math.ceil(z.end / STEP_MS))
    let gi = 0
    for (let i = i0; i <= i1; i++) {
      const t = i * STEP_MS
      let p = z.target
      if (groups.length) {
        while (gi < groups.length - 1 && groups[gi].end < t) gi++
        p = toCrop(groups[gi].cx, groups[gi].cy)
      }
      const px = clamp(p.x, 0, 1)
      const py = clamp(p.y, 0, 1)
      if (z.presentation === 'loupe') {
        tl[i] = 1
        tlx[i] = px
        tly[i] = py
        tlr[i] = z.loupeRadius
      } else if (z.level > 1) {
        ts[i] = z.level
        // Keep the zoomed viewport inside the recording when asked to.
        const half = 0.5 / z.level
        tvx[i] = opts.avoidEmpty ? clamp(px, half, 1 - half) : px
        tvy[i] = opts.avoidEmpty ? clamp(py, half, 1 - half) : py
      }
      if (z.instant) instant[i] = 1
    }
    if (z.instant) {
      const e1 = Math.min(n - 1, Math.ceil((z.end + 50) / STEP_MS))
      for (let i = i1; i <= e1; i++) instant[i] = 1
    }
  }

  const springAt = (i: number) => (instant[i] ? null : spring)
  const loupeSpring = { ...spring, stiffness: spring.stiffness * 1.5 }
  return {
    vx: integrate(tvx, springAt, 0.5),
    vy: integrate(tvy, springAt, 0.5),
    scale: integrate(ts, springAt, 1),
    loupe: integrate(tl, (i) => (instant[i] ? null : loupeSpring), 0),
    lx: integrate(tlx, (i) => (instant[i] ? null : loupeSpring), 0.5),
    ly: integrate(tly, (i) => (instant[i] ? null : loupeSpring), 0.5),
    loupeRadius: integrate(tlr, () => loupeSpring, 0.35),
  }
}

export function cameraAt(track: CameraTrack, ms: number) {
  return {
    vx: sample(track.vx, ms),
    vy: sample(track.vy, ms),
    scale: Math.max(1, sample(track.scale, ms)),
    loupe: clamp(sample(track.loupe, ms), 0, 1),
    lx: sample(track.lx, ms),
    ly: sample(track.ly, ms),
    loupeRadius: sample(track.loupeRadius, ms),
  }
}
