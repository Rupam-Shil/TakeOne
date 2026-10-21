import { useRef, useState } from 'react'
import type { CameraAnchor, Mask, TextOverlay } from '@shared/project'
import type { Scene } from '@/render/scene'
import { runtime } from './runtime'
import { useEditor } from './store'

/** Direct-manipulation handles drawn over the preview canvas (CSS pixels). */
export function PreviewOverlay({ scene, width, height }: { scene: Scene; width: number; height: number }) {
  const selection = useEditor((s) => s.selection)
  const playMs = useEditor((s) => s.playMs)
  const playing = useEditor((s) => s.playing)
  if (playing) return null
  const sourceMs = scene.timeMap.toSource(playMs)
  const t = runtime.compositor.transformAt(scene, sourceMs, width, height)

  const mask = selection?.kind === 'mask' ? scene.config.timeline.masks.find((m) => m.id === selection.id) : null
  const text = selection?.kind === 'text' ? scene.config.timeline.texts.find((x) => x.id === selection.id) : null

  return (
    <div className="absolute inset-0 pointer-events-none">
      {mask && <MaskBox mask={mask} t={t} />}
      {text && <TextHandle text={text} width={width} height={height} />}
      <CameraDrag scene={scene} t={t} width={width} height={height} />
    </div>
  )
}

type Transform = ReturnType<typeof runtime.compositor.transformAt>

function MaskBox({ mask, t }: { mask: Mask; t: Transform }) {
  const update = useEditor((s) => s.update)
  const R = t.geo.screen
  const toStage = (x01: number, y01: number) => ({
    x: (R.x + x01 * R.width - t.px) * t.s + t.cx,
    y: (R.y + y01 * R.height - t.py) * t.s + t.cy,
  })
  const a = toStage(mask.rect.x, mask.rect.y)
  const b = toStage(mask.rect.x + mask.rect.width, mask.rect.y + mask.rect.height)
  const drag = useRef<{ mode: string; x: number; y: number; rect: Mask['rect'] } | null>(null)

  const onDown = (mode: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, rect: { ...mask.rect } }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / (R.width * t.s)
    const dy = (e.clientY - d.y) / (R.height * t.s)
    update((draft) => {
      const m = draft.timeline.masks.find((x) => x.id === mask.id)
      if (!m) return
      const r = { ...d.rect }
      if (d.mode === 'move') {
        r.x = clamp01(r.x + dx, 1 - r.width)
        r.y = clamp01(r.y + dy, 1 - r.height)
      } else {
        if (d.mode.includes('e')) r.width = Math.max(0.02, Math.min(1 - r.x, r.width + dx))
        if (d.mode.includes('s')) r.height = Math.max(0.02, Math.min(1 - r.y, r.height + dy))
        if (d.mode.includes('w')) {
          const nx = clamp01(r.x + dx, r.x + r.width - 0.02)
          r.width += r.x - nx
          r.x = nx
        }
        if (d.mode.includes('n')) {
          const ny = clamp01(r.y + dy, r.y + r.height - 0.02)
          r.height += r.y - ny
          r.y = ny
        }
      }
      m.rect = r
    }, `mask-drag-${mask.id}`)
  }
  const handles = ['nw', 'ne', 'sw', 'se']
  return (
    <div
      className="absolute pointer-events-auto border-[1.5px] border-mask rounded-[4px] cursor-move bg-mask/10"
      style={{ left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y }}
      onPointerDown={onDown('move')}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
    >
      {handles.map((h) => (
        <span
          key={h}
          onPointerDown={onDown(h)}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          className="absolute size-2.5 rounded-full bg-white shadow"
          style={{
            left: h.includes('w') ? -5 : undefined,
            right: h.includes('e') ? -5 : undefined,
            top: h.includes('n') ? -5 : undefined,
            bottom: h.includes('s') ? -5 : undefined,
            cursor: `${h}-resize`,
          }}
        />
      ))}
      <span className="absolute -top-6 left-0 text-[11px] px-1.5 h-5 rounded bg-mask text-black font-medium flex items-center">
        {mask.type === 'highlight' ? 'Highlight' : mask.type === 'pixelate' ? 'Pixelate' : 'Blur'}
      </span>
    </div>
  )
}

function TextHandle({ text, width, height }: { text: TextOverlay; width: number; height: number }) {
  const update = useEditor((s) => s.update)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const size = text.size * height
  return (
    <div
      className="absolute pointer-events-auto cursor-move border border-dashed border-caption/80 rounded-[6px]"
      style={{
        left: text.position.x * width,
        top: text.position.y * height,
        transform: 'translate(-50%,-50%)',
        width: Math.max(80, size * Math.max(...text.text.split('\n').map((l) => l.length)) * 0.6 + size),
        height: size * 1.25 * text.text.split('\n').length + size * 0.5,
      }}
      onPointerDown={(e) => {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, px: text.position.x, py: text.position.y }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        update((draft) => {
          const x = draft.timeline.texts.find((i) => i.id === text.id)
          if (x) x.position = { x: clamp01(d.px + (e.clientX - d.x) / width, 1), y: clamp01(d.py + (e.clientY - d.y) / height, 1) }
        }, `text-drag-${text.id}`)
      }}
      onPointerUp={() => (drag.current = null)}
    />
  )
}

const ANCHORS: CameraAnchor[] = ['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right']

/** Drag the overlay camera; it snaps to the nearest of eight anchors on release. */
function CameraDrag({ scene, t, width, height }: { scene: Scene; t: Transform; width: number; height: number }) {
  const update = useEditor((s) => s.update)
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const style = scene.config.style
  if (!scene.hasCamera || style.camera.hide || t.geo.cameraOpacity < 0.5 || t.geo.cutout || t.geo.cameraRadiusScale !== 1) return null
  const r = t.geo.camera
  return (
    <div
      className="absolute pointer-events-auto cursor-grab active:cursor-grabbing rounded-full hover:ring-2 hover:ring-white/50"
      style={{
        left: r.x + (offset?.dx ?? 0),
        top: r.y + (offset?.dy ?? 0),
        width: r.width,
        height: r.height,
        borderRadius: style.camera.radiusRatio * Math.min(r.width, r.height),
      }}
      onPointerDown={(e) => {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, y: e.clientY }
        setOffset({ dx: 0, dy: 0 })
      }}
      onPointerMove={(e) => start.current && setOffset({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y })}
      onPointerUp={() => {
        if (!offset) return
        const cx = (r.x + offset.dx + r.width / 2) / width
        const cy = (r.y + offset.dy + r.height / 2) / height
        const col = cx < 0.33 ? 'left' : cx > 0.66 ? 'right' : ''
        const row = cy < 0.33 ? 'top' : cy > 0.66 ? 'bottom' : ''
        const anchor = ([row, col].filter(Boolean).join('-') || 'bottom-right') as CameraAnchor
        if (ANCHORS.includes(anchor)) update((d) => void (d.style.layout.overlayAnchor = anchor))
        start.current = null
        setOffset(null)
      }}
    />
  )
}

const clamp01 = (v: number, max: number) => Math.min(max, Math.max(0, v))
