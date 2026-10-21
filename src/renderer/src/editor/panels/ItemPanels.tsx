import { useEffect, useRef, useState } from 'react'
import { Copy, RotateCcw, Trash2 } from 'lucide-react'
import type { Mask, Slice, TextOverlay, Zoom } from '@shared/project'
import { Button, ColorInput, Field, Section, Segmented, Slider, Toggle, cx } from '@/ui/controls'
import { runtime } from '../runtime'
import { useEditor } from '../store'
import { deleteSelection, duplicateSelection } from '../commands'
import { SPEED_PRESETS, resetCuts } from '../ops'
import { PanelHeader, pct } from './common'
import { trackMaskScroll, trackMatches } from '@/render/scroll-track'
import { toast } from '../toast'

function useItem<T extends { id: string }>(kind: 'zooms' | 'slices' | 'masks' | 'texts'): [T | null, (fn: (it: T) => void, gesture?: string) => void] {
  const selection = useEditor((s) => s.selection)
  const item = useEditor((s) => (selection ? ((s.config!.timeline[kind] as unknown as T[]).find((x) => x.id === selection.id) ?? null) : null))
  const update = useEditor((s) => s.update)
  return [
    item,
    (fn, gesture) =>
      update((d) => {
        const it = (d.timeline[kind] as unknown as T[]).find((x) => x.id === selection?.id)
        if (it) fn(it)
      }, gesture ? `${kind}-${selection?.id}-${gesture}` : undefined),
  ]
}

function ItemActions({ duplicate }: { duplicate?: boolean }) {
  return (
    <div className="flex gap-2 px-4 py-3">
      {duplicate && (
        <Button size="sm" onClick={() => duplicateSelection()}>
          <Copy className="size-3.5" /> Duplicate
        </Button>
      )}
      <Button size="sm" variant="danger" onClick={() => deleteSelection()}>
        <Trash2 className="size-3.5" /> Delete
      </Button>
    </div>
  )
}

/** Small frame of the recording where the focus point of a manual zoom can be placed. */
function FocusPicker({ zoom, onPick }: { zoom: Zoom; onPick: (x: number, y: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const project = useEditor((s) => s.project)
  const crop = useEditor((s) => s.config!.style.output.crop)
  useEffect(() => {
    const c = ref.current
    const v = runtime.playback?.screen
    if (!c || !v || !project) return
    const g = c.getContext('2d')!
    const { width: vw, height: vh } = project.meta.videoSize
    g.drawImage(v, crop.x * vw, crop.y * vh, crop.width * vw, crop.height * vh, 0, 0, c.width, c.height)
  })
  const aspect = project ? (project.meta.videoSize.width * crop.width) / (project.meta.videoSize.height * crop.height) : 16 / 9
  return (
    <div className="relative rounded-[8px] overflow-hidden ring-1 ring-white/10 cursor-crosshair" style={{ aspectRatio: aspect }}>
      <canvas
        ref={ref}
        width={480}
        height={Math.round(480 / aspect)}
        className="size-full"
        onPointerDown={(e) => {
          const pick = (ev: { clientX: number; clientY: number }) => {
            const r = (e.target as HTMLElement).getBoundingClientRect()
            onPick(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
          }
          pick(e)
          const move = (ev: PointerEvent) => pick(ev)
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      />
      <span
        className="absolute border-2 border-zoom rounded-[4px] pointer-events-none bg-zoom/10"
        style={{
          width: `${100 / zoom.level}%`,
          height: `${100 / zoom.level}%`,
          left: `${(zoom.target.x - 0.5 / zoom.level) * 100}%`,
          top: `${(zoom.target.y - 0.5 / zoom.level) * 100}%`,
        }}
      />
    </div>
  )
}

export function ZoomPanel() {
  const [z, set] = useItem<Zoom>('zooms')
  const update = useEditor((s) => s.update)
  if (!z) return null
  return (
    <>
      <PanelHeader title="Zoom" />
      <Section title="Zoom">
        <Slider
          label="Zoom level"
          value={z.level}
          min={1}
          max={4}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(v) =>
            update((d) => {
              const it = d.timeline.zooms.find((x) => x.id === z.id)
              if (it) it.level = v
              d.style.zooms.defaultLevel = v
            }, `zoom-level-${z.id}`)
          }
        />
        <div className="flex gap-1">
          {[1.2, 1.5, 2, 2.5, 3].map((l) => (
            <button key={l} className={cx('flex-1 h-7 rounded-[6px] text-[12px] tabular', z.level === l ? 'bg-zoom text-black' : 'bg-white/6 hover:bg-white/10')} onClick={() => set((it) => void (it.level = l))}>
              {l}×
            </button>
          ))}
        </div>
        <Field label="Style">
          <Segmented
            value={z.presentation}
            onChange={(v) => set((it) => void (it.presentation = v))}
            options={[
              { value: 'screen', label: 'Classic zoom' },
              { value: 'loupe', label: 'Glass loupe' },
            ]}
          />
        </Field>
        {z.presentation === 'loupe' && (
          <Slider label="Loupe size" value={z.loupeRadius} min={0.25} max={0.75} step={0.01} format={pct} onChange={(v) => set((it) => void (it.loupeRadius = v), 'loupe')} />
        )}
      </Section>
      <Section title="Focus">
        <Segmented
          value={z.mode}
          onChange={(v) => set((it) => void (it.mode = v))}
          options={[
            { value: 'auto', label: 'Follow cursor' },
            { value: 'manual', label: 'Fixed point' },
          ]}
        />
        {z.mode === 'manual' && <FocusPicker zoom={z} onPick={(x, y) => set((it) => void (it.target = { x, y }), 'target')} />}
        <Toggle label="Instant animation" hint="Cut straight to the zoom instead of easing in." checked={z.instant} onChange={(v) => set((it) => void (it.instant = v))} />
        <Toggle label="Disable this zoom" checked={z.disabled} onChange={(v) => set((it) => void (it.disabled = v))} />
      </Section>
      <ItemActions duplicate />
    </>
  )
}

export function SlicePanel() {
  const [s, set] = useItem<Slice>('slices')
  const update = useEditor((st) => st.update)
  const duration = useEditor((st) => (st.project?.meta.duration ?? 0) * 1000)
  if (!s) return null
  return (
    <>
      <PanelHeader title="Clip" />
      <Section title="Speed">
        <div className="grid grid-cols-5 gap-1">
          {SPEED_PRESETS.map((v) => (
            <button key={v} onClick={() => set((it) => void (it.speed = v))} className={cx('h-7 rounded-[6px] text-[12px] tabular', s.speed === v ? 'bg-speed text-black' : 'bg-white/6 hover:bg-white/10')}>
              {v}×
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => update((d) => d.timeline.slices.forEach((x) => (x.speed = s.speed)))}>
          Apply speed to all clips
        </Button>
      </Section>
      <Section title="Volume">
        <Slider label="Microphone" value={s.volume} min={0} max={1} step={0.05} format={pct} onChange={(v) => set((it) => void (it.volume = v), 'vol')} />
        <Slider label="System audio" value={s.systemVolume} min={0} max={1} step={0.05} format={pct} onChange={(v) => set((it) => void (it.systemVolume = v), 'sys')} />
      </Section>
      <Section title="Cursor">
        <Toggle label="Hide cursor in this clip" checked={s.hideCursor} onChange={(v) => set((it) => void (it.hideCursor = v))} />
        <Toggle label="Disable smooth movement" checked={s.disableSmoothing} onChange={(v) => set((it) => void (it.disableSmoothing = v))} />
      </Section>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Button size="sm" variant="danger" onClick={() => deleteSelection()}>
          <Trash2 className="size-3.5" /> Delete clip
        </Button>
        <Button size="sm" variant="ghost" onClick={() => update((d) => resetCuts(d, duration))}>
          <RotateCcw className="size-3.5" /> Reset cuts &amp; speed
        </Button>
      </div>
    </>
  )
}

export function MaskPanel() {
  const [m, set] = useItem<Mask>('masks')
  const update = useEditor((s) => s.update)
  const project = useEditor((s) => s.project)
  const [tracking, setTracking] = useState<number | null>(null)
  if (!m) return null
  const stale = !!m.followScroll && !trackMatches(m)
  const track = async () => {
    if (!project || tracking !== null) return
    const config = useEditor.getState().config!
    const id = m.id
    setTracking(0)
    try {
      const t = await trackMaskScroll(project, config, m, (v) => setTracking(v))
      update((d) => {
        const it = d.timeline.masks.find((x) => x.id === id)
        if (it) {
          it.track = t
          it.followScroll = true
        }
      })
      toast(t.samples.length > 1 ? 'The mask now follows the content' : "Couldn't find movement to follow")
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setTracking(null)
    }
  }
  return (
    <>
      <PanelHeader title="Mask" />
      <Section title="Mask">
        <Segmented
          value={m.type}
          onChange={(v) => set((it) => void (it.type = v))}
          options={[
            { value: 'blur', label: 'Blur' },
            { value: 'pixelate', label: 'Pixelate' },
            { value: 'highlight', label: 'Highlight' },
          ]}
        />
        {m.type !== 'highlight' ? (
          <Slider label={m.type === 'pixelate' ? 'Block size' : 'Blur'} value={m.blur} min={2} max={80} step={1} format={(v) => v.toFixed(0)} onChange={(v) => set((it) => void (it.blur = v), 'blur')} />
        ) : (
          <>
            <Slider label="Dim outside" value={m.opacity} min={0.1} max={0.9} step={0.01} format={pct} onChange={(v) => set((it) => void (it.opacity = v), 'opacity')} />
            <Button size="sm" variant="ghost" onClick={() => update((d) => d.timeline.masks.forEach((x) => x.type === 'highlight' && (x.opacity = m.opacity)))}>
              Apply opacity to all highlights
            </Button>
          </>
        )}
        <Slider label="Corner radius" value={m.radius} min={0} max={60} step={1} format={(v) => `${v}px`} onChange={(v) => set((it) => void (it.radius = v), 'radius')} />
        <p className="text-[12px] text-muted">Drag the box in the preview to move it.</p>
        <Toggle
          label="Follow scrolling content"
          hint="Keeps the mask on the same content while the page scrolls. Analysed once."
          checked={!!m.followScroll}
          onChange={(v) => {
            if (!v) return set((it) => void (it.followScroll = false))
            if (m.track && trackMatches(m)) return set((it) => void (it.followScroll = true))
            void track()
          }}
        />
        {tracking !== null && <p className="text-[12px] text-muted tabular">Following the content… {Math.round(tracking * 100)}%</p>}
        {stale && tracking === null && (
          <div className="flex items-center justify-between gap-2 text-[12px] text-caption">
            <span>The mask moved since it was analysed.</span>
            <Button size="sm" onClick={() => void track()}>
              Track again
            </Button>
          </div>
        )}
        <Toggle label="Disable mask" checked={m.disabled} onChange={(v) => set((it) => void (it.disabled = v))} />
      </Section>
      <ItemActions duplicate />
    </>
  )
}

export function TextPanel() {
  const [t, set] = useItem<TextOverlay>('texts')
  if (!t) return null
  return (
    <>
      <PanelHeader title="Text" />
      <Section title="Text">
        <textarea
          value={t.text}
          onChange={(e) => set((it) => void (it.text = e.target.value), 'text')}
          rows={3}
          className="w-full rounded-[8px] bg-black/25 border border-line-soft p-2 text-[13px] outline-none focus:border-line resize-none"
        />
        <Slider label="Size" value={t.size} min={0.02} max={0.2} step={0.002} format={pct} onChange={(v) => set((it) => void (it.size = v), 'size')} />
        <Segmented
          value={t.weight}
          onChange={(v) => set((it) => void (it.weight = v))}
          options={[
            { value: 400, label: 'Regular' },
            { value: 600, label: 'Semibold' },
            { value: 800, label: 'Heavy' },
          ]}
        />
        <Field label="Text color" inline>
          <ColorInput value={t.color} onChange={(v) => set((it) => void (it.color = v), 'color')} />
        </Field>
        <Field label="Background" inline>
          <div className="flex gap-1.5">
            {['transparent', 'rgba(15,16,20,0.78)', 'rgba(255,255,255,0.92)', '#ff3b30'].map((bg) => (
              <button
                key={bg}
                onClick={() => set((it) => void (it.background = bg))}
                className={cx('size-7 rounded-[6px] ring-1', t.background === bg ? 'ring-white' : 'ring-white/15')}
                style={{ background: bg === 'transparent' ? 'repeating-conic-gradient(#555 0 25%, #333 0 50%) 50% / 8px 8px' : bg }}
                aria-label={bg}
              />
            ))}
          </div>
        </Field>
        <p className="text-[12px] text-muted">Drag the text in the preview to move it.</p>
      </Section>
      <ItemActions duplicate />
    </>
  )
}
