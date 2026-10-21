import { useEffect, useMemo, useState } from 'react'
import { Music, Play, Square, Trash2 } from 'lucide-react'
import { mediaUrl } from '@shared/media'
import { api } from '@/lib/bridge'
import { Button, Field, Section, Segmented, Slider, Toggle } from '@/ui/controls'
import { generateMusic, MUSIC_STYLES } from '@/lib/music'
import { playClickSound } from '@/lib/sounds'
import { typingRanges } from '@/render/keystrokes'
import { useEditor } from '../store'
import { PanelHeader, pct, useStyleSection } from './common'

let previewCtx: AudioContext | null = null
const previewContext = () => (previewCtx ??= new AudioContext())

export function AudioPanel() {
  const [a, set] = useStyleSection('audio')
  const project = useEditor((s) => s.project)
  const hasMic = !!project?.meta.tracks.mic
  const hasSystem = !!project?.meta.tracks.system
  const [busy, setBusy] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<HTMLAudioElement | null>(null)

  useEffect(() => () => previewing?.pause(), [previewing])

  const pickMusic = async () => {
    const [p] = await api.showOpenDialog({ filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'aac'] }] })
    if (!p || !project) return
    const copied = await api.copyIntoProject(project.path, p, 'assets')
    set((s) => void (s.music = copied))
  }

  const makeMusic = async (style: string) => {
    if (!project) return
    setBusy('Composing track…')
    try {
      const wav = await generateMusic(style, 32)
      const path = `${project.path}/assets/${style}-${Date.now()}.wav`
      const h = await api.fileOpen(path)
      await api.fileWrite(h, 0, new Uint8Array(wav))
      await api.fileClose(h)
      set((s) => void (s.music = path))
    } finally {
      setBusy(null)
    }
  }

  const togglePreview = () => {
    if (previewing) {
      previewing.pause()
      setPreviewing(null)
    } else if (a.music) {
      const el = new Audio(mediaUrl(a.music))
      el.volume = Math.min(1, a.musicVolume * 4)
      el.onended = () => setPreviewing(null)
      el.play()
      setPreviewing(el)
    }
  }

  return (
    <>
      <PanelHeader title="Audio">{busy && <span className="text-[11.5px] text-muted">{busy}</span>}</PanelHeader>
      <Section title="Microphone">
        {!hasMic ? (
          <p className="text-[12.5px] text-muted">No microphone was recorded.</p>
        ) : (
          <>
            <Toggle label="Mute microphone" checked={a.muteMic} onChange={(v) => set((s) => void (s.muteMic = v))} />
            <Slider label="Volume" value={a.volume} min={0} max={2} step={0.01} format={pct} onChange={(v) => set((s) => void (s.volume = v), 'vol')} />
            <Field label="Voice">
              <Segmented
                value={a.micPreset}
                onChange={(v) => set((s) => void (s.micPreset = v))}
                options={[
                  { value: 'original', label: 'Original', title: 'Untouched recording' },
                  { value: 'voice', label: 'Standard', title: 'Consistent volume, same character' },
                  { value: 'noise-reduction', label: 'Clean', title: 'Reduce background noise and hum' },
                  { value: 'podcast', label: 'Podcast', title: 'Gate, EQ and compression for a studio sound' },
                ]}
              />
            </Field>
          </>
        )}
      </Section>
      <Section title="System audio">
        {!hasSystem ? (
          <p className="text-[12.5px] text-muted">No system audio was recorded.</p>
        ) : (
          <>
            <Toggle label="Mute system audio" checked={a.muteSystem} onChange={(v) => set((s) => void (s.muteSystem = v))} />
            <Slider label="Volume" value={a.systemVolume} min={0} max={2} step={0.01} format={pct} onChange={(v) => set((s) => void (s.systemVolume = v), 'sys')} />
          </>
        )}
      </Section>
      <Section title="Background music">
        {a.music ? (
          <div className="flex items-center gap-2 rounded-[8px] bg-black/20 px-2.5 py-2">
            <Music className="size-4 text-muted shrink-0" />
            <span className="flex-1 truncate text-[12.5px]">{a.music.split('/').pop()}</span>
            <button className="text-muted hover:text-fg" onClick={togglePreview} aria-label="Preview">
              {previewing ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <button className="text-muted hover:text-tally" onClick={() => set((s) => void (s.music = null))} aria-label="Remove music">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">Generate an original loop or add your own track.</p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          {MUSIC_STYLES.map((m) => (
            <Button key={m.id} size="sm" onClick={() => makeMusic(m.id)} disabled={!!busy}>
              {m.label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={pickMusic}>
          Choose audio file…
        </Button>
        {a.music && (
          <>
            <Toggle label="Mute music" checked={a.muteMusic} onChange={(v) => set((s) => void (s.muteMusic = v))} />
            <Slider label="Volume" value={a.musicVolume} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((s) => void (s.musicVolume = v), 'music')} />
            <Toggle label="Fade in and out" checked={a.musicFade} onChange={(v) => set((s) => void (s.musicFade = v))} />
          </>
        )}
      </Section>
      <Section title="Click sounds">
        <Segmented
          value={a.clickSound}
          onChange={(v) => {
            set((s) => void (s.clickSound = v))
            if (v !== 'none') playClickSound(previewContext(), v, a.clickVolume)
          }}
          options={[
            { value: 'none', label: 'None' },
            { value: 'soft', label: 'Trackpad' },
            { value: 'mechanical', label: 'Mouse' },
          ]}
        />
        {a.clickSound !== 'none' && (
          <Slider label="Volume" value={a.clickVolume} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((s) => void (s.clickVolume = v), 'click')} />
        )}
      </Section>
    </>
  )
}

export function KeystrokesPanel() {
  const [k, set] = useStyleSection('keystrokes')
  const project = useEditor((s) => s.project)
  const labels = useMemo(() => {
    const out = new Map<string, number>()
    for (const key of project?.input.keys ?? []) {
      if (key.type !== 'down' || !key.key || key.isRepeat) continue
      const mods = key.modifiers.filter((m) => m !== 'fn')
      if (!mods.some((m) => m === 'cmd' || m === 'ctrl' || m === 'alt')) continue
      const sym: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' }
      const label = ['ctrl', 'alt', 'shift', 'cmd'].filter((m) => mods.includes(m)).map((m) => sym[m]).join('') + (key.key.length === 1 ? key.key.toUpperCase() : key.key)
      out.set(label, (out.get(label) ?? 0) + 1)
    }
    return [...out.entries()]
  }, [project])
  const typing = useMemo(() => typingRanges(project?.input.keys ?? []), [project])
  return (
    <>
      <PanelHeader title="Keyboard shortcuts" />
      <Section title="On-screen keys">
        <Toggle label="Show keyboard shortcuts" checked={k.enabled} onChange={(v) => set((s) => void (s.enabled = v))} />
        {k.enabled && (
          <>
            <Slider label="Size" value={k.size} min={0.075} max={0.25} step={0.005} format={pct} onChange={(v) => set((s) => void (s.size = v), 'size')} />
            <Toggle label="Show single keys" hint="Keys pressed without ⌘, ⌃ or ⌥." checked={k.showSingleKeys} onChange={(v) => set((s) => void (s.showSingleKeys = v))} />
            <Segmented
              value={k.theme}
              onChange={(v) => set((s) => void (s.theme = v))}
              options={[
                { value: 'dark', label: 'Dark keys' },
                { value: 'light', label: 'Light keys' },
              ]}
            />
          </>
        )}
      </Section>
      <Section title="Shortcuts in this recording">
        {labels.length === 0 && (
          <p className="text-[12.5px] text-muted">
            No shortcuts were captured. Allow Input Monitoring in Settings → Permissions to record them.
          </p>
        )}
        {labels.map(([label, count]) => (
          <Toggle
            key={label}
            label={
              <span>
                <span className="tabular">{label}</span> <span className="text-faint text-[11.5px]">×{count}</span>
              </span>
            }
            checked={!k.hidden.includes(label)}
            onChange={(v) => set((s) => void (s.hidden = v ? s.hidden.filter((x) => x !== label) : [...s.hidden, label]))}
          />
        ))}
        {typing.length > 0 && <p className="text-[12px] text-muted">{typing.length} typing section{typing.length > 1 ? 's' : ''} can be sped up — see the keyboard row in the timeline.</p>}
      </Section>
    </>
  )
}

export function DevicePanel() {
  const [d, set] = useStyleSection('device')
  const isDevice = useEditor((s) => s.project?.meta.source.type === 'device')
  return (
    <>
      <PanelHeader title="Device frame" />
      <Section title="Frame">
        {isDevice ? (
          <Toggle label="Show device frame" hint="Wraps your iPhone or iPad recording in a device bezel." checked={d.enableFrame} onChange={(v) => set((s) => void (s.enableFrame = v))} />
        ) : (
          <p className="text-[12.5px] text-muted">Device frames apply to iPhone and iPad recordings. Connect a device with a cable and choose iPhone in the recording bar.</p>
        )}
      </Section>
    </>
  )
}
