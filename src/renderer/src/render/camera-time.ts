/**
 * Older recordings start the camera ~1.5 s after the screen, and a camera's first frames are black
 * while its sensor settles. Before the camera track begins we hold a frame just past that warm-up
 * instead of frame 0, so the bubble never flashes black.
 */
export const CAMERA_LEAD_S = 0.12

/** Camera file time (seconds) for a source time, held at the lead-in until the track starts. */
export const cameraTime = (sourceMs: number, offset: number) => Math.max(CAMERA_LEAD_S, sourceMs / 1000 - offset)
