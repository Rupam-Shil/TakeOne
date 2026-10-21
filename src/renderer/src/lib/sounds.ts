/** Synthesised mouse click sounds (no sampled audio is shipped). */
export type ClickKind = 'soft' | 'mechanical'

function clickBuffer(ctx: BaseAudioContext, kind: ClickKind): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * (kind === 'soft' ? 0.05 : 0.07))
  const buf = ctx.createBuffer(1, len, sr)
  const d = buf.getChannelData(0)
  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 1073741823.5 - 1
  }
  for (let i = 0; i < len; i++) {
    const t = i / sr
    if (kind === 'soft') {
      // A short damped thump plus a little noise: like a trackpad tap.
      d[i] = (Math.sin(2 * Math.PI * 1800 * t) * 0.5 + rand() * 0.35) * Math.exp(-t * 140)
    } else {
      // Two transients (press + release spring) with a brighter tone.
      const a = (Math.sin(2 * Math.PI * 3200 * t) * 0.6 + rand() * 0.5) * Math.exp(-t * 220)
      const t2 = t - 0.035
      const b = t2 > 0 ? (Math.sin(2 * Math.PI * 2600 * t2) * 0.4 + rand() * 0.3) * Math.exp(-t2 * 260) : 0
      d[i] = a + b * 0.7
    }
  }
  return buf
}

const cache = new WeakMap<BaseAudioContext, Partial<Record<ClickKind, AudioBuffer>>>()

function bufferFor(ctx: BaseAudioContext, kind: ClickKind) {
  let entry = cache.get(ctx)
  if (!entry) cache.set(ctx, (entry = {}))
  return (entry[kind] ??= clickBuffer(ctx, kind))
}

export function playClickSound(ctx: AudioContext, kind: ClickKind, volume: number) {
  scheduleClick(ctx, kind, volume, ctx.currentTime)
}

export function scheduleClick(ctx: BaseAudioContext, kind: ClickKind, volume: number, when: number) {
  const src = ctx.createBufferSource()
  src.buffer = bufferFor(ctx, kind)
  const g = ctx.createGain()
  g.gain.value = volume
  src.connect(g).connect(ctx.destination)
  src.start(when)
}
