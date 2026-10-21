import type { CursorSetId } from '@shared/project'

/** Original vector cursors drawn on a 32×32 grid; hotspot in the same units. */
interface Shape {
  path: string
  hotspot: [number, number]
  /** Shapes like the arrow read best dark-filled; hands read best light-filled. */
  invert?: boolean
}

const SHAPES: Record<string, Shape> = {
  arrow: {
    path: 'M7 3.5 L7 24.6 L12 19.9 L15.4 27.8 L19 26.2 L15.7 18.6 L22.4 18.6 Z',
    hotspot: [7, 3.5],
  },
  pointingHand: {
    path: 'M12.2 3.4c1.2 0 2.1.9 2.1 2.1v7.4h.3v-1.4c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v1.6h.3v-.9c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v1.6h.2c0-.9.8-1.6 1.7-1.6s1.7.7 1.7 1.6v6.9c0 4.3-3 7.9-7.5 7.9h-2.3c-2.4 0-4.3-1.1-5.7-3.1l-4.6-6.4c-.6-.9-.4-2.1.5-2.7.9-.6 2.1-.4 2.7.4l1.3 1.8V5.5c0-1.2.9-2.1 2.1-2.1z',
    hotspot: [12.4, 3.6],
    invert: true,
  },
  openHand: {
    path: 'M15.6 3.6c1 0 1.8.8 1.8 1.8v7h.3V6.3c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v6.6h.3V8.8c0-1 .8-1.8 1.8-1.8s1.7.8 1.7 1.8v11.1c0 4.5-3.1 8.2-7.8 8.2h-1.8c-2.6 0-4.6-1.2-6-3.4L6 18.5c-.5-.9-.2-2 .7-2.5.9-.5 2-.3 2.6.5l1.7 2.2V7.2c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v5.2h.2V5.4c0-1 .8-1.8 1.8-1.8z',
    hotspot: [16, 16],
    invert: true,
  },
  closedHand: {
    path: 'M10.5 11.2c.9-.6 2-.4 2.6.3v-.5c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v.4h.3c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v.6h.2c0-1 .8-1.7 1.8-1.7s1.7.8 1.7 1.7v8.2c0 4.4-3.1 7.9-7.6 7.9h-1.9c-2.5 0-4.4-1.1-5.8-3.2l-2.4-3.9c-.5-.9-.3-2 .6-2.5.8-.5 1.8-.3 2.4.4V13c0-.7.3-1.4.9-1.8z',
    hotspot: [16, 16],
    invert: true,
  },
  ibeam: {
    path: 'M11 4.5h3.4l1.6 1.4 1.6-1.4H21v2.2h-3.6v18.6H21v2.2h-3.4L16 26.1l-1.6 1.4H11v-2.2h3.6V6.7H11z',
    hotspot: [16, 16],
  },
  crosshair: {
    path: 'M15 4h2v10h10v2H17v10h-2V16H5v-2h10z',
    hotspot: [16, 15],
  },
  resizeLeftRight: {
    path: 'M3 16l6-6v4h14v-4l6 6-6 6v-4H9v4z',
    hotspot: [16, 16],
  },
  resizeUpDown: {
    path: 'M16 3l6 6h-4v14h4l-6 6-6-6h4V9h-4z',
    hotspot: [16, 16],
  },
  notAllowed: {
    path: 'M16 5a11 11 0 1 1 0 22a11 11 0 0 1 0-22zm-6 6.4a8 8 0 0 0 10.6 10.6zm2.4-2.4l10.6 10.6A8 8 0 0 0 12.4 9z',
    hotspot: [16, 16],
  },
  contextualMenu: {
    path: 'M5 3.5 L5 22 L9.4 17.9 L12.4 24.8 L15.6 23.4 L12.7 16.7 L18.6 16.7 Z M20 11h9v12h-9z',
    hotspot: [5, 3.5],
  },
  dragCopy: {
    path: 'M5 3.5 L5 22 L9.4 17.9 L12.4 24.8 L15.6 23.4 L12.7 16.7 L18.6 16.7 Z M24 15a5 5 0 1 1 0 10a5 5 0 0 1 0-10z',
    hotspot: [5, 3.5],
  },
  // Touch-style sets replace every pointer with one of these.
  touch: {
    path: 'M16 4a12 12 0 1 1 0 24a12 12 0 0 1 0-24z',
    hotspot: [16, 16],
  },
  beacon: {
    path: 'M16 3a13 13 0 1 1 0 26a13 13 0 0 1 0-26zm0 3.4a9.6 9.6 0 1 0 0 19.2a9.6 9.6 0 0 0 0-19.2zm0 4.6a5 5 0 1 1 0 10a5 5 0 0 1 0-10z',
    hotspot: [16, 16],
  },
  ring: {
    path: 'M16 4.5a11.5 11.5 0 1 1 0 23a11.5 11.5 0 0 1 0-23z',
    hotspot: [16, 16],
  },
}

const ALIASES: Record<string, string> = {
  resizeLeft: 'resizeLeftRight',
  resizeRight: 'resizeLeftRight',
  resizeUp: 'resizeUpDown',
  resizeDown: 'resizeUpDown',
  ibeamVertical: 'ibeam',
  dragLink: 'dragCopy',
  disappearingItem: 'arrow',
}

type Fill = string | { stops: string[]; angle?: number }

interface Paint {
  fill: Fill
  stroke: string
  strokeWidth: number
  /** Soft halo around the glyph (a blurred copy with no offset). */
  glow?: { color: string; blur: number }
  /** Specular highlight over the upper half, 0–1. */
  gloss?: number
  /** Hollow glyph: only the stroke is drawn. */
  strokeOnly?: boolean
  /** Rasterised small and scaled without smoothing for a retro look. */
  pixel?: boolean
}

export type CursorGroup = 'Standard' | 'Gradient' | 'Metal' | 'Minimal' | 'Shape' | 'Rendered'
export const CURSOR_GROUPS: CursorGroup[] = ['Standard', 'Gradient', 'Metal', 'Minimal', 'Shape', 'Rendered']

interface VectorStyle {
  kind: 'vector'
  name: string
  group: CursorGroup
  /** Every pointer type renders as this one shape (touch-style sets). */
  only?: keyof typeof SHAPES
  paint: (shape: Shape) => Paint
}

/** A pre-rendered arrow (PNG under public/cursors); other pointer shapes borrow the `base` vector style. */
interface BitmapStyle {
  kind: 'bitmap'
  name: string
  group: CursorGroup
  file: string
  /** Hotspot as a fraction of the image. */
  hotspot: [number, number]
  /** Image height relative to a standard arrow image, so the glyph lands at the same on-screen size. */
  heightScale: number
  base: CursorSetId
}

type Style = VectorStyle | BitmapStyle

const DARK = { fill: '#111111', stroke: '#ffffff', strokeWidth: 1.6 }
const LIGHT = { fill: '#ffffff', stroke: '#111111', strokeWidth: 1.5 }
const WHITE_STROKE = '#ffffff'

const vector = (name: string, group: CursorGroup, paint: (shape: Shape) => Paint, only?: keyof typeof SHAPES): VectorStyle => ({ kind: 'vector', name, group, paint, only })
const gradient = (name: string, stops: string[], extra: Partial<Paint> = {}) =>
  vector(name, 'Gradient', () => ({ fill: { stops }, stroke: WHITE_STROKE, strokeWidth: 1.4, ...extra }))
const metal = (name: string, stops: string[], stroke: string, extra: Partial<Paint> = {}) =>
  vector(name, 'Metal', () => ({ fill: { stops, angle: 120 }, stroke, strokeWidth: 1.2, gloss: 0.38, ...extra }))

const STYLES: Record<CursorSetId, Style> = {
  // Standard
  macos: vector('Classic', 'Standard', (s) => (s.invert ? LIGHT : DARK)),
  outline: vector('Inverted', 'Standard', (s) => (s.invert ? DARK : LIGHT)),
  mono: vector('Midnight', 'Standard', () => ({ fill: '#1d1f27', stroke: '#9aa0b4', strokeWidth: 1.4 })),
  neon: vector('Neon', 'Standard', () => ({ fill: '#141416', stroke: '#ffffff', strokeWidth: 1.8 })),
  recorded: vector('As recorded', 'Standard', (s) => (s.invert ? LIGHT : DARK)),
  // Gradient
  sunset: gradient('Sunset', ['#ffb347', '#ff6a3d', '#ff2d7a']),
  ocean: gradient('Ocean', ['#5ff2ff', '#2b9bff', '#2448ff']),
  aurora: gradient('Aurora', ['#7dffb3', '#38c8f8', '#a070ff']),
  ember: gradient('Ember', ['#ffe08a', '#ff6a1f', '#b3121f'], { glow: { color: 'rgba(255,106,31,0.55)', blur: 1.4 } }),
  bubblegum: gradient('Bubblegum', ['#ff8ad8', '#ff5fa2', '#b06bff']),
  mint: gradient('Mint', ['#eaff6e', '#5ee07a', '#1fb37c']),
  sapphire: gradient('Sapphire', ['#86b4ff', '#2f3cff', '#0b0f5e']),
  crimson: gradient('Crimson', ['#ff7b7b', '#ff3b30', '#9a0f1b']),
  // Metal
  gold: metal('Gold', ['#fff4b8', '#f6c445', '#a8700f', '#ffd966'], '#3b2a06'),
  chrome: metal('Chrome', ['#ffffff', '#cdd2da', '#6b727f', '#eef0f3'], '#2b2f36'),
  titanium: metal('Titanium', ['#aeb2ba', '#5a5e66', '#2c2f35', '#9094a0'], '#141517', { gloss: 0.3 }),
  copper: metal('Copper', ['#ffd9bf', '#d9783f', '#7a3914', '#eea06c'], '#3a1a08'),
  obsidian: vector('Obsidian', 'Metal', () => ({ fill: { stops: ['#4a4a52', '#1a1a1e', '#000000'], angle: 120 }, stroke: '#ffffff', strokeWidth: 1.3, gloss: 0.42 })),
  // Minimal
  frosted: vector('Frosted', 'Minimal', () => ({ fill: 'rgba(255,255,255,0.42)', stroke: 'rgba(255,255,255,0.95)', strokeWidth: 1.6, glow: { color: 'rgba(0,0,0,0.35)', blur: 1.2 } })),
  wire: vector('Wire', 'Minimal', () => ({ fill: 'none', stroke: '#ffffff', strokeWidth: 2.1, strokeOnly: true, glow: { color: 'rgba(0,0,0,0.6)', blur: 1 } })),
  ink: vector('Ink', 'Minimal', () => ({ fill: 'none', stroke: '#111111', strokeWidth: 2.1, strokeOnly: true, glow: { color: 'rgba(255,255,255,0.85)', blur: 1 } })),
  soft: vector('Soft', 'Minimal', (s) => ({ ...(s.invert ? DARK : LIGHT), strokeWidth: 1.1, glow: { color: 'rgba(0,0,0,0.45)', blur: 2.2 } })),
  halo: vector('Halo', 'Minimal', () => ({ fill: '#111111', stroke: '#ffffff', strokeWidth: 1.3, glow: { color: 'rgba(255,255,255,0.9)', blur: 2 } })),
  pixel: vector('Pixel', 'Minimal', (s) => ({ ...(s.invert ? DARK : LIGHT), strokeWidth: 1.9, pixel: true })),
  // Shape
  touch: vector('Touch', 'Shape', () => ({ fill: 'rgba(255,255,255,0.55)', stroke: 'rgba(0,0,0,0.35)', strokeWidth: 1.2 }), 'touch'),
  beacon: vector('Beacon', 'Shape', () => ({ fill: 'rgba(255,255,255,0.92)', stroke: 'rgba(0,0,0,0.35)', strokeWidth: 1, glow: { color: 'rgba(0,0,0,0.3)', blur: 1 } }), 'beacon'),
  ring: vector('Ring', 'Shape', () => ({ fill: 'none', stroke: '#ffffff', strokeWidth: 2.6, strokeOnly: true, glow: { color: 'rgba(0,0,0,0.55)', blur: 1.2 } }), 'ring'),
}

export const CURSOR_SETS: { id: CursorSetId; name: string; group: CursorGroup }[] = (Object.keys(STYLES) as CursorSetId[]).map((id) => ({
  id,
  name: STYLES[id].name,
  group: STYLES[id].group,
}))

function styleOf(set: CursorSetId): Style {
  return STYLES[set] ?? STYLES.macos
}

function vectorStyle(set: CursorSetId): VectorStyle {
  const s = styleOf(set)
  return s.kind === 'vector' ? s : (styleOf(s.base) as VectorStyle)
}

/** Vector art is rasterised with a margin so glows and strokes are not clipped at the tip. */
const PAD = 4
const BOX = 32 + PAD * 2

function gradientLine(angle = 135) {
  const a = (angle * Math.PI) / 180
  const dx = Math.sin(a) * 13
  const dy = -Math.cos(a) * 13
  return { x1: 16 - dx, y1: 16 - dy, x2: 16 + dx, y2: 16 + dy }
}

const fmt = (n: number) => +n.toFixed(2)

export function cursorSvg(type: string, set: CursorSetId, raster = 320): { svg: string; hotspot: [number, number]; pixel: boolean } {
  const style = vectorStyle(set)
  const name = style.only ?? (SHAPES[type] ? type : ALIASES[type]) ?? 'arrow'
  const shape = SHAPES[name] ?? SHAPES.arrow
  const p = style.paint(shape)
  const uid = `${set}-${name}`.replace(/[^a-z0-9-]/gi, '')
  const defs: string[] = []
  let fill = 'none'
  if (!p.strokeOnly) {
    if (typeof p.fill === 'string') fill = p.fill
    else {
      const { x1, y1, x2, y2 } = gradientLine(p.fill.angle)
      const stops = p.fill.stops.map((c, i, a) => `<stop offset="${fmt((i / (a.length - 1)) * 100)}%" stop-color="${c}"/>`).join('')
      defs.push(`<linearGradient id="f${uid}" gradientUnits="userSpaceOnUse" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}">${stops}</linearGradient>`)
      fill = `url(#f${uid})`
    }
  }
  if (p.glow) {
    defs.push(
      `<filter id="g${uid}" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="${p.glow.blur}" flood-color="${p.glow.color}"/></filter>`,
    )
  }
  let gloss = ''
  if (p.gloss && !p.strokeOnly) {
    defs.push(`<clipPath id="c${uid}"><path d="${shape.path}" fill-rule="evenodd"/></clipPath>`)
    defs.push(
      `<linearGradient id="h${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${p.gloss}"/><stop offset="0.48" stop-color="#fff" stop-opacity="${fmt(p.gloss * 0.3)}"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
    )
    gloss = `<rect x="0" y="0" width="32" height="32" fill="url(#h${uid})" clip-path="url(#c${uid})"/>`
  }
  const crisp = p.pixel ? ' shape-rendering="crispEdges"' : ''
  const body = `<path d="${shape.path}" fill="${fill}" fill-rule="evenodd" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linejoin="round" paint-order="stroke"${crisp}/>${gloss}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD} ${-PAD} ${BOX} ${BOX}" width="${raster}" height="${raster}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<g${p.glow ? ` filter="url(#g${uid})"` : ''}>${body}</g></svg>`
  return { svg, hotspot: [shape.hotspot[0] + PAD, shape.hotspot[1] + PAD], pixel: !!p.pixel }
}

/** Image source for the picker tile of a set: the arrow (or the set's single shape). */
export function cursorPreview(set: CursorSetId): { src: string; pixel: boolean } {
  const style = styleOf(set)
  if (style.kind === 'bitmap') return { src: `./cursors/${style.file}`, pixel: false }
  const { svg, pixel } = cursorSvg('arrow', set === 'recorded' ? 'macos' : set, pixel_raster(set))
  return { src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, pixel }
}

const pixel_raster = (set: CursorSetId) => (vectorStyle(set).paint(SHAPES.arrow).pixel ? 32 : 320)

export interface CursorBitmap {
  image: ImageBitmap
  /** Hotspot as a fraction of the image size. */
  hx: number
  hy: number
  /** Image aspect (w/h). */
  aspect: number
  /** Visual height of the glyph relative to a standard arrow (for consistent sizing). */
  heightScale: number
  /** Draw without smoothing (pixel-art sets). */
  pixelated?: boolean
}

const cache = new Map<string, Promise<CursorBitmap | null>>()

async function svgToBitmap(svg: string): Promise<ImageBitmap> {
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return await createImageBitmap(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function bitmapCursor(style: BitmapStyle): Promise<CursorBitmap | null> {
  const key = `b:${style.file}`
  let p = cache.get(key)
  if (!p) {
    p = fetch(`./cursors/${style.file}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => createImageBitmap(b))
      .then((image) => ({ image, hx: style.hotspot[0], hy: style.hotspot[1], aspect: image.width / image.height, heightScale: style.heightScale }))
      .catch(() => null)
    cache.set(key, p)
  }
  return p
}

export function vectorCursor(type: string, set: CursorSetId): Promise<CursorBitmap | null> {
  const style = styleOf(set)
  const resolved = (SHAPES[type] ? type : ALIASES[type]) ?? 'arrow'
  if (style.kind === 'bitmap' && resolved === 'arrow') {
    // Fall back to the base vector art if the PNG is missing, so the cursor never disappears.
    return bitmapCursor(style).then((b) => b ?? vectorCursor(type, style.base))
  }
  const key = `v:${set}:${type}`
  let p = cache.get(key)
  if (!p) {
    const { svg, hotspot, pixel } = cursorSvg(type, set, pixel_raster(set))
    p = svgToBitmap(svg)
      .then((image) => ({ image, hx: hotspot[0] / BOX, hy: hotspot[1] / BOX, aspect: 1, heightScale: BOX / 32, pixelated: pixel }))
      .catch(() => null)
    cache.set(key, p)
  }
  return p
}

export function recordedCursor(url: string, hotspotX: number, hotspotY: number, width: number, height: number): Promise<CursorBitmap | null> {
  const key = `r:${url}`
  let p = cache.get(key)
  if (!p) {
    p = fetch(url)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((image) => ({
        image,
        hx: hotspotX / width,
        hy: hotspotY / height,
        aspect: width / height,
        // macOS arrow is ~28×40pt including its shadow; normalise against that.
        heightScale: height / 32,
      }))
      .catch(() => null)
    cache.set(key, p)
  }
  return p
}

export const KNOWN_CURSOR_TYPES = new Set([...Object.keys(SHAPES), ...Object.keys(ALIASES)])
