import { useEffect, useRef, useState } from 'react'
import { Minus, Pause, Play, Plus, X } from 'lucide-react'
import { api, useSettings } from '@/lib/bridge'

/** Teleprompter shown while recording. It belongs to the app, so it never appears in the capture. */
export default function Notes() {
  const [settings, update] = useSettings()
  const [scrolling, setScrolling] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const notes = settings?.recording.speakerNotes

  useEffect(() => {
    if (!scrolling || !notes) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const el = box.current
      if (el) el.scrollTop += ((now - last) / 1000) * notes.speed * 6
      last = now
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [scrolling, notes])

  if (!notes) return null
  const set = (patch: Partial<typeof notes>) => update({ recording: { speakerNotes: patch } })

  return (
    <div className="h-full p-1.5">
      <div className="h-full flex flex-col rounded-[16px] glass-float overflow-hidden" style={{ opacity: notes.opacity }}>
        <header className="drag h-8 shrink-0 flex items-center gap-1 px-2 text-muted">
          <button className="no-drag size-6 rounded inline-flex items-center justify-center hover:bg-white/10" onClick={() => setScrolling(!scrolling)} aria-label={scrolling ? 'Pause scrolling' : 'Start scrolling'} title={scrolling ? 'Pause scrolling' : 'Start scrolling'}>
            {scrolling ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <span className="text-[11px] tabular w-14">Speed {notes.speed}</span>
          <button className="no-drag size-6 rounded inline-flex items-center justify-center hover:bg-white/10" onClick={() => set({ speed: Math.max(1, notes.speed - 1) })} aria-label="Slower">
            <Minus className="size-3" />
          </button>
          <button className="no-drag size-6 rounded inline-flex items-center justify-center hover:bg-white/10" onClick={() => set({ speed: Math.min(20, notes.speed + 1) })} aria-label="Faster">
            <Plus className="size-3" />
          </button>
          <span className="flex-1" />
          <button className="no-drag size-6 rounded inline-flex items-center justify-center hover:bg-white/10" onClick={() => set({ fontSize: Math.max(10, notes.fontSize - 2) })} aria-label="Smaller text">
            A-
          </button>
          <button className="no-drag size-6 rounded inline-flex items-center justify-center hover:bg-white/10" onClick={() => set({ fontSize: Math.min(40, notes.fontSize + 2) })} aria-label="Larger text">
            A+
          </button>
          <button className="no-drag size-6 rounded inline-flex items-center justify-center hover:bg-white/10" onClick={() => api.closeWindow()} aria-label="Close">
            <X className="size-3.5" />
          </button>
        </header>
        <textarea
          ref={box}
          defaultValue={notes.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="Write your notes here. This window won't appear in the recording."
          className="flex-1 bg-transparent px-4 pb-4 outline-none resize-none leading-relaxed text-fg/95 placeholder:text-faint"
          style={{ fontSize: notes.fontSize }}
        />
      </div>
    </div>
  )
}
