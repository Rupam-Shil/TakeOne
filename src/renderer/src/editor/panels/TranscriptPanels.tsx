import { useEffect, useMemo, useState } from 'react'
import { Download, EyeOff, RotateCcw, Scissors, Sparkles, Timer, Wand2 } from 'lucide-react'
import type { TranscriptWord } from '@shared/project'
import { api, bridge } from '@/lib/bridge'
import { WHISPER_SIZES, type WhisperSize } from '@/lib/ai-models'
import { transcribeWithWhisper } from '@/lib/whisper'
import { Button, ColorInput, Field, Section, Segmented, Select, Slider, Toggle, cx } from '@/ui/controls'
import { toSrt, toVtt, buildCaptionLines } from '@/render/captions'
import { trackPath } from '../loader'
import { useEditor } from '../store'
import { useScene } from '../runtime'
import { seekTo } from '../commands'
import { toast } from '../toast'
import { buildTokens, deleteWords, fillerIndices, fillerTier, isCut, restoreRange, setHidden, tightenPauses } from '../transcript'
import { PanelHeader, pct, useStyleSection } from './common'

type TranscriptEngine = 'apple' | 'whisper'

/** Languages offered for Whisper (it recognises many more; these cover most recordings). */
const WHISPER_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'uk', 'ru', 'tr', 'ar', 'he', 'hi', 'id', 'vi', 'th', 'ja', 'ko', 'zh']

const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** Turns Whisper's second-based words into transcript words on the source timeline. */
function toTranscriptWords(words: { text: string; start: number; end: number }[], offsetMs: number): TranscriptWord[] {
  return words.map((w, i) => {
    const text = w.text
    const sound = /^[[(].*[\])]$/.test(text)
    return { index: i, text, start: Math.round(w.start * 1000 + offsetMs), end: Math.round(w.end * 1000 + offsetMs), type: sound ? 'sound-label' : 'word' }
  })
}

function useTranscription() {
  const project = useEditor((s) => s.project)
  const update = useEditor((s) => s.update)
  const [locales, setLocales] = useState<{ supported: string[]; installed: string[]; available: boolean } | null>(null)
  const [locale, setLocale] = useState(() => localStorage.getItem('studio.locale') ?? 'en-US')
  const [engine, setEngineState] = useState<TranscriptEngine>(() => (localStorage.getItem('studio.transcriptEngine') === 'whisper' ? 'whisper' : 'apple'))
  const [whisperSize, setWhisperSizeState] = useState<WhisperSize>(() => (localStorage.getItem('studio.whisperSize') === 'small' ? 'small' : 'base'))
  // Whisper takes a bare language code ("en") or auto-detects; it starts from the Apple locale.
  const [whisperLang, setWhisperLangState] = useState(() => localStorage.getItem('studio.whisperLang') ?? (localStorage.getItem('studio.locale') ?? 'en-US').split(/[-_]/)[0].toLowerCase())
  const [progress, setProgress] = useState<{ p: number; phase: string } | null>(null)

  useEffect(() => {
    api.transcriptionLocales().then(setLocales).catch(() => setLocales({ supported: [], installed: [], available: false }))
    return bridge.on('transcribe:progress', (e) => setProgress({ p: e.progress, phase: e.phase }))
  }, [])

  const appleAvailable = !!locales?.available
  const activeEngine: TranscriptEngine = appleAvailable ? engine : 'whisper'
  const setEngine = (e: TranscriptEngine) => {
    localStorage.setItem('studio.transcriptEngine', e)
    setEngineState(e)
  }
  const setWhisperSize = (s: WhisperSize) => {
    localStorage.setItem('studio.whisperSize', s)
    setWhisperSizeState(s)
  }
  const setWhisperLang = (l: string) => {
    localStorage.setItem('studio.whisperLang', l)
    setWhisperLangState(l)
  }

  const run = async () => {
    if (!project) return
    const source = trackPath(project, 'mic') ? 'mic' : 'system'
    const path = trackPath(project, source)
    if (!path) return toast('This recording has no audio to transcribe')
    const offset = (project.meta.tracks[source]?.offset ?? 0) * 1000
    setProgress({ p: 0, phase: activeEngine === 'whisper' ? 'download' : 'transcribe' })
    try {
      let list: TranscriptWord[]
      let language: string
      let model: string
      if (activeEngine === 'whisper') {
        language = whisperLang
        model = `whisper-${whisperSize}`
        const words = await transcribeWithWhisper(path, whisperSize, whisperLang === 'auto' ? null : whisperLang, (p, phase) => setProgress({ p, phase }))
        list = toTranscriptWords(words, offset)
      } else {
        localStorage.setItem('studio.locale', locale)
        language = locale
        model = 'apple-on-device'
        list = toTranscriptWords(await api.transcribe(path, locale), offset)
      }
      update((d) => {
        d.transcript = { language, model, words: list, createdAt: new Date().toISOString() }
        d.style.captions.enabled = true
      })
      toast(`Transcribed ${list.length} words`)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setProgress(null)
    }
  }
  return { locales, locale, setLocale, appleAvailable, engine: activeEngine, setEngine, whisperSize, setWhisperSize, whisperLang, setWhisperLang, progress, run }
}

function Generate({ compact }: { compact?: boolean }) {
  const t = useTranscription()
  const has = useEditor((s) => !!s.config?.transcript)
  const whisper = t.engine === 'whisper'
  const whisperLanguages = useMemo(() => {
    const codes = new Set(WHISPER_LANGUAGES)
    for (const l of t.locales?.supported ?? []) codes.add(l.split(/[-_]/)[0].toLowerCase())
    if (t.whisperLang !== 'auto') codes.add(t.whisperLang)
    const list = [...codes].map((c) => ({ value: c, label: languageName(c) })).sort((a, b) => a.label.localeCompare(b.label))
    return [{ value: 'auto', label: 'Auto-detect' }, ...list]
  }, [t.locales, t.whisperLang])
  const progressLabel = (p: { p: number; phase: string }) => {
    const pctText = `${Math.round(p.p * 100)}%`
    if (p.phase !== 'download') return `Transcribing… ${pctText}`
    if (!whisper) return 'Downloading language model…'
    return p.p >= 1 ? `Loading Whisper (${t.whisperSize})…` : `Downloading Whisper (${t.whisperSize})… ${pctText}`
  }
  return (
    <div className="flex flex-col gap-2.5">
      {!compact && <p className="text-[12.5px] text-muted">Your audio is transcribed on this Mac. Nothing is uploaded.</p>}
      {t.appleAvailable && (
        <Field label="Engine">
          <Segmented
            value={t.engine}
            onChange={t.setEngine}
            options={[
              { value: 'apple', label: 'Apple', title: 'Speech recognition built into macOS' },
              { value: 'whisper', label: 'Whisper', title: 'OpenAI’s open speech model, run on this Mac' },
            ]}
          />
        </Field>
      )}
      {whisper && (
        <Field label="Model">
          <Select
            value={t.whisperSize}
            onChange={t.setWhisperSize}
            options={(Object.keys(WHISPER_SIZES) as WhisperSize[]).map((s) => ({ value: s, label: `${WHISPER_SIZES[s].label} · ${WHISPER_SIZES[s].mb} MB · ${WHISPER_SIZES[s].note}` }))}
          />
        </Field>
      )}
      <Field label="Language">
        {whisper ? (
          <Select value={t.whisperLang} onChange={t.setWhisperLang} options={whisperLanguages} />
        ) : (
          <Select
            value={t.locale}
            onChange={t.setLocale}
            options={(t.locales?.supported ?? ['en-US']).map((l) => ({
              value: l,
              label: `${languageName(l)}${t.locales?.installed.includes(l) ? '' : ' (download)'}`,
            }))}
          />
        )}
      </Field>
      {t.progress ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 rounded-full bg-control overflow-hidden">
            <div className="h-full bg-caption transition-[width]" style={{ width: `${Math.round(t.progress.p * 100)}%` }} />
          </div>
          <span className="text-[12px] text-muted">{progressLabel(t.progress)}</span>
        </div>
      ) : (
        <Button variant="primary" onClick={t.run}>
          <Sparkles className="size-4" /> {has ? 'Regenerate transcript' : 'Generate transcript'}
        </Button>
      )}
      {has && !t.progress && <p className="text-[11.5px] text-faint">Regenerating replaces your text edits.</p>}
      {whisper && !t.progress && !compact && (
        <p className="text-[11.5px] text-faint">Whisper runs on your Mac; the first use downloads the model ({WHISPER_SIZES[t.whisperSize].mb} MB). Nothing is uploaded.</p>
      )}
    </div>
  )
}

export function CaptionsPanel() {
  const [c, set] = useStyleSection('captions')
  const hasTranscript = useEditor((s) => !!s.config?.transcript)
  const scene = useScene()
  const project = useEditor((s) => s.project)

  const exportSubs = async (kind: 'srt' | 'vtt') => {
    if (!scene || !project) return
    const lines = buildCaptionLines(scene.config.transcript, { ...c, enabled: true }, scene.timeMap, scene.aspect)
    const text = kind === 'srt' ? toSrt(lines, scene.timeMap) : toVtt(lines, scene.timeMap)
    const out = await api.showSaveDialog({ defaultPath: `${project.file.name}.${kind}`, filters: [{ name: 'Subtitles', extensions: [kind] }] })
    if (out) {
      await api.writeText(out, text)
      toast('Subtitles saved')
    }
  }

  return (
    <>
      <PanelHeader title="Captions" />
      {!hasTranscript ? (
        <Section title="Transcript">
          <Generate />
        </Section>
      ) : (
        <>
          <Section title="Captions">
            <Toggle label="Show captions" checked={c.enabled} onChange={(v) => set((s) => void (s.enabled = v))} />
            <Field label="Style">
              <Segmented
                value={c.color === '#ffffff' ? 'dark' : 'light'}
                onChange={(v) =>
                  set((s) => {
                    s.color = v === 'dark' ? '#ffffff' : '#111111'
                    s.background = v === 'dark' ? '#000000' : '#ffffff'
                  })
                }
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
              />
            </Field>
            <Field label="Font">
              <Segmented
                value={c.font}
                onChange={(v) => set((s) => void (s.font = v))}
                options={[
                  { value: 'sans-serif', label: 'Sans' },
                  { value: 'serif', label: 'Serif' },
                  { value: 'mono', label: 'Mono' },
                ]}
              />
            </Field>
            <Slider label="Size" value={c.size} min={0.03} max={0.125} step={0.001} format={pct} onChange={(v) => set((s) => void (s.size = v), 'size')} />
            <Slider label="Background" value={c.backgroundOpacity} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((s) => void (s.backgroundOpacity = v), 'bg')} />
            <div className="flex gap-2">
              <Field label="Text">
                <ColorInput value={c.color} onChange={(v) => set((s) => void (s.color = v), 'color')} />
              </Field>
              <Field label="Box">
                <ColorInput value={c.background} onChange={(v) => set((s) => void (s.background = v), 'box')} />
              </Field>
            </div>
            <Field label="Position">
              <Segmented
                value={c.position.y >= 0.9 ? 'bottom' : c.position.y <= 0.2 ? 'top' : 'center'}
                onChange={(v) => set((s) => void (s.position = { x: 0.5, y: v === 'bottom' ? 1 : v === 'top' ? 0.1 : 0.5 }))}
                options={[
                  { value: 'top', label: 'Top' },
                  { value: 'center', label: 'Center' },
                  { value: 'bottom', label: 'Bottom' },
                ]}
              />
            </Field>
          </Section>
          <Section title="Animation">
            <Field label="Reveal">
              <Segmented
                value={c.wordsReveal}
                onChange={(v) => set((s) => void (s.wordsReveal = v))}
                options={[
                  { value: 'line-by-line', label: 'Line by line' },
                  { value: 'word-by-word', label: 'Word by word' },
                ]}
              />
            </Field>
            {c.wordsReveal === 'word-by-word' ? (
              <Field label="Line growth">
                <Segmented
                  value={c.lineGrowth}
                  onChange={(v) => set((s) => void (s.lineGrowth = v))}
                  options={[
                    { value: 'entire-line', label: 'Full line' },
                    { value: 'left-anchored', label: 'Expanding' },
                    { value: 'centered', label: 'Centered' },
                  ]}
                />
              </Field>
            ) : (
              <Field label="Current word">
                <div className="flex items-center gap-2">
                  <ColorInput value={c.highlightColor} onChange={(v) => set((s) => void (s.highlightColor = v), 'hl')} />
                  <Button size="sm" variant="ghost" onClick={() => set((s) => void (s.highlightColor = s.color))}>
                    No highlight
                  </Button>
                </div>
              </Field>
            )}
            <Field label="Word entrance">
              <Segmented
                value={c.wordEntrance}
                onChange={(v) => set((s) => void (s.wordEntrance = v))}
                options={[
                  { value: 'appear', label: 'Appear' },
                  { value: 'fade-in', label: 'Fade' },
                  { value: 'slide-in', label: 'Slide' },
                ]}
              />
            </Field>
            <Toggle label="Show sound labels" hint="e.g. [laughs], [music]" checked={c.showSoundLabels} onChange={(v) => set((s) => void (s.showSoundLabels = v))} />
          </Section>
          <Section title="Export">
            <div className="flex gap-2">
              <Button size="sm" onClick={() => exportSubs('srt')}>
                <Download className="size-3.5" /> SRT
              </Button>
              <Button size="sm" onClick={() => exportSubs('vtt')}>
                <Download className="size-3.5" /> WebVTT
              </Button>
            </div>
          </Section>
          <Section title="Transcript" defaultOpen={false}>
            <Generate compact />
          </Section>
        </>
      )}
    </>
  )
}

export function TranscriptPanel() {
  const transcript = useEditor((s) => s.config?.transcript ?? null)
  const update = useEditor((s) => s.update)
  const playMs = useEditor((s) => s.playMs)
  const duration = useEditor((s) => (s.project?.meta.duration ?? 0) * 1000)
  const scene = useScene()
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [showDeleted, setShowDeleted] = useState(true)
  const [showHidden, setShowHidden] = useState(true)
  const [editing, setEditing] = useState<number | null>(null)
  const tokens = useMemo(() => buildTokens(transcript?.words ?? []), [transcript])
  const map = scene?.timeMap

  const selected = useMemo(() => {
    if (!sel || !transcript) return [] as TranscriptWord[]
    const [a, b] = sel.a <= sel.b ? [sel.a, sel.b] : [sel.b, sel.a]
    return transcript.words.filter((w) => w.index >= a && w.index <= b)
  }, [sel, transcript])

  const fillers = map && transcript ? fillerIndices(transcript.words, map) : []
  const sourceNow = map?.toSource(playMs) ?? 0

  const del = () => {
    if (!selected.length || !map) return
    const live = selected.filter((w) => !isCut(w.start, w.end, map))
    if (!live.length) return
    try {
      update((d) => void deleteWords(d, live.map((w) => w.index)))
      toast(`Removed ${live.length} word${live.length > 1 ? 's' : ''} — ⌘Z to undo`)
      setSel(null)
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const restore = () => {
    if (!selected.length) return
    update((d) => restoreRange(d, selected[0].start, selected[selected.length - 1].end, duration))
    setSel(null)
  }
  const hide = (hidden: boolean) => {
    update((d) => setHidden(d, selected.map((w) => w.index), hidden))
    setSel(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement).closest('input,textarea')) return
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        e.stopPropagation()
        if (e.metaKey) hide(true)
        else del()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!transcript) {
    return (
      <>
        <PanelHeader title="Edit by transcript" />
        <Section title="Transcript">
          <Generate />
        </Section>
      </>
    )
  }

  return (
    <>
      <PanelHeader title="Edit by transcript" />
      <div className="px-4 py-3 flex flex-wrap gap-1.5 border-b border-line-soft">
        <Button size="sm" disabled={!fillers.length} onClick={() => update((d) => void deleteWords(d, fillers))} title="Remove um, uh and similar">
          <Wand2 className="size-3.5" /> Remove fillers{fillers.length ? ` (${fillers.length})` : ''}
        </Button>
        <Button size="sm" onClick={() => map && update((d) => void tightenPauses(d, map))} title="Shorten pauses longer than 0.2s">
          <Timer className="size-3.5" /> Tighten pauses
        </Button>
      </div>
      {selected.length > 0 && (
        <div className="px-4 py-2 flex flex-wrap gap-1.5 border-b border-line-soft bg-white/3">
          <Button size="sm" variant="danger" onClick={del} title="Cut from the video (⌫)">
            <Scissors className="size-3.5" /> Delete
          </Button>
          <Button size="sm" onClick={() => hide(!selected.every((w) => w.hidden))} title="Hide from captions only (⌘⌫)">
            <EyeOff className="size-3.5" /> {selected.every((w) => w.hidden) ? 'Show in captions' : 'Hide in captions'}
          </Button>
          <Button size="sm" variant="ghost" onClick={restore}>
            <RotateCcw className="size-3.5" /> Restore
          </Button>
        </div>
      )}
      <div className="px-4 py-3 text-[14px] leading-[1.9] select-text">
        {tokens.map((tk, i) => {
          if (tk.kind === 'gap') {
            const cut = map ? isCut(tk.start + 50, tk.end - 50, map) : false
            if (cut && !showDeleted) return null
            return (
              <button
                key={`g${i}`}
                className={cx('inline-flex items-center mx-0.5 px-1.5 h-5 rounded-[5px] text-[11px] align-middle', cut ? 'bg-white/5 text-faint line-through' : 'bg-white/8 text-muted hover:bg-white/14')}
                title={`${((tk.end - tk.start) / 1000).toFixed(1)}s pause — click to shorten`}
                onClick={() => map && update((d) => void tightenPauses(d, map, [tk.start, tk.end]))}
              >
                {((tk.end - tk.start) / 1000).toFixed(1)}s
              </button>
            )
          }
          const w = tk.word
          const cut = map ? isCut(w.start, w.end, map) : false
          if (cut && !showDeleted) return null
          if (w.hidden && !showHidden) return null
          const inSel = selected.includes(w)
          const now = sourceNow >= w.start && sourceNow < w.end
          const tier = fillerTier(w.text)
          if (editing === w.index) {
            return (
              <input
                key={w.index}
                autoFocus
                defaultValue={w.text}
                className="inline w-24 bg-black/40 rounded px-1 outline-none text-[14px]"
                onBlur={(e) => {
                  const text = e.target.value.trim()
                  setEditing(null)
                  if (text && text !== w.text) update((d) => void (d.transcript!.words.find((x) => x.index === w.index)!.text = text))
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            )
          }
          return (
            <span
              key={w.index}
              onMouseDown={(e) => {
                if (e.shiftKey && sel) setSel({ a: sel.a, b: w.index })
                else setSel({ a: w.index, b: w.index })
                if (map && !cut) seekTo(map.toPlaybackNearest(w.start))
              }}
              onMouseEnter={(e) => e.buttons === 1 && sel && setSel({ a: sel.a, b: w.index })}
              onDoubleClick={() => setEditing(w.index)}
              className={cx(
                'cursor-text rounded-[3px] px-[1px]',
                inSel && 'bg-clip/45',
                now && !inSel && 'bg-caption/30',
                cut && 'line-through text-faint',
                w.hidden && !cut && 'text-muted italic',
                w.type === 'sound-label' && 'text-faint',
                tier === 1 && !cut && 'underline decoration-caption decoration-2 underline-offset-4',
                tier === 2 && !cut && 'underline decoration-white/25 decoration-dotted underline-offset-4',
              )}
            >
              {w.text}{' '}
            </span>
          )
        })}
      </div>
      <Section title="View" defaultOpen={false}>
        <Toggle label="Show deleted text" checked={showDeleted} onChange={setShowDeleted} />
        <Toggle label="Show hidden words" checked={showHidden} onChange={setShowHidden} />
      </Section>
    </>
  )
}
