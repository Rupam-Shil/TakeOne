import { mediaUrl } from '@shared/media'
import type { AudioSettings, ProjectConfig } from '@shared/project'
import type { TimeMap } from '@/render/timemap'
import type { InputData } from '@/render/input'
import { scheduleClick } from '@/lib/sounds'

const SR = 48000

const decodeCtx = () => new OfflineAudioContext(2, SR, SR)

export async function decodeFile(path: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(mediaUrl(path))
    if (!res.ok) return null
    return await decodeCtx().decodeAudioData(await res.arrayBuffer())
  } catch {
    return null
  }
}

/** Peak-normalise to −6 dBFS ("voice" preset baseline). */
function normalize(buf: AudioBuffer, targetDb = -6) {
  let peak = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
  }
  if (peak < 1e-4) return buf
  const gain = Math.pow(10, targetDb / 20) / peak
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) d[i] *= gain
  }
  return buf
}

/** Simple spectral-floor noise gate: attenuates frames whose energy sits near the noise floor. */
function denoise(buf: AudioBuffer) {
  const frame = 480
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    const energies: number[] = []
    for (let i = 0; i < d.length; i += frame) {
      let e = 0
      for (let j = i; j < Math.min(d.length, i + frame); j++) e += d[j] * d[j]
      energies.push(Math.sqrt(e / frame))
    }
    const sorted = [...energies].sort((a, b) => a - b)
    const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0
    let g = 1
    for (let f = 0; f < energies.length; f++) {
      const snr = energies[f] / Math.max(floor, 1e-6)
      const target = snr < 2 ? 0.08 : snr < 4 ? 0.4 : 1
      for (let j = f * frame; j < Math.min(d.length, (f + 1) * frame); j++) {
        g += (target - g) * (target > g ? 0.02 : 0.002)
        d[j] *= g
      }
    }
  }
  return buf
}

/** Applies the microphone preset offline. Results are cheap enough to recompute per export. */
export async function processMic(raw: AudioBuffer, preset: AudioSettings['micPreset']): Promise<AudioBuffer> {
  if (preset === 'original') return raw
  const copy = new AudioBuffer({ length: raw.length, numberOfChannels: raw.numberOfChannels, sampleRate: raw.sampleRate })
  for (let c = 0; c < raw.numberOfChannels; c++) copy.copyToChannel(raw.getChannelData(c), c)
  if (preset === 'voice') return normalize(copy)
  if (preset === 'noise-reduction') return normalize(denoise(copy))
  // Podcast: gate, high-pass, presence EQ, compression, then normalise.
  denoise(copy)
  const ctx = new OfflineAudioContext(copy.numberOfChannels, copy.length, copy.sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = copy
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 70
  const mud = ctx.createBiquadFilter()
  mud.type = 'peaking'
  mud.frequency.value = 350
  mud.gain.value = -3
  mud.Q.value = 1
  const presence = ctx.createBiquadFilter()
  presence.type = 'peaking'
  presence.frequency.value = 4000
  presence.gain.value = 2.5
  presence.Q.value = 0.8
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -24
  comp.ratio.value = 4
  comp.attack.value = 0.005
  comp.release.value = 0.15
  comp.knee.value = 6
  src.connect(hp).connect(mud).connect(presence).connect(comp).connect(ctx.destination)
  src.start()
  return normalize(await ctx.startRendering(), -3)
}

/** Silent stretches in the mic (50ms RMS windows below 10% of the loudest window). */
export function detectSilences(buf: AudioBuffer, minMs: number, offsetMs = 0): { start: number; end: number }[] {
  const win = Math.floor(buf.sampleRate * 0.05)
  const d = buf.getChannelData(0)
  const rms: number[] = []
  for (let i = 0; i < d.length; i += win) {
    let e = 0
    for (let j = i; j < Math.min(d.length, i + win); j++) e += d[j] * d[j]
    rms.push(Math.sqrt(e / win))
  }
  const max = Math.max(...rms, 1e-6)
  const out: { start: number; end: number }[] = []
  let start = -1
  rms.forEach((r, i) => {
    const silent = r < max * 0.1
    if (silent && start < 0) start = i
    if ((!silent || i === rms.length - 1) && start >= 0) {
      const s = start * 50 + offsetMs
      const e = i * 50 + offsetMs
      if (e - s >= minMs) out.push({ start: s, end: e })
      start = -1
    }
  })
  return out
}

/** A sub-range of a mapped slice (source ms), with its playback start. */
class TimeMapSegment {
  readonly playStart: number
  readonly start: number
  readonly end: number
  readonly speed: number
  constructor(seg: { playStart: number; slice: { start: number; speed: number } }, start: number, end: number) {
    this.start = start
    this.end = end
    this.speed = seg.slice.speed
    this.playStart = seg.playStart + (start - seg.slice.start) / seg.slice.speed
  }
}

function placeSegment(ctx: BaseAudioContext, buf: AudioBuffer, offsetSec: number, seg: TimeMapSegment, volume: number) {
  if (volume <= 0) return
  let when = seg.playStart / 1000
  let from = seg.start / 1000 - offsetSec
  let len = (seg.end - seg.start) / 1000
  if (from < 0) {
    when += -from / seg.speed
    len += from
    from = 0
  }
  if (len <= 0 || from >= buf.duration) return
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = seg.speed
  const g = ctx.createGain()
  g.gain.value = volume
  src.connect(g).connect(ctx.destination)
  src.start(when, from, Math.min(len, buf.duration - from))
}

export interface MixSources {
  mic: { path: string; offset: number } | null
  system: { path: string; offset: number } | null
  music: string | null
}

/** Renders the final soundtrack on the playback timeline (after cuts and speed changes). */
export async function mixAudio(sources: MixSources, config: ProjectConfig, map: TimeMap, input: InputData): Promise<AudioBuffer | null> {
  const a = config.style.audio
  const duration = map.duration / 1000
  if (duration <= 0) return null
  const [micRaw, sys, music] = await Promise.all([
    sources.mic && !a.muteMic ? decodeFile(sources.mic.path) : null,
    sources.system && !a.muteSystem ? decodeFile(sources.system.path) : null,
    a.music && !a.muteMusic ? decodeFile(a.music) : null,
  ])
  const mic = micRaw ? await processMic(micRaw, a.micPreset) : null
  if (!mic && !sys && !music && a.clickSound === 'none' && !config.timeline.voiceOvers.length) return null

  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR)
  const place = (buf: AudioBuffer, offsetSec: number, volume: (s: (typeof map.segments)[number]) => number) => {
    for (const seg of map.segments) {
      const vol = volume(seg)
      if (vol <= 0) continue
      let when = seg.playStart / 1000
      let from = seg.slice.start / 1000 - offsetSec
      let len = (seg.slice.end - seg.slice.start) / 1000
      if (from < 0) {
        when += -from / seg.slice.speed
        len += from
        from = 0
      }
      if (len <= 0 || from >= buf.duration) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = seg.slice.speed
      const g = ctx.createGain()
      g.gain.value = vol
      src.connect(g).connect(ctx.destination)
      src.start(when, from, Math.min(len, buf.duration - from))
    }
  }
  // Voiceovers can silence the original narration while they play.
  const muted = config.timeline.voiceOvers.filter((v) => v.muteOriginal && !v.disabled)
  const micGain = (s: (typeof map.segments)[number]) => a.volume * s.slice.volume
  if (mic) {
    if (!muted.length) place(mic, sources.mic!.offset, micGain)
    else {
      // Split each slice around the muted ranges.
      for (const seg of map.segments) {
        let cursor = seg.slice.start
        const cuts = muted.map((v) => [v.start, v.attach === 'synced' ? v.end : v.start + v.duration * seg.slice.speed] as const).sort((x, y) => x[0] - y[0])
        const ranges: [number, number][] = []
        for (const [ms, me] of cuts) {
          if (me <= cursor || ms >= seg.slice.end) continue
          if (ms > cursor) ranges.push([cursor, ms])
          cursor = Math.max(cursor, me)
        }
        if (cursor < seg.slice.end) ranges.push([cursor, seg.slice.end])
        for (const [rs, re] of ranges) {
          const sub = new TimeMapSegment(seg, rs, re)
          placeSegment(ctx, mic, sources.mic!.offset, sub, micGain(seg))
        }
      }
    }
  }
  if (sys) place(sys, sources.system!.offset, (s) => a.systemVolume * s.slice.systemVolume)

  for (const vo of config.timeline.voiceOvers) {
    if (vo.disabled) continue
    const buf = await decodeFile(vo.file)
    if (!buf) continue
    if (vo.attach === 'synced') {
      for (const seg of map.segments) {
        const s0 = Math.max(seg.slice.start, vo.start)
        const s1 = Math.min(seg.slice.end, vo.end)
        if (s1 > s0) placeSegment(ctx, buf, vo.start / 1000, new TimeMapSegment(seg, s0, s1), vo.volume)
      }
    } else {
      const src = ctx.createBufferSource()
      src.buffer = buf
      const g = ctx.createGain()
      g.gain.value = vo.volume
      src.connect(g).connect(ctx.destination)
      src.start(map.toPlaybackNearest(vo.start) / 1000)
    }
  }

  if (music) {
    const src = ctx.createBufferSource()
    src.buffer = music
    src.loop = true
    const g = ctx.createGain()
    const v = a.musicVolume
    if (a.musicFade) {
      g.gain.setValueAtTime(0, 0)
      g.gain.linearRampToValueAtTime(v, Math.min(1, duration / 4))
      g.gain.setValueAtTime(v, Math.max(0, duration - 2))
      g.gain.linearRampToValueAtTime(0, duration)
    } else g.gain.value = v
    src.connect(g).connect(ctx.destination)
    src.start(0)
    src.stop(duration)
  }

  if (a.clickSound !== 'none') {
    for (const c of input.clicks) {
      if (c.type !== 'down' || c.button !== 'left') continue
      if (map.speedAtSource(c.t) > 2) continue
      const p = map.toPlayback(c.t)
      if (p !== null) scheduleClick(ctx, a.clickSound, a.clickVolume, p / 1000)
    }
  }
  return ctx.startRendering()
}
