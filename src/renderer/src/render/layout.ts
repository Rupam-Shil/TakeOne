import type { CameraAnchor, LayoutSegment, LayoutSettings, LayoutType, OutputSettings } from '@shared/project'
import { clamp, easeInOutCubic, lerp } from './spring'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Geometry {
  screen: Rect
  screenOpacity: number
  camera: Rect
  cameraOpacity: number
  /** Corner radius multiplier for the camera (1 = use style radius ratio). */
  cameraRadiusScale: number
  /** True when the camera should fill without its own background/shadow (cutout). */
  cutout: boolean
}

export const ASPECTS: { label: string; value: OutputSettings['aspectRatio'] }[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'Wide 16:9', value: 16 / 9 },
  { label: 'Vertical 9:16', value: 9 / 16 },
  { label: 'Square 1:1', value: 1 },
  { label: 'Classic 4:3', value: 4 / 3 },
  { label: 'Tall 3:4', value: 3 / 4 },
  { label: 'Portrait 4:5', value: 4 / 5 },
]

const ASPECT_VALUES: Record<LayoutSettings['overlayAspect'], number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16,
}

/** Stage aspect: for "auto" it's the crop plus padding on every side. */
export function stageAspect(output: OutputSettings, cropAspect: number): number {
  if (output.aspectRatio !== 'auto') return output.aspectRatio
  const p = output.padding
  if (cropAspect >= 1) return cropAspect * (1 - 2 * p) + 2 * p
  // Portrait: padding follows the (shorter) width.
  return 1 / ((1 - 2 * p) / cropAspect + 2 * p)
}

/** Output pixel size for a target height, capped at 3840×2160 and kept even. */
export function stageSize(aspect: number, height: number) {
  let w = height * aspect
  let h = height
  const maxW = aspect >= 1 ? 3840 : 2160
  const maxH = aspect >= 1 ? 2160 : 3840
  if (w > maxW) {
    w = maxW
    h = w / aspect
  }
  if (h > maxH) {
    h = maxH
    w = h * aspect
  }
  return { width: Math.round(w / 2) * 2, height: Math.round(h / 2) * 2 }
}

function fit(aspect: number, box: Rect): Rect {
  let w = box.width
  let h = w / aspect
  if (h > box.height) {
    h = box.height
    w = h * aspect
  }
  return { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h }
}

function anchorRect(anchor: CameraAnchor, w: number, h: number, W: number, H: number, m: number): Rect {
  const x = anchor.includes('left') ? m : anchor.includes('right') ? W - w - m : (W - w) / 2
  const y = anchor.startsWith('top') ? m : anchor.startsWith('bottom') ? H - h - m : (H - h) / 2
  return { x, y, width: w, height: h }
}

export function geometryFor(
  type: LayoutType,
  s: LayoutSettings,
  stage: { width: number; height: number },
  padding: number,
  cropAspect: number,
  cameraAspect: number,
  hasCamera: boolean,
): Geometry {
  const W = stage.width
  const H = stage.height
  const short = Math.min(W, H)
  const pad = padding * short
  const inner: Rect = { x: pad, y: pad, width: W - 2 * pad, height: H - 2 * pad }
  const screen = fit(cropAspect, inner)
  const margin = Math.max(pad * 0.5, short * 0.025)

  const overlayCamera = () => {
    const a = ASPECT_VALUES[s.overlayAspect] ?? 1
    const size = s.overlaySize * short
    const w = size * Math.sqrt(a)
    const h = size / Math.sqrt(a)
    return anchorRect(s.overlayAnchor, w, h, W, H, margin)
  }

  if (!hasCamera) type = 'screen-only'

  switch (type) {
    case 'screen-only': {
      const cam = overlayCamera()
      return { screen, screenOpacity: 1, camera: shrink(cam, 0.6), cameraOpacity: 0, cameraRadiusScale: 1, cutout: false }
    }
    case 'fullscreen-camera': {
      return {
        screen: shrink(screen, 0.92),
        screenOpacity: 0,
        camera: s.splitFill ? { x: 0, y: 0, width: W, height: H } : inner,
        cameraOpacity: 1,
        cameraRadiusScale: 0.12,
        cutout: false,
      }
    }
    case 'split-screen': {
      const horizontal = s.splitDirection === 'auto' ? W >= H : s.splitDirection === 'horizontal'
      const fill = s.splitFill
      const outer: Rect = fill ? { x: 0, y: 0, width: W, height: H } : inner
      const gap = fill ? 0 : pad * 0.5
      const r = clamp(s.splitRatio, 0.2, 0.8)
      let a: Rect
      let b: Rect
      if (horizontal) {
        const wa = (outer.width - gap) * r
        a = { x: outer.x, y: outer.y, width: wa, height: outer.height }
        b = { x: outer.x + wa + gap, y: outer.y, width: outer.width - wa - gap, height: outer.height }
      } else {
        const ha = (outer.height - gap) * r
        a = { x: outer.x, y: outer.y, width: outer.width, height: ha }
        b = { x: outer.x, y: outer.y + ha + gap, width: outer.width, height: outer.height - ha - gap }
      }
      if (s.splitFlip) [a, b] = [b, a]
      return { screen: fill ? a : fit(cropAspect, a), screenOpacity: 1, camera: b, cameraOpacity: 1, cameraRadiusScale: fill ? 0 : 0.12, cutout: false }
    }
    case 'cutout-camera': {
      const h = s.cutoutSize * H
      const w = h * cameraAspect
      const x = s.cutoutPosition === 0 ? margin : s.cutoutPosition === 1 ? W - w - margin : (W - w) / 2
      return { screen, screenOpacity: 1, camera: { x, y: H - h, width: w, height: h }, cameraOpacity: 1, cameraRadiusScale: 0, cutout: true }
    }
    case 'camera-overlay':
    default:
      return { screen, screenOpacity: 1, camera: overlayCamera(), cameraOpacity: 1, cameraRadiusScale: 1, cutout: false }
  }
}

function shrink(r: Rect, k: number): Rect {
  const w = r.width * k
  const h = r.height * k
  return { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, width: w, height: h }
}

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  width: lerp(a.width, b.width, t),
  height: lerp(a.height, b.height, t),
})

export function lerpGeometry(a: Geometry, b: Geometry, t: number): Geometry {
  return {
    screen: lerpRect(a.screen, b.screen, t),
    screenOpacity: lerp(a.screenOpacity, b.screenOpacity, t),
    camera: lerpRect(a.camera, b.camera, t),
    cameraOpacity: lerp(a.cameraOpacity, b.cameraOpacity, t),
    cameraRadiusScale: lerp(a.cameraRadiusScale, b.cameraRadiusScale, t),
    cutout: t < 0.5 ? a.cutout : b.cutout,
  }
}

export const LAYOUT_TRANSITION_MS = 450

/** Layout in effect at a source time, with the previous one and transition progress. */
export function layoutStateAt(ms: number, segments: LayoutSegment[], fallback: LayoutType): { from: LayoutType; to: LayoutType; t: number } {
  const active = segments.filter((s) => !s.disabled).sort((a, b) => a.start - b.start)
  const typeAt = (x: number) => active.find((s) => x >= s.start && x < s.end)?.layout ?? fallback
  // Find the most recent boundary at or before ms where the layout changed.
  const boundaries = active.flatMap((s) => [s.start, s.end]).filter((b) => b <= ms).sort((a, b) => b - a)
  for (const b of boundaries) {
    const before = typeAt(b - 1)
    const after = typeAt(b)
    if (before !== after) {
      const p = (ms - b) / LAYOUT_TRANSITION_MS
      if (p >= 1) break
      return { from: before, to: after, t: easeInOutCubic(clamp(p, 0, 1)) }
    }
  }
  const cur = typeAt(ms)
  return { from: cur, to: cur, t: 1 }
}
