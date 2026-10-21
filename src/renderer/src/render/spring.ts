import type { Spring } from '@shared/project'

/** Track resolution: one sample every STEP_MS of source time. */
export const STEP_MS = 4
const SUBSTEP_MS = 1

/** One semi-implicit Euler step (dt in ms). Overshoot is clamped by switching to critical damping. */
function step(x: number, v: number, target: number, s: Spring, dtMs: number): [number, number] {
  const dt = dtMs / 1000
  const k = s.stiffness
  const m = Math.max(s.mass, 1e-4)
  let c = s.damping
  const delta = target - x
  // Heading toward the target fast enough to overshoot → critically damp instead of bouncing.
  if (Math.sign(v) === Math.sign(delta) && Math.abs(v) > Math.abs(delta) * Math.sqrt(k / m)) c = Math.max(c, 2 * Math.sqrt(k * m))
  const a = (-k * (x - target) - c * v) / m
  v += a * dt
  x += v * dt
  return [x, v]
}

const settleCache = new Map<string, number>()

/** Milliseconds a spring needs to settle a 0→1000 move to within 0.5. */
export function settleTime(s: Spring): number {
  const key = `${s.stiffness}|${s.damping}|${s.mass}`
  const hit = settleCache.get(key)
  if (hit !== undefined) return hit
  let x = 0
  let v = 0
  let t = 0
  while (t < 20000) {
    ;[x, v] = step(x, v, 1000, s, SUBSTEP_MS)
    t += SUBSTEP_MS
    if (Math.abs(1000 - x) < 0.5 && Math.abs(v) < 0.5) break
  }
  settleCache.set(key, t)
  return t
}

/** Rescales a spring so it settles within `windowMs`, or returns null for an instant snap. */
export function fitSpring(s: Spring, windowMs: number): Spring | null {
  if (windowMs <= 33) return null
  const T = settleTime(s)
  if (T <= windowMs) return s
  const r = T / windowMs
  return { stiffness: s.stiffness * r * r, damping: s.damping * r, mass: s.mass }
}

/**
 * Integrates a spring that chases `targets` (sampled every STEP_MS). `springAt(i)` may vary the
 * spring per sample; null snaps instantly. Returns positions at the same resolution.
 */
export function integrate(targets: Float32Array, springAt: (i: number) => Spring | null, initial = targets[0] ?? 0): Float32Array {
  const out = new Float32Array(targets.length)
  let x = initial
  let v = 0
  for (let i = 0; i < targets.length; i++) {
    const s = springAt(i)
    const target = targets[i]
    if (!s || s.mass <= 0) {
      x = target
      v = 0
    } else {
      for (let j = 0; j < STEP_MS; j += SUBSTEP_MS) [x, v] = step(x, v, target, s, SUBSTEP_MS)
    }
    out[i] = x
  }
  return out
}

/** Linear sample of a track at time `ms`. */
export function sample(track: Float32Array, ms: number): number {
  if (track.length === 0) return 0
  const f = ms / STEP_MS
  if (f <= 0) return track[0]
  const i = Math.floor(f)
  if (i >= track.length - 1) return track[track.length - 1]
  const a = f - i
  return track[i] * (1 - a) + track[i + 1] * a
}

export const steps = (durationMs: number) => Math.max(2, Math.ceil(durationMs / STEP_MS) + 2)

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
