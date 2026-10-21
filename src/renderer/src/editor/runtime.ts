import { useMemo } from 'react'
import { joinPath } from '@shared/media'
import type { CursorSettings } from '@shared/project'
import { BackgroundCache } from '@/render/background'
import { Compositor } from '@/render/compositor'
import { loadCursorBitmaps, resolveCursor } from '@/render/cursor-loader'
import type { CursorBitmap } from '@/render/cursor-assets'
import { SceneBuilder, type Scene } from '@/render/scene'
import { decodeFile, detectSilences, processMic } from '@/export/audio-mix'
import { Playback } from './playback'
import { analyzeFaces, loadFaceTrack, type FaceSample } from '@/render/faces'
import { toast } from './toast'
import { trackPath, type LoadedProject } from './loader'
import { useEditor } from './store'

/** Long-lived objects for the open editor window (one project per window). */
class Runtime {
  project: LoadedProject | null = null
  playback: Playback | null = null
  builder = new SceneBuilder()
  compositor = new Compositor()
  background = new BackgroundCache()
  cursors = new Map<string, CursorBitmap>()
  private cursorKey = ''
  silences: { start: number; end: number }[] = []
  faces: FaceSample[] | null = null
  micBuffer: AudioBuffer | null = null
  waveforms: { mic?: Float32Array; system?: Float32Array } = {}
  listeners = new Set<() => void>()

  private audioReady: Promise<void> = Promise.resolve()

  attach(p: LoadedProject) {
    this.project = p
    this.playback?.destroy()
    this.playback = new Playback(p)
    this.audioReady = this.analyzeAudio(p)
    this.faces = null
    if (p.meta.tracks.camera) {
      void loadFaceTrack(p).then((t) => {
        if (this.project !== p) return
        this.faces = t?.samples ?? null
        useEditor.setState((s) => ({ analysisRev: s.analysisRev + 1 }))
      })
    }
  }

  /** Releases the media and analysis of the open project when the editor page goes away. */
  detach() {
    this.playback?.destroy()
    this.playback = null
    this.project = null
    this.faces = null
    this.silences = []
    this.micBuffer = null
    this.waveforms = {}
    this.cursors = new Map()
    this.cursorKey = ''
  }

  private facesPending: Promise<void> | null = null
  /** Analyses the camera for faces once (or again with `force`) and refreshes the scene. */
  ensureFaces(force = false): Promise<void> {
    const p = this.project
    if (!p || !p.meta.tracks.camera) return Promise.resolve()
    if (this.faces && !force) return Promise.resolve()
    this.facesPending ??= (async () => {
      toast('Finding your face in the camera video…')
      try {
        const track = await analyzeFaces(p, () => {})
        if (this.project !== p) return
        this.faces = track.samples
        toast(track.samples.length ? 'Face tracking ready' : 'No face found in the camera video')
        useEditor.setState((s) => ({ analysisRev: s.analysisRev + 1 }))
      } catch (e) {
        toast(`Face tracking failed: ${(e as Error).message}`)
      } finally {
        this.facesPending = null
      }
    })()
    return this.facesPending
  }

  async ensureCursors(settings: CursorSettings) {
    if (!this.project) return
    const key = settings.set
    if (key === this.cursorKey && this.cursors.size) return
    this.cursorKey = key
    this.cursors = await loadCursorBitmaps(this.project, settings)
    this.compositor.cursorBitmap = resolveCursor(this.cursors)
    this.notify()
  }

  /** Decodes audio once for waveforms and silence detection. */
  private async analyzeAudio(p: LoadedProject) {
    const mic = trackPath(p, 'mic')
    const sys = trackPath(p, 'system')
    const peaks = (buf: AudioBuffer) => {
      const n = Math.ceil(buf.duration * 50) // 20ms buckets
      const out = new Float32Array(n)
      const d = buf.getChannelData(0)
      const per = Math.floor(d.length / n)
      for (let i = 0; i < n; i++) {
        let m = 0
        for (let j = i * per; j < (i + 1) * per; j += 4) m = Math.max(m, Math.abs(d[j]))
        out[i] = m
      }
      return out
    }
    if (mic) {
      const buf = await decodeFile(mic)
      if (buf) {
        this.micBuffer = buf
        this.waveforms.mic = peaks(buf)
        this.silences = detectSilences(buf, 1500, (p.meta.tracks.mic?.offset ?? 0) * 1000)
      }
    }
    if (sys && sys !== trackPath(p, 'screen')) {
      const buf = await decodeFile(sys)
      if (buf) this.waveforms.system = peaks(buf)
    }
    this.notify()
  }

  /** Writes the processed mic to the project cache so preview hears the chosen preset. */
  async prepareMicPreset(preset: 'original' | 'voice' | 'noise-reduction' | 'podcast') {
    await this.audioReady
    if (!this.project || !this.micBuffer || !this.playback) return
    if (preset === 'original') return this.playback.setMicSource(trackPath(this.project, 'mic'))
    const out = joinPath(this.project.path, 'cache', `mic-${preset}.wav`)
    const existing = await window.bridge.api.readBinary(out)
    if (!existing) {
      const processed = await processMic(this.micBuffer, preset)
      const wav = encodeWav(processed)
      const handle = await window.bridge.api.fileOpen(out)
      await window.bridge.api.fileWrite(handle, 0, new Uint8Array(wav))
      await window.bridge.api.fileClose(handle)
    }
    this.playback.setMicSource(out)
  }

  notify() {
    this.listeners.forEach((l) => l())
  }

  buildScene(): Scene | null {
    const { project, config } = useEditor.getState()
    if (!project || !config) return null
    return this.builder.build(project.meta, project.input, config, this.silences, this.faces)
  }
}

export const runtime = new Runtime()

export function useScene(): Scene | null {
  const config = useEditor((s) => s.config)
  const project = useEditor((s) => s.project)
  const rev = useEditor((s) => s.analysisRev)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (project && config ? runtime.builder.build(project.meta, project.input, config, runtime.silences, runtime.faces) : null), [project, config, rev])
}

function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels
  const len = buf.length
  const out = new ArrayBuffer(44 + len * ch * 2)
  const v = new DataView(out)
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + len * ch * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, ch, true)
  v.setUint32(24, buf.sampleRate, true)
  v.setUint32(28, buf.sampleRate * ch * 2, true)
  v.setUint16(32, ch * 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, len * ch * 2, true)
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]))
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  return out
}
