import type { GradientStop } from '@shared/project'

/** Procedural mesh-gradient wallpapers: a base colour with soft colour fields and fine grain. */
export interface WallpaperDef {
  id: string
  name: string
  category: 'Aurora' | 'Dusk' | 'Paper' | 'Night'
  base: string
  blobs: { x: number; y: number; r: number; color: string; alpha?: number }[]
  grain?: number
}

export const WALLPAPERS: WallpaperDef[] = [
  { id: 'aurora', name: 'Aurora', category: 'Aurora', base: '#141a3a', blobs: [
    { x: 0.15, y: 0.2, r: 0.7, color: '#3f6bff' }, { x: 0.85, y: 0.25, r: 0.6, color: '#b14dff' },
    { x: 0.55, y: 0.95, r: 0.75, color: '#20d3c2', alpha: 0.85 }, { x: 0.95, y: 0.9, r: 0.5, color: '#ff5fa2', alpha: 0.7 } ] },
  { id: 'lagoon', name: 'Lagoon', category: 'Aurora', base: '#062a3a', blobs: [
    { x: 0.1, y: 0.9, r: 0.8, color: '#00b4a6' }, { x: 0.8, y: 0.1, r: 0.7, color: '#2f80ff' },
    { x: 0.5, y: 0.5, r: 0.45, color: '#7cf3d4', alpha: 0.55 } ] },
  { id: 'orchid', name: 'Orchid', category: 'Aurora', base: '#2a0f3d', blobs: [
    { x: 0.2, y: 0.8, r: 0.75, color: '#ff4fd8' }, { x: 0.8, y: 0.2, r: 0.7, color: '#7a5cff' },
    { x: 0.9, y: 0.95, r: 0.5, color: '#ffb36b', alpha: 0.7 } ] },
  { id: 'meadow', name: 'Meadow', category: 'Aurora', base: '#0f3324', blobs: [
    { x: 0.1, y: 0.1, r: 0.7, color: '#3ddc84' }, { x: 0.9, y: 0.6, r: 0.75, color: '#d4ff6b', alpha: 0.8 },
    { x: 0.4, y: 1.0, r: 0.6, color: '#1fa2ff', alpha: 0.6 } ] },
  { id: 'ember', name: 'Ember', category: 'Dusk', base: '#3a0e0e', blobs: [
    { x: 0.2, y: 0.85, r: 0.8, color: '#ff5a1f' }, { x: 0.85, y: 0.15, r: 0.65, color: '#ffcc33' },
    { x: 0.95, y: 0.95, r: 0.5, color: '#ff2d6f', alpha: 0.8 } ] },
  { id: 'sundown', name: 'Sundown', category: 'Dusk', base: '#401a3f', blobs: [
    { x: 0.5, y: 1.05, r: 0.85, color: '#ff8a3d' }, { x: 0.1, y: 0.15, r: 0.7, color: '#6a3cff' },
    { x: 0.95, y: 0.3, r: 0.6, color: '#ff4f8b', alpha: 0.85 } ] },
  { id: 'peach', name: 'Peach', category: 'Dusk', base: '#ffb38a', blobs: [
    { x: 0.1, y: 0.1, r: 0.7, color: '#ff7eb3' }, { x: 0.9, y: 0.85, r: 0.75, color: '#ffd36b' },
    { x: 0.7, y: 0.2, r: 0.45, color: '#fff1e0', alpha: 0.7 } ] },
  { id: 'citrus', name: 'Citrus', category: 'Dusk', base: '#ffd23f', blobs: [
    { x: 0.15, y: 0.85, r: 0.75, color: '#ff6b35' }, { x: 0.85, y: 0.1, r: 0.7, color: '#c5f04a' } ] },
  { id: 'cloud', name: 'Cloud', category: 'Paper', base: '#eef1f6', blobs: [
    { x: 0.15, y: 0.15, r: 0.7, color: '#c9d6ff', alpha: 0.9 }, { x: 0.9, y: 0.85, r: 0.75, color: '#ffd6e8', alpha: 0.9 },
    { x: 0.8, y: 0.15, r: 0.45, color: '#d6fff1', alpha: 0.8 } ], grain: 0.025 },
  { id: 'linen', name: 'Linen', category: 'Paper', base: '#f4ede4', blobs: [
    { x: 0.2, y: 0.9, r: 0.8, color: '#e8d3bd', alpha: 0.9 }, { x: 0.85, y: 0.15, r: 0.6, color: '#fff9f2' } ], grain: 0.03 },
  { id: 'mint', name: 'Mint', category: 'Paper', base: '#dcf7ee', blobs: [
    { x: 0.1, y: 0.2, r: 0.7, color: '#a5f0d8' }, { x: 0.9, y: 0.9, r: 0.7, color: '#c6e2ff' } ], grain: 0.025 },
  { id: 'lilac', name: 'Lilac', category: 'Paper', base: '#ece6ff', blobs: [
    { x: 0.85, y: 0.2, r: 0.75, color: '#cdb8ff' }, { x: 0.15, y: 0.9, r: 0.7, color: '#ffc8ea' } ], grain: 0.025 },
  { id: 'graphite', name: 'Graphite', category: 'Night', base: '#16171c', blobs: [
    { x: 0.2, y: 0.1, r: 0.8, color: '#3a3d4a', alpha: 0.9 }, { x: 0.9, y: 0.95, r: 0.7, color: '#2a2c36' } ], grain: 0.04 },
  { id: 'midnight', name: 'Midnight', category: 'Night', base: '#05060f', blobs: [
    { x: 0.8, y: 0.15, r: 0.7, color: '#1d2f8f', alpha: 0.9 }, { x: 0.15, y: 0.95, r: 0.6, color: '#4a1d7a', alpha: 0.8 } ], grain: 0.035 },
  { id: 'deepsea', name: 'Deep sea', category: 'Night', base: '#020d17', blobs: [
    { x: 0.5, y: 1.0, r: 0.8, color: '#0b5e7a', alpha: 0.9 }, { x: 0.9, y: 0.1, r: 0.5, color: '#14306b', alpha: 0.8 } ], grain: 0.035 },
  { id: 'nebula', name: 'Nebula', category: 'Night', base: '#0b0717', blobs: [
    { x: 0.25, y: 0.3, r: 0.55, color: '#7b2cff', alpha: 0.75 }, { x: 0.75, y: 0.7, r: 0.55, color: '#ff2c9c', alpha: 0.6 },
    { x: 0.6, y: 0.2, r: 0.35, color: '#2cc9ff', alpha: 0.5 } ], grain: 0.04 },
]

export const GRADIENT_PRESETS: { name: string; angle: number; stops: GradientStop[] }[] = [
  ['Royal', 135, ['#4776e6', '#8e54e9']],
  ['Morning', 135, ['#f5f7fa', '#c3cfe2']],
  ['Sky', 135, ['#a1c4fd', '#c2e9fb']],
  ['Ocean', 160, ['#0f2027', '#203a43', '#2c5364']],
  ['Charcoal', 135, ['#434343', '#000000']],
  ['Flamingo', 135, ['#f093fb', '#f5576c']],
  ['Lime', 135, ['#d4fc79', '#96e6a1']],
  ['Dusk', 135, ['#2c3e50', '#fd746c']],
  ['Cotton', 135, ['#fbc2eb', '#a6c1ee']],
  ['Citrus', 135, ['#f6d365', '#fda085']],
  ['Aqua', 135, ['#13547a', '#80d0c7']],
  ['Plum', 135, ['#667eea', '#764ba2']],
  ['Rose', 135, ['#ff9a9e', '#fecfef']],
  ['Forest', 135, ['#134e5e', '#71b280']],
  ['Lava', 135, ['#f83600', '#f9d423']],
  ['Steel', 135, ['#536976', '#292e49']],
  ['Spring', 135, ['#43e97b', '#38f9d7']],
  ['Velvet', 135, ['#30cfd0', '#330867']],
  ['Candy', 120, ['#ff6a88', '#ff99ac', '#fcb69f']],
  ['Northern', 120, ['#00c6fb', '#005bea', '#7a2ff7']],
  ['Sand', 135, ['#e6dada', '#274046']],
  ['Mango', 135, ['#ffe259', '#ffa751']],
  ['Iris', 135, ['#5f2c82', '#49a09d']],
  ['Nightfall', 160, ['#141e30', '#243b55']],
].map(([name, angle, colors]) => ({
  name: name as string,
  angle: angle as number,
  stops: (colors as string[]).map((color, i, arr) => ({ color, at: arr.length === 1 ? 0 : i / (arr.length - 1) })),
}))

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export const rgba = (hex: string, a: number) => {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

let grainTile: OffscreenCanvas | null = null
function grain(): OffscreenCanvas {
  if (grainTile) return grainTile
  const size = 256
  grainTile = new OffscreenCanvas(size, size)
  const g = grainTile.getContext('2d')!
  const img = g.createImageData(size, size)
  let seed = 1337
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647
    const v = (seed / 2147483647) * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return grainTile
}

/** Adds faint noise; it also breaks up banding in smooth gradients. */
export function drawGrain(ctx: Ctx, w: number, h: number, amount: number) {
  if (amount <= 0) return
  ctx.save()
  ctx.globalAlpha = amount
  ctx.globalCompositeOperation = 'overlay'
  const pattern = ctx.createPattern(grain(), 'repeat')
  if (pattern) {
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, w, h)
  }
  ctx.restore()
}

export function drawWallpaper(ctx: Ctx, def: WallpaperDef, w: number, h: number) {
  ctx.fillStyle = def.base
  ctx.fillRect(0, 0, w, h)
  const d = Math.max(w, h)
  for (const b of def.blobs) {
    const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * d)
    g.addColorStop(0, rgba(b.color, b.alpha ?? 1))
    g.addColorStop(0.55, rgba(b.color, (b.alpha ?? 1) * 0.35))
    g.addColorStop(1, rgba(b.color, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  if (def.grain !== 0) drawGrain(ctx, w, h, def.grain ?? 0.05)
}

export function drawGradient(ctx: Ctx, angle: number, stops: GradientStop[], w: number, h: number, grain = true) {
  const rad = ((angle - 90) * Math.PI) / 180
  const cx = w / 2
  const cy = h / 2
  // Gradient line long enough to cover the corners at any angle (CSS semantics).
  const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))
  const dx = (Math.cos(rad) * len) / 2
  const dy = (Math.sin(rad) * len) / 2
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
  for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, s.at)), s.color)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  if (grain) drawGrain(ctx, w, h, 0.035)
}

export function wallpaperById(id: string): WallpaperDef | undefined {
  return WALLPAPERS.find((w) => `builtin:${w.id}` === id)
}

export function cssGradient(angle: number, stops: GradientStop[]) {
  return `linear-gradient(${angle}deg, ${stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ')})`
}

export function cssWallpaper(def: WallpaperDef) {
  const layers = def.blobs.map(
    (b) => `radial-gradient(circle at ${b.x * 100}% ${b.y * 100}%, ${rgba(b.color, b.alpha ?? 1)} 0%, ${rgba(b.color, 0)} ${b.r * 100}%)`,
  )
  return [...layers, def.base].join(', ')
}

export function rotateHue(hex: string, degrees: number) {
  const { r, g, b } = hexToRgb(hex)
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
  }
  h = (h * 60 + degrees + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r1)}${to(g1)}${to(b1)}`
}
