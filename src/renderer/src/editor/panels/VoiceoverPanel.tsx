import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { Mic, Sparkles, Square, Trash2, Wand2 } from 'lucide-react'
import { uid, type VoiceOver } from '@shared/project'
import { joinPath } from '@shared/media'
import { api } from '@/lib/bridge'
import { isAbortError } from '@/lib/ai-client'
import { getKokoro, kokoroVoices, speakWithKokoro, type KokoroVoice } from '@/lib/kokoro'
import { Button, Field, Section, Segmented, Select, Slider, Toggle } from '@/ui/controls'
import { runtime } from '../runtime'
import { useEditor } from '../store'
import { insertVoiceOver } from '../ops'
import { deleteSelection } from '../commands'
import { isCut } from '../transcript'
import { applyRevoice, fitSpeed, groupSentences, isRevoiceClip, type RevoiceClip } from '../revoice'
import { toast } from '../toast'
import { PanelHeader, pct } from './common'

const MAX_CHARS = 500

type Engine = 'natural' | 'macos'

/** Shown before the model has been loaded; replaced by the model's own list afterwards. */
const KNOWN_VOICES: KokoroVoice[] = [
  { id: 'af_heart', name: 'Heart', language: 'en-us', gender: 'Female', grade: 'A' },
  { id: 'af_bella', name: 'Bella', language: 'en-us', gender: 'Female', grade: 'A-' },
  { id: 'am_michael', name: 'Michael', language: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'bm_george', name: 'George', language: 'en-gb', gender: 'Male', grade: 'C' },
  { id: 'bf_emma', name: 'Emma', language: 'en-gb', gender: 'Female', grade: 'B-' },
]

const localeLabel = (lang: string) => {
  const [l, region] = lang.split(/[-_]/)
  return region ? `${l}-${region.toUpperCase()}` : l
}
// Not exported: a non-component export would stop React Fast Refresh from applying edits to this panel.
const voiceLabel = (v: KokoroVoice) => `${v.name} (${localeLabel(v.language)}, ${v.gender.toLowerCase()})`

interface VoiceSettings {
  engine: Engine
  kokoroVoice: string
  speed: number
  kokoroVoices: KokoroVoice[]
  set(p: Partial<Pick<VoiceSettings, 'engine' | 'kokoroVoice' | 'speed'>>): void
}

/** Voice choices shared by the writer and the re-voice tool; engine and voice persist across sessions. */
const useVoiceSettings = create<VoiceSettings>((set) => ({
  engine: localStorage.getItem('studio.voiceEngine') === 'macos' ? 'macos' : 'natural',
  kokoroVoice: localStorage.getItem('studio.kokoroVoice') ?? 'af_heart',
  speed: 1,
  kokoroVoices: KNOWN_VOICES,
  set(p) {
    set(p)
    if (p.engine) localStorage.setItem('studio.voiceEngine', p.engine)
    if (p.kokoroVoice) localStorage.setItem('studio.kokoroVoice', p.kokoroVoice)
  },
}))

function useVoices() {
  const [voices, setVoices] = useState<{ name: string; locale: string }[]>([])
  useEffect(() => {
    api.listVoices().then((v) => {
      const lang = navigator.language.replace('-', '_').slice(0, 2)
      // The user's language first, then everything else.
      setVoices([...v.filter((x) => x.locale.startsWith(lang)), ...v.filter((x) => !x.locale.startsWith(lang))])
    })
  }, [])
  return voices
}

/**
 * Synthesises with Kokoro (in the AI worker, so the editor stays responsive), loading the model
 * on first use. `onLoad` receives a label while the model downloads and null once it is ready,
 * so callers can restore their own status text.
 */
async function speak(text: string, voice: string, speed: number, onLoad: (label: string | null) => void, signal?: AbortSignal) {
  const clip = await speakWithKokoro(
    text,
    voice,
    speed,
    (f, phase) => {
      if (phase === 'ready') onLoad(null)
      else onLoad(f >= 1 ? 'Loading voice model…' : `Downloading voice model… ${Math.round(f * 100)}%`)
    },
    signal,
  )
  // The model is loaded now: swap the placeholder voice list for the full graded one.
  if (useVoiceSettings.getState().kokoroVoices === KNOWN_VOICES) {
    useVoiceSettings.setState({ kokoroVoices: kokoroVoices(await getKokoro()) })
  }
  return clip
}

async function writeFile(path: string, bytes: ArrayBuffer) {
  const h = await api.fileOpen(path)
  await api.fileWrite(h, 0, new Uint8Array(bytes))
  await api.fileClose(h)
}

function addAtPlayhead(file: string, duration: number, extra: Partial<VoiceOver>, atPlayMs?: number) {
  const st = useEditor.getState()
  const scene = runtime.buildScene()
  if (!scene) return
  let id = ''
  st.update((d) => {
    const vo = insertVoiceOver(d, {
      id: uid(),
      start: scene.timeMap.toSource(atPlayMs ?? st.playMs),
      duration,
      file,
      source: 'speech',
      volume: 1,
      attach: 'independent',
      muteOriginal: false,
      disabled: false,
      ...extra,
    })
    id = vo.id
  })
  st.select({ kind: 'voiceover', id })
}

function KokoroVoiceSelect() {
  const { kokoroVoice, kokoroVoices, set } = useVoiceSettings()
  const options = useMemo(() => {
    const list = kokoroVoices.map((v) => ({ value: v.id, label: voiceLabel(v) }))
    // Keep a stored voice selectable even if the loaded list grades it out.
    if (!list.some((o) => o.value === kokoroVoice)) list.unshift({ value: kokoroVoice, label: kokoroVoice })
    return list
  }, [kokoroVoices, kokoroVoice])
  return (
    <Field label="Voice">
      <Select value={kokoroVoice} onChange={(v) => set({ kokoroVoice: v })} options={options} />
    </Field>
  )
}

function Writer() {
  const project = useEditor((s) => s.project)!
  const macVoices = useVoices()
  const { engine, kokoroVoice, speed, set } = useVoiceSettings()
  const [text, setText] = useState('')
  const [voice, setVoice] = useState(() => localStorage.getItem('studio.voice') ?? '')
  const [rate, setRate] = useState(185)
  const [busy, setBusy] = useState<string | null>(null)
  const generate = async () => {
    if (!text.trim()) return
    setBusy('Generating…')
    try {
      if (engine === 'natural') {
        const clip = await speak(text, kokoroVoice, speed, (label) => setBusy(label ?? 'Generating…'))
        const path = joinPath(project.path, 'voiceovers', `kokoro-${Date.now()}.wav`)
        await writeFile(path, clip.wav)
        addAtPlayhead(path, clip.durationMs, { source: 'speech', text, voice: `kokoro:${kokoroVoice}` })
      } else {
        localStorage.setItem('studio.voice', voice)
        const { path, duration } = await api.synthesizeSpeech(text, voice, rate, joinPath(project.path, 'voiceovers'))
        addAtPlayhead(path, duration, { source: 'speech', text, voice })
      }
      setText('')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        maxLength={MAX_CHARS}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="What should the voiceover say?"
        className="w-full rounded-[8px] bg-black/25 border border-line-soft p-2.5 text-[13px] outline-none focus:border-line resize-none"
      />
      <span className="text-[11px] text-faint -mt-2 text-right tabular">
        {text.length}/{MAX_CHARS}
      </span>
      <Field label="Engine">
        <Segmented
          value={engine}
          onChange={(v) => set({ engine: v })}
          options={[
            { value: 'natural', label: 'Natural', title: 'Kokoro, an open voice model that runs on your Mac' },
            { value: 'macos', label: 'macOS', title: 'The voices built into macOS' },
          ]}
        />
      </Field>
      {engine === 'natural' ? (
        <>
          <KokoroVoiceSelect />
          <Slider label="Speed" value={speed} min={0.7} max={1.3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ speed: v })} />
        </>
      ) : (
        <>
          <Field label="Voice">
            <Select value={voice} onChange={setVoice} options={[{ value: '', label: 'System default' }, ...macVoices.map((v) => ({ value: v.name, label: `${v.name} (${v.locale.replace('_', '-')})` }))]} />
          </Field>
          <Slider label="Pace" value={rate} min={120} max={280} step={5} format={(v) => `${v} wpm`} onChange={setRate} />
        </>
      )}
      <Button variant="primary" onClick={generate} disabled={!!busy || !text.trim()}>
        <Sparkles className="size-4" /> {busy ?? 'Add at playhead'}
      </Button>
      {engine === 'natural' ? (
        <p className="text-[11.5px] text-faint">Kokoro runs on your Mac; the first use downloads about 90 MB. Nothing is uploaded.</p>
      ) : (
        <p className="text-[11.5px] text-faint">Uses the voices built into macOS; nothing leaves your Mac. Download more voices in System Settings → Accessibility → Spoken Content.</p>
      )}
    </div>
  )
}

/** A re-voice keeps running if the panel is switched away, so its state lives outside the component. */
const useRevoiceRun = create<{ progress: string | null; controller: AbortController | null }>(() => ({ progress: null, controller: null }))

async function revoiceNarration() {
  const st = useEditor.getState()
  const { project, config } = st
  if (!project || !config?.transcript) return
  const { kokoroVoice, kokoroVoices } = useVoiceSettings.getState()
  const map = runtime.buildScene()?.timeMap
  // Words already cut from the video would only be muted again; leave them out.
  const sentences = groupSentences(config.transcript.words, (w) => !!map && isCut(w.start, w.end, map))
  if (!sentences.length) return toast('There is no narration to re-voice')

  const controller = new AbortController()
  useRevoiceRun.setState({ controller, progress: 'Preparing…' })
  const clips: RevoiceClip[] = []
  const stamp = Date.now()
  try {
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i]
      const label = `Re-voicing ${i + 1} of ${sentences.length}…`
      useRevoiceRun.setState({ progress: label })
      const onLoad = (l: string | null) => useRevoiceRun.setState({ progress: l ?? label })
      // Cancelling rejects the clip in flight; the worker drops its result.
      let clip = await speak(s.text, kokoroVoice, 1, onLoad, controller.signal)
      // Spoken too slowly for the gap it fills: try once more, a little faster.
      const faster = fitSpeed(clip.durationMs, s.end - s.start)
      if (faster) clip = await speak(s.text, kokoroVoice, faster, onLoad, controller.signal)
      const file = joinPath(project.path, 'voiceovers', `kokoro-${stamp}-${String(i + 1).padStart(2, '0')}.wav`)
      await writeFile(file, clip.wav)
      clips.push({ sentence: s, file, durationMs: clip.durationMs })
    }
    useEditor.getState().update((d) => applyRevoice(d, clips, `kokoro:${kokoroVoice}`, true))
    const name = kokoroVoices.find((v) => v.id === kokoroVoice)?.name ?? kokoroVoice
    toast(`Narration replaced with ${name}. Your microphone track is muted.`)
  } catch (e) {
    // A cancelled run leaves the project as it was; only a complete one replaces the narration.
    toast(isAbortError(e) ? 'Re-voicing cancelled' : (e as Error).message)
  } finally {
    useRevoiceRun.setState({ controller: null, progress: null })
  }
}

function Revoice() {
  const hasTranscript = useEditor((s) => !!s.config?.transcript)
  const previous = useEditor((s) => s.config!.timeline.voiceOvers.some(isRevoiceClip))
  const { progress, controller } = useRevoiceRun()
  const { engine } = useVoiceSettings()
  if (!hasTranscript) {
    return (
      <Section title="Re-voice my narration">
        <p className="text-[12.5px] text-muted">Generate a transcript first (Words panel) to re-voice your narration.</p>
      </Section>
    )
  }
  return (
    <Section title="Re-voice my narration">
      <p className="text-[12.5px] text-muted">Reads your transcript sentence by sentence in a natural voice, timed to your original narration, and mutes your microphone.</p>
      {engine === 'natural' ? (
        <p className="text-[11.5px] text-faint -mt-2">Uses the voice selected above.</p>
      ) : (
        <KokoroVoiceSelect />
      )}
      {progress ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-muted tabular">{progress}</span>
          <Button size="sm" variant="ghost" onClick={() => controller?.abort()}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="primary" onClick={revoiceNarration}>
          <Wand2 className="size-4" /> {previous ? 'Replace my narration again' : 'Replace my narration with this voice'}
        </Button>
      )}
      {previous && !progress && <p className="text-[11.5px] text-faint">Running again replaces the voiceovers from the last re-voice.</p>}
    </Section>
  )
}

function Recorder() {
  const project = useEditor((s) => s.project)!
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; started: number; playMs: number } | null>(null)
  // Switching panels mid-take must not leave the microphone open.
  useEffect(
    () => () => {
      const r = rec.current
      if (!r) return
      try {
        r.mr.stop()
      } catch {
        /* already stopped */
      }
      r.stream.getTracks().forEach((t) => t.stop())
      rec.current = null
    },
    [],
  )

  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => rec.current && setElapsed((Date.now() - rec.current.started) / 1000), 200)
    return () => clearInterval(t)
  }, [recording])

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.current = { mr, chunks, stream, started: Date.now(), playMs: useEditor.getState().playMs }
      mr.start(250)
      setRecording(true)
      void togglePreview(true)
    } catch {
      toast('Allow microphone access in System Settings to record a voiceover')
    }
  }

  const stop = async () => {
    const r = rec.current
    if (!r) return
    await new Promise<void>((res) => {
      r.mr.onstop = () => res()
      r.mr.stop()
    })
    r.stream.getTracks().forEach((t) => t.stop())
    setRecording(false)
    void togglePreview(false)
    const blob = new Blob(r.chunks, { type: 'audio/webm' })
    const path = joinPath(project.path, 'voiceovers', `recording-${Date.now()}.webm`)
    await writeFile(path, await blob.arrayBuffer())
    const duration = Date.now() - r.started
    addAtPlayhead(path, duration, { source: 'recording', muteOriginal: true }, r.playMs)
    rec.current = null
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-muted">Records from the playhead while the video plays, so you can narrate along with it.</p>
      {recording ? (
        <Button variant="record" onClick={stop}>
          <Square className="size-3.5 fill-white" /> Stop · {elapsed.toFixed(1)}s
        </Button>
      ) : (
        <Button variant="record" onClick={start}>
          <Mic className="size-4" /> Record voiceover
        </Button>
      )}
    </div>
  )
}

async function togglePreview(play: boolean) {
  const st = useEditor.getState()
  if (play !== st.playing) {
    const { togglePlay } = await import('../commands')
    await togglePlay()
  }
}

export function VoiceoverPanel() {
  const selection = useEditor((s) => s.selection)
  const voiceOvers = useEditor((s) => s.config!.timeline.voiceOvers)
  const update = useEditor((s) => s.update)
  const selected = useMemo(() => (selection?.kind === 'voiceover' ? voiceOvers.find((v) => v.id === selection.id) : null), [selection, voiceOvers])
  const [mode, setMode] = useState<'write' | 'record'>('write')
  const set = (fn: (v: VoiceOver) => void, key?: string) =>
    update((d) => {
      const v = d.timeline.voiceOvers.find((x) => x.id === selected?.id)
      if (v) fn(v)
    }, key)

  if (selected) {
    return (
      <>
        <PanelHeader title="Voiceover" />
        <Section title={selected.source === 'speech' ? 'Generated voiceover' : 'Recorded voiceover'}>
          {selected.text && <p className="text-[12.5px] text-muted italic">“{selected.text}”</p>}
          <Slider label="Volume" value={selected.volume} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((x) => void (x.volume = v), 'vo-vol')} />
          <Field label="Attach to recording">
            <Segmented
              value={selected.attach}
              onChange={(v) => set((x) => void ((x.attach = v), (x.end = x.start + x.duration)))}
              options={[
                { value: 'independent', label: 'Independent', title: 'Plays at normal speed, ignoring cuts' },
                { value: 'synced', label: 'Synchronized', title: 'Follows cuts and speed changes' },
              ]}
            />
          </Field>
          <Toggle label="Mute original audio" hint="Silence your microphone while this plays." checked={selected.muteOriginal} onChange={(v) => set((x) => void (x.muteOriginal = v))} />
          <Toggle label="Disable" checked={selected.disabled} onChange={(v) => set((x) => void (x.disabled = v))} />
        </Section>
        <div className="px-4 py-3">
          <Button size="sm" variant="danger" onClick={() => deleteSelection()}>
            <Trash2 className="size-3.5" /> Remove voiceover
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <PanelHeader title="Voiceover" />
      <Section title="Add voiceover">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'write', label: 'Write' },
            { value: 'record', label: 'Record' },
          ]}
        />
        {mode === 'write' ? <Writer /> : <Recorder />}
      </Section>
      <Revoice />
      {voiceOvers.length > 0 && (
        <Section title="In this project">
          {voiceOvers.map((v) => (
            <button
              key={v.id}
              onClick={() => useEditor.getState().select({ kind: 'voiceover', id: v.id })}
              className="text-left text-[12.5px] px-2.5 py-2 rounded-[7px] bg-white/4 hover:bg-white/8 truncate"
            >
              {v.text ?? 'Recorded voiceover'} <span className="text-faint">· {(v.duration / 1000).toFixed(1)}s</span>
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => update((d) => void (d.timeline.voiceOvers = []))}>
            Remove all voiceovers
          </Button>
        </Section>
      )}
    </>
  )
}
