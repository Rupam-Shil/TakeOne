import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import { api } from '@/lib/bridge'

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

/**
 * Person matte for the webcam (cutout layout, background blur/removal). Runs Google's on-device
 * selfie segmenter; the mask is smoothed over time so edges don't shimmer.
 */
export class PersonMatte {
  private canvas: OffscreenCanvas
  private ctx: OffscreenCanvasRenderingContext2D
  private data: ImageData | null = null
  private prev: Float32Array | null = null
  private lastTs = -1

  private constructor(private segmenter: ImageSegmenter) {
    this.canvas = new OffscreenCanvas(256, 256)
    this.ctx = this.canvas.getContext('2d')!
  }

  private static pending: Promise<PersonMatte | null> | null = null

  /** Shared instance; resolves to null if the model can't be loaded (e.g. offline on first use). */
  static get(): Promise<PersonMatte | null> {
    this.pending ??= (async () => {
      try {
        const model = await api.ensureModel('selfie_segmenter.tflite', MODEL_URL)
        const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe', document.baseURI).href.replace(/\/$/, ''))
        const segmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: model, delegate: 'GPU' },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        })
        return new PersonMatte(segmenter)
      } catch (e) {
        console.warn('segmentation unavailable', e)
        return null
      }
    })()
    return this.pending
  }

  /** Returns a canvas whose alpha is the person (white) vs background (transparent). */
  matte(frame: TexImageSource, timestampMs: number): OffscreenCanvas {
    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    const ts = timestampMs <= this.lastTs ? this.lastTs + 1 : timestampMs
    this.lastTs = ts
    const result = this.segmenter.segmentForVideo(frame as never, ts)
    const mask = result.confidenceMasks?.[0]
    if (!mask) return this.canvas
    const w = mask.width
    const h = mask.height
    const values = mask.getAsFloat32Array()
    if (this.canvas.width !== w || this.canvas.height !== h || !this.data) {
      this.canvas.width = w
      this.canvas.height = h
      this.data = this.ctx.createImageData(w, h)
      this.prev = null
    }
    const px = this.data.data
    const prev = this.prev && this.prev.length === values.length ? this.prev : null
    const next = new Float32Array(values.length)
    for (let i = 0; i < values.length; i++) {
      // Temporal smoothing plus a soft threshold for a clean but feathered edge.
      const v = prev ? prev[i] * 0.35 + values[i] * 0.65 : values[i]
      next[i] = v
      const a = Math.min(1, Math.max(0, (v - 0.35) / 0.3))
      const o = i * 4
      px[o] = px[o + 1] = px[o + 2] = 255
      px[o + 3] = a * 255
    }
    this.prev = next
    this.ctx.putImageData(this.data, 0, 0)
    result.close()
    return this.canvas
  }

  reset() {
    this.prev = null
  }
}
