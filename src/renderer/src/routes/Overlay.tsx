import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle } from 'lucide-react'
import type { CaptureSources, DisplayInfo, Rect, RecordTarget, Size, WindowInfo } from '@shared/recording'
import { api, bridge, useQuery, useSettings } from '@/lib/bridge'

type Mode = 'display' | 'window' | 'area' | 'countdown'

const AREA_KEY = 'studio.lastArea'

/** Full-screen transparent overlay for one display: pick a target, show the countdown, dim the surroundings. */
export default function Overlay() {
  const q = useQuery()
  const mode = (q.get('mode') ?? 'display') as Mode
  const displayId = Number(q.get('displayId'))
  const [sources, setSources] = useState<CaptureSources | null>(null)
  const [countdown, setCountdown] = useState<{ n: number; target: RecordTarget } | null>(null)
  const [highlight, setHighlight] = useState<RecordTarget | null>(null)

  const refresh = useCallback((force = false) => api.listSources(force).then(setSources).catch(() => {}), [])
  useEffect(() => {
    void refresh()
    let timer: ReturnType<typeof setInterval> | null = null
    const offCount = bridge.on('recorder:countdown', ({ seconds, target }) => {
      let n = seconds
      setCountdown({ n, target })
      if (timer) clearInterval(timer)
      timer = setInterval(() => {
        n -= 1
        if (n <= 0 && timer) clearInterval(timer)
        else setCountdown({ n, target })
      }, 1000)
    })
    const offHi = bridge.on('recorder:highlight', (t) => {
      setCountdown(null)
      setHighlight(t)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.cancelSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      if (timer) clearInterval(timer)
      offCount()
      offHi()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Electron display ids match CGDirectDisplayID on macOS.
  const display = sources?.displays.find((d) => d.id === displayId) ?? null
  const origin = { x: window.screenX, y: window.screenY }

  const targetRect = (t: RecordTarget | null): Rect | null => {
    if (!t || !sources) return null
    if (t.type === 'window') {
      const w = sources.windows.find((x) => x.id === t.windowId)
      return w ? { ...w.frame, x: w.frame.x - origin.x, y: w.frame.y - origin.y } : null
    }
    if (t.type === 'area' && t.rect && t.displayId === displayId) return t.rect
    if (t.type === 'area' && t.rect) {
      const d = sources.displays.find((x) => x.id === t.displayId)
      return d ? { ...t.rect, x: t.rect.x + d.frame.x - origin.x, y: t.rect.y + d.frame.y - origin.y } : null
    }
    return null
  }

  if (highlight) return <Dimmer hole={targetRect(highlight)} />

  if (countdown) {
    const hole = targetRect(countdown.target)
    const onThisDisplay = countdown.target.type === 'display' ? countdown.target.displayId === displayId : !!hole
    return (
      <div className="fixed inset-0" onMouseDown={() => api.cancelSelection()}>
        <Dimmer hole={hole} strength={0.35} />
        {onThisDisplay && (
          <div
            className="absolute flex items-center justify-center pointer-events-none"
            style={hole ? { left: hole.x, top: hole.y, width: hole.width, height: hole.height } : { inset: 0 }}
          >
            <div key={countdown.n} className="countdown-pop flex flex-col items-center gap-3">
              <span className="font-display text-[148px] font-semibold leading-none text-white drop-shadow-[0_8px_30px_#000a] tabular">
                {countdown.n}
              </span>
              <span className="text-[13px] text-white/70">Click anywhere or press Esc to cancel</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!sources || !display) return <div className="fixed inset-0 bg-black/25" />
  if (mode === 'window') return <WindowPicker windows={sources.windows} display={display} origin={origin} onRefresh={() => refresh(true)} />
  if (mode === 'area') return <AreaPicker display={display} />
  return <DisplayPicker display={display} />
}

function Dimmer({ hole, strength = 0.5 }: { hole: Rect | null; strength?: number }) {
  if (!hole) return <div className="fixed inset-0 pointer-events-none" style={{ background: `rgba(0,0,0,${strength})` }} />
  return (
    <div className="fixed inset-0 pointer-events-none">
      <div
        className="absolute rounded-[10px]"
        style={{
          left: hole.x,
          top: hole.y,
          width: hole.width,
          height: hole.height,
          boxShadow: `0 0 0 100000px rgba(0,0,0,${strength})`,
          outline: '1.5px solid rgba(255,255,255,0.55)',
        }}
      />
    </div>
  )
}

function RecordPill({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="inline-flex items-center gap-2 h-11 pl-3.5 pr-5 rounded-full text-white text-[14px] font-semibold bg-[linear-gradient(180deg,#ff6a5f,#e8392e)] shadow-[0_14px_34px_-10px_#ff4f43dd,inset_0_1px_0_#ffffff40] hover:brightness-110 active:scale-[0.98] transition-transform"
    >
      <Circle className="size-3.5 fill-white stroke-none" />
      {label}
    </button>
  )
}

function DisplayPicker({ display }: { display: DisplayInfo }) {
  const [hover, setHover] = useState(false)
  const start = () => api.startRecording({ type: 'display', displayId: display.id })
  return (
    <div
      className="fixed inset-0 flex items-center justify-center transition-colors"
      style={{ background: hover ? 'rgba(30,80,255,0.16)' : 'rgba(0,0,0,0.38)' }}
      onMouseEnter={() => {
        setHover(true)
        api.setOverlayFocus()
      }}
      onMouseLeave={() => setHover(false)}
      onClick={start}
    >
      {hover && <div className="absolute inset-0 border-[3px] border-clip/80 pointer-events-none" />}
      <div className="flex flex-col items-center gap-4 card px-9 py-7 rise-in">
        <div className="text-center">
          <div className="text-[17px] font-semibold">{display.name}</div>
          <div className="text-[12.5px] text-muted tabular mt-0.5">
            {Math.round(display.frame.width * display.scale)} × {Math.round(display.frame.height * display.scale)}
          </div>
        </div>
        <RecordPill onClick={start} label="Record display" />
        <span className="text-[12px] text-faint font-medium">Esc to cancel</span>
      </div>
    </div>
  )
}

/** Window sizes offered before recording, in points. Aspect presets fit the display. */
function sizePresets(display: DisplayInfo, saved: Size[]): { label: string; size: Size; saved?: boolean }[] {
  const maxW = display.frame.width - 40
  const maxH = display.frame.height - 90 // menu bar + Dock
  const fit = (aw: number, ah: number) => {
    let w = maxW
    let h = (w * ah) / aw
    if (h > maxH) {
      h = maxH
      w = (h * aw) / ah
    }
    return { width: Math.round(w / 2) * 2, height: Math.round(h / 2) * 2 }
  }
  const fixed = [
    { label: '1280×720', size: { width: 1280, height: 720 } },
    { label: '1920×1080', size: { width: 1920, height: 1080 } },
    { label: '1024×768', size: { width: 1024, height: 768 } },
  ].filter((p) => p.size.width <= maxW && p.size.height <= maxH)
  return [
    { label: '16:9', size: fit(16, 9) },
    { label: '4:3', size: fit(4, 3) },
    { label: '1:1', size: fit(1, 1) },
    ...fixed,
    ...saved.map((s) => ({ label: `${s.width}×${s.height}`, size: s, saved: true })),
  ]
}

function WindowPicker({ windows, display, origin, onRefresh }: { windows: WindowInfo[]; display: DisplayInfo; origin: { x: number; y: number }; onRefresh: () => Promise<void> }) {
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [settings, update] = useSettings()
  const [busy, setBusy] = useState(false)
  const [resizeError, setResizeError] = useState<string | null>(null)
  // Keep the hovered window while its frame changes under the pointer after a resize.
  const stickyUntil = useRef(0)
  const hovered = windows.find((w) => w.id === hoveredId) ?? null
  const onMove = useCallback(
    (e: React.MouseEvent) => {
      if (performance.now() < stickyUntil.current) return
      if ((e.target as HTMLElement).closest?.('[data-panel]')) return
      const gx = e.clientX + origin.x
      const gy = e.clientY + origin.y
      // Windows arrive front-to-back, so the first hit is the visible one.
      const hit = windows.find(
        (w) => gx >= w.frame.x && gx <= w.frame.x + w.frame.width && gy >= w.frame.y && gy <= w.frame.y + w.frame.height,
      )
      setHoveredId(hit?.id ?? null)
    },
    [windows, origin.x, origin.y],
  )
  const start = () => hovered && api.startRecording({ type: 'window', windowId: hovered.id })
  const presets = sizePresets(display, settings?.recording.windowSizes ?? [])
  const resize = async (size: Size) => {
    if (!hovered || busy) return
    setBusy(true)
    setResizeError(null)
    try {
      await api.resizeWindow(hovered.id, size.width, size.height)
      stickyUntil.current = performance.now() + 1500
      await onRefresh()
    } catch (err) {
      setResizeError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const saveSize = () => {
    if (!hovered || !settings) return
    const size = { width: Math.round(hovered.frame.width), height: Math.round(hovered.frame.height) }
    if (settings.recording.windowSizes.some((s) => s.width === size.width && s.height === size.height)) return
    update({ recording: { windowSizes: [...settings.recording.windowSizes, size] } })
  }
  const forgetSize = (size: Size) => {
    if (!settings) return
    update({ recording: { windowSizes: settings.recording.windowSizes.filter((s) => s.width !== size.width || s.height !== size.height) } })
  }
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const isCurrent = (s: Size) => hovered && Math.abs(hovered.frame.width - s.width) < 2 && Math.abs(hovered.frame.height - s.height) < 2
  const r = hovered && {
    x: hovered.frame.x - origin.x,
    y: hovered.frame.y - origin.y,
    width: hovered.frame.width,
    height: hovered.frame.height,
  }
  return (
    <div
      className="fixed inset-0"
      onMouseMove={onMove}
      onMouseEnter={() => api.setOverlayFocus()}
      onClick={start}
      style={{ background: r ? 'transparent' : 'rgba(0,0,0,0.3)' }}
    >
      {r && (
        <div
          className="absolute rounded-[12px] flex items-center justify-center"
          style={{
            left: r.x,
            top: r.y,
            width: r.width,
            height: r.height,
            background: 'rgba(30,90,255,0.18)',
            outline: '2.5px solid rgba(90,140,255,0.95)',
            boxShadow: '0 0 0 100000px rgba(0,0,0,0.38)',
          }}
        >
          <div data-panel className="flex flex-col items-center gap-3 card px-6 py-5 max-w-[80%] rise-in" onMouseDown={stop} onClick={stop}>
            <div className="text-center min-w-0">
              <div className="text-[15px] font-semibold truncate">{hovered!.appName}</div>
              {/* The title repeats the app name for windows without a document; say nothing twice. */}
              {hovered!.title && hovered!.title.trim() !== hovered!.appName.trim() && (
                <div className="text-[12px] text-muted truncate max-w-[320px]">{hovered!.title}</div>
              )}
              <div className="text-[11.5px] text-faint tabular mt-1">
                {Math.round(r.width * display.scale)} × {Math.round(r.height * display.scale)}
              </div>
            </div>
            <RecordPill onClick={start} label="Record window" />
            {r.width >= 420 && (
              <div className="flex flex-col items-center gap-1.5 max-w-[420px]">
                <div className="flex flex-wrap justify-center gap-1">
                  {presets.map((p) => (
                    <span key={p.label + (p.saved ? '*' : '')} className="group/chip relative">
                      <button
                        disabled={busy}
                        onClick={() => resize(p.size)}
                        title={`Resize to ${p.size.width}×${p.size.height} points (${p.size.width * display.scale}×${p.size.height * display.scale} px)`}
                        className={`h-7 px-2.5 rounded-full text-[11.5px] font-semibold tabular ${isCurrent(p.size) ? 'bg-fg text-on-fg' : 'bg-control text-muted hover:text-fg hover:bg-hover'} disabled:opacity-50`}
                      >
                        {p.label}
                      </button>
                      {p.saved && (
                        <button
                          onClick={() => forgetSize(p.size)}
                          aria-label={`Forget ${p.label}`}
                          className="absolute -top-1 -right-1 hidden group-hover/chip:flex size-3.5 rounded-full bg-fg text-on-fg text-[9px] leading-none items-center justify-center"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  <button onClick={saveSize} className="h-7 px-2.5 rounded-full text-[11.5px] font-semibold text-muted hover:text-fg hover:bg-control" title="Remember this window's current size as a preset">
                    Remember size
                  </button>
                </div>
                <span className="text-[11.5px] text-faint font-medium">{resizeError ?? 'Resize the window before recording'}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {!r && (
        <div className="absolute inset-x-0 top-[38%] text-center text-white/85 text-[15px] font-medium pointer-events-none drop-shadow">
          Hover a window to record it. Esc cancels.
        </div>
      )}
    </div>
  )
}

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'new'

function AreaPicker({ display }: { display: DisplayInfo }) {
  const saved = useMemo(() => {
    try {
      const r = JSON.parse(localStorage.getItem(AREA_KEY) ?? 'null') as (Rect & { displayId: number }) | null
      return r && r.displayId === display.id ? r : null
    } catch {
      return null
    }
  }, [display.id])
  const [rect, setRect] = useState<Rect | null>(saved)
  const drag = useRef<{ handle: Handle; start: { x: number; y: number }; rect: Rect } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.start.x
      const dy = e.clientY - d.start.y
      let { x, y, width, height } = d.rect
      const W = window.innerWidth
      const H = window.innerHeight
      if (d.handle === 'new') {
        x = Math.min(d.start.x, e.clientX)
        y = Math.min(d.start.y, e.clientY)
        width = Math.abs(dx)
        height = Math.abs(dy)
      } else if (d.handle === 'move') {
        x = Math.max(0, Math.min(W - width, x + dx))
        y = Math.max(0, Math.min(H - height, y + dy))
      } else {
        if (d.handle.includes('e')) width = Math.max(40, width + dx)
        if (d.handle.includes('s')) height = Math.max(40, height + dy)
        if (d.handle.includes('w')) {
          x = Math.min(x + width - 40, x + dx)
          width = d.rect.x + d.rect.width - x
        }
        if (d.handle.includes('n')) {
          y = Math.min(y + height - 40, y + dy)
          height = d.rect.y + d.rect.height - y
        }
      }
      if (e.shiftKey && d.handle !== 'move') height = width * (9 / 16)
      setRect({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) })
    }
    const onUp = () => {
      drag.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const begin = (handle: Handle) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const r = rect ?? { x: e.clientX, y: e.clientY, width: 0, height: 0 }
    drag.current = { handle, start: { x: e.clientX, y: e.clientY }, rect: r }
    if (handle === 'new') setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 })
  }

  const start = () => {
    if (!rect || rect.width < 150 || rect.height < 150) return
    localStorage.setItem(AREA_KEY, JSON.stringify({ ...rect, displayId: display.id }))
    api.startRecording({ type: 'area', displayId: display.id, rect })
  }

  const handles: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
  const pos = (h: Handle): React.CSSProperties => ({
    left: h.includes('w') ? -6 : h.includes('e') ? undefined : '50%',
    right: h.includes('e') ? -6 : undefined,
    top: h.includes('n') ? -6 : h.includes('s') ? undefined : '50%',
    bottom: h.includes('s') ? -6 : undefined,
    transform: `translate(${h === 'n' || h === 's' ? '-50%' : '0'}, ${h === 'e' || h === 'w' ? '-50%' : '0'})`,
    cursor: `${h}-resize`,
  })

  return (
    <div className="fixed inset-0 cursor-crosshair" onMouseDown={begin('new')} onMouseEnter={() => api.setOverlayFocus()}>
      {!rect && (
        <>
          <div className="fixed inset-0 bg-black/40 pointer-events-none" />
          <div className="absolute inset-x-0 top-[40%] text-center text-white/85 text-[15px] font-medium pointer-events-none drop-shadow">
            Drag to select an area. Hold ⇧ for 16:9. Esc cancels.
          </div>
        </>
      )}
      {rect && (
        <div
          className="absolute cursor-move"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, boxShadow: '0 0 0 100000px rgba(0,0,0,0.42)', outline: '1.5px dashed rgba(255,255,255,0.9)' }}
          onMouseDown={begin('move')}
          onDoubleClick={start}
        >
          {handles.map((h) => (
            <span
              key={h}
              onMouseDown={begin(h)}
              className="absolute size-3 rounded-full bg-white shadow-[0_0_0_1px_#0005]"
              style={pos(h)}
            />
          ))}
          <div className="absolute left-1/2 -translate-x-1/2 -top-9 h-7 px-3 rounded-full card text-[12px] tabular font-semibold flex items-center whitespace-nowrap">
            {Math.round(rect.width * display.scale)} × {Math.round(rect.height * display.scale)}
          </div>
          {rect.width >= 150 && rect.height >= 150 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none [&>button]:pointer-events-auto">
              <RecordPill onClick={start} label="Record area" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
