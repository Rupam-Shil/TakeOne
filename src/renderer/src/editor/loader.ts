import { ALL_FORMATS, Input, UrlSource } from 'mediabunny'
import { defaultStyle, emptyTimeline, normalizeStyle, type ProjectConfig, type StyleConfig } from '@shared/project'
import type { ProjectFile } from '@shared/project-file'
import type { RecordingEvents, RecordingMeta } from '@shared/recording'
import { mediaUrl, joinPath } from '@shared/media'
import { api } from '@/lib/bridge'
import { normalizeInput, type InputData } from '@/render/input'
import { generateAutoZooms } from '@/render/zoom'

export interface LoadedProject {
  path: string
  file: ProjectFile
  recordingDir: string
  meta: RecordingMeta
  events: RecordingEvents | null
  input: InputData
  config: ProjectConfig
}

const LAST_STYLE_KEY = 'studio.lastStyle'

export function rememberStyle(style: StyleConfig) {
  try {
    // Music is project-specific; don't carry it into new recordings.
    const crop = { x: 0, y: 0, width: 1, height: 1 }
    localStorage.setItem(LAST_STYLE_KEY, JSON.stringify({ ...style, output: { ...style.output, crop }, audio: { ...style.audio, music: null } }))
  } catch {
    /* storage unavailable */
  }
}

async function initialStyle(): Promise<StyleConfig> {
  const settings = await api.getSettings()
  if (settings.general.defaultPresetId) {
    const presets = await api.listPresets()
    const p = presets.find((x) => x.id === settings.general.defaultPresetId)
    if (p) return normalizeStyle(p.style)
  }
  if (settings.general.useLastProjectSettings) {
    try {
      const raw = localStorage.getItem(LAST_STYLE_KEY)
      if (raw) return normalizeStyle(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }
  return defaultStyle()
}

/** Imported videos have no helper metadata, so derive it from the file itself. */
async function synthesizeMeta(dir: string): Promise<RecordingMeta> {
  const info = JSON.parse((await api.readText(joinPath(dir, 'import.json'))) ?? '{}') as { file?: string }
  const file = info.file ?? 'screen.mp4'
  const input = new Input({ source: new UrlSource(mediaUrl(joinPath(dir, file))), formats: ALL_FORMATS })
  const video = await input.getPrimaryVideoTrack()
  const audio = await input.getPrimaryAudioTrack()
  const duration = await input.computeDuration()
  const width = video?.displayWidth ?? 1920
  const height = video?.displayHeight ?? 1080
  const meta: RecordingMeta = {
    version: 1,
    createdAt: new Date().toISOString(),
    source: { type: 'display', displayId: null, windowId: null, deviceId: null },
    fps: 60,
    scale: 1,
    captureRect: { x: 0, y: 0, width, height },
    videoSize: { width, height },
    duration,
    pauses: [],
    tracks: {
      screen: { file, offset: 0 },
      system: audio ? { file, offset: 0 } : null,
      mic: null,
      camera: null,
    },
    frames: 0,
  }
  await api.writeText(joinPath(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  return meta
}

export async function loadProject(path: string): Promise<LoadedProject> {
  const file = await api.readProject(path)
  const recordingDir = joinPath(path, file.recordings[0] ?? 'recording')
  const metaText = await api.readText(joinPath(recordingDir, 'meta.json'))
  const meta: RecordingMeta = metaText ? JSON.parse(metaText) : await synthesizeMeta(recordingDir)
  // Recovered recordings carry a checkpointed duration; measure the real one from the file.
  if ((meta as RecordingMeta & { partial?: boolean }).partial && meta.tracks.screen) {
    const input = new Input({ source: new UrlSource(mediaUrl(joinPath(recordingDir, meta.tracks.screen.file))), formats: ALL_FORMATS })
    meta.duration = await input.computeDuration()
    delete (meta as RecordingMeta & { partial?: boolean }).partial
    await api.writeText(joinPath(recordingDir, 'meta.json'), JSON.stringify(meta, null, 2))
  }
  const eventsText = await api.readText(joinPath(recordingDir, 'events.json'))
  const events: RecordingEvents | null = eventsText ? JSON.parse(eventsText) : null
  const input = normalizeInput(meta, events)

  let config: ProjectConfig
  if (file.config) {
    config = {
      style: normalizeStyle(file.config.style),
      timeline: { ...emptyTimeline(meta.duration * 1000), ...file.config.timeline },
      transcript: file.config.transcript ?? null,
    }
  } else {
    const style = await initialStyle()
    const timeline = emptyTimeline(Math.round(meta.duration * 1000))
    const settings = await api.getSettings()
    if (settings.recording.autoZoom && style.zooms.autoZoom && input.hasEvents) {
      timeline.zooms = generateAutoZooms(input, style.zooms.defaultLevel)
    }
    if (meta.source.type === 'device') style.cursor.hide = true
    config = { style, timeline, transcript: null }
    file.config = config
    await api.writeProject(path, file)
  }
  return { path, file, recordingDir, meta, events, input, config }
}

export const trackPath = (p: LoadedProject, track: 'screen' | 'camera' | 'mic' | 'system') => {
  const ref = p.meta.tracks[track]
  return ref ? joinPath(p.recordingDir, ref.file) : null
}
