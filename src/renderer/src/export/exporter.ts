import { AudioBufferSource, CanvasSource, Mp4OutputFormat, Output, StreamTarget, canEncodeVideo, type StreamTargetChunk } from 'mediabunny'
import type { ProjectConfig } from '@shared/project'
import { joinPath } from '@shared/media'
import { api } from '@/lib/bridge'
import { BackgroundCache } from '@/render/background'
import { Compositor } from '@/render/compositor'
import { stageSize } from '@/render/layout'
import { SceneBuilder, needsMatte } from '@/render/scene'
import { PersonMatte } from '@/render/segmentation'
import { loadFaceTrack } from '@/render/faces'
import { trackPath, type LoadedProject } from '@/editor/loader'
import { loadCursorBitmaps, resolveCursor } from '@/render/cursor-loader'
import { FrameCursor } from './frames'
import { detectSilences, mixAudio, decodeFile } from './audio-mix'
import { cameraTime } from '@/render/camera-time'

export type ExportQuality = 'studio' | 'social-media' | 'web-high' | 'web-low'

export interface ExportOptions {
  format: 'mp4' | 'gif'
  fps: number
  height: number
  quality: ExportQuality
  codec: 'h264' | 'h265' | 'av1'
  gifLoop?: boolean
  gifHighQuality?: boolean
}

export interface ExportProgress {
  phase: 'preparing' | 'audio' | 'rendering' | 'finishing' | 'gif'
  progress: number
  frame?: number
  frames?: number
  etaSec?: number
}

const BITRATE_FACTOR: Record<ExportQuality, number> = { studio: 0.3, 'social-media': 0.05, 'web-high': 0.0175, 'web-low': 0.0075 }

export function exportDimensions(project: LoadedProject, config: ProjectConfig, height: number) {
  const scene = new SceneBuilder().build(project.meta, project.input, config)
  return stageSize(scene.aspect, height)
}

export function estimateSize(opts: ExportOptions, width: number, height: number, durationSec: number) {
  if (opts.format === 'gif') return width * height * opts.fps * durationSec * 0.06
  const video = width * height * opts.fps * BITRATE_FACTOR[opts.quality]
  return ((video + 192_000) / 8) * durationSec
}

/** Renders the project to an MP4 (or GIF via ffmpeg) at `outPath`. */
export async function exportProject(
  project: LoadedProject,
  config: ProjectConfig,
  opts: ExportOptions,
  outPath: string,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
) {
  onProgress({ phase: 'preparing', progress: 0 })
  const isGif = opts.format === 'gif'
  const mp4Path = isGif ? await api.tempPath('gif-source.mp4') : outPath
  const fps = opts.fps

  let silences: { start: number; end: number }[] = []
  const micPath = trackPath(project, 'mic')
  if (config.style.camera.hideDuringSilenceMs && micPath) {
    const buf = await decodeFile(micPath)
    if (buf) silences = detectSilences(buf, config.style.camera.hideDuringSilenceMs, (project.meta.tracks.mic?.offset ?? 0) * 1000)
  }
  const faces = config.style.camera.faceTracking && project.meta.tracks.camera ? (await loadFaceTrack(project))?.samples ?? null : null
  const scene = new SceneBuilder().build(project.meta, project.input, config, silences, faces)
  const { width, height } = stageSize(scene.aspect, opts.height)
  const map = scene.timeMap
  const totalFrames = Math.max(1, Math.ceil((map.duration / 1000) * fps))

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { alpha: false })!
  const background = await new BackgroundCache().get(config.style.style.background, width, height, { grain: !isGif })
  const compositor = new Compositor()
  const cursors = await loadCursorBitmaps(project, config.style.cursor)
  compositor.cursorBitmap = resolveCursor(cursors)

  const screenPath = trackPath(project, 'screen')!
  const screen = await FrameCursor.open(screenPath)
  const camPath = trackPath(project, 'camera')
  const camera = camPath && !config.style.camera.hide ? await FrameCursor.open(camPath) : null
  const screenOffset = project.meta.tracks.screen?.offset ?? 0
  const cameraOffset = project.meta.tracks.camera?.offset ?? 0
  const matter = camera && needsMatte(config) ? await PersonMatte.get() : null
  matter?.reset()

  const handle = await api.fileOpen(mp4Path)
  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) => api.fileWrite(handle, chunk.position, chunk.data),
  })
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true, chunkSize: 16 * 2 ** 20 }),
  })

  let codec: 'avc' | 'hevc' | 'av1' = isGif ? 'avc' : opts.codec === 'h265' ? 'hevc' : opts.codec === 'av1' ? 'av1' : 'avc'
  if (codec !== 'avc' && !(await canEncodeVideo(codec, { width, height }))) codec = 'avc'
  const bitrate = Math.round(width * height * fps * (isGif ? 0.15 : BITRATE_FACTOR[opts.quality]))
  const video = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2 })
  output.addVideoTrack(video, { frameRate: fps })

  let audioSource: AudioBufferSource | null = null
  let mixed: AudioBuffer | null = null
  if (!isGif) {
    onProgress({ phase: 'audio', progress: 0.01 })
    const ref = (t: 'mic' | 'system') => {
      const p = trackPath(project, t)
      return p ? { path: p, offset: project.meta.tracks[t]!.offset } : null
    }
    mixed = await mixAudio({ mic: ref('mic'), system: ref('system'), music: config.style.audio.music }, config, map, project.input)
    if (mixed) {
      audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 })
      output.addAudioTrack(audioSource)
    }
  }

  await output.start()
  if (audioSource && mixed) await audioSource.add(mixed)

  const started = performance.now()
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
      const playMs = (i * 1000) / fps
      const sourceMs = map.toSource(playMs)
      const s = screen ? await screen.frameAt(sourceMs / 1000 - screenOffset) : null
      const c = camera ? await camera.frameAt(cameraTime(sourceMs, cameraOffset)) : null
      const camSource = c?.toCanvasImageSource() ?? null
      const cameraMatte = matter && camSource ? matter.matte(camSource as TexImageSource, performance.now()) : null
      compositor.render(ctx, scene, sourceMs, { screen: s?.toCanvasImageSource() ?? null, camera: camSource, cameraMatte }, {
        width,
        height,
        background,
        cursorImage: compositor.cursorBitmap!,
        frameMs: 1000 / fps,
        motionBlurSamples: 10,
      })
      await video.add(i / fps, 1 / fps)
      if (i % 5 === 0 || i === totalFrames - 1) {
        const elapsed = (performance.now() - started) / 1000
        const rate = (i + 1) / elapsed
        onProgress({
          phase: 'rendering',
          progress: 0.02 + 0.93 * ((i + 1) / totalFrames),
          frame: i + 1,
          frames: totalFrames,
          etaSec: (totalFrames - i - 1) / Math.max(rate, 0.01),
        })
      }
    }
    onProgress({ phase: 'finishing', progress: 0.96 })
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => {})
    await api.fileClose(handle)
    await api.deleteFile(mp4Path)
    throw err
  } finally {
    await screen?.close()
    await camera?.close()
  }
  await api.fileClose(handle)

  if (isGif) {
    onProgress({ phase: 'gif', progress: 0.97 })
    await api.gifEncode(mp4Path, outPath, {
      fps,
      width,
      loop: opts.gifLoop ?? true,
      colors: opts.gifHighQuality === false ? 128 : 256,
    })
    await api.deleteFile(mp4Path)
  }
  onProgress({ phase: 'finishing', progress: 1 })
  return { width, height, path: outPath }
}

/** Renders the current frame to a PNG (up to 2160p) next to the project's exports. */
export async function exportFrame(project: LoadedProject, config: ProjectConfig, sourceMs: number, height = 2160): Promise<Blob> {
  const scene = new SceneBuilder().build(project.meta, project.input, config)
  const { width, height: h } = stageSize(scene.aspect, height)
  const canvas = new OffscreenCanvas(width, h)
  const ctx = canvas.getContext('2d')!
  const background = await new BackgroundCache().get(config.style.style.background, width, h)
  const compositor = new Compositor()
  const cursors = await loadCursorBitmaps(project, config.style.cursor)
  compositor.cursorBitmap = resolveCursor(cursors)
  const screen = await FrameCursor.open(trackPath(project, 'screen')!)
  const camPath = trackPath(project, 'camera')
  const camera = camPath ? await FrameCursor.open(camPath) : null
  const s = await screen?.frameAt(sourceMs / 1000 - (project.meta.tracks.screen?.offset ?? 0))
  const c = await camera?.frameAt(cameraTime(sourceMs, project.meta.tracks.camera?.offset ?? 0))
  compositor.render(ctx, scene, sourceMs, { screen: s?.toCanvasImageSource() ?? null, camera: c?.toCanvasImageSource() ?? null }, {
    width,
    height: h,
    background,
    cursorImage: compositor.cursorBitmap,
    frameMs: 1000 / 60,
    motionBlurSamples: 1,
  })
  await screen?.close()
  await camera?.close()
  return canvas.convertToBlob({ type: 'image/png' })
}

export const exportsFolderFile = (dir: string, name: string, ext: string) => joinPath(dir, `${name.replace(/[/:]/g, '-')}.${ext}`)
