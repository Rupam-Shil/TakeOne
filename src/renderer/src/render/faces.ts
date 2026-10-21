import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import { joinPath } from '@shared/media'
import { api } from '@/lib/bridge'
import { FrameCursor } from '@/export/frames'
import { trackPath, type LoadedProject } from '@/editor/loader'

/** One smoothed face position: centre and box height, normalised to the camera frame; `t` is source ms. */
export interface FaceSample {
  t: number
  x: number
  y: number
  h: number
}

export interface FaceTrack {
  version: 1
  samples: FaceSample[]
}

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite'
const STEP_MS = 200

export const faceTrackPath = (p: LoadedProject) => joinPath(p.path, 'cache', 'faces.json')

export async function loadFaceTrack(p: LoadedProject): Promise<FaceTrack | null> {
  const text = await api.readText(faceTrackPath(p))
  if (!text) return null
  try {
    const t = JSON.parse(text) as FaceTrack
    return Array.isArray(t.samples) ? t : null
  } catch {
    return null
  }
}

/**
 * Runs Google's on-device face detector over the camera track (5 samples a second) and turns the
 * raw boxes into a calm framing track: the target only re-centres when the face drifts a fair way,
 * then eases there, so the crop doesn't twitch with every head movement.
 */
export async function analyzeFaces(p: LoadedProject, onProgress: (v: number) => void, signal?: AbortSignal): Promise<FaceTrack> {
  const camPath = trackPath(p, 'camera')
  if (!camPath) throw new Error('This recording has no camera')
  const model = await api.ensureModel('blaze_face_short_range.tflite', MODEL_URL)
  const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe', document.baseURI).href.replace(/\/$/, ''))
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: model, delegate: 'GPU' },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.5,
  })
  const cursor = await FrameCursor.open(camPath)
  if (!cursor) throw new Error("The camera video couldn't be read")
  const offset = p.meta.tracks.camera?.offset ?? 0
  const durationMs = p.meta.duration * 1000
  const raw: (Omit<FaceSample, 't'> | null)[] = []
  try {
    let ts = 0
    for (let t = 0; t <= durationMs; t += STEP_MS) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const camT = t / 1000 - offset
      const frame = camT >= 0 ? await cursor.frameAt(camT) : null
      if (!frame) {
        raw.push(null)
        continue
      }
      const result = detector.detectForVideo(frame.toCanvasImageSource() as never, ++ts)
      const best = result.detections.filter((d) => d.boundingBox).sort((a, b) => b.boundingBox!.height - a.boundingBox!.height)[0]
      if (best?.boundingBox) {
        const b = best.boundingBox
        raw.push({ x: (b.originX + b.width / 2) / cursor.width, y: (b.originY + b.height / 2) / cursor.height, h: b.height / cursor.height })
      } else raw.push(null)
      if (t % 1000 === 0) onProgress(t / durationMs)
    }
  } finally {
    await cursor.close()
    detector.close()
  }
  const track: FaceTrack = { version: 1, samples: smooth(raw) }
  await api.writeText(faceTrackPath(p), JSON.stringify(track))
  onProgress(1)
  return track
}

function smooth(raw: (Omit<FaceSample, 't'> | null)[]): FaceSample[] {
  const first = raw.find(Boolean)
  if (!first) return []
  let cur = { ...first }
  let target = { ...first }
  const out: FaceSample[] = []
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]
    if (s) {
      // Re-centre only when the face has moved a fair way (a dead zone keeps small sways still).
      if (Math.hypot(s.x - target.x, s.y - target.y) > 0.07) target = { ...target, x: s.x, y: s.y }
      if (Math.abs(s.h - target.h) / Math.max(0.01, target.h) > 0.22) target.h = s.h
    }
    const a = 0.11 // per 200ms step → settles in about 1.5s
    cur = { x: cur.x + (target.x - cur.x) * a, y: cur.y + (target.y - cur.y) * a, h: cur.h + (target.h - cur.h) * a * 0.6 }
    out.push({ t: i * STEP_MS, x: +cur.x.toFixed(4), y: +cur.y.toFixed(4), h: +cur.h.toFixed(4) })
  }
  return out
}

/** Interpolated face position at `ms` (source time), or null before the first sample. */
export function faceAt(samples: FaceSample[], ms: number): FaceSample | null {
  if (!samples.length) return null
  if (ms <= samples[0].t) return samples[0]
  const last = samples[samples.length - 1]
  if (ms >= last.t) return last
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= ms) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  const k = (ms - a.t) / Math.max(1, b.t - a.t)
  return { t: ms, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + (b.h - a.h) * k }
}
