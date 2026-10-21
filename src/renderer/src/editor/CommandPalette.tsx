import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Kbd, cx } from '@/ui/controls'
import { useEscape } from '@/ui/useEscape'
import { X } from 'lucide-react'
import { useEditor } from './store'
import { RAIL } from './Inspector'
import { resetCuts } from './ops'
import { generateAutoZooms } from '@/render/zoom'
import { formatTime } from '@/lib/bridge'
import { runtime } from './runtime'
import { toast } from './toast'
import {
  addZoomAtPlayhead,
  deleteSelection,
  duplicateSelection,
  rippleDelete,
  seekTo,
  splitAtPlayhead,
  togglePlay,
} from './commands'

export interface Command {
  id: string
  label: string
  group: string
  keys?: string
  run: () => void
}

export function useCommands(open: { exportTo: (t: 'file' | 'clipboard' | 'link') => void; crop: () => void; guide: () => void }): Command[] {
  return useMemo(() => {
    const st = () => useEditor.getState()
    const cmds: Command[] = [
      { id: 'play', label: 'Play / pause', group: 'Playback', keys: 'Space', run: () => void togglePlay() },
      { id: 'start', label: 'Go to start', group: 'Playback', keys: '⌘←', run: () => seekTo(0) },
      { id: 'end', label: 'Go to end', group: 'Playback', keys: '⌘→', run: () => seekTo(Number.MAX_SAFE_INTEGER) },
      { id: 'split', label: 'Split at playhead', group: 'Timeline', keys: 'C', run: splitAtPlayhead },
      { id: 'ripple', label: 'Remove back to previous cut', group: 'Timeline', keys: 'X', run: rippleDelete },
      { id: 'delete', label: 'Delete selection', group: 'Timeline', keys: '⌫', run: deleteSelection },
      { id: 'zoom', label: 'Add zoom at playhead', group: 'Timeline', keys: 'Z', run: addZoomAtPlayhead },
      { id: 'dup', label: 'Duplicate selection', group: 'Timeline', keys: '⌘D', run: duplicateSelection },
      {
        id: 'reset-cuts',
        label: 'Reset trims, cuts and speed',
        group: 'Timeline',
        run: () => st().update((d) => resetCuts(d, (st().project?.meta.duration ?? 0) * 1000)),
      },
      {
        id: 'restore-zooms',
        label: 'Restore automatic zooms',
        group: 'Timeline',
        run: () => {
          const project = st().project
          if (!project) return
          st().update((d) => {
            // Keep hand-made zooms; regenerate the automatic ones around them.
            const manual = d.timeline.zooms.filter((z) => !z.generated)
            const generated = generateAutoZooms(project.input, d.style.zooms.defaultLevel).filter((z) => !manual.some((m) => z.start < m.end && z.end > m.start))
            d.timeline.zooms = [...manual, ...generated].sort((a, b) => a.start - b.start)
          })
          toast('Automatic zooms restored')
        },
      },
      {
        id: 'chapters',
        label: 'Copy chapter list from markers',
        group: 'Export',
        run: () => {
          const scene = runtime.buildScene()
          if (!scene) return
          const times = [0, ...scene.input.markers.map((m) => scene.timeMap.toPlaybackNearest(m))].filter((t, i, a) => a.indexOf(t) === i).sort((a, b) => a - b)
          const lines = times.map((t, i) => `${formatTime(t / 1000).padStart(4, '0')} ${i === 0 ? 'Intro' : `Chapter ${i + 1}`}`)
          navigator.clipboard.writeText(lines.join('\n')).then(() => toast(`Copied ${lines.length} chapters for YouTube`))
        },
      },
      { id: 'undo', label: 'Undo', group: 'Edit', keys: '⌘Z', run: () => st().undo() },
      { id: 'redo', label: 'Redo', group: 'Edit', keys: '⇧⌘Z', run: () => st().redo() },
      { id: 'crop', label: 'Crop recording…', group: 'Edit', keys: 'R', run: open.crop },
      { id: 'export', label: 'Export…', group: 'Export', keys: '⇧⌘E', run: () => open.exportTo('file') },
      { id: 'export-clip', label: 'Export to clipboard', group: 'Export', keys: '⌥⌘C', run: () => open.exportTo('clipboard') },
      { id: 'export-link', label: 'Export to shareable link', group: 'Export', keys: '⌃⌘S', run: () => open.exportTo('link') },
      { id: 'preview', label: 'Toggle preview mode', group: 'View', keys: '⇧⌘↩', run: () => useEditor.setState({ previewMode: !st().previewMode }) },
      { id: 'safe', label: 'Toggle vertical video safe zones', group: 'View', run: () => useEditor.setState({ safeZones: st().safeZones === 'none' ? 'tiktok' : 'none' }) },
      { id: 'guide', label: 'Show shortcuts guide', group: 'Help', keys: '⌘/', run: open.guide },
      ...RAIL.map((r) => ({
        id: `panel-${r.id}`,
        label: `Open ${r.label}`,
        group: 'Panels',
        keys: r.key ? `⌘${r.key}` : undefined,
        run: () => {
          st().select(null)
          st().set({ panel: r.id })
        },
      })),
    ]
    return cmds
  }, [open])
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  useEscape(onClose)
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter((c) => terms.every((t) => `${c.label} ${c.group}`.toLowerCase().includes(t)))
  }, [q, commands])

  useEffect(() => setIndex(0), [q])
  useEffect(() => {
    list.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (c: Command | undefined) => {
    if (!c) return
    onClose()
    c.run()
  }

  return (
    <div data-modal className="fixed inset-0 z-[70] bg-black/45 backdrop-blur-[2px] flex items-start justify-center pt-[14vh]" onMouseDown={onClose}>
      <div className="w-[580px] rounded-[18px] glass-float overflow-hidden rise-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 h-14 px-5 border-b border-line-soft">
          <Search className="size-4 text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search commands…"
            aria-label="Search commands"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-faint"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') (e.preventDefault(), setIndex((i) => Math.min(results.length - 1, i + 1)))
              if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)))
              if (e.key === 'Enter') run(results[index])
            }}
          />
        </div>
        <div ref={list} className="max-h-[380px] overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-6 text-center text-muted text-[13px]">No matching commands</p>}
          {results.map((c, i) => (
            <button
              key={c.id}
              data-i={i}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
              className={cx('w-full h-9 px-3 rounded-[9px] flex items-center gap-3 text-left text-[13px]', i === index && 'bg-fg text-on-fg')}
            >
              <span className="flex-1">{c.label}</span>
              <span className="text-[11.5px] text-faint">{c.group}</span>
              {c.keys && <Kbd>{c.keys}</Kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ShortcutsGuide({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  useEscape(onClose)
  const groups = useMemo(() => {
    const m = new Map<string, Command[]>()
    for (const c of commands) if (c.keys) m.set(c.group, [...(m.get(c.group) ?? []), c])
    m.set('Zoom', [
      { id: 'zl', label: 'Set zoom level 1.0×–2.6× (with a zoom selected)', group: 'Zoom', keys: '1–9', run: () => {} },
      { id: 'zp', label: 'Zoom level up / down (with a zoom selected)', group: 'Zoom', keys: '= / −', run: () => {} },
    ])
    m.set('Navigation', [
      { id: 'f', label: 'Previous / next frame', group: 'Navigation', keys: '← →', run: () => {} },
      { id: 'ff', label: 'Back / forward 2 seconds', group: 'Navigation', keys: '⇧← ⇧→', run: () => {} },
      { id: 'jkl', label: 'Shuttle back / stop / play', group: 'Navigation', keys: 'J K L', run: () => {} },
      { id: 'sc', label: 'Scissors (click clip to split)', group: 'Navigation', keys: 'hold ⌥', run: () => {} },
    ])
    return [...m.entries()]
  }, [commands])
  return (
    <div data-modal className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-8" onMouseDown={onClose}>
      <div className="w-full max-w-[920px] max-h-full overflow-y-auto rounded-[20px] glass-float p-6 rise-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold">Keyboard shortcuts</h2>
          <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="grid gap-x-8 gap-y-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {groups.map(([group, cmds]) => (
            <section key={group}>
              <h3 className="text-[12px] font-semibold text-muted mb-2">{group}</h3>
              {cmds.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 h-8 text-[13px]">
                  <span className="truncate">{c.label}</span>
                  <Kbd>{c.keys}</Kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
