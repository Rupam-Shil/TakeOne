import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, FileVideo, Image as ImageIcon, Link2, Loader2, X } from 'lucide-react'
import type { AppSettings } from '@shared/settings'
import { api, bridge, useSettings } from '@/lib/bridge'
import { Button, Field, Segmented, Select, Toggle, cx } from '@/ui/controls'
import { useEscape } from '@/ui/useEscape'
import { estimateSize, exportDimensions, exportFrame, exportProject, type ExportOptions, type ExportProgress } from '@/export/exporter'
import { TimeMap } from '@/render/timemap'
import { useEditor } from './store'
import { pausePlayback } from './commands'
import { toast } from './toast'

type Target = AppSettings['export']['target']

const MP4_FPS = [60, 50, 30, 25, 24, 20, 10]
const GIF_FPS = [50, 30, 25, 20, 15, 10]
const QUALITY: { value: AppSettings['export']['quality']; label: string; hint: string }[] = [
  { value: 'studio', label: 'Studio', hint: 'Highest quality, best for further editing. Large files.' },
  { value: 'social-media', label: 'Social media', hint: 'Great quality; platforms may compress it further.' },
  { value: 'web-high', label: 'Web (high)', hint: 'Good for playing directly on websites. Compression slightly visible.' },
  { value: 'web-low', label: 'Web (low)', hint: 'Smallest files when quality matters less.' },
]
const CODEC_LABEL: Record<AppSettings['export']['codec'], string> = { h264: 'H.264', h265: 'HEVC', av1: 'AV1', both: 'H.264 + HEVC' }

const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
const fmtEta = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.max(1, Math.round(s))}s`)
const safeName = (name: string) => name.replace(/[/:]/g, '-')

/** Copies the live preview canvas so the sheet shows exactly what will be exported. */
function FramePreview({ aspect }: { aspect: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const src = document.querySelector<HTMLCanvasElement>('[data-preview-canvas]')
    const c = ref.current
    if (!src || !c) return
    const g = c.getContext('2d')
    if (!g) return
    c.width = 640
    c.height = Math.round(640 / aspect)
    try {
      g.drawImage(src, 0, 0, c.width, c.height)
    } catch {
      /* preview not ready */
    }
  }, [aspect])
  return <canvas ref={ref} className="w-full rounded-[10px] shadow-[0_20px_50px_-20px_#000,0_0_0_1px_#ffffff14]" style={{ aspectRatio: aspect }} />
}

export function ExportDialog({ onClose, initialTarget, autoStart }: { onClose: () => void; initialTarget?: Target; autoStart?: boolean }) {
  const [settings, updateSettings] = useSettings()
  const project = useEditor((s) => s.project)!
  const config = useEditor((s) => s.config)!
  const playMs = useEditor((s) => s.playMs)
  const [target, setTarget] = useState<Target>(initialTarget ?? 'file')
  const [title, setTitle] = useState(project.file.name)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [done, setDone] = useState<{ path?: string; url?: string; extra?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEscape(onClose, !progress)

  useEffect(() => {
    if (initialTarget) setTarget(initialTarget)
  }, [initialTarget])

  useEffect(() => bridge.on('share:progress', (p) => setProgress({ phase: 'finishing', progress: 0.9 + p.progress * 0.1 })), [])

  const e = settings?.export
  const isGif = e?.format === 'gif' && target !== 'link'
  const height = target === 'link' ? 1080 : isGif ? (e?.gifHeight ?? 480) : (e?.height ?? 1080)
  const fps = target === 'link' ? 60 : isGif ? (e?.gifFps ?? 15) : (e?.fps ?? 60)
  const dims = useMemo(() => exportDimensions(project, config, height), [project, config, height])
  const durationSec = useMemo(() => {
    const slices = config.timeline.slices
    return slices.reduce((t, s) => t + (s.end - s.start) / s.speed, 0) / 1000
  }, [config.timeline.slices])
  if (!settings || !e) return null

  const codecSetting: AppSettings['export']['codec'] = target === 'link' ? 'h264' : e.codec
  const opts: ExportOptions = {
    format: isGif ? 'gif' : 'mp4',
    fps,
    height,
    quality: target === 'link' ? 'social-media' : isGif ? (e.gifHighQuality ? 'studio' : 'social-media') : e.quality,
    codec: codecSetting === 'both' || codecSetting === 'h264' ? 'h264' : codecSetting,
    gifLoop: e.gifLoop,
    gifHighQuality: e.gifHighQuality,
  }
  const size = estimateSize(opts, dims.width, dims.height, durationSec)
  const set = (patch: Partial<AppSettings['export']>) => updateSettings({ export: patch })
  const linkReady = settings.share.endpoint && settings.share.token
  const summary = isGif
    ? ['GIF', `${height}p`, `${fps} fps`, e.gifHighQuality ? '256 colors' : '128 colors']
    : ['MP4', CODEC_LABEL[codecSetting], height === 2160 ? '4K' : `${height}p`, `${fps} fps`, QUALITY.find((q) => q.value === opts.quality)?.label ?? '']

  const start = async () => {
    pausePlayback()
    setError(null)
    setDone(null)
    setConfirmStop(false)
    const ext = isGif ? 'gif' : 'mp4'
    let out: string | null
    if (target === 'file' && autoStart && !done) {
      // "Record & save": no dialog, straight into the export folder.
      out = `${settings.general.exportDir}/${safeName(project.file.name)}.${ext}`
    } else if (target === 'file') {
      out = await api.showSaveDialog({
        title: 'Save export',
        defaultPath: `${settings.general.exportDir}/${safeName(project.file.name)}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      })
      if (!out) return
    } else {
      out = await api.tempPath(`${target === 'clipboard' ? 'Clipboard' : 'Share'}-${Date.now()}.${ext}`)
    }
    abort.current = new AbortController()
    setProgress({ phase: 'preparing', progress: 0 })
    let lastDock = -1
    const onProgress = (p: ExportProgress) => {
      setProgress(p)
      if (Math.abs(p.progress - lastDock) >= 0.01) {
        lastDock = p.progress
        void api.setProgress(p.progress)
      }
    }
    try {
      await exportProject(project, config, opts, out, onProgress, abort.current.signal)
      let extra: string | undefined
      if (codecSetting === 'both' && target === 'file' && !isGif) {
        // Second pass with HEVC next to the H.264 file.
        extra = out.replace(/\.mp4$/i, '') + ' (HEVC).mp4'
        await exportProject(project, config, { ...opts, codec: 'h265' }, extra, onProgress, abort.current.signal)
      }
      if (target === 'clipboard') {
        await api.copyFileToClipboard(out)
        setDone({ path: out })
        toast('Exported video copied to clipboard. Paste it in any app that accepts files.')
      } else if (target === 'link') {
        const { url } = await api.shareUpload(out, { title, endpoint: settings.share.endpoint, token: settings.share.token, visibility: settings.share.visibility })
        setDone({ url })
        navigator.clipboard.writeText(url).catch(() => {})
        toast('Shareable link copied to clipboard')
      } else {
        setDone({ path: out, extra })
        void api.recordExport(out, project.file.name)
        if (extra) void api.recordExport(extra, project.file.name)
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') toast('Export stopped')
      else setError((err as Error).message)
    } finally {
      setProgress(null)
      abort.current = null
      void api.setProgress(-1)
    }
  }

  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStart && settings && !autoStarted.current && !progress) {
      autoStarted.current = true
      void start()
    }
  })

  const saveFrame = async () => {
    const out = await api.showSaveDialog({ defaultPath: `${settings.general.exportDir}/${safeName(project.file.name)}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] })
    if (!out) return
    const cfg = useEditor.getState().config!
    const blob = await exportFrame(project, cfg, new TimeMap(cfg.timeline.slices).toSource(playMs))
    const h = await api.fileOpen(out)
    await api.fileWrite(h, 0, new Uint8Array(await blob.arrayBuffer()))
    await api.fileClose(h)
    toast('Frame saved')
    api.revealInFinder(out)
  }

  const phaseLabel =
    progress?.phase === 'preparing'
      ? 'Preparing export…'
      : progress?.phase === 'audio'
        ? 'Mixing audio…'
        : progress?.phase === 'rendering'
          ? 'Rendering video…'
          : progress?.phase === 'gif'
            ? 'Building GIF…'
            : target === 'link'
              ? 'Uploading video…'
              : 'Finishing…'

  return (
    <div data-modal className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px] flex items-center justify-center p-8" onMouseDown={() => !progress && onClose()}>
      <div className="w-[760px] max-w-full rounded-[20px] glass-float overflow-hidden rise-in flex" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="w-[320px] shrink-0 p-5 bg-black/20 flex flex-col gap-4 border-r border-line-soft">
          <FramePreview aspect={dims.width / dims.height} />
          <div className="flex flex-wrap gap-1.5">
            {summary.filter(Boolean).map((s) => (
              <span key={s} className="h-6 px-2 rounded-full bg-white/7 border border-white/8 text-[11.5px] font-semibold text-muted inline-flex items-center">
                {s}
              </span>
            ))}
          </div>
          <div className="text-[12px] text-muted tabular flex justify-between">
            <span>
              {dims.width} × {dims.height}
            </span>
            <span>about {fmtBytes(size)}</span>
          </div>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={saveFrame} className="self-start" title="Save the current frame as a PNG">
            <ImageIcon className="size-3.5" /> Save this frame as PNG…
          </Button>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="flex items-center justify-between h-14 px-5 border-b border-line-soft">
            <h2 className="text-[16px] font-semibold">Export</h2>
            {!progress && (
              <button onClick={onClose} className="size-7 rounded-full inline-flex items-center justify-center text-muted hover:text-fg hover:bg-white/8" aria-label="Close">
                <X className="size-4" />
              </button>
            )}
          </header>

          {progress ? (
            <div className="p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                <Loader2 className="size-4 animate-spin text-fg" />
                {phaseLabel}
              </div>
              <div className="h-2 rounded-full bg-control overflow-hidden">
                <div className="h-full bg-fg transition-[width] duration-200" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
              </div>
              <div className="flex justify-between text-[12px] text-muted tabular">
                <span>{Math.round(progress.progress * 100)}%</span>
                {progress.etaSec !== undefined && <span>{fmtEta(progress.etaSec)} left</span>}
              </div>
              {confirmStop ? (
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-muted">Stop this export?</span>
                  <Button variant="danger" size="sm" onClick={() => abort.current?.abort()}>
                    Stop export
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmStop(false)}>
                    Keep going
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmStop(true)} className="self-start">
                  Stop export…
                </Button>
              )}
            </div>
          ) : done ? (
            <div className="p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-[14px] font-semibold">
                <span className="size-6 rounded-full bg-speed/20 text-speed inline-flex items-center justify-center">
                  <Check className="size-3.5" />
                </span>
                Exported
              </div>
              {done.url && (
                <div className="flex gap-2">
                  <input readOnly value={done.url} aria-label="Shareable link" className="flex-1 h-8 px-2.5 rounded-[9px] bg-black/30 text-[12px]" />
                  <Button size="sm" onClick={() => navigator.clipboard.writeText(done.url!)}>
                    Copy
                  </Button>
                </div>
              )}
              {done.extra && <p className="text-[12px] text-muted">The HEVC version was saved next to it.</p>}
              <div className="flex gap-2">
                {done.path && target === 'file' && <Button onClick={() => api.revealInFinder(done.path!)}>Show in Finder</Button>}
                {done.url && <Button onClick={() => api.openExternal(done.url!)}>Open link</Button>}
                <Button variant="ghost" onClick={() => setDone(null)}>
                  Export again
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-5 flex flex-col gap-4">
              <Segmented
                value={target}
                onChange={setTarget}
                options={[
                  { value: 'file', label: <><FileVideo className="size-3.5" /> File</> },
                  { value: 'clipboard', label: <><Clipboard className="size-3.5" /> Clipboard</> },
                  { value: 'link', label: <><Link2 className="size-3.5" /> Shareable link</> },
                ]}
              />
              {target === 'link' ? (
                <>
                  <Field label="Video title">
                    <input value={title} onChange={(ev) => setTitle(ev.target.value)} className="h-8 px-2.5 rounded-[9px] bg-control text-[13px] outline-none focus:ring-1 focus:ring-fg/40" />
                  </Field>
                  <Toggle
                    label="Private link"
                    hint="Only people with the link can watch. Also becomes the default for new links."
                    checked={settings.share.visibility === 'private'}
                    onChange={(v) => updateSettings({ share: { visibility: v ? 'private' : 'public' } })}
                  />
                  <p className="text-[12px] text-muted">Shareable links are always exported as 1080p at 60 fps.</p>
                  {!linkReady && <p className="text-[12px] text-caption">Add your share server address and token in Settings → Sharing first.</p>}
                </>
              ) : (
                <>
                  <Field label="Format">
                    <Segmented
                      value={e.format}
                      onChange={(v) => set({ format: v })}
                      options={[
                        { value: 'mp4', label: 'MP4' },
                        { value: 'gif', label: 'GIF' },
                      ]}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Frame rate">
                      <Select
                        label="Frame rate"
                        value={String(fps)}
                        onChange={(v) => set(isGif ? { gifFps: Number(v) } : { fps: Number(v) })}
                        options={(isGif ? GIF_FPS : MP4_FPS).map((f) => ({ value: String(f), label: `${f} fps` }))}
                      />
                    </Field>
                    <Field label="Resolution">
                      <Select
                        label="Resolution"
                        value={String(height)}
                        onChange={(v) => set(isGif ? { gifHeight: Number(v) } : { height: Number(v) })}
                        options={(isGif ? [480, 720, 1080] : [720, 1080, 1440, 2160])
                          .filter((h) => isGif || h <= 1080 || !e.quality.startsWith('web'))
                          .map((h) => ({ value: String(h), label: h === 2160 ? '4K' : `${h}p` }))}
                      />
                    </Field>
                  </div>
                  {isGif ? (
                    <>
                      <Toggle label="High quality" hint="Optimized 256-color palette; slower export." checked={e.gifHighQuality} onChange={(v) => set({ gifHighQuality: v })} />
                      <Toggle label="Loop" checked={e.gifLoop} onChange={(v) => set({ gifLoop: v })} />
                      {height >= 1080 && <p className="text-[12px] text-caption">1080p GIFs produce very large files. MP4 is usually a better choice.</p>}
                    </>
                  ) : (
                    <>
                      <Field label="Quality">
                        <div className="grid grid-cols-2 gap-1.5">
                          {QUALITY.map((q) => (
                            <button
                              key={q.value}
                              title={q.hint}
                              onClick={() => set({ quality: q.value, ...(q.value.startsWith('web') && e.height > 1080 ? { height: 1080 } : {}) })}
                              className={cx(
                                'h-8 rounded-[9px] text-[12px] font-semibold transition-colors',
                                e.quality === q.value ? 'bg-fg text-on-fg' : 'btn-soft',
                              )}
                            >
                              {q.label}
                            </button>
                          ))}
                        </div>
                        <span className="text-[11.5px] text-faint">{QUALITY.find((q) => q.value === e.quality)?.hint}</span>
                      </Field>
                      <Field label="Codec">
                        <Segmented
                          value={e.codec}
                          onChange={(v) => set({ codec: v })}
                          options={[
                            { value: 'h264', label: 'H.264', title: 'Plays everywhere' },
                            { value: 'h265', label: 'HEVC', title: 'Smaller files; most modern players' },
                            { value: 'av1', label: 'AV1', title: 'Smallest files; newest players and browsers' },
                            { value: 'both', label: 'Both', title: 'H.264 and HEVC files side by side' },
                          ]}
                        />
                      </Field>
                    </>
                  )}
                </>
              )}
              {error && <p className="text-[12px] text-tally">{error}</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="primary" size="lg" className="flex-1" onClick={start} disabled={target === 'link' && !linkReady}>
                  {target === 'file' ? 'Export to file…' : target === 'clipboard' ? 'Export to clipboard' : 'Export and copy link'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
