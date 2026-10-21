import { useEffect, useRef, useState } from 'react'
import type { Rect01 } from '@shared/project'
import { Button, Segmented } from '@/ui/controls'
import { useEscape } from '@/ui/useEscape'
import { runtime } from './runtime'
import { useEditor } from './store'

const PRESETS: { label: string; value: number | null }[] = [
  { label: 'Free', value: null },
  { label: '16:9', value: 16 / 9 },
  { label: '4:3', value: 4 / 3 },
  { label: '1:1', value: 1 },
  { label: '3:4', value: 3 / 4 },
  { label: '9:16', value: 9 / 16 },
]

/** Crops the raw recording before styling (e.g. to drop a browser's chrome). */
export function CropModal({ onClose }: { onClose: () => void }) {
  useEscape(onClose)
  const project = useEditor((s) => s.project)!
  const initial = useEditor((s) => s.config!.style.output.crop)
  const update = useEditor((s) => s.update)
  const [rect, setRect] = useState<Rect01>(initial)
  const [aspect, setAspect] = useState<number | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const { width: vw, height: vh } = project.meta.videoSize
  const videoAspect = vw / vh

  useEffect(() => {
    const c = canvas.current
    const v = runtime.playback?.screen
    if (c && v) c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
  }, [])

  const applyAspect = (a: number | null) => {
    setAspect(a)
    if (!a) return
    // Fit the largest rect of that aspect, centred on the current crop.
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    let w = 1
    let h = (w * videoAspect) / a
    if (h > 1) {
      h = 1
      w = (h * a) / videoAspect
    }
    setRect({ x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), width: w, height: h })
  }

  const drag = (mode: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const el = box.current!.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, r: { ...rect } }
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / el.width
      const dy = (ev.clientY - start.y) / el.height
      let { x, y, width, height } = start.r
      if (mode === 'move') {
        x = clamp(x + dx, 0, 1 - width)
        y = clamp(y + dy, 0, 1 - height)
      } else {
        if (mode.includes('e')) width = clamp(width + dx, 0.05, 1 - x)
        if (mode.includes('s')) height = clamp(height + dy, 0.05, 1 - y)
        if (mode.includes('w')) {
          const nx = clamp(x + dx, 0, x + width - 0.05)
          width += x - nx
          x = nx
        }
        if (mode.includes('n')) {
          const ny = clamp(y + dy, 0, y + height - 0.05)
          height += y - ny
          y = ny
        }
        if (aspect) height = Math.min(1 - y, (width * videoAspect) / aspect)
      }
      setRect({ x, y, width, height })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div data-modal className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[3px] flex items-center justify-center p-10" onMouseDown={onClose}>
      <div className="flex flex-col gap-4 max-w-[1000px] w-full" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Crop recording</h2>
          <Segmented value={String(aspect)} onChange={(v) => applyAspect(v === 'null' ? null : Number(v))} options={PRESETS.map((p) => ({ value: String(p.value), label: p.label }))} className="w-[360px]" />
        </div>
        <div ref={box} className="relative w-full" style={{ aspectRatio: videoAspect }}>
          <canvas ref={canvas} width={1280} height={Math.round(1280 / videoAspect)} className="absolute inset-0 size-full rounded-[6px]" />
          <div
            className="absolute border-2 border-white cursor-move"
            style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
            onPointerDown={drag('move')}
          >
            {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((h) => (
              <span
                key={h}
                onPointerDown={drag(h)}
                className="absolute size-3 bg-white rounded-full"
                style={{
                  left: h.includes('w') ? -6 : h.includes('e') ? undefined : 'calc(50% - 6px)',
                  right: h.includes('e') ? -6 : undefined,
                  top: h.includes('n') ? -6 : h.includes('s') ? undefined : 'calc(50% - 6px)',
                  bottom: h.includes('s') ? -6 : undefined,
                  cursor: `${h}-resize`,
                }}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-muted tabular">
            {Math.round(rect.width * vw)} × {Math.round(rect.height * vh)} px
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setRect({ x: 0, y: 0, width: 1, height: 1 })}>
              Reset
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                update((d) => void (d.style.output.crop = rect))
                onClose()
              }}
            >
              Apply crop
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
