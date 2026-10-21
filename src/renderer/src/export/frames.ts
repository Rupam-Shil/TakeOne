import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny'
import { mediaUrl } from '@shared/media'

/**
 * Forward-only frame access for variable-frame-rate recordings: holds the frame covering the
 * requested time until a later one starts, restarting the decoder only for backward/large jumps.
 */
export class FrameCursor {
  private iterator: AsyncGenerator<VideoSample, void, unknown> | null = null
  private current: VideoSample | null = null
  private next: VideoSample | null = null
  private done = false

  private constructor(private sink: VideoSampleSink, private input: Input, readonly width: number, readonly height: number) {}

  static async open(path: string): Promise<FrameCursor | null> {
    const input = new Input({ source: new UrlSource(mediaUrl(path)), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    return new FrameCursor(new VideoSampleSink(track), input, track.displayWidth, track.displayHeight)
  }

  private async restart(t: number) {
    this.current?.close()
    this.next?.close()
    this.current = null
    this.next = null
    await this.iterator?.return()
    this.iterator = this.sink.samples(Math.max(0, t))
    this.done = false
    await this.pull()
    this.current = this.next
    this.next = null
    await this.pull()
  }

  private async pull() {
    if (this.done || !this.iterator) return
    const r = await this.iterator.next()
    if (r.done) {
      this.done = true
      this.next = null
    } else this.next = r.value
  }

  /** The frame visible at `t` seconds. Valid until the next call. */
  async frameAt(t: number): Promise<VideoSample | null> {
    const cur = this.current
    const jumpedBack = cur && t + 1e-4 < cur.timestamp
    const jumpedFar = cur && this.next && t > this.next.timestamp + 2
    if (!this.iterator || jumpedBack || jumpedFar) await this.restart(t)
    while (this.next && this.next.timestamp <= t + 1e-4) {
      this.current?.close()
      this.current = this.next
      this.next = null
      await this.pull()
    }
    return this.current
  }

  async close() {
    this.current?.close()
    this.next?.close()
    await this.iterator?.return()
    this.input.dispose?.()
  }
}
