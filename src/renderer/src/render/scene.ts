import type { ProjectConfig } from '@shared/project'
import type { RecordingMeta } from '@shared/recording'
import { buildCaptionLines, type CaptionLine } from './captions'
import { buildCursorTrack, type CursorTrack } from './cursor'
import type { InputData } from './input'
import { buildKeyGroups, type KeyGroup } from './keystrokes'
import { stageAspect } from './layout'
import { TimeMap } from './timemap'
import { buildCameraTrack, type CameraTrack } from './zoom'
import type { FaceSample } from './faces'

/** Everything derived from a project that the compositor needs, rebuilt when the config changes. */
export interface Scene {
  meta: RecordingMeta
  input: InputData
  config: ProjectConfig
  timeMap: TimeMap
  cursor: CursorTrack | null
  camera: CameraTrack
  captions: CaptionLine[]
  keyGroups: KeyGroup[]
  /** Source-time ranges where the mic is silent (for "hide camera during silence"). */
  silences: { start: number; end: number }[]
  /** Smoothed face positions in the camera frame, when analysed. */
  faces: FaceSample[] | null
  aspect: number
  cropAspect: number
  hasCamera: boolean
  isDevice: boolean
}

export function buildScene(
  meta: RecordingMeta,
  input: InputData,
  config: ProjectConfig,
  extras: { silences?: { start: number; end: number }[]; faces?: FaceSample[] | null } = {},
): Scene {
  const { style, timeline } = config
  const timeMap = new TimeMap(timeline.slices)
  const crop = style.output.crop
  const cropAspect = (crop.width * meta.videoSize.width) / (crop.height * meta.videoSize.height)
  const aspect = stageAspect(style.output, cropAspect)
  const durationMs = meta.duration * 1000
  const isDevice = meta.source.type === 'device'
  return {
    meta,
    input,
    config,
    timeMap,
    cursor: input.hasEvents && !isDevice ? buildCursorTrack(input, style.cursor, style.animations, timeMap) : null,
    camera: buildCameraTrack({
      zooms: timeline.zooms,
      input,
      crop,
      video: meta.videoSize,
      spring: style.animations.screenSpring,
      startEarly: style.zooms.startAnimationEarly,
      avoidEmpty: true,
      durationMs,
    }),
    captions: style.captions.enabled ? buildCaptionLines(config.transcript, style.captions, timeMap, aspect) : [],
    keyGroups: style.keystrokes.enabled ? buildKeyGroups(input.keys, style.keystrokes) : [],
    silences: extras.silences ?? [],
    faces: extras.faces ?? null,
    aspect,
    cropAspect,
    hasCamera: !!meta.tracks.camera,
    isDevice,
  }
}

/** Rebuilds only the parts of a scene whose inputs changed (tracks are O(duration) to compute). */
export class SceneBuilder {
  private memo = new Map<string, { key: string; value: unknown }>()

  private cached<T>(slot: string, deps: unknown, make: () => T): T {
    const key = JSON.stringify(deps)
    const hit = this.memo.get(slot)
    if (hit && hit.key === key) return hit.value as T
    const value = make()
    this.memo.set(slot, { key, value })
    return value
  }

  build(meta: RecordingMeta, input: InputData, config: ProjectConfig, silences: { start: number; end: number }[] = [], faces: FaceSample[] | null = null): Scene {
    const { style, timeline } = config
    const timeMap = this.cached('timemap', timeline.slices, () => new TimeMap(timeline.slices))
    const crop = style.output.crop
    const cropAspect = (crop.width * meta.videoSize.width) / (crop.height * meta.videoSize.height)
    const aspect = stageAspect(style.output, cropAspect)
    const isDevice = meta.source.type === 'device'
    const cursor = this.cached('cursor', [style.cursor, style.animations.cursorSpring, timeline.slices, input.moves.length], () =>
      input.hasEvents && !isDevice ? buildCursorTrack(input, style.cursor, style.animations, timeMap) : null,
    )
    const camera = this.cached('camera', [timeline.zooms, crop, style.animations.screenSpring, style.zooms.startAnimationEarly], () =>
      buildCameraTrack({
        zooms: timeline.zooms,
        input,
        crop,
        video: meta.videoSize,
        spring: style.animations.screenSpring,
        startEarly: style.zooms.startAnimationEarly,
      avoidEmpty: true,
        durationMs: meta.duration * 1000,
      }),
    )
    const captions = this.cached('captions', [style.captions, config.transcript?.words, timeline.slices, aspect], () =>
      style.captions.enabled ? buildCaptionLines(config.transcript, style.captions, timeMap, aspect) : [],
    )
    const keyGroups = this.cached('keys', [style.keystrokes], () => (style.keystrokes.enabled ? buildKeyGroups(input.keys, style.keystrokes) : []))
    return { meta, input, config, timeMap, cursor, camera, captions, keyGroups, silences, faces, aspect, cropAspect, hasCamera: !!meta.tracks.camera, isDevice }
  }
}

/** Whether any setting needs the person matte (cutout layout, background removal or blur). */
export function needsMatte(config: ProjectConfig) {
  const st = config.style
  return (
    !st.camera.hide &&
    (st.layout.type === 'cutout-camera' ||
      st.camera.removeBackground ||
      st.camera.backgroundBlur > 0 ||
      config.timeline.layouts.some((l) => l.layout === 'cutout-camera' && !l.disabled))
  )
}
