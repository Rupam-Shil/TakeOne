import { mediaUrl } from '@shared/media'
import type { ProjectConfig } from '@shared/project'
import type { TimeMap } from '@/render/timemap'
import { playClickSound } from '@/lib/sounds'
import { CAMERA_LEAD_S, cameraTime } from '@/render/camera-time'
import { trackPath, type LoadedProject } from './loader'

type Media = HTMLMediaElement & { preservesPitch?: boolean }

interface AudioRoute {
  el: Media
  gain: GainNode
  offset: number
}

/**
 * Drives preview playback from the screen video's clock. Slices are played back to back by jumping
 * the media to the next kept range, at that slice's speed.
 */
export class Playback {
  readonly screen: HTMLVideoElement
  readonly camera: HTMLVideoElement | null
  private ctx: AudioContext
  private routes: { mic?: AudioRoute; system?: AudioRoute; music?: AudioRoute } = {}
  private voices = new Map<string, HTMLAudioElement>()
  private micMuted = false
  private cameraOffset = 0
  private screenOffset = 0
  private lastSourceMs = 0
  private segIndex = 0
  playing = false
  readonly ready: Promise<void>

  constructor(private project: LoadedProject) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.screen = this.video(trackPath(project, 'screen')!)
    const cam = trackPath(project, 'camera')
    this.camera = cam ? this.video(cam) : null
    this.cameraOffset = project.meta.tracks.camera?.offset ?? 0
    this.screenOffset = project.meta.tracks.screen?.offset ?? 0
    const mic = trackPath(project, 'mic')
    if (mic) this.routes.mic = this.audio(mic, project.meta.tracks.mic!.offset)
    const sys = trackPath(project, 'system')
    // Imported videos carry audio in the same file as the screen track.
    if (sys && sys !== trackPath(project, 'screen')) this.routes.system = this.audio(sys, project.meta.tracks.system!.offset)
    else if (sys) this.routes.system = this.attach(this.screen, project.meta.tracks.system!.offset)
    this.ready = new Promise<void>((resolve) => {
      if (this.screen.readyState >= 2) resolve()
      else this.screen.addEventListener('loadeddata', () => resolve(), { once: true })
    })
  }

  private video(path: string) {
    const v = document.createElement('video')
    // CORS mode keeps canvases untainted (thumbnails, frame export) and Web Audio audible.
    v.crossOrigin = 'anonymous'
    v.src = mediaUrl(path)
    v.muted = true
    v.preload = 'auto'
    v.playsInline = true
    ;(v as Media).preservesPitch = true
    return v
  }

  private attach(el: Media, offset: number): AudioRoute {
    el.muted = false
    el.preservesPitch = true
    const node = this.ctx.createMediaElementSource(el)
    const gain = this.ctx.createGain()
    node.connect(gain).connect(this.ctx.destination)
    return { el, gain, offset }
  }

  private audio(path: string, offset: number) {
    const a = new Audio()
    a.crossOrigin = 'anonymous'
    a.src = mediaUrl(path)
    a.preload = 'auto'
    return this.attach(a as Media, offset)
  }

  setMusic(path: string | null) {
    if (this.routes.music && this.routes.music.el.src === (path ? mediaUrl(path) : '')) return
    if (this.routes.music) {
      this.routes.music.el.pause()
      this.routes.music.gain.disconnect()
      delete this.routes.music
    }
    if (path) {
      this.routes.music = this.audio(path, 0)
      this.routes.music.el.loop = true
    }
  }

  /** Swaps in a processed (denoised/levelled) mic file. */
  setMicSource(path: string | null) {
    const route = this.routes.mic
    if (!route || !path) return
    const url = mediaUrl(path)
    if (route.el.src !== url) {
      const t = route.el.currentTime
      route.el.src = url
      route.el.currentTime = t
    }
  }

  get sourceMs() {
    return (this.screen.currentTime + this.screenOffset) * 1000
  }

  private syncAll(sourceMs: number, force = false) {
    // A track that starts after the screen waits, paused at its first usable frame, until the playhead
    // reaches it. Seeking it back on every tick instead made the camera stutter and show black.
    const sync = (el: HTMLMediaElement, offset: number, lead: number) => {
      const raw = sourceMs / 1000 - offset
      if (raw < lead) {
        if (!el.paused) el.pause()
        if (force || Math.abs(el.currentTime - lead) > 0.01) el.currentTime = lead
        return
      }
      if (this.playing && el.paused) void el.play().catch(() => {})
      if (force || Math.abs(el.currentTime - raw) > 0.12) el.currentTime = raw
    }
    if (this.camera) sync(this.camera, this.cameraOffset, CAMERA_LEAD_S)
    for (const k of ['mic', 'system'] as const) {
      const r = this.routes[k]
      if (r && r.el !== this.screen) sync(r.el, r.offset, 0)
    }
  }

  applyVolumes(config: ProjectConfig, sliceVolume = 1, sliceSystem = 1) {
    const a = config.style.audio
    const t = this.ctx.currentTime
    this.routes.mic?.gain.gain.setTargetAtTime(a.muteMic || this.micMuted ? 0 : a.volume * sliceVolume, t, 0.02)
    this.routes.system?.gain.gain.setTargetAtTime(a.muteSystem ? 0 : a.systemVolume * sliceSystem, t, 0.02)
    this.routes.music?.gain.gain.setTargetAtTime(a.muteMusic || !a.music ? 0 : a.musicVolume, t, 0.05)
  }

  private setRate(speed: number) {
    const rate = Math.min(16, Math.max(0.0625, speed))
    this.screen.playbackRate = rate
    if (this.camera) this.camera.playbackRate = rate
    for (const r of Object.values(this.routes)) if (r && r !== this.routes.music) r.el.playbackRate = rate
    // Pitch-preserved audio gets choppy past 4×; mute like the export does above 2× for clicks.
  }

  async seek(sourceMs: number) {
    this.lastSourceMs = sourceMs
    const t = Math.max(0, sourceMs / 1000 - this.screenOffset)
    await new Promise<void>((resolve) => {
      if (Math.abs(this.screen.currentTime - t) < 0.0005) return resolve()
      const done = () => resolve()
      this.screen.addEventListener('seeked', done, { once: true })
      this.screen.currentTime = t
      setTimeout(done, 400)
    })
    if (this.camera) {
      const ct = cameraTime(sourceMs, this.cameraOffset)
      await new Promise<void>((resolve) => {
        if (Math.abs(this.camera!.currentTime - ct) < 0.0005) return resolve()
        this.camera!.addEventListener('seeked', () => resolve(), { once: true })
        this.camera!.currentTime = ct
        setTimeout(resolve, 400)
      })
    }
    this.syncAll(sourceMs, true)
  }

  async play(map: TimeMap, playMs: number, config: ProjectConfig) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    const start = playMs >= map.duration - 30 ? 0 : playMs
    const seg = map.segmentAtPlayback(start)
    if (!seg) return
    this.segIndex = map.segments.indexOf(seg)
    await this.seek(map.toSource(start))
    this.setRate(seg.slice.speed)
    this.applyVolumes(config, seg.slice.volume, seg.slice.systemVolume)
    this.playing = true
    const all: HTMLMediaElement[] = [this.screen, ...(this.camera ? [this.camera] : []), ...Object.values(this.routes).map((r) => r!.el)]
    if (this.routes.music) this.routes.music.el.currentTime = (start / 1000) % Math.max(1, this.routes.music.el.duration || 1)
    await Promise.allSettled(all.map((m) => m.play()))
  }

  pause() {
    this.playing = false
    for (const m of [this.screen, this.camera, ...Object.values(this.routes).map((r) => r?.el), ...this.voices.values()]) m?.pause()
  }

  /** Advances playback; returns the playback time, or null when the end was reached. */
  tick(map: TimeMap, config: ProjectConfig): number | null {
    let src = this.sourceMs
    let seg = map.segments[this.segIndex]
    if (!seg) return null
    if (src >= seg.slice.end - 8 || this.screen.ended) {
      const next = map.segments[this.segIndex + 1]
      if (!next) {
        this.pause()
        return null
      }
      this.segIndex++
      seg = next
      src = next.slice.start
      this.screen.currentTime = Math.max(0, src / 1000 - this.screenOffset)
      this.syncAll(src, true)
      this.setRate(next.slice.speed)
      this.applyVolumes(config, next.slice.volume, next.slice.systemVolume)
    } else if (src < seg.slice.start - 50) {
      src = seg.slice.start
    }
    this.syncAll(src)
    this.fireClicks(config, this.lastSourceMs, src, seg.slice.speed)
    this.lastSourceMs = src
    const play = seg.playStart + (Math.max(src, seg.slice.start) - seg.slice.start) / seg.slice.speed
    this.syncVoiceOvers(config, map, play, src, seg.slice.speed)
    return play
  }

  /** Plays voiceovers whose window covers the playhead and mutes the mic under "mute original" ones. */
  private syncVoiceOvers(config: ProjectConfig, map: TimeMap, playMs: number, sourceMs: number, speed: number) {
    let mute = false
    const live = new Set<string>()
    for (const vo of config.timeline.voiceOvers) {
      if (vo.disabled) continue
      const local = vo.attach === 'synced' ? (sourceMs - vo.start) / 1000 : (playMs - map.toPlaybackNearest(vo.start)) / 1000
      if (local < 0 || local >= vo.duration / 1000) continue
      live.add(vo.id)
      if (vo.muteOriginal) mute = true
      let el = this.voices.get(vo.id)
      if (!el || !el.src.endsWith(encodeURIComponent(vo.file.split('/').pop()!))) {
        el?.pause()
        el = new Audio(mediaUrl(vo.file))
        this.voices.set(vo.id, el)
      }
      el.volume = Math.min(1, vo.volume)
      el.playbackRate = vo.attach === 'synced' ? Math.min(16, speed) : 1
      if (Math.abs(el.currentTime - local) > 0.15) el.currentTime = local
      if (el.paused) void el.play().catch(() => {})
    }
    for (const [id, el] of this.voices) if (!live.has(id) && !el.paused) el.pause()
    if (mute !== this.micMuted) {
      this.micMuted = mute
      const a = config.style.audio
      this.routes.mic?.gain.gain.setTargetAtTime(mute || a.muteMic ? 0 : a.volume, this.ctx.currentTime, 0.03)
    }
  }

  private fireClicks(config: ProjectConfig, from: number, to: number, speed: number) {
    const a = config.style.audio
    if (a.clickSound === 'none' || speed > 2 || to <= from || to - from > 500) return
    for (const c of this.project.input.clicks) {
      if (c.type === 'down' && c.button === 'left' && c.t > from && c.t <= to) playClickSound(this.ctx, a.clickSound, a.clickVolume)
    }
  }

  destroy() {
    this.pause()
    this.ctx.close()
    this.screen.removeAttribute('src')
    this.camera?.removeAttribute('src')
  }
}
