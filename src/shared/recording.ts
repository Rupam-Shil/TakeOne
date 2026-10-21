// Formats written by the native capture helper (resources/bin/studio-recorder).

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export type SourceType = 'display' | 'window' | 'area' | 'device'

export interface TrackRef {
  file: string
  /** Seconds between the session origin (first screen frame) and this file's first sample. */
  offset: number
}

export interface RecordingMeta {
  version: 1
  createdAt: string
  source: { type: SourceType; displayId: number | null; windowId: number | null; deviceId: string | null }
  fps: number
  /** Pixels per point of the captured display. */
  scale: number
  /** Captured region in global display points (top-left origin). */
  captureRect: Rect
  videoSize: Size
  duration: number
  pauses: { at: number; duration: number }[]
  tracks: {
    screen: TrackRef | null
    system: TrackRef | null
    mic: TrackRef | null
    camera: TrackRef | null
    cameraSize?: Size
  }
  frames: number
}

export interface ClickEvent {
  t: number
  x: number
  y: number
  button: 'left' | 'right' | 'middle'
  type: 'down' | 'up'
  clickCount?: number
}

export interface KeyEvent {
  t: number
  type: 'down' | 'up' | 'modifiers'
  modifiers: string[]
  keyCode: number
  key?: string
  isRepeat?: boolean
}

export interface CursorImage {
  file?: string
  type?: string
  hotspotX: number
  hotspotY: number
  width: number
  height: number
}

export interface RecordingEvents {
  version: 1
  /** [t, x, y] in global points. */
  mouse: [number, number, number][]
  clicks: ClickEvent[]
  /** [t, x, y, dx, dy] */
  scrolls: [number, number, number, number, number][]
  keys: KeyEvent[]
  cursors: { t: number; id: string }[]
  cursorImages: Record<string, CursorImage>
  /** [t, x, y, w, h] — window recordings only. */
  windowFrames: [number, number, number, number, number][]
  /** Seconds where the user pressed "add marker" while recording. */
  markers?: number[]
  eventTap: boolean
}

export interface DisplayInfo {
  id: number
  name: string
  frame: Rect
  scale: number
  isMain: boolean
}

export interface WindowInfo {
  id: number
  title: string
  appName: string
  bundleId: string
  pid: number
  frame: Rect
}

export interface DeviceInfo {
  id: string
  name: string
  model: string
}

export interface RunningApp {
  bundleId: string
  name: string
  pid: number
}

export interface CaptureSources {
  displays: DisplayInfo[]
  windows: WindowInfo[]
  /** Regular (Dock-visible) apps, for per-app system audio. */
  apps: RunningApp[]
  cameras: DeviceInfo[]
  microphones: DeviceInfo[]
  mobileDevices: DeviceInfo[]
}

export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted'

export interface PermissionStatus {
  screen: PermissionState
  accessibility: PermissionState
  inputMonitoring: PermissionState
  camera: PermissionState
  microphone: PermissionState
}

export interface RecordTarget {
  type: SourceType
  displayId?: number
  windowId?: number
  /** Area recordings: display-local points. */
  rect?: Rect
  deviceId?: string
}

export type RecorderPhase = 'idle' | 'selecting' | 'countdown' | 'starting' | 'recording' | 'paused' | 'stopping'

export interface RecorderState {
  phase: RecorderPhase
  /** Accumulated recorded seconds (excludes pauses). */
  elapsed: number
  startedAt: number | null
  target: RecordTarget | null
  error?: string
}
