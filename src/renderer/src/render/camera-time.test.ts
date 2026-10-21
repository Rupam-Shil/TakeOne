import { describe, expect, it } from 'vitest'
import { CAMERA_LEAD_S, cameraTime } from './camera-time'

describe('cameraTime', () => {
  it('holds a frame past the warm-up before a late camera track starts', () => {
    // Camera began 1.5 s after the screen: the first 1.5 s show the held frame, never frame 0.
    expect(cameraTime(0, 1.5)).toBe(CAMERA_LEAD_S)
    expect(cameraTime(900, 1.5)).toBe(CAMERA_LEAD_S)
  })

  it('follows the screen once the camera track has started', () => {
    expect(cameraTime(3000, 1.5)).toBeCloseTo(1.5)
  })

  it('handles a camera that started slightly before the screen', () => {
    expect(cameraTime(1000, -0.02)).toBeCloseTo(1.02)
  })
})
