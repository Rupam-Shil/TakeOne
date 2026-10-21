import type { CameraLook, Mask, StyleConfig, TextOverlay, CutoutShape } from '@shared/project'
import { FONT_STACKS, lineAt } from './captions'
import { cursorAt } from './cursor'
import type { CursorBitmap } from './cursor-assets'
import { keyStateAt } from './keystrokes'
import { geometryFor, layoutStateAt, lerpGeometry, type Geometry, type Rect } from './layout'
import type { Scene } from './scene'
import { clamp, easeOutCubic, lerp, smoothstep } from './spring'
import { rgba } from './wallpapers'
import { cameraAt } from './zoom'
import { faceAt } from './faces'
import { scrollOffsetAt, trackMatches } from './scroll-track'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface FrameSources {
  screen: CanvasImageSource | null
  camera: CanvasImageSource | null
  /** Optional person matte for the camera (white = person). */
  cameraMatte?: CanvasImageSource | null
}

export interface RenderOptions {
  width: number
  height: number
  /** Pre-rendered background at stage size. */
  background: CanvasImageSource | null
  cursorImage: (id: string | null) => CursorBitmap | null
  /** Frame duration used to estimate motion between frames. */
  frameMs: number
  motionBlurSamples: number
  /** Preview hides nothing; export may skip work like guides. */
  showSafeZones?: 'none' | 'tiktok' | 'reels'
}

interface ScreenTransform {
  geo: Geometry
  s: number
  px: number
  py: number
  cx: number
  cy: number
}

const LOOK_FILTERS: Record<CameraLook, string> = {
  none: '',
  studio: 'contrast(1.06) saturate(1.08) brightness(1.03)',
  cinema: 'contrast(1.12) saturate(0.9) sepia(0.12) hue-rotate(-8deg)',
  film: 'contrast(1.05) saturate(0.85) sepia(0.22)',
  golden: 'sepia(0.3) saturate(1.25) brightness(1.04) hue-rotate(-10deg)',
  cream: 'sepia(0.18) brightness(1.08) contrast(0.95)',
  terra: 'sepia(0.35) saturate(1.3) contrast(1.08) hue-rotate(-18deg)',
  moody: 'contrast(1.18) saturate(0.75) brightness(0.92)',
  arctic: 'saturate(0.85) hue-rotate(12deg) brightness(1.05) contrast(1.04)',
  neon: 'saturate(1.6) contrast(1.1) hue-rotate(-12deg)',
  punch: 'saturate(1.35) contrast(1.15)',
  fade: 'contrast(0.88) brightness(1.08) saturate(0.85)',
  mono: 'grayscale(1) contrast(1.1)',
}

let scratch: OffscreenCanvas | null = null
function scratchCanvas(w: number, h: number) {
  scratch ??= new OffscreenCanvas(w, h)
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, Math.ceil(w))
    scratch.height = Math.max(scratch.height, Math.ceil(h))
  }
  return scratch
}

/** Square-ish frame for a cutout shape, sitting on the bottom edge of the camera rect. */
function shapeRect(r: Rect): Rect {
  const side = Math.min(r.width, r.height)
  return { x: r.x + (r.width - side) / 2, y: r.y + r.height - side, width: side, height: side }
}

function cutoutShapePath(ctx: Ctx, r: Rect, shape: CutoutShape) {
  const s = shapeRect(r)
  ctx.beginPath()
  if (shape === 'circle') ctx.ellipse(s.x + s.width / 2, s.y + s.height / 2, s.width / 2, s.height / 2, 0, 0, Math.PI * 2)
  else if (shape === 'hexagon') {
    const cx = s.x + s.width / 2
    const cy = s.y + s.height / 2
    const R = s.width / 2
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3
      const px = cx + R * Math.cos(a)
      const py = cy + R * Math.sin(a)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else ctx.roundRect(s.x, s.y, s.width, s.height, shape === 'rounded' ? s.width * 0.22 : 0)
}

function roundRectPath(ctx: Ctx, r: Rect, radius: number) {
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.width, r.height, Math.max(0, Math.min(radius, r.width / 2, r.height / 2)))
}

export function sourceSize(src: CanvasImageSource | null): { width: number; height: number } {
  if (!src) return { width: 0, height: 0 }
  const s = src as any
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return { width: src.displayWidth, height: src.displayHeight }
  if (s.videoWidth) return { width: s.videoWidth, height: s.videoHeight }
  return { width: s.width ?? 0, height: s.height ?? 0 }
}

export class Compositor {
  /** Renders one frame of the project at source time `ms`. */
  render(ctx: Ctx, scene: Scene, ms: number, sources: FrameSources, opt: RenderOptions) {
    const { width: W, height: H } = opt
    const style = scene.config.style
    const u = Math.min(W, H) / 1080

    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (opt.background) ctx.drawImage(opt.background, 0, 0, W, H)
    else {
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, W, H)
    }

    const cur = this.transformAt(scene, ms, W, H)
    const prev = this.transformAt(scene, ms - opt.frameMs, W, H)
    const motion =
      Math.abs(cur.s - prev.s) / cur.s + (Math.abs(cur.px - prev.px) + Math.abs(cur.py - prev.py)) / Math.max(1, cur.geo.screen.width)
    const blurAmount = style.animations.motionBlur
    const samples = blurAmount > 0 && motion > 0.0015 ? Math.max(1, Math.round(opt.motionBlurSamples * blurAmount)) : 1

    this.drawScreenLayer(ctx, scene, ms, sources, cur, prev, samples, u, W)
    this.drawCamera(ctx, scene, ms, sources, cur, u)
    this.drawTexts(ctx, scene.config.timeline.texts, ms, W, H, u)
    this.drawKeystrokes(ctx, scene, ms, W, H)
    this.drawCaptions(ctx, scene, ms, W, H, u)
    if (opt.showSafeZones && opt.showSafeZones !== 'none') this.drawSafeZones(ctx, W, H)
    ctx.restore()
  }

  transformAt(scene: Scene, ms: number, W: number, H: number): ScreenTransform {
    const style = scene.config.style
    const lay = layoutStateAt(ms, scene.config.timeline.layouts, style.layout.type)
    const camAspect = scene.meta.tracks.cameraSize ? scene.meta.tracks.cameraSize.width / scene.meta.tracks.cameraSize.height : 16 / 9
    const g = (t: typeof lay.from) =>
      geometryFor(t, style.layout, { width: W, height: H }, style.output.padding, scene.cropAspect, camAspect, scene.hasCamera && !style.camera.hide)
    const geo = lay.t >= 1 ? g(lay.to) : lerpGeometry(g(lay.from), g(lay.to), lay.t)
    const cam = cameraAt(scene.camera, Math.max(0, ms))
    const R = geo.screen
    return {
      geo,
      s: cam.scale,
      px: R.x + cam.vx * R.width,
      py: R.y + cam.vy * R.height,
      cx: R.x + R.width / 2,
      cy: R.y + R.height / 2,
    }
  }

  private applyTransform(ctx: Ctx, t: ScreenTransform) {
    ctx.translate(t.cx, t.cy)
    ctx.scale(t.s, t.s)
    ctx.translate(-t.px, -t.py)
  }

  /** Maps a recording-pixel position to stage coordinates (after zoom). */
  mapPoint(scene: Scene, t: ScreenTransform, x: number, y: number) {
    const crop = scene.config.style.output.crop
    const { width: vw, height: vh } = scene.meta.videoSize
    const R = t.geo.screen
    const lx = R.x + ((x / vw - crop.x) / crop.width) * R.width
    const ly = R.y + ((y / vh - crop.y) / crop.height) * R.height
    return { x: (lx - t.px) * t.s + t.cx, y: (ly - t.py) * t.s + t.cy }
  }

  private screenRadius(style: StyleConfig, u: number, scene: Scene, R: Rect) {
    if (scene.isDevice && style.device.enableFrame) return R.width * 0.11
    if (style.output.padding === 0 && style.output.aspectRatio === 'auto') return 0
    return style.style.screenRadius * u
  }

  private drawScreenLayer(
    ctx: Ctx,
    scene: Scene,
    ms: number,
    src: FrameSources,
    cur: ScreenTransform,
    prev: ScreenTransform,
    samples: number,
    u: number,
    W: number,
  ) {
    const style = scene.config.style
    const R = cur.geo.screen
    if (cur.geo.screenOpacity <= 0.001) return
    const radius = this.screenRadius(style, u, scene, R)
    const crop = style.output.crop
    const { width: vw, height: vh } = scene.meta.videoSize
    const sx = crop.x * vw
    const sy = crop.y * vh
    const sw = crop.width * vw
    const sh = crop.height * vh

    ctx.save()
    ctx.globalAlpha = cur.geo.screenOpacity

    // Shadow, drawn once under the screen. Canvas shadows ignore the transform, so scale by hand.
    const sh_ = style.style.shadow
    if (sh_.intensity > 0) {
      ctx.save()
      this.applyTransform(ctx, cur)
      const rad = (sh_.angle * Math.PI) / 180
      const dist = sh_.directional ? sh_.distance * u * cur.s : 0
      ctx.shadowColor = `rgba(0,0,0,${clamp(sh_.intensity, 0, 1)})`
      ctx.shadowBlur = sh_.blur * 4 * u * cur.s
      ctx.shadowOffsetX = Math.cos(rad) * dist
      ctx.shadowOffsetY = Math.sin(rad) * dist
      ctx.fillStyle = '#000'
      if (scene.isDevice && style.device.enableFrame) roundRectPath(ctx, inflate(R, R.width * 0.045), radius + R.width * 0.045)
      else roundRectPath(ctx, R, radius)
      ctx.fill()
      ctx.restore()
    }

    if (scene.isDevice && style.device.enableFrame) {
      ctx.save()
      this.applyTransform(ctx, cur)
      drawDeviceFrame(ctx, R, radius)
      ctx.restore()
    }

    const baseAlpha = ctx.globalAlpha
    for (let k = 0; k < samples; k++) {
      const f = samples === 1 ? 1 : (k + 1) / samples
      const t: ScreenTransform =
        samples === 1
          ? cur
          : { ...cur, s: lerp(prev.s, cur.s, f), px: lerp(prev.px, cur.px, f), py: lerp(prev.py, cur.py, f) }
      ctx.save()
      // Running average: sample k drawn at 1/(k+1) leaves every sample equally weighted.
      ctx.globalAlpha = baseAlpha * (samples === 1 ? 1 : 1 / (k + 1))
      this.applyTransform(ctx, t)
      roundRectPath(ctx, R, radius)
      ctx.clip()
      if (src.screen) ctx.drawImage(src.screen, sx, sy, sw, sh, R.x, R.y, R.width, R.height)
      else {
        ctx.fillStyle = '#000'
        ctx.fillRect(R.x, R.y, R.width, R.height)
      }
      ctx.restore()
    }

    ctx.save()
    this.applyTransform(ctx, cur)
    roundRectPath(ctx, R, radius)
    ctx.clip()
    for (const m of scene.config.timeline.masks) this.drawMask(ctx, m, ms, src.screen, R, { sx, sy, sw, sh }, u)
    const inset = style.style.inset
    if (inset.size > 0 && style.output.padding > 0) {
      ctx.strokeStyle = rgba(inset.color, inset.alpha)
      ctx.lineWidth = inset.size * 2 * u
      roundRectPath(ctx, R, radius)
      ctx.stroke()
    }
    this.drawLoupe(ctx, scene, ms, src.screen, R, { sx, sy, sw, sh })
    ctx.restore()

    ctx.restore()

    this.drawCursor(ctx, scene, ms, cur, prev, samples, u, W)
  }

  private drawMask(ctx: Ctx, m: Mask, ms: number, screen: CanvasImageSource | null, R: Rect, s: { sx: number; sy: number; sw: number; sh: number }, u: number) {
    if (m.disabled) return
    // Masks fade in 200ms early and out 200ms late so they never reveal a frame.
    const a = smoothstep(m.start - 200, m.start, ms) * (1 - smoothstep(m.end, m.end + 200, ms))
    if (a <= 0) return
    // Scroll-following masks ride along with the analysed content offset.
    const follow = m.followScroll && m.track && trackMatches(m) ? scrollOffsetAt(m.track, ms) : { dx: 0, dy: 0 }
    const mx = m.rect.x + follow.dx
    const my = m.rect.y + follow.dy
    const rect: Rect = { x: R.x + mx * R.width, y: R.y + my * R.height, width: m.rect.width * R.width, height: m.rect.height * R.height }
    const radius = m.radius * u
    ctx.save()
    ctx.globalAlpha *= a
    if (m.type === 'highlight') {
      ctx.fillStyle = `rgba(0,0,0,${clamp(m.opacity, 0, 1)})`
      ctx.beginPath()
      ctx.rect(R.x, R.y, R.width, R.height)
      ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius)
      ctx.fill('evenodd')
    } else if (screen) {
      const srcRect = { x: s.sx + mx * s.sw, y: s.sy + my * s.sh, w: m.rect.width * s.sw, h: m.rect.height * s.sh }
      roundRectPath(ctx, rect, radius)
      ctx.clip()
      if (m.type === 'pixelate') {
        const block = Math.max(4, m.blur)
        const tw = Math.max(1, Math.round(rect.width / block))
        const th = Math.max(1, Math.round(rect.height / block))
        const c = scratchCanvas(tw, th)
        const g = c.getContext('2d')!
        g.clearRect(0, 0, tw, th)
        g.drawImage(screen, srcRect.x, srcRect.y, srcRect.w, srcRect.h, 0, 0, tw, th)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(c, 0, 0, tw, th, rect.x, rect.y, rect.width, rect.height)
      } else {
        // Sample a margin around the mask so the blur doesn't fade to transparent at the edges.
        const pad = 0.15
        ctx.filter = `blur(${Math.max(1, m.blur) * u}px)`
        ctx.drawImage(
          screen,
          srcRect.x - srcRect.w * pad,
          srcRect.y - srcRect.h * pad,
          srcRect.w * (1 + 2 * pad),
          srcRect.h * (1 + 2 * pad),
          rect.x - rect.width * pad,
          rect.y - rect.height * pad,
          rect.width * (1 + 2 * pad),
          rect.height * (1 + 2 * pad),
        )
        ctx.filter = 'none'
      }
    }
    ctx.restore()
  }

  private drawLoupe(ctx: Ctx, scene: Scene, ms: number, screen: CanvasImageSource | null, R: Rect, s: { sx: number; sy: number; sw: number; sh: number }) {
    if (!screen) return
    const cam = cameraAt(scene.camera, ms)
    if (cam.loupe < 0.01) return
    const zoom = scene.config.timeline.zooms.find((z) => z.presentation === 'loupe' && ms >= z.start - 600 && ms <= z.end + 600)
    const level = Math.max(1.4, zoom?.level ?? 2)
    // A gentle wobble keeps the glass feeling alive.
    const wob = 0.0125
    const lx = cam.lx + Math.sin((ms / 12000) * Math.PI * 2) * wob
    const ly = cam.ly + Math.sin((ms / 18000) * Math.PI * 2) * wob
    const r = cam.loupeRadius * Math.max(R.width, R.height) * 0.5 * easeOutCubic(cam.loupe)
    const cx = R.x + lx * R.width
    const cy = R.y + ly * R.height
    ctx.save()
    ctx.globalAlpha *= cam.loupe
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = r * 0.35
    ctx.shadowOffsetY = r * 0.08
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.save()
    ctx.clip()
    const srcW = ((2 * r) / R.width) * s.sw / level
    const srcH = ((2 * r) / R.height) * s.sh / level
    ctx.drawImage(screen, s.sx + lx * s.sw - srcW / 2, s.sy + ly * s.sh - srcH / 2, srcW, srcH, cx - r, cy - r, 2 * r, 2 * r)
    // Masks must hold inside the glass too, so the loupe never reveals what's blurred outside it.
    const magnified: Rect = { x: cx - lx * R.width * level, y: cy - ly * R.height * level, width: R.width * level, height: R.height * level }
    const u = Math.min(ctx.canvas.width, ctx.canvas.height) / 1080
    for (const m of scene.config.timeline.masks) this.drawMask(ctx, m, ms, screen, magnified, s, u * level)
    // Glass: inner rim shading and a soft highlight.
    const rim = ctx.createRadialGradient(cx, cy, r * 0.78, cx, cy, r)
    rim.addColorStop(0, 'rgba(255,255,255,0)')
    rim.addColorStop(0.85, 'rgba(255,255,255,0.08)')
    rim.addColorStop(1, 'rgba(0,0,0,0.35)')
    ctx.fillStyle = rim
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r)
    const shine = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.2, cy + r * 0.2)
    shine.addColorStop(0, 'rgba(255,255,255,0.28)')
    shine.addColorStop(0.45, 'rgba(255,255,255,0)')
    ctx.fillStyle = shine
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r)
    ctx.restore()
    ctx.lineWidth = Math.max(1.5, r * 0.025)
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  private drawCursor(ctx: Ctx, scene: Scene, ms: number, cur: ScreenTransform, prev: ScreenTransform, samples: number, u: number, W: number) {
    const cs = scene.config.style.cursor
    if (!scene.cursor || cs.hide) return
    const c = cursorAt(scene.cursor, ms)
    this.drawClickEffects(ctx, scene, ms, cur, u, W)
    if (c.opacity < 0.01) return
    const bmp = this.cursorBitmap?.(c.id) ?? null
    if (!bmp) return
    const p = this.mapPoint(scene, cur, c.x, c.y)
    const pc = cursorAt(scene.cursor, ms - 1000 / 60)
    const pp = this.mapPoint(scene, prev, pc.x, pc.y)
    const h = cs.size * 0.7 * u * cur.s * bmp.heightScale * c.scale
    const w = h * bmp.aspect
    const dist = Math.hypot(p.x - pp.x, p.y - pp.y)
    // Fast flicks get a short trail; the cursor is small so this stays cheap.
    const n = scene.config.style.animations.motionBlur > 0 && dist > h * 0.15 ? Math.min(8, Math.max(samples, Math.ceil(dist / (h * 0.25)))) : 1
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.28)'
    ctx.shadowBlur = h * 0.12
    ctx.shadowOffsetY = h * 0.04
    if (bmp.pixelated) ctx.imageSmoothingEnabled = false
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 1 : (k + 1) / n
      ctx.save()
      ctx.globalAlpha = c.opacity * (n === 1 ? 1 : 1 / (k + 1))
      ctx.translate(lerp(pp.x, p.x, f), lerp(pp.y, p.y, f))
      ctx.rotate(c.rotation)
      ctx.drawImage(bmp.image, -bmp.hx * w, -bmp.hy * h, w, h)
      ctx.restore()
    }
    ctx.restore()
  }

  private personLayer: OffscreenCanvas | null = null

  /** Set by the host so the compositor can resolve preloaded cursor images synchronously. */
  cursorBitmap: ((id: string | null) => CursorBitmap | null) | null = null

  private drawClickEffects(ctx: Ctx, scene: Scene, ms: number, t: ScreenTransform, u: number, W: number) {
    const cs = scene.config.style.cursor
    if (cs.clickEffect === 'none' || !scene.cursor) return
    const recent = scene.cursor.clicks.filter((c) => c.type === 'down' && c.button === 'left' && ms >= c.t && ms - c.t < 1000).slice(-3)
    for (const click of recent) {
      const dt = ms - click.t
      const pos = cursorAt(scene.cursor, click.t)
      const p = this.mapPoint(scene, t, pos.x, pos.y)
      ctx.save()
      if (cs.clickEffect === 'circle') {
        const q = dt / 450
        if (q > 1) {
          ctx.restore()
          continue
        }
        const env = smoothstep(0, 0.15, q) * (1 - smoothstep(0.15, 0.9, q))
        const r = W * (0.002 + 0.028 * easeOutCubic(q)) * Math.sqrt(t.s)
        ctx.globalAlpha = 0.6 * env
        ctx.fillStyle = cs.clickEffectColor
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 0.5 * env
        ctx.lineWidth = Math.max(1, W * 0.0007)
        ctx.strokeStyle = '#000'
        ctx.stroke()
      } else {
        const ts = dt / 1000
        const bounce = Math.exp(-3 * ts) * Math.sin(9.4 * ts)
        const r = W * (0.012 + ts * 0.2 * 0.35) * Math.sqrt(t.s)
        const band = W * 0.02
        const g = ctx.createRadialGradient(p.x, p.y, Math.max(0, r - band), p.x, p.y, r + band)
        g.addColorStop(0, rgba(cs.clickEffectColor, 0))
        g.addColorStop(0.5, rgba(cs.clickEffectColor, clamp(Math.abs(bounce) * 0.9, 0, 0.7)))
        g.addColorStop(1, rgba(cs.clickEffectColor, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, r + band, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
    void u
  }

  private drawCamera(ctx: Ctx, scene: Scene, ms: number, src: FrameSources, t: ScreenTransform, u: number) {
    const style = scene.config.style
    const camStyle = style.camera
    if (!src.camera || !scene.hasCamera || camStyle.hide) return
    const geo = t.geo
    let opacity = geo.cameraOpacity
    if (camStyle.hideDuringSilenceMs) {
      const silent = scene.silences.find((s) => ms >= s.start && ms <= s.end && s.end - s.start >= camStyle.hideDuringSilenceMs!)
      if (silent) opacity *= 1 - smoothstep(silent.start, silent.start + 300, ms) * (1 - smoothstep(silent.end - 300, silent.end, ms))
    }
    if (opacity <= 0.01) return
    let rect = geo.camera
    // Shrink the overlay camera while the screen is zoomed in so it covers less.
    const activeLayout = scene.config.timeline.layouts.find((l) => !l.disabled && ms >= l.start && ms < l.end)?.layout ?? style.layout.type
    if (activeLayout === 'camera-overlay') {
      const k = clamp(t.s - 1, 0, 1)
      const sc = lerp(1, style.layout.overlayZoomedScale, k)
      if (sc !== 1) rect = scaleToward(rect, sc, style.layout.overlayAnchor, ctx.canvas.width, ctx.canvas.height)
    }
    const { width: cw, height: ch } = sourceSize(src.camera)
    if (!cw || !ch) return
    const radius = camStyle.radiusRatio * Math.min(rect.width, rect.height) * geo.cameraRadiusScale

    ctx.save()
    ctx.globalAlpha = opacity
    if (!geo.cutout && camStyle.shadow > 0) {
      ctx.save()
      ctx.shadowColor = `rgba(0,0,0,${camStyle.shadow})`
      ctx.shadowBlur = 40 * u
      ctx.shadowOffsetY = 10 * u
      ctx.fillStyle = '#000'
      roundRectPath(ctx, rect, radius)
      ctx.fill()
      ctx.restore()
    }
    const cutoutShape: CutoutShape = geo.cutout ? (style.layout.cutoutShape ?? 'free') : 'free'
    if (cutoutShape !== 'free') {
      // A soft plate under the person so the shape reads even where the silhouette does not reach it.
      ctx.save()
      cutoutShapePath(ctx, rect, cutoutShape)
      ctx.shadowColor = `rgba(0,0,0,${Math.max(0.25, camStyle.shadow)})`
      ctx.shadowBlur = 30 * u
      ctx.shadowOffsetY = 8 * u
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.fill()
      ctx.restore()
    }
    ctx.save()
    if (!geo.cutout) {
      roundRectPath(ctx, rect, radius)
      ctx.clip()
    } else if (cutoutShape !== 'free') {
      cutoutShapePath(ctx, rect, cutoutShape)
      ctx.clip()
    }
    // Cover-fit the camera into its rect, with the user's crop zoom and offset.
    const targetAspect = rect.width / rect.height
    let sw = cw
    let sh = cw / targetAspect
    if (sh > ch) {
      sh = ch
      sw = ch * targetAspect
    }
    let sx: number
    let sy: number
    const face = camStyle.faceTracking && scene.faces?.length ? faceAt(scene.faces, ms) : null
    if (face) {
      // Frame the face at about a third of the crop height, with a little headroom.
      const zoom = clamp(0.34 / Math.max(0.05, face.h), 1, 2.4)
      sw /= zoom
      sh /= zoom
      sx = clamp(face.x * cw - sw / 2, 0, cw - sw)
      sy = clamp((face.y - 0.05) * ch - sh / 2, 0, ch - sh)
    } else {
      sw /= camStyle.zoom
      sh /= camStyle.zoom
      sx = clamp((cw - sw) / 2 + camStyle.offset.x * (cw - sw) / 2, 0, cw - sw)
      sy = clamp((ch - sh) / 2 + camStyle.offset.y * (ch - sh) / 2, 0, ch - sh)
    }
    const filter = [LOOK_FILTERS[camStyle.look], camStyle.brightness !== 1 ? `brightness(${camStyle.brightness})` : ''].filter(Boolean).join(' ')
    if (camStyle.mirror) {
      ctx.translate(rect.x + rect.width, rect.y)
      ctx.scale(-1, 1)
      ctx.translate(-rect.x, -rect.y)
    }
    const lookStrength = camStyle.look === 'none' ? 1 : clamp(camStyle.lookIntensity, 0, 1)
    if (src.cameraMatte && (geo.cutout || camStyle.backgroundBlur > 0 || camStyle.removeBackground)) {
      this.drawMattedCamera(ctx, src.camera, src.cameraMatte, { sx, sy, sw, sh }, rect, filter, camStyle.backgroundBlur * u, geo.cutout || camStyle.removeBackground)
    } else if (!geo.cutout || !src.cameraMatte) {
      if (lookStrength < 1) {
        // Partial look: the untouched frame underneath, the graded one blended on top.
        ctx.filter = camStyle.brightness !== 1 ? `brightness(${camStyle.brightness})` : 'none'
        ctx.drawImage(src.camera, sx, sy, sw, sh, rect.x, rect.y, rect.width, rect.height)
        ctx.globalAlpha = opacity * lookStrength
      }
      if (filter) ctx.filter = filter
      ctx.drawImage(src.camera, sx, sy, sw, sh, rect.x, rect.y, rect.width, rect.height)
      ctx.filter = 'none'
      ctx.globalAlpha = opacity
    }
    if (camStyle.grain > 0) {
      ctx.globalAlpha = opacity * camStyle.grain * 0.4
      ctx.globalCompositeOperation = 'overlay'
      ctx.fillStyle = noisePattern(ctx, ms)
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.restore()
    if (camStyle.border > 0 && cutoutShape !== 'free') {
      ctx.lineWidth = camStyle.border * u
      ctx.strokeStyle = camStyle.borderColor
      cutoutShapePath(ctx, rect, cutoutShape)
      ctx.stroke()
    }
    if (camStyle.border > 0 && !geo.cutout) {
      ctx.lineWidth = camStyle.border * u
      ctx.strokeStyle = camStyle.borderColor
      roundRectPath(ctx, inflate(rect, -(camStyle.border * u) / 2), Math.max(0, radius - (camStyle.border * u) / 2))
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawMattedCamera(
    ctx: Ctx,
    camera: CanvasImageSource,
    matte: CanvasImageSource,
    s: { sx: number; sy: number; sw: number; sh: number },
    rect: Rect,
    filter: string,
    blurPx: number,
    removeBackground: boolean,
  ) {
    const w = Math.ceil(rect.width)
    const h = Math.ceil(rect.height)
    if (!this.personLayer || this.personLayer.width !== w || this.personLayer.height !== h) this.personLayer = new OffscreenCanvas(w, h)
    const c = this.personLayer
    const g = c.getContext('2d')!
    g.globalCompositeOperation = 'source-over'
    g.filter = 'none'
    g.clearRect(0, 0, w, h)
    const { width: mw, height: mh } = sourceSize(matte)
    const { width: cw, height: ch } = sourceSize(camera)
    // Person layer = camera ∩ matte.
    g.drawImage(matte, (s.sx / cw) * mw, (s.sy / ch) * mh, (s.sw / cw) * mw, (s.sh / ch) * mh, 0, 0, w, h)
    g.globalCompositeOperation = 'source-in'
    if (filter) g.filter = filter
    g.drawImage(camera, s.sx, s.sy, s.sw, s.sh, 0, 0, w, h)
    if (!removeBackground) {
      ctx.filter = `${filter} blur(${Math.max(2, blurPx)}px)`
      ctx.drawImage(camera, s.sx, s.sy, s.sw, s.sh, rect.x, rect.y, rect.width, rect.height)
      ctx.filter = 'none'
    }
    ctx.drawImage(c, rect.x, rect.y, rect.width, rect.height)
  }

  private drawKeystrokes(ctx: Ctx, scene: Scene, ms: number, W: number, H: number) {
    const ks = scene.config.style.keystrokes
    if (!ks.enabled || !scene.keyGroups.length) return
    const st = keyStateAt(scene.keyGroups, ms)
    if (!st) return
    const keyH = H * ks.size * 0.55
    const font = `600 ${keyH * 0.48}px ${FONT_STACKS['sans-serif']}`
    ctx.save()
    ctx.font = font
    const gap = keyH * 0.14
    const widths = st.press.tokens.map((tk) => Math.max(keyH, ctx.measureText(tk).width + keyH * 0.6))
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)
    const enter = easeOutCubic(clamp(st.age / 180, 0, 1))
    const alpha = enter * (1 - st.fadeOut)
    const captionsUp = scene.config.style.captions.enabled && scene.captions.length ? H * scene.config.style.captions.size * 2.2 : 0
    const y = H - H * 0.06 - keyH - captionsUp + (1 - enter) * keyH * 0.4
    let x = (W - total) / 2
    ctx.globalAlpha = alpha
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    st.press.tokens.forEach((tk, i) => {
      const w = widths[i]
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.33)'
      ctx.shadowBlur = ks.size * 200 * (H / 1080) * 0.4
      ctx.shadowOffsetY = ks.size * 25 * (H / 1080) * 0.4
      ctx.fillStyle = ks.theme === 'dark' ? 'rgba(24,25,30,0.92)' : 'rgba(250,250,252,0.96)'
      ctx.beginPath()
      ctx.roundRect(x, y, w, keyH, keyH * 0.22)
      ctx.fill()
      ctx.restore()
      ctx.strokeStyle = ks.theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
      ctx.lineWidth = Math.max(1, keyH * 0.02)
      ctx.beginPath()
      ctx.roundRect(x, y, w, keyH, keyH * 0.22)
      ctx.stroke()
      ctx.fillStyle = ks.theme === 'dark' ? '#f3f4f7' : '#17181c'
      ctx.fillText(tk, x + w / 2, y + keyH / 2 + keyH * 0.02)
      x += w + gap
    })
    ctx.restore()
  }

  private drawCaptions(ctx: Ctx, scene: Scene, ms: number, W: number, H: number, u: number) {
    const cs = scene.config.style.captions
    if (!cs.enabled || !scene.captions.length) return
    const line = lineAt(scene.captions, ms)
    if (!line) return
    const fontPx = cs.size * H
    ctx.save()
    ctx.font = `600 ${fontPx}px ${FONT_STACKS[cs.font]}`
    ctx.textBaseline = 'middle'
    const space = ctx.measureText(' ').width
    const widths = line.words.map((w) => ctx.measureText(w.text).width)
    const fullWidth = widths.reduce((a, b) => a + b, 0) + space * (widths.length - 1)
    const revealCount = cs.wordsReveal === 'word-by-word' ? line.words.filter((w) => w.start <= ms).length || 1 : line.words.length
    const shownWidth = widths.slice(0, revealCount).reduce((a, b) => a + b, 0) + space * (revealCount - 1)
    const padX = fontPx * 0.5
    const padY = fontPx * 0.32
    const boxH = fontPx + padY * 2
    const cx = cs.position.x * W
    const bottomMargin = H * 0.05
    const yCenter = clamp(cs.position.y * H, boxH / 2 + bottomMargin, H - boxH / 2 - bottomMargin)
    const lineAlpha = smoothstep(line.start - 120, line.start, ms) * (1 - smoothstep(line.until - 150, line.until, ms))
    let boxW = fullWidth
    let boxX = cx - fullWidth / 2
    if (cs.wordsReveal === 'word-by-word') {
      if (cs.lineGrowth === 'left-anchored') boxW = shownWidth
      else if (cs.lineGrowth === 'centered') {
        boxW = shownWidth
        boxX = cx - shownWidth / 2
      }
    }
    ctx.globalAlpha = lineAlpha
    if (cs.backgroundOpacity > 0) {
      ctx.fillStyle = rgba(cs.background, cs.backgroundOpacity)
      ctx.beginPath()
      ctx.roundRect(boxX - padX, yCenter - boxH / 2, boxW + padX * 2, boxH, fontPx * 0.32)
      ctx.fill()
    }
    let x = boxX
    line.words.forEach((w, i) => {
      if (i >= revealCount) return
      const active = ms >= w.start && ms < w.end + 80
      const upcoming = ms < w.start
      let a = 1
      let dy = 0
      if (cs.wordEntrance === 'fade-in') a = upcoming ? 0.4 : 1
      if (cs.wordEntrance === 'slide-in' && !upcoming) {
        const p = easeOutCubic(clamp((ms - w.start) / 160, 0, 1))
        dy = (1 - p) * fontPx * 0.25
        a = 0.3 + 0.7 * p
      }
      ctx.globalAlpha = lineAlpha * a
      ctx.fillStyle = active && cs.wordsReveal === 'line-by-line' && cs.highlightColor !== cs.color ? cs.highlightColor : cs.color
      ctx.fillText(w.text, x, yCenter + dy)
      x += widths[i] + space
    })
    ctx.restore()
    void u
  }

  private drawTexts(ctx: Ctx, texts: TextOverlay[], ms: number, W: number, H: number, u: number) {
    for (const t of texts) {
      if (t.disabled || ms < t.start - 200 || ms > t.end + 200) continue
      const a = smoothstep(t.start - 200, t.start + 50, ms) * (1 - smoothstep(t.end - 50, t.end + 200, ms))
      if (a <= 0) continue
      const fontPx = t.size * H
      ctx.save()
      ctx.globalAlpha = a
      ctx.font = `${t.weight} ${fontPx}px ${FONT_STACKS['sans-serif']}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lines = t.text.split('\n')
      const widths = lines.map((l) => ctx.measureText(l).width)
      const bw = Math.max(...widths) + fontPx
      const bh = lines.length * fontPx * 1.25 + fontPx * 0.5
      const x = t.position.x * W
      const y = t.position.y * H + (1 - easeOutCubic(clamp((ms - t.start + 200) / 350, 0, 1))) * 12 * u
      if (t.background !== 'transparent') {
        ctx.fillStyle = t.background
        ctx.beginPath()
        ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, fontPx * 0.35)
        ctx.fill()
      }
      ctx.fillStyle = t.color
      lines.forEach((l, i) => ctx.fillText(l, x, y - ((lines.length - 1) * fontPx * 1.25) / 2 + i * fontPx * 1.25))
      ctx.restore()
    }
  }

  private drawSafeZones(ctx: Ctx, W: number, H: number) {
    ctx.save()
    ctx.fillStyle = 'rgba(255, 60, 60, 0.12)'
    ctx.fillRect(0, 0, W, H * 0.12)
    ctx.fillRect(0, H * 0.8, W, H * 0.2)
    ctx.fillRect(W * 0.85, H * 0.12, W * 0.15, H * 0.68)
    ctx.restore()
  }
}

function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d }
}

function scaleToward(r: Rect, k: number, anchor: string, W: number, H: number): Rect {
  const w = r.width * k
  const h = r.height * k
  const ax = anchor.includes('left') ? r.x : anchor.includes('right') ? r.x + r.width : r.x + r.width / 2
  const ay = anchor.startsWith('top') ? r.y : anchor.startsWith('bottom') ? r.y + r.height : r.y + r.height / 2
  const x = anchor.includes('left') ? ax : anchor.includes('right') ? ax - w : ax - w / 2
  const y = anchor.startsWith('top') ? ay : anchor.startsWith('bottom') ? ay - h : ay - h / 2
  void W
  void H
  return { x, y, width: w, height: h }
}

/** Procedural phone bezel around the screen rect (no third-party device artwork). */
function drawDeviceFrame(ctx: Ctx, R: Rect, screenRadius: number) {
  const bezel = R.width * 0.045
  const outer = inflate(R, bezel)
  const g = ctx.createLinearGradient(outer.x, outer.y, outer.x + outer.width, outer.y + outer.height)
  g.addColorStop(0, '#3a3c42')
  g.addColorStop(0.5, '#1c1d21')
  g.addColorStop(1, '#2d2f35')
  ctx.fillStyle = g
  roundRectPath(ctx, outer, screenRadius + bezel)
  ctx.fill()
  ctx.lineWidth = Math.max(1, bezel * 0.12)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  roundRectPath(ctx, inflate(outer, -ctx.lineWidth / 2), screenRadius + bezel)
  ctx.stroke()
  // Side buttons.
  ctx.fillStyle = '#2a2b30'
  const bw = bezel * 0.35
  ctx.fillRect(outer.x - bw, outer.y + outer.height * 0.2, bw, outer.height * 0.06)
  ctx.fillRect(outer.x - bw, outer.y + outer.height * 0.29, bw, outer.height * 0.09)
  ctx.fillRect(outer.x + outer.width, outer.y + outer.height * 0.25, bw, outer.height * 0.12)
  ctx.fillStyle = '#000'
  roundRectPath(ctx, R, screenRadius)
  ctx.fill()
}

let noiseCanvas: OffscreenCanvas | null = null
function noisePattern(ctx: Ctx, ms: number): CanvasPattern | string {
  if (!noiseCanvas) {
    noiseCanvas = new OffscreenCanvas(128, 128 * 8)
    const g = noiseCanvas.getContext('2d')!
    const img = g.createImageData(128, 128 * 8)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    g.putImageData(img, 0, 0)
  }
  const p = ctx.createPattern(noiseCanvas, 'repeat')
  if (!p) return '#808080'
  // Re-seed at ~24 Hz by shifting the tile.
  const frame = Math.floor(ms / (1000 / 24)) % 8
  p.setTransform(new DOMMatrix().translate(0, -frame * 128))
  return p
}
