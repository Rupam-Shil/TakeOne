import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Eye, Redo2, Save, Smartphone, Undo2, Upload } from 'lucide-react'
import { normalizeStyle, uid, type Preset } from '@shared/project'
import { api, bridge, useQuery } from '@/lib/bridge'
import { Button, IconButton, MenuItem, Popover, cx } from '@/ui/controls'
import { Compositor } from '@/render/compositor'
import { stageSize } from '@/render/layout'
import { loadProject, rememberStyle } from './loader'
import { useEditor } from './store'
import { runtime } from './runtime'
import { Preview } from './Preview'
import { Timeline } from './Timeline'
import { Inspector, RAIL } from './Inspector'
import { CropModal } from './CropModal'
import { ExportDialog } from './ExportDialog'
import { toast, useToasts } from './toast'
import { CommandPalette, ShortcutsGuide, useCommands } from './CommandPalette'
import {
  addZoomAtPlayhead,
  deleteSelection,
  duplicateSelection,
  rippleDelete,
  seekBy,
  seekTo,
  setZoomLevel,
  splitAtPlayhead,
  stepFrame,
  togglePlay,
} from './commands'

// Dev-only handle for automated checks over the DevTools protocol.
if (import.meta.env.DEV) {
  import('@/export/exporter').then((exporter) => {
    ;(window as unknown as Record<string, unknown>).__studio = { useEditor, runtime, exporter, api }
  })
}

export default function Editor() {
  const q = useQuery()
  const path = q.get('project') ?? ''
  const project = useEditor((s) => s.project)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadProject(path)
      .then((p) => {
        runtime.attach(p)
        useEditor.getState().load(p)
        api.setWindowTitle(p.file.name)
      })
      .catch((e) => setError(String(e?.message ?? e)))
    return () => runtime.playback?.destroy()
  }, [path])

  if (error)
    return (
      <div className="h-full app-surface flex items-center justify-center text-center p-10">
        <div>
          <h1 className="text-[16px] font-semibold">This project couldn't be opened</h1>
          <p className="text-muted mt-1 max-w-[420px]">{error}</p>
        </div>
      </div>
    )
  // Leaving the page (library, another project) releases media and writes pending edits.
  useEffect(
    () => () => {
      void flushAutosave()
      runtime.detach()
      useEditor.setState({ project: null, config: null, selection: null, playing: false, playMs: 0, past: [], future: [] })
    },
    [],
  )
  if (!project) return <div className="h-full app-surface" />
  return <EditorShell />
}

function EditorShell() {
  const autoExport = useQuery().get('autoExport') as 'file' | 'clipboard' | 'link' | null
  const [crop, setCrop] = useState(false)
  const [exporting, setExporting] = useState<false | 'file' | 'clipboard' | 'link'>(autoExport ?? false)
  // "Record & save" skips the save dialog exactly once; later exports always ask.
  const [autoPending, setAutoPending] = useState<'file' | 'clipboard' | null>(autoExport && autoExport !== 'link' ? autoExport : null)
  const previewMode = useEditor((s) => s.previewMode)
  // Until the user drags the divider, the timeline is as tall as its tracks (within reason), so nothing is chopped.
  const [timelineH, setTimelineH] = useState(() => Number(localStorage.getItem('studio.timelineH')) || 0)
  const [naturalH, setNaturalH] = useState(0)
  const tlH = timelineH || Math.min(Math.max(naturalH, 220), Math.round(window.innerHeight * 0.48))

  const [palette, setPalette] = useState<false | 'commands' | 'guide'>(false)
  const openers = useMemo(
    () => ({ exportTo: (t: 'file' | 'clipboard' | 'link') => setExporting(t), crop: () => setCrop(true), guide: () => setPalette('guide') }),
    [],
  )
  const commands = useCommands(openers)

  useAutosave()
  useShortcuts({ openExport: openers.exportTo, openCrop: openers.crop, openPalette: setPalette })
  usePreviewAudio()

  return (
    <div className="h-full flex flex-col app-surface">
      <TopBar onExport={() => setExporting('file')} />
      <div className="flex-1 min-h-0 flex">
        {!previewMode && <Inspector onCrop={() => setCrop(true)} />}
        <div className={cx('relative flex-1 min-w-0 flex flex-col overflow-hidden', previewMode ? 'p-2' : 'px-10 py-8')}>
          <Preview />
        </div>
      </div>
      {!previewMode && (
        <>
          <div
            className="h-1.5 -mb-1.5 z-10 cursor-row-resize hover:bg-fg/30 transition-colors"
            onPointerDown={(e) => {
              const startY = e.clientY
              const startH = tlH
              const move = (ev: PointerEvent) => {
                const h = Math.min(520, Math.max(150, startH - (ev.clientY - startY)))
                setTimelineH(h)
                localStorage.setItem('studio.timelineH', String(h))
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          />
          <div style={{ height: tlH }} className="shrink-0">
            <Timeline onNaturalHeight={setNaturalH} />
          </div>
        </>
      )}
      {crop && <CropModal onClose={() => setCrop(false)} />}
      {exporting && (
        <ExportDialog
          initialTarget={exporting}
          // Uploading leaves the machine, so link exports always wait for a click.
          autoStart={!!autoPending && exporting === autoPending}
          onClose={() => {
            setExporting(false)
            setAutoPending(null)
          }}
        />
      )}
      {palette === 'commands' && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {palette === 'guide' && <ShortcutsGuide commands={commands} onClose={() => setPalette(false)} />}
      <Toasts />
    </div>
  )
}

function TopBar({ onExport }: { onExport: () => void }) {
  const project = useEditor((s) => s.project)!
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const dirty = useEditor((s) => s.dirty)
  const previewMode = useEditor((s) => s.previewMode)
  const safeZones = useEditor((s) => s.safeZones)
  const [name, setName] = useState(project.file.name)

  return (
    <header className="drag h-[52px] shrink-0 flex items-center gap-2 pl-4 pr-3 border-b border-line-soft bg-panel hairline-top">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={async () => {
          if (name.trim() && name !== project.file.name) {
            await flushAutosave()
            const newPath = await api.renameProject(project.path, name.trim())
            // The package moved on disk; the main window reopens it at the new path.
            await api.openEditor(newPath)
          }
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Project name"
        className="no-drag h-7 px-2 rounded-[7px] bg-transparent hover:bg-white/6 focus:bg-black/30 outline-none text-[13.5px] font-semibold w-[280px] truncate"
      />
      <span className={cx('inline-flex items-center gap-1.5 text-[11.5px]', dirty ? 'text-muted' : 'text-faint')}>
        <span className={cx('size-1.5 rounded-full', dirty ? 'bg-caption' : 'bg-speed/80')} />
        {dirty ? 'Saving…' : 'Saved'}
      </span>
      <div className="flex-1" />
      <div className="no-drag flex items-center gap-1">
        <IconButton label="Undo (⌘Z)" disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
          <Undo2 className="size-4" />
        </IconButton>
        <IconButton label="Redo (⇧⌘Z)" disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
          <Redo2 className="size-4" />
        </IconButton>
        <IconButton label="Vertical video safe zones" active={safeZones !== 'none'} onClick={() => useEditor.setState({ safeZones: safeZones === 'none' ? 'tiktok' : 'none' })}>
          <Smartphone className="size-4" />
        </IconButton>
        <IconButton label="Preview mode (⇧⌘↩)" active={previewMode} onClick={() => useEditor.setState({ previewMode: !previewMode })}>
          <Eye className="size-4" />
        </IconButton>
        <PresetsMenu />
        <Button variant="primary" size="md" onClick={onExport} className="ml-1">
          <Upload className="size-4" /> Export
        </Button>
      </div>
    </header>
  )
}

function PresetsMenu() {
  const [presets, setPresets] = useState<Preset[]>([])
  const [naming, setNaming] = useState(false)
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const update = useEditor((s) => s.update)
  useEffect(() => {
    api.listPresets().then(setPresets)
    api.getSettings().then((s) => setDefaultId(s.general.defaultPresetId))
  }, [])
  // Presets describe a look, not this recording's crop.
  const current = () => {
    const s = useEditor.getState().config!.style
    return { ...s, output: { ...s.output, crop: { x: 0, y: 0, width: 1, height: 1 } } }
  }
  return (
    <Popover
      align="end"
      trigger={(_, toggle) => (
        <Button variant="secondary" onClick={toggle}>
          <Save className="size-4" /> Presets <ChevronDown className="size-3.5 text-muted" />
        </Button>
      )}
    >
      {(close) => (
        <div className="w-[260px]">
          {presets.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted">Save this project's look to reuse it on new recordings.</p>}
          {presets.map((p) => (
            <div key={p.id} className="group flex items-center">
              <MenuItem
                onClick={() => {
                  update((d) => {
                    const s = normalizeStyle(p.style)
                    d.style = { ...s, output: { ...s.output, crop: d.style.output.crop }, audio: { ...s.audio, music: d.style.audio.music } }
                  })
                  close()
                }}
              >
                <span className="flex-1 truncate">{p.name}</span>
              </MenuItem>
              <button
                className={cx('text-[11px] px-1.5', defaultId === p.id ? 'text-speed' : 'opacity-0 group-hover:opacity-100 text-muted hover:text-fg')}
                title="Apply to new recordings"
                onClick={() => {
                  const next = defaultId === p.id ? null : p.id
                  setDefaultId(next)
                  api.updateSettings({ general: { defaultPresetId: next } })
                }}
              >
                {defaultId === p.id ? 'Default' : 'Make default'}
              </button>
              <button
                className="opacity-0 group-hover:opacity-100 text-[11px] text-muted hover:text-fg px-1.5"
                title="Update with current settings"
                onClick={() => api.savePreset({ ...p, style: current() }).then(setPresets)}
              >
                Update
              </button>
              <button className="opacity-0 group-hover:opacity-100 text-[11px] text-muted hover:text-fg px-1.5" onClick={() => api.exportPreset(p)}>
                Share
              </button>
              <button className="opacity-0 group-hover:opacity-100 text-[11px] text-tally px-1.5" onClick={() => api.deletePreset(p.id).then(setPresets)}>
                Delete
              </button>
            </div>
          ))}
          <div className="h-px bg-line-soft my-1" />
          {naming ? (
            <input
              autoFocus
              placeholder="Preset name"
              className="w-full h-8 px-2.5 rounded-[6px] bg-black/30 outline-none text-[13px]"
              onKeyDown={async (e) => {
                if (e.key === 'Escape') setNaming(false)
                if (e.key !== 'Enter') return
                const name = (e.target as HTMLInputElement).value.trim()
                if (!name) return
                setPresets(await api.savePreset({ id: uid(), name, style: current(), createdAt: new Date().toISOString() }))
                setNaming(false)
              }}
            />
          ) : (
            <MenuItem onClick={() => setNaming(true)}>Save current look as preset…</MenuItem>
          )}
          <MenuItem onClick={() => api.importPreset().then(setPresets)}>Import preset…</MenuItem>
        </div>
      )}
    </Popover>
  )
}

function Toasts() {
  const items = useToasts((s) => s.items)
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto h-9 px-3.5 rounded-[11px] glass-float text-[13px] flex items-center gap-3 rise-in shadow-xl">
          {t.message}
          {t.action && (
            <button className="text-clip font-medium" onClick={t.action.run}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

let saveTimer: number | null = null

async function saveNow() {
  const st = useEditor.getState()
  if (!st.project || !st.config) return
  try {
    await api.writeProject(st.project.path, { ...st.project.file, config: st.config })
    rememberStyle(st.config.style)
    if (useEditor.getState().config === st.config) useEditor.setState({ dirty: false })
  } catch (err) {
    toast(`Couldn't save: ${(err as Error).message}`)
  }
}

/** Writes any pending edit immediately (before renaming or closing). */
export async function flushAutosave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  await saveNow()
}

/** Keeps preview playback in sync with the audio settings (music, mic preset, volumes). */
function usePreviewAudio() {
  const audio = useEditor((s) => s.config?.style.audio)
  const hasMic = useEditor((s) => !!s.project?.meta.tracks.mic)
  const preset = audio?.micPreset
  useEffect(() => {
    if (hasMic && preset) void runtime.prepareMicPreset(preset)
  }, [preset, hasMic])
  useEffect(() => {
    if (!audio) return
    runtime.playback?.setMusic(audio.music)
    const c = useEditor.getState().config
    if (c) runtime.playback?.applyVolumes(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio?.music, audio?.musicVolume, audio?.muteMusic, audio?.volume, audio?.muteMic, audio?.systemVolume, audio?.muteSystem])
}

/** Saves edits shortly after they happen and refreshes the library thumbnail. */
function useAutosave() {
  const thumbTimer = useRef<number | null>(null)
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (s.config === prev.config || !s.project || !s.config) return
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = window.setTimeout(() => void saveNow(), 600)
        if (thumbTimer.current) clearTimeout(thumbTimer.current)
        thumbTimer.current = window.setTimeout(() => void saveThumbnail(), 2500)
      }),
    [],
  )
  useEffect(() => {
    const t = setTimeout(() => void saveThumbnail(), 1500)
    return () => clearTimeout(t)
  }, [])
}

async function saveThumbnail() {
  const st = useEditor.getState()
  const scene = runtime.buildScene()
  const pb = runtime.playback
  if (!st.project || !scene || !pb) return
  const { width, height } = stageSize(scene.aspect, 360)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const bg = await runtime.background.get(scene.config.style.style.background, width, height)
  const c = new Compositor()
  c.cursorBitmap = runtime.compositor.cursorBitmap
  c.render(ctx, scene, scene.timeMap.toSource(st.playMs), { screen: pb.screen, camera: pb.camera }, {
    width,
    height,
    background: bg,
    cursorImage: c.cursorBitmap ?? (() => null),
    frameMs: 16,
    motionBlurSamples: 1,
  })
  try {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
    await api.saveThumbnail(st.project.path, new Uint8Array(await blob.arrayBuffer()))
  } catch {
    /* tainted or not ready */
  }
}

function useShortcuts({
  openExport,
  openCrop,
  openPalette,
}: {
  openExport: (t: 'file' | 'clipboard' | 'link') => void
  openCrop: () => void
  openPalette: (p: 'commands' | 'guide') => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      // Dialogs own the keyboard while they're open.
      if (document.querySelector('[data-modal]')) return
      const st = useEditor.getState()
      const meta = e.metaKey
      const k = e.key
      if (k === 'Alt') return useEditor.setState({ scissors: true })
      if (meta && /^[0-9]$/.test(k)) {
        const r = RAIL.find((x) => x.key === k)
        if (r) {
          e.preventDefault()
          st.select(null)
          st.set({ panel: r.id })
        }
        return
      }
      if (meta && k.toLowerCase() === 'k') return (e.preventDefault(), openPalette('commands'))
      if (meta && k === '/') return (e.preventDefault(), openPalette('guide'))
      if (meta && e.shiftKey && k.toLowerCase() === 'e') return (e.preventDefault(), openExport('file'))
      if (meta && e.altKey && e.code === 'KeyC') return (e.preventDefault(), openExport('clipboard'))
      if (meta && e.ctrlKey && e.code === 'KeyS') return (e.preventDefault(), openExport('link'))
      if (meta && e.shiftKey && k === 'Enter') return useEditor.setState({ previewMode: !st.previewMode })
      if (meta && k.toLowerCase() === 'd') return (e.preventDefault(), duplicateSelection())
      if (meta && k === 'ArrowLeft') return seekTo(0)
      if (meta && k === 'ArrowRight') return seekTo(Number.MAX_SAFE_INTEGER)
      if (meta) return
      switch (k) {
        case ' ':
          e.preventDefault()
          return void togglePlay()
        case 'ArrowLeft':
          e.preventDefault()
          return e.shiftKey ? seekBy(-2000) : st.playing ? seekBy(-1000) : stepFrame(-1)
        case 'ArrowRight':
          e.preventDefault()
          return e.shiftKey ? seekBy(2000) : st.playing ? seekBy(1000) : stepFrame(1)
        case 'Backspace':
        case 'Delete':
          return deleteSelection()
        case 'c':
        case 'C':
          return splitAtPlayhead()
        case 'x':
        case 'X':
          return rippleDelete()
        case 'z':
        case 'Z':
          return addZoomAtPlayhead()
        case '=':
        case '+':
          return setZoomLevel((l) => l + 0.2)
        case '-':
          return setZoomLevel((l) => l - 0.2)
        case 'Escape':
          if (st.previewMode) return useEditor.setState({ previewMode: false })
          return st.select(null)
        case 'r':
        case 'R':
          return openCrop()
      }
      if (st.selection?.kind === 'zoom' && /^[1-9]$/.test(k)) setZoomLevel(1 + (Number(k) - 1) * 0.2)
      if (k === 'k' || k === 'K') {
        runtime.playback?.pause()
        useEditor.setState({ playing: false })
      }
      if (k === 'l' || k === 'L') void togglePlay()
      if (k === 'j' || k === 'J') seekBy(-1000)
    }
    const onUp = (e: KeyboardEvent) => e.key === 'Alt' && useEditor.setState({ scissors: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    const offMenu = bridge.on('menu:command', (cmd) => {
      const st = useEditor.getState()
      if (cmd === 'undo') st.undo()
      else if (cmd === 'redo') st.redo()
      else if (cmd === 'export') openExport('file')
      else if (cmd === 'export-clipboard') openExport('clipboard')
      else if (cmd === 'play') void togglePlay()
      else if (cmd === 'split') splitAtPlayhead()
      else if (cmd === 'add-zoom') addZoomAtPlayhead()
      else if (cmd === 'delete') deleteSelection()
      else if (cmd === 'timeline-zoom-in') useEditor.setState({ pxPerSec: Math.min(600, st.pxPerSec * 1.4) })
      else if (cmd === 'timeline-zoom-out') useEditor.setState({ pxPerSec: Math.max(2, st.pxPerSec / 1.4) })
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
      offMenu()
    }
  }, [openExport, openCrop, openPalette])
}
