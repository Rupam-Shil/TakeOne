import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Clapperboard,
  Keyboard,
  LayoutTemplate,
  Maximize2,
  MicVocal,
  Pause,
  Play,
  Plus,
  Scissors,
  SkipBack,
  SquareDashed,
  Type,
  VolumeX,
  ZoomIn,
} from 'lucide-react'
import type { LayoutType } from '@shared/project'
import { formatTime } from '@/lib/bridge'
import { cx, IconButton, Popover, Slider } from '@/ui/controls'
import { typingRanges } from '@/render/keystrokes'
import type { Scene } from '@/render/scene'
import { useEditor } from './store'
import { runtime, useScene } from './runtime'
import { addItem, newLayout, newMask, newText, newZoom, setItemRange, speedUpRange, splitSliceAt, trimSlice, type TrackKind } from './ops'
import { togglePlay, seekTo } from './commands'
import { toast } from './toast'

const GUTTER = 40
const LAYOUT_LABEL: Record<LayoutType, string> = {
  'camera-overlay': 'Camera overlay',
  'screen-only': 'Screen only',
  'split-screen': 'Split screen',
  'fullscreen-camera': 'Camera only',
  'cutout-camera': 'Cutout',
}

export function Timeline({ onNaturalHeight }: { onNaturalHeight?: (h: number) => void } = {}) {
  const scene = useScene()
  const pps = useEditor((s) => s.pxPerSec)
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(800)
  // Tell the editor how tall the tracks want to be (toolbar + ruler + every track + padding).
  useEffect(() => {
    if (!onNaturalHeight || !root.current || !scroller.current || !content.current) return
    const report = () => {
      const r = root.current!
      const c = content.current!
      const top = scroller.current!.getBoundingClientRect().top - r.getBoundingClientRect().top
      // Sum the rows themselves; the content box stretches to fill, so its own height is no measure.
      let rows = 0
      for (const el of Array.from(c.children) as HTMLElement[]) if (getComputedStyle(el).position !== 'absolute') rows += el.offsetHeight
      const pad = parseFloat(getComputedStyle(c).paddingBottom) || 0
      onNaturalHeight(Math.ceil(top + rows + pad + 1))
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(content.current)
    return () => ro.disconnect()
  }, [onNaturalHeight])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setViewW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit the whole video on first show.
  const fitted = useRef(false)
  useEffect(() => {
    if (!scene || fitted.current || viewW < 320) return
    fitted.current = true
    useEditor.setState({ pxPerSec: Math.max(4, (viewW - GUTTER - 40) / Math.max(1, scene.timeMap.duration / 1000)) })
  }, [scene, viewW])

  if (!scene) return null
  const durationMs = scene.timeMap.duration
  const width = Math.max(viewW - GUTTER, (durationMs / 1000) * pps + 60)
  const x = (ms: number) => (ms / 1000) * pps

  return (
    <div ref={root} className="flex flex-col h-full bg-panel border-t border-line-soft hairline-top select-none">
      <TimelineToolbar scene={scene} viewW={viewW} />
      <div ref={scroller} className="relative flex-1 overflow-x-auto overflow-y-auto">
        <div ref={content} className="relative pb-7" style={{ width: width + GUTTER, minHeight: '100%' }}>
          <Ruler durationMs={durationMs} pps={pps} width={width} content={content} />
          <ClipTrack scene={scene} x={x} />
          <ItemTrack scene={scene} kind="zooms" x={x} icon={<ZoomIn className="size-3.5" />} color="zoom" />
          {(scene.hasCamera || scene.config.timeline.layouts.length > 0) && (
            <ItemTrack scene={scene} kind="layouts" x={x} icon={<LayoutTemplate className="size-3.5" />} color="layout" />
          )}
          {scene.config.timeline.masks.length > 0 && <ItemTrack scene={scene} kind="masks" x={x} icon={<SquareDashed className="size-3.5" />} color="mask" />}
          {scene.config.timeline.texts.length > 0 && <ItemTrack scene={scene} kind="texts" x={x} icon={<Type className="size-3.5" />} color="caption" />}
          {scene.config.timeline.voiceOvers.length > 0 && <ItemTrack scene={scene} kind="voiceOvers" x={x} icon={<MicVocal className="size-3.5" />} color="voice" />}
          <TypingTrack scene={scene} x={x} />
          {scene.input.markers.map((m, i) => (
            <div
              key={i}
              title="Marker"
              className="absolute top-0 z-20 cursor-pointer"
              style={{ left: GUTTER + x(scene.timeMap.toPlaybackNearest(m)) - 5 }}
              onClick={() => seekTo(scene.timeMap.toPlaybackNearest(m))}
            >
              <svg width="10" height="14" viewBox="0 0 10 14"><path d="M1 0v14M1 1h8l-2 3 2 3H1" fill="var(--color-caption)" stroke="var(--color-caption)" strokeWidth="1.2" /></svg>
            </div>
          ))}
          <Playhead x={x} content={content} />
        </div>
      </div>
    </div>
  )
}

function TimelineToolbar({ scene, viewW }: { scene: Scene; viewW: number }) {
  const playing = useEditor((s) => s.playing)
  const playMs = useEditor((s) => s.playMs)
  const pps = useEditor((s) => s.pxPerSec)
  const scissors = useEditor((s) => s.scissors)
  const update = useEditor((s) => s.update)
  const select = useEditor((s) => s.select)
  const dur = scene.timeMap.duration
  const sourceAtPlayhead = () => scene.timeMap.toSource(useEditor.getState().playMs)

  const add = (kind: TrackKind) => {
    const t = sourceAtPlayhead()
    let created: { id: string } | null = null
    const lastZoom = scene.config.timeline.zooms.find((z) => z.id === useEditor.getState().selection?.id)
    update((d) => {
      created = addItem(d, kind, t, scene.meta.duration * 1000, (s, e) => {
        if (kind === 'zooms') return newZoom(s, e, d.style.zooms.defaultLevel, lastZoom) as never
        if (kind === 'layouts') return newLayout(s, e, d.style.layout.type === 'camera-overlay' ? 'fullscreen-camera' : 'camera-overlay') as never
        if (kind === 'masks') return newMask(s, e) as never
        return newText(s, e) as never
      })
    })
    if (created) select({ kind: kind.slice(0, -1) as 'zoom', id: (created as { id: string }).id })
    else toast('No room here — move the playhead to an empty spot')
  }

  return (
    <div className="h-12 shrink-0 flex items-center gap-1 px-2.5 border-b border-line-soft">
      <IconButton label="Go to start" onClick={() => seekTo(0)}>
        <SkipBack className="size-4" />
      </IconButton>
      <button
        aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        onClick={() => togglePlay()}
        className="size-8 rounded-full inline-flex items-center justify-center bg-fg text-base hover:bg-white active:scale-95 transition-transform"
      >
        {playing ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current translate-x-px" />}
      </button>
      <span className="font-display tabular text-[14px] font-semibold text-fg ml-2 w-[128px]">
        {formatTime(playMs / 1000, true)} <span className="text-faint font-medium">/ {formatTime(dur / 1000, true)}</span>
      </span>
      <span className="w-px h-5 bg-line mx-1.5" />
      <IconButton label="Scissors — click the clip to split (hold ⌥)" active={scissors} onClick={() => useEditor.setState({ scissors: !scissors })}>
        <Scissors className="size-4" />
      </IconButton>
      <AddButton icon={<ZoomIn className="size-3.5" />} label="Zoom" onClick={() => add('zooms')} />
      {scene.hasCamera && <AddButton icon={<LayoutTemplate className="size-3.5" />} label="Layout" onClick={() => add('layouts')} />}
      <AddButton icon={<SquareDashed className="size-3.5" />} label="Mask" onClick={() => add('masks')} />
      <AddButton icon={<Type className="size-3.5" />} label="Text" onClick={() => add('texts')} />
      <div className="flex-1" />
      <div className="w-[140px]">
        <Slider value={Math.log(pps)} min={Math.log(2)} max={Math.log(600)} step={0.01} onChange={(v) => useEditor.setState({ pxPerSec: Math.exp(v) })} />
      </div>
      <IconButton
        label="Fit timeline"
        onClick={() => useEditor.setState({ pxPerSec: Math.max(2, (viewW - GUTTER - 40) / Math.max(1, dur / 1000)) })}
      >
        <Maximize2 className="size-3.5" />
      </IconButton>
    </div>
  )
}

function AddButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="h-7 pl-2 pr-2.5 rounded-full text-[12px] font-semibold text-muted hover:text-fg bg-white/4 hover:bg-white/9 border border-white/6 inline-flex items-center gap-1" title={`Add ${label.toLowerCase()} at playhead`}>
      <Plus className="size-3" />
      {icon}
      {label}
    </button>
  )
}

function Ruler({ durationMs, pps, width, content }: { durationMs: number; pps: number; width: number; content: React.RefObject<HTMLDivElement | null> }) {
  const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 70) ?? 600
  const ticks: number[] = []
  for (let t = 0; t <= durationMs / 1000 + step; t += step) ticks.push(t)
  const scrub = useScrub(content)
  return (
    <div className="sticky top-0 z-20 h-6 bg-panel border-b border-line-soft" style={{ width: width + GUTTER }} onPointerDown={scrub}>
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 h-full" style={{ left: GUTTER + t * pps }}>
          <div className="h-full w-px bg-white/8" />
          <span className="absolute top-1.5 left-1.5 text-[10px] text-faint tabular whitespace-nowrap">{formatTime(Math.round(t * 100) / 100, step < 1)}</span>
        </div>
      ))}
    </div>
  )
}

/** Pointer handler that seeks while dragging over the timeline. */
function useScrub(content: React.RefObject<HTMLDivElement | null>) {
  return (e: React.PointerEvent) => {
    e.stopPropagation()
    const seek = (clientX: number) => {
      const left = content.current?.getBoundingClientRect().left ?? 0
      const pps = useEditor.getState().pxPerSec
      const duration = runtime.buildScene()?.timeMap.duration ?? Infinity
      const ms = Math.min(duration, Math.max(0, ((clientX - left - GUTTER) / pps) * 1000))
      useEditor.setState({ playMs: ms, playing: false })
      runtime.playback?.pause()
    }
    seek(e.clientX)
    const move = (ev: PointerEvent) => seek(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
}

function TrackRow({ height, icon, children, tint }: { height: number; icon: ReactNode; children: ReactNode; tint?: string }) {
  return (
    <div className="relative border-b border-line-soft/60" style={{ height }}>
      <div className="sticky left-0 z-10 w-[40px] h-full flex items-center justify-center text-faint bg-panel/95 backdrop-blur border-r border-line-soft/60" style={tint ? { color: tint } : undefined}>{icon}</div>
      <div className="absolute inset-y-0 right-0" style={{ left: GUTTER }}>
        {children}
      </div>
    </div>
  )
}

function ClipTrack({ scene, x }: { scene: Scene; x: (ms: number) => number }) {
  const selection = useEditor((s) => s.selection)
  const scissors = useEditor((s) => s.scissors)
  const update = useEditor((s) => s.update)
  const select = useEditor((s) => s.select)
  const durationMs = scene.meta.duration * 1000

  return (
    <TrackRow height={64} icon={<Clapperboard className="size-3.5" />}>
      {scene.timeMap.segments.map((seg) => {
        const s = seg.slice
        const left = x(seg.playStart)
        const w = Math.max(2, x(seg.playEnd) - left)
        const selected = selection?.kind === 'slice' && selection.id === s.id
        const trim = (edge: 'start' | 'end') => (e: React.PointerEvent) => {
          e.stopPropagation()
          const startX = e.clientX
          const init = edge === 'start' ? s.start : s.end
          const move = (ev: PointerEvent) => {
            const pps = useEditor.getState().pxPerSec
            const dms = ((ev.clientX - startX) / pps) * 1000 * s.speed
            update((d) => trimSlice(d, s.id, edge, init + dms, durationMs), `trim-${s.id}-${edge}`)
          }
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }
        return (
          <div
            key={s.id}
            className={cx(
              'absolute top-1.5 bottom-1.5 rounded-[10px] overflow-hidden group border',
              selected ? 'border-white ring-1 ring-white/60' : 'border-white/10',
              scissors ? 'cursor-[col-resize]' : '',
            )}
            style={{ left, width: w, background: 'linear-gradient(180deg, #0f0f11, #050506)', boxShadow: 'inset 0 1px 0 #ffffff14' }}
            onPointerDown={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const playAt = seg.playStart + ((e.clientX - rect.left) / w) * (seg.playEnd - seg.playStart)
              if (scissors || e.altKey) {
                try {
                  update((d) => void splitSliceAt(d, scene.timeMap.toSource(playAt)))
                } catch (err) {
                  toast((err as Error).message)
                }
                return
              }
              select({ kind: 'slice', id: s.id })
              seekTo(playAt)
            }}
          >
            <Waveform from={s.start} to={s.end} width={w} />
            <div className="absolute left-2 top-1 flex items-center gap-1.5 text-[11px] font-medium text-white/90 pointer-events-none">
              {s.speed !== 1 && <span className="px-1 rounded bg-black/35 tabular">{s.speed}×</span>}
              {s.volume === 0 && <VolumeX className="size-3" />}
            </div>
            <span onPointerDown={trim('start')} className="absolute left-0 inset-y-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40 group-hover:bg-white/15" />
            <span onPointerDown={trim('end')} className="absolute right-0 inset-y-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40 group-hover:bg-white/15" />
          </div>
        )
      })}
    </TrackRow>
  )
}

function Waveform({ from, to, width }: { from: number; to: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    runtime.listeners.add(l)
    return () => void runtime.listeners.delete(l)
  }, [])
  useEffect(() => {
    const c = ref.current
    const peaks = runtime.waveforms.mic ?? runtime.waveforms.system
    if (!c || !peaks) return
    const w = Math.min(8192, Math.max(1, Math.round(width)))
    c.width = w
    c.height = 40
    const g = c.getContext('2d')!
    g.clearRect(0, 0, w, 40)
    g.fillStyle = 'rgba(255,255,255,0.82)'
    const i0 = from / 20
    const i1 = to / 20
    for (let px = 0; px < w; px++) {
      const a = Math.floor(i0 + ((i1 - i0) * px) / w)
      const b = Math.max(a + 1, Math.floor(i0 + ((i1 - i0) * (px + 1)) / w))
      let m = 0
      for (let i = a; i < b && i < peaks.length; i++) m = Math.max(m, peaks[i])
      const h = Math.max(1, Math.min(1, m * 1.6) * 34)
      g.fillRect(px, 40 - h - 2, 1, h)
    }
  })
  return <canvas ref={ref} className="absolute inset-x-0 bottom-0 h-[40px] w-full pointer-events-none" />
}

const TRACK_COLORS: Record<string, string> = { zoom: 'var(--color-zoom)', layout: 'var(--color-layout)', mask: 'var(--color-mask)', caption: 'var(--color-caption)', voice: 'var(--color-voice)' }

function ItemTrack({ scene, kind, x, icon, color }: { scene: Scene; kind: TrackKind; x: (ms: number) => number; icon: ReactNode; color: string }) {
  const selection = useEditor((s) => s.selection)
  const update = useEditor((s) => s.update)
  const select = useEditor((s) => s.select)
  const [ghost, setGhost] = useState<number | null>(null)
  const map = scene.timeMap
  const items = scene.config.timeline[kind] as { id: string; start: number; end: number; disabled: boolean }[]
  const durationMs = scene.meta.duration * 1000
  const single = (kind === 'voiceOvers' ? 'voiceover' : kind.slice(0, -1)) as 'zoom' | 'layout' | 'mask' | 'text' | 'voiceover'

  const label = (it: (typeof items)[number]) => {
    if (kind === 'zooms') {
      const z = scene.config.timeline.zooms.find((q) => q.id === it.id)!
      return `${z.presentation === 'loupe' ? 'Loupe' : 'Zoom'} ${z.level.toFixed(1)}×${z.mode === 'manual' ? ' · fixed' : ''}`
    }
    if (kind === 'layouts') return LAYOUT_LABEL[scene.config.timeline.layouts.find((q) => q.id === it.id)!.layout]
    if (kind === 'masks') return scene.config.timeline.masks.find((q) => q.id === it.id)!.type === 'highlight' ? 'Highlight' : 'Blur'
    if (kind === 'voiceOvers') {
      const v = scene.config.timeline.voiceOvers.find((q) => q.id === it.id)!
      return v.text ?? 'Voiceover'
    }
    return scene.config.timeline.texts.find((q) => q.id === it.id)!.text.split('\n')[0]
  }

  const drag = (it: (typeof items)[number], mode: 'move' | 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation()
    select({ kind: single, id: it.id })
    const startX = e.clientX
    const p0 = map.toPlaybackNearest(it.start)
    const p1 = map.toPlaybackNearest(it.end)
    const move = (ev: PointerEvent) => {
      const pps = useEditor.getState().pxPerSec
      const d = ((ev.clientX - startX) / pps) * 1000
      let a = p0
      let b = p1
      if (mode === 'move') {
        a += d
        b += d
      } else if (mode === 'start') a += d
      else b += d
      const s = map.toSource(Math.max(0, a))
      const en = mode === 'move' ? s + (it.end - it.start) : map.toSource(Math.max(0, b))
      update((draft) => setItemRange(draft, kind, it.id, mode === 'end' ? it.start : s, mode === 'start' ? it.end : en, durationMs), `drag-${it.id}`)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const addAt = (playMs: number) => {
    if (kind === 'voiceOvers') return useEditor.getState().set({ panel: 'voiceover' })
    const t = map.toSource(playMs)
    let created: { id: string } | null = null
    update((d) => {
      created = addItem(d, kind, t, durationMs, (s, e) => {
        if (kind === 'zooms') return newZoom(s, e, d.style.zooms.defaultLevel) as never
        if (kind === 'layouts') return newLayout(s, e, 'fullscreen-camera') as never
        if (kind === 'masks') return newMask(s, e) as never
        return newText(s, e) as never
      })
    })
    if (created) select({ kind: single, id: (created as { id: string }).id })
  }

  return (
    <TrackRow height={40} icon={icon} tint={TRACK_COLORS[color]}>
      <div
        className="absolute inset-0"
        onPointerMove={(e) => {
          if (e.target !== e.currentTarget) return setGhost(null)
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setGhost(e.clientX - rect.left)
        }}
        onPointerLeave={() => setGhost(null)}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          addAt(((e.clientX - rect.left) / useEditor.getState().pxPerSec) * 1000)
        }}
      />
      {ghost !== null && (
        <div className="absolute top-1.5 bottom-1.5 rounded-[9px] border border-dashed border-white/25 text-[12px] text-muted flex items-center px-2.5 pointer-events-none whitespace-nowrap" style={{ left: ghost }}>
          <Plus className="size-3 mr-1" /> Add {single}
        </div>
      )}
      {items.map((it) => {
        const a = x(map.toPlaybackNearest(it.start))
        const vo = kind === 'voiceOvers' ? scene.config.timeline.voiceOvers.find((v) => v.id === it.id) : null
        // Independent voiceovers keep their real length on the playback timeline.
        const b = vo && vo.attach === 'independent' ? a + x(vo.duration) : x(map.toPlaybackNearest(it.end))
        const selected = selection?.id === it.id
        return (
          <div
            key={it.id}
            onPointerDown={drag(it, 'move')}
            className={cx(
              'chip absolute top-1.5 bottom-1.5 rounded-[9px] px-2.5 flex items-center text-[12px] font-semibold overflow-hidden whitespace-nowrap cursor-grab',
              selected && 'chip-selected',
              it.disabled && 'opacity-40',
            )}
            style={{ left: a, width: Math.max(6, b - a), ['--chip' as string]: TRACK_COLORS[color] }}
          >
            <span className="truncate pointer-events-none">{label(it)}</span>
            {kind !== 'voiceOvers' && (
              <>
                <span onPointerDown={drag(it, 'start')} className="absolute left-0 inset-y-0 w-1.5 cursor-ew-resize hover:bg-white/25" />
                <span onPointerDown={drag(it, 'end')} className="absolute right-0 inset-y-0 w-1.5 cursor-ew-resize hover:bg-white/25" />
              </>
            )}
          </div>
        )
      })}
    </TrackRow>
  )
}

function TypingTrack({ scene, x }: { scene: Scene; x: (ms: number) => number }) {
  const update = useEditor((s) => s.update)
  const ranges = useMemo(() => typingRanges(scene.input.keys), [scene.input.keys])
  const resolved = scene.config.timeline.resolvedTypingSuggestions
  const pending = ranges.filter((r) => !resolved.includes(Math.round(r.start)))
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('studio.typingSpeed') ?? 3))
  if (!ranges.length && !scene.keyGroups.length) return null
  const map = scene.timeMap

  const apply = (rs: typeof ranges) =>
    update((d) => {
      for (const r of rs) {
        speedUpRange(d, r.start, r.end, speed)
        d.timeline.resolvedTypingSuggestions.push(Math.round(r.start))
      }
    })
  const dismiss = (r: (typeof ranges)[number]) => update((d) => void d.timeline.resolvedTypingSuggestions.push(Math.round(r.start)))

  return (
    <TrackRow height={36} icon={<Keyboard className="size-3.5" />} tint="var(--color-keys)">
      {scene.keyGroups.map((g) => (
        <span key={g.start} className="absolute top-2 h-2.5 w-1 rounded-full bg-white/30" style={{ left: x(map.toPlaybackNearest(g.start)) }} title={g.presses.map((p) => p.label).join(' ')} />
      ))}
      {pending.map((r) => {
        const a = x(map.toPlaybackNearest(r.start))
        const b = x(map.toPlaybackNearest(r.end))
        return (
          <div key={r.start} className="absolute top-0.5" style={{ left: a, width: Math.max(28, b - a) }}>
            <Popover
              trigger={(_, toggle) => (
                <button
                  onClick={toggle}
                  className="chip h-5 w-full rounded-[6px] text-[10.5px] font-semibold flex items-center gap-1 px-1.5 hover:brightness-125"
                  style={{ ['--chip' as string]: 'var(--color-keys)' }}
                >
                  <Keyboard className="size-3 shrink-0" /> <span className="truncate">Typing</span>
                </button>
              )}
            >
              {(close) => (
                <div className="w-[260px] p-2 flex flex-col gap-3">
                  <p className="text-[12.5px] text-muted leading-snug">You're typing here. Speed this part up so viewers don't wait.</p>
                  <Slider
                    label="Speed"
                    value={speed}
                    min={1.5}
                    max={8}
                    step={0.5}
                    format={(v) => `${v}×`}
                    onChange={(v) => {
                      setSpeed(v)
                      localStorage.setItem('studio.typingSpeed', String(v))
                    }}
                  />
                  <div className="flex gap-1.5">
                    <button className="flex-1 h-7 rounded-[7px] bg-fg text-base text-[12px] font-semibold" onClick={() => (apply([r]), close())}>
                      Speed up
                    </button>
                    <button className="h-7 px-2.5 rounded-full btn-soft text-[12px] font-semibold" onClick={() => (apply(pending), close())}>
                      Apply to all
                    </button>
                  </div>
                  <button className="text-[12px] text-muted hover:text-fg text-left" onClick={() => (dismiss(r), close())}>
                    Dismiss
                  </button>
                </div>
              )}
            </Popover>
          </div>
        )
      })}
    </TrackRow>
  )
}

function Playhead({ x, content }: { x: (ms: number) => number; content: React.RefObject<HTMLDivElement | null> }) {
  const playMs = useEditor((s) => s.playMs)
  const scrub = useScrub(content)
  return (
    <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: GUTTER + x(playMs) }}>
      <div className="absolute top-0 -translate-x-1/2 size-3 rounded-full bg-tally shadow-[0_2px_6px_#0008] pointer-events-auto cursor-ew-resize" onPointerDown={scrub} />
      <div className="absolute top-0 bottom-0 w-px bg-tally -translate-x-1/2" />
    </div>
  )
}
