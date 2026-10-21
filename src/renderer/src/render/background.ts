import type { BackgroundSettings } from '@shared/project'
import { mediaUrl } from '@shared/media'
import { drawGradient, drawGrain, drawWallpaper, wallpaperById, WALLPAPERS } from './wallpapers'

const images = new Map<string, Promise<ImageBitmap | null>>()

export function loadImage(path: string): Promise<ImageBitmap | null> {
  let p = images.get(path)
  if (!p) {
    const url = path.startsWith('blob:') || path.startsWith('data:') ? path : mediaUrl(path)
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => createImageBitmap(b))
      .catch(() => null)
    images.set(path, p)
  }
  return p
}

function drawCover(ctx: OffscreenCanvasRenderingContext2D, img: ImageBitmap, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height)
  const dw = img.width * s
  const dh = img.height * s
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/** Renders (and caches) the stage background so frames only blit it. */
export class BackgroundCache {
  private key = ''
  private canvas: OffscreenCanvas | null = null

  /** `grain: false` is used for GIFs, where noise defeats palette compression. */
  async get(bg: BackgroundSettings, width: number, height: number, opts: { grain?: boolean } = {}): Promise<OffscreenCanvas> {
    const grain = opts.grain ?? true
    const key = JSON.stringify([bg, width, height, grain])
    if (this.canvas && key === this.key) return this.canvas
    const c = new OffscreenCanvas(width, height)
    const ctx = c.getContext('2d')!
    const u = Math.min(width, height) / 1080
    const blur = bg.blur * u
    const withBlur = async (draw: (g: OffscreenCanvasRenderingContext2D, w: number, h: number) => void | Promise<void>) => {
      if (blur <= 0) return draw(ctx, width, height)
      // Draw slightly larger than the stage and blur that, so the edges never fade to transparent.
      const pad = Math.ceil(blur * 3)
      const tmp = new OffscreenCanvas(width + pad * 2, height + pad * 2)
      const g = tmp.getContext('2d')!
      await draw(g, width + pad * 2, height + pad * 2)
      ctx.filter = `blur(${blur}px)`
      ctx.drawImage(tmp, -pad, -pad)
      ctx.filter = 'none'
    }

    switch (bg.type) {
      case 'color':
        ctx.fillStyle = bg.color
        ctx.fillRect(0, 0, width, height)
        break
      case 'gradient':
        drawGradient(ctx, bg.gradient.angle, bg.gradient.stops, width, height, grain)
        break
      case 'image':
      case 'wallpaper': {
        const builtin = bg.type === 'wallpaper' ? (wallpaperById(bg.wallpaper) ?? (bg.wallpaper.startsWith('builtin:') ? WALLPAPERS[0] : null)) : null
        if (builtin) {
          await withBlur((g, w, h) => drawWallpaper(g, grain ? builtin : { ...builtin, grain: 0 }, w, h))
          break
        }
        const path = bg.type === 'image' ? bg.image : bg.wallpaper
        const img = path ? await loadImage(path) : null
        if (img) {
          await withBlur((g, w, h) => drawCover(g, img, w, h))
          if (grain) drawGrain(ctx, width, height, 0.02)
        } else drawWallpaper(ctx, WALLPAPERS[0], width, height)
        break
      }
    }
    this.canvas = c
    this.key = key
    return c
  }
}
