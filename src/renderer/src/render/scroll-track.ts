import type { Mask, ProjectConfig, ScrollTrack } from '@shared/project'
import { FrameCursor } from '@/export/frames'
import { trackPath, type LoadedProject } from '@/editor/loader'

const STEP_MS = 50
const SAMPLE_W = 160

/**
 * Follows the content under a mask as it scrolls. For each step the luminance profile of the
 * masked region is searched for inside a slightly larger window of the next frame (rows for
 * vertical motion, columns for horizontal); the best match gives the shift. Offsets are
 * normalised to the cropped screen so the compositor can apply them directly.
 */
export async function trackMaskScroll(
  p: LoadedProject,
  config: ProjectConfig,
  mask: Mask,
  onProgress: (v: number) => void,
  signal?: AbortSignal,
  debug?: (step: { t: number; dy: number; dyScore: number; dx: number; dxScore: number }) => void,
): Promise<ScrollTrack> {
  const cursor = await FrameCursor.open(trackPath(p, 'screen')!)
  if (!cursor) throw new Error("The recording couldn't be read")
  const crop = config.style.output.crop
  const vw = p.meta.videoSize.width
  const vh = p.meta.videoSize.height
  const cropPx = { x: crop.x * vw, y: crop.y * vh, width: crop.width * vw, height: crop.height * vh }
  const region = {
    x: cropPx.x + mask.rect.x * cropPx.width,
    y: cropPx.y + mask.rect.y * cropPx.height,
    width: Math.max(8, mask.rect.width * cropPx.width),
    height: Math.max(8, mask.rect.height * cropPx.height),
  }
  // The search window has to contain the content after a whole step of fast scrolling (apps often
  // jump by a line or a wheel notch at once), so it's generous relative to the mask.
  const padX = Math.min(320, Math.max(80, region.width * 0.35))
  const padY = Math.min(640, Math.max(220, region.height * 1.3))
  const k = SAMPLE_W / (region.width + 2 * padX)
  const win = { w: SAMPLE_W, h: Math.max(4, Math.round((region.height + 2 * padY) * k)) }
  const canvas = new OffscreenCanvas(win.w, win.h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const screenOffset = p.meta.tracks.screen?.offset ?? 0

  const profiles = (sx: number, sy: number, sw: number, sh: number, img: CanvasImageSource) => {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, win.w, win.h)
    const d = ctx.getImageData(0, 0, win.w, win.h).data
    const rows = new Float32Array(win.h)
    const cols = new Float32Array(win.w)
    const lum = new Float32Array(win.w * win.h)
    for (let y = 0; y < win.h; y++) {
      for (let x = 0; x < win.w; x++) {
        const o = (y * win.w + x) * 4
        const l = d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114
        lum[y * win.w + x] = l
        rows[y] += l
        cols[x] += l
      }
    }
    for (let y = 0; y < win.h; y++) rows[y] /= win.w
    for (let x = 0; x < win.w; x++) cols[x] /= win.h
    return { rows, cols, lum }
  }

  // Repeating content (table rows, list items) aliases in a 1D profile, so the profile only
  // proposes candidates; the 2D patch decides between them.
  const patchScore = (ref: Float32Array, cur: Float32Array, dy: number, dx: number) => {
    const y0 = innerY + dy
    const x0 = innerX + dx
    if (y0 < 0 || x0 < 0 || y0 + innerH > win.h || x0 + innerW > win.w) return -1
    let ma = 0
    let mb = 0
    const n = innerH * innerW
    for (let y = 0; y < innerH; y++) {
      for (let x = 0; x < innerW; x++) {
        ma += ref[(innerY + y) * win.w + innerX + x]
        mb += cur[(y0 + y) * win.w + x0 + x]
      }
    }
    ma /= n
    mb /= n
    let cov = 0
    let va = 0
    let vb = 0
    for (let y = 0; y < innerH; y++) {
      for (let x = 0; x < innerW; x++) {
        const da = ref[(innerY + y) * win.w + innerX + x] - ma
        const db = cur[(y0 + y) * win.w + x0 + x] - mb
        cov += da * db
        va += da * da
        vb += db * db
      }
    }
    return va < 1e-3 || vb < 1e-3 ? 0 : cov / Math.sqrt(va * vb)
  }

  const samples: [number, number, number][] = []
  let ox = 0
  let oy = 0
  let prevShift = 0
  let ref: { rows: Float32Array; cols: Float32Array; lum: Float32Array } | null = null
  const innerY = Math.round(padY * k)
  const innerX = Math.round(padX * k)
  const innerH = Math.max(2, Math.round(region.height * k))
  const innerW = Math.max(2, Math.round(region.width * k))
  try {
    for (let t = mask.start; t <= mask.end; t += STEP_MS) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const frame = await cursor.frameAt(t / 1000 - screenOffset)
      if (!frame) continue
      const wx = region.x + ox - padX
      const wy = region.y + oy - padY
      const cur = profiles(wx, wy, region.width + 2 * padX, region.height + 2 * padY, frame.toCanvasImageSource())
      if (ref) {
        const dyCands = candidateShifts(ref.rows, cur.rows, innerY, innerH)
        const dxCands = candidateShifts(ref.cols, cur.cols, innerX, innerW)
        let best = { dy: 0, dx: 0, score: patchScore(ref.lum, cur.lum, 0, 0) }
        // Dense vertical sweep (scrolling is mostly vertical) at each plausible horizontal shift,
        // then a small refinement around the winner.
        for (const cx of [0, ...dxCands]) {
          for (let cy = -innerY; cy <= win.h - innerH - innerY; cy++) {
            const score = patchScore(ref.lum, cur.lum, cy, cx)
            if (score > best.score + 1e-4) best = { dy: cy, dx: cx, score }
          }
        }
        for (let jy = -1; jy <= 1; jy++) {
          for (let jx = -2; jx <= 2; jx++) {
            const score = patchScore(ref.lum, cur.lum, best.dy + jy, best.dx + jx)
            if (score > best.score + 1e-4) best = { dy: best.dy + jy, dx: best.dx + jx, score }
          }
        }
        // Content scrolling under a fixed header makes "no movement" compete with the real shift;
        // when scores are close, keep the direction the content was already moving in.
        if (prevShift !== 0 && best.dy === 0 && best.score < 0.9) {
          for (const cy of dyCands) {
            const sc = patchScore(ref.lum, cur.lum, cy, best.dx)
            if (Math.sign(cy) === Math.sign(prevShift) && sc > 0.5 && best.score - sc < 0.18 && Math.abs(cy - prevShift) < Math.abs(prevShift)) best = { dy: cy, dx: best.dx, score: sc }
          }
        }
        if (best.score > 0.6 && best.dy !== 0) prevShift = best.dy
        const dy = { shift: best.dy, score: best.score }
        const dx = { shift: best.dx, score: best.score }
        debug?.({ t, dy: dy.shift / k, dyScore: dy.score, dx: dx.shift / k, dxScore: dx.score, cands: dyCands.map((c) => [c, +patchScore(ref!.lum, cur.lum, c, 0).toFixed(2)]), at0: +patchScore(ref.lum, cur.lum, 0, 0).toFixed(2), k, innerH, innerY, winH: win.h } as never)
        if (best.score > 0.6) {
          oy += dy.shift / k
          ox += dx.shift / k
        }
        // Content that scrolled out of the frame can't be followed any further.
        const ry = region.y + oy
        const rx = region.x + ox
        if (ry < cropPx.y - region.height * 0.5 || ry + region.height > cropPx.y + cropPx.height + region.height * 0.5 || rx < cropPx.x - region.width * 0.5 || rx + region.width > cropPx.x + cropPx.width + region.width * 0.5) {
          samples.push([t, ox / cropPx.width, oy / cropPx.height])
          break
        }
        // Re-sample the reference at the new position only when the match was trustworthy.
        if (best.score > 0.6) {
          ref = profiles(region.x + ox - padX, region.y + oy - padY, region.width + 2 * padX, region.height + 2 * padY, frame.toCanvasImageSource())
        }
      } else ref = cur
      samples.push([t, +(ox / cropPx.width).toFixed(5), +(oy / cropPx.height).toFixed(5)])
      if (samples.length % 10 === 0) onProgress((t - mask.start) / Math.max(1, mask.end - mask.start))
    }
  } finally {
    await cursor.close()
  }
  onProgress(1)
  return { version: 1, start: mask.start, rect: { ...mask.rect }, samples }
}

/** Local maxima of the 1D match (score > 0.5), strongest first, as candidate shifts. */
function candidateShifts(ref: Float32Array, cur: Float32Array, inner: number, len: number): number[] {
  const a = ref.subarray(inner, inner + len)
  const ma = mean(a)
  let va = 0
  for (let i = 0; i < a.length; i++) va += (a[i] - ma) ** 2
  if (va < 1e-3) return []
  const maxOff = cur.length - len
  const scores = new Float32Array(maxOff + 1)
  for (let off = 0; off <= maxOff; off++) {
    const b = cur.subarray(off, off + len)
    const mb = mean(b)
    let cov = 0
    let vb = 0
    for (let i = 0; i < len; i++) {
      const db = b[i] - mb
      cov += (a[i] - ma) * db
      vb += db * db
    }
    scores[off] = vb < 1e-3 ? 0 : cov / Math.sqrt(va * vb)
  }
  const peaks: { off: number; score: number }[] = []
  for (let off = 0; off <= maxOff; off++) {
    const s = scores[off]
    if (s > 0.5 && (off === 0 || s >= scores[off - 1]) && (off === maxOff || s >= scores[off + 1])) peaks.push({ off, score: s })
  }
  return peaks
    .sort((p, q) => q.score - p.score)
    .slice(0, 5)
    .map((p) => p.off - inner)
}

function mean(x: Float32Array) {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]
  return s / Math.max(1, x.length)
}

/** Scroll offset (normalised to the cropped screen) at `ms`, interpolated between samples. */
export function scrollOffsetAt(track: ScrollTrack, ms: number): { dx: number; dy: number } {
  const s = track.samples
  if (!s.length || ms <= s[0][0]) return { dx: 0, dy: 0 }
  const last = s[s.length - 1]
  if (ms >= last[0]) return { dx: last[1], dy: last[2] }
  let lo = 0
  let hi = s.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s[mid][0] <= ms) lo = mid
    else hi = mid
  }
  const k = (ms - s[lo][0]) / Math.max(1, s[hi][0] - s[lo][0])
  return { dx: s[lo][1] + (s[hi][1] - s[lo][1]) * k, dy: s[lo][2] + (s[hi][2] - s[lo][2]) * k }
}

/** A track only applies while the mask still sits where it was analysed. */
export function trackMatches(mask: Mask) {
  const t = mask.track
  if (!t) return false
  const r = mask.rect
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-4
  return t.start === mask.start && eq(t.rect.x, r.x) && eq(t.rect.y, r.y) && eq(t.rect.width, r.width) && eq(t.rect.height, r.height)
}
