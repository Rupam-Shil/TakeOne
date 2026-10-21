import type { Slice } from '@shared/project'

export interface MappedSegment {
  slice: Slice
  /** Playback-time start/end (ms). */
  playStart: number
  playEnd: number
}

/**
 * Maps between source time (the raw recording) and playback time (after trims, cuts and speed
 * changes). Slices are the kept parts; anything between them is cut.
 */
export class TimeMap {
  readonly segments: MappedSegment[]
  readonly duration: number

  constructor(slices: Slice[]) {
    const sorted = [...slices].sort((a, b) => a.start - b.start)
    let t = 0
    this.segments = sorted.map((slice) => {
      const len = (slice.end - slice.start) / slice.speed
      const seg = { slice, playStart: t, playEnd: t + len }
      t += len
      return seg
    })
    this.duration = t
  }

  segmentAtPlayback(ms: number): MappedSegment | null {
    if (!this.segments.length) return null
    if (ms <= 0) return this.segments[0]
    for (const s of this.segments) if (ms < s.playEnd) return s
    return this.segments[this.segments.length - 1]
  }

  toSource(playMs: number): number {
    const seg = this.segmentAtPlayback(playMs)
    if (!seg) return 0
    const local = Math.min(Math.max(playMs - seg.playStart, 0), seg.playEnd - seg.playStart)
    return seg.slice.start + local * seg.slice.speed
  }

  /** Null when the source time falls inside a cut. */
  toPlayback(sourceMs: number): number | null {
    for (const s of this.segments) {
      if (sourceMs >= s.slice.start && sourceMs <= s.slice.end) return s.playStart + (sourceMs - s.slice.start) / s.slice.speed
    }
    return null
  }

  /** Nearest playback time for a source time, snapping cut regions to the next kept part. */
  toPlaybackNearest(sourceMs: number): number {
    const direct = this.toPlayback(sourceMs)
    if (direct !== null) return direct
    for (const s of this.segments) if (s.slice.start > sourceMs) return s.playStart
    return this.duration
  }

  sliceAtSource(sourceMs: number): Slice | null {
    for (const s of this.segments) if (sourceMs >= s.slice.start && sourceMs < s.slice.end) return s.slice
    return null
  }

  speedAtSource(sourceMs: number): number {
    return this.sliceAtSource(sourceMs)?.speed ?? 1
  }
}
