/**
 * Original background loops synthesised offline with Web Audio: chord pads, a bass line and a
 * soft beat. Each style is a small arrangement recipe; the result is a seamless-ish WAV loop.
 */
export const MUSIC_STYLES = [
  { id: 'lofi', label: 'Lo-fi', bpm: 78, chords: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]], wave: 'triangle' as OscillatorType, drums: 'lofi' },
  { id: 'uplift', label: 'Uplifting', bpm: 112, chords: [[60, 64, 67, 72], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65]], wave: 'sawtooth' as OscillatorType, drums: 'pop' },
  { id: 'ambient', label: 'Ambient', bpm: 70, chords: [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]], wave: 'sine' as OscillatorType, drums: 'none' },
  { id: 'focus', label: 'Focus', bpm: 96, chords: [[62, 65, 69, 72], [58, 62, 65, 69], [60, 64, 67, 70], [57, 60, 64, 67]], wave: 'square' as OscillatorType, drums: 'pulse' },
]

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

export async function generateMusic(styleId: string, seconds: number): Promise<ArrayBuffer> {
  const style = MUSIC_STYLES.find((s) => s.id === styleId) ?? MUSIC_STYLES[0]
  const sr = 44100
  const beat = 60 / style.bpm
  const bar = beat * 4
  const bars = Math.max(4, Math.round(seconds / bar / 4) * 4)
  const duration = bars * bar
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sr), sr)
  const master = ctx.createGain()
  master.gain.value = 0.5
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = style.wave === 'sawtooth' || style.wave === 'square' ? 2600 : 5000
  lp.connect(master).connect(ctx.destination)

  // Pads
  for (let b = 0; b < bars; b++) {
    const chord = style.chords[b % style.chords.length]
    const t0 = b * bar
    for (const note of chord) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator()
        o.type = style.wave
        o.frequency.value = midi(note)
        o.detune.value = detune
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t0)
        g.gain.linearRampToValueAtTime(0.045, t0 + 0.25)
        g.gain.setValueAtTime(0.045, t0 + bar - 0.3)
        g.gain.linearRampToValueAtTime(0, t0 + bar)
        const pan = ctx.createStereoPanner()
        pan.pan.value = detune < 0 ? -0.35 : 0.35
        o.connect(g).connect(pan).connect(lp)
        o.start(t0)
        o.stop(t0 + bar + 0.05)
      }
    }
    // Bass on beats 1 and 3
    for (const k of [0, 2]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = midi(chord[0] - 12)
      const g = ctx.createGain()
      const t = t0 + k * beat
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.6)
      o.connect(g).connect(master)
      o.start(t)
      o.stop(t + beat * 1.8)
    }
    // Arpeggio sparkle
    if (style.drums !== 'none') {
      for (let s = 0; s < 8; s++) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = midi(chord[s % chord.length] + 12)
        const g = ctx.createGain()
        const t = t0 + s * (beat / 2)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.035, t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.45)
        o.connect(g).connect(master)
        o.start(t)
        o.stop(t + beat * 0.5)
      }
    }
  }

  // Drums
  const noise = ctx.createBuffer(1, sr, sr)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
  const kick = (t: number, gain = 0.7) => {
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    o.connect(g).connect(master)
    o.start(t)
    o.stop(t + 0.32)
  }
  const hat = (t: number, gain = 0.06) => {
    const s = ctx.createBufferSource()
    s.buffer = noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7000
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    s.connect(hp).connect(g).connect(master)
    s.start(t)
    s.stop(t + 0.06)
  }
  const snare = (t: number, gain = 0.18) => {
    const s = ctx.createBufferSource()
    s.buffer = noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1800
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    s.connect(bp).connect(g).connect(master)
    s.start(t)
    s.stop(t + 0.2)
  }
  if (style.drums !== 'none') {
    for (let b = 0; b < bars; b++) {
      const t0 = b * bar
      for (let q = 0; q < 4; q++) {
        const t = t0 + q * beat
        if (style.drums === 'pop' || style.drums === 'pulse') kick(t, style.drums === 'pulse' ? 0.45 : 0.6)
        else if (q === 0 || q === 2) kick(t + (q === 2 ? beat * 0.5 : 0), 0.55)
        if (q === 1 || q === 3) snare(t, style.drums === 'lofi' ? 0.12 : 0.16)
        hat(t + beat / 2)
        if (style.drums !== 'lofi') hat(t, 0.035)
      }
    }
  }
  const buf = await ctx.startRendering()
  return encodeWav(buf)
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
