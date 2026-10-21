// Editable project model. Times are milliseconds of *source* (recording) time unless noted.

export interface Spring {
  stiffness: number
  damping: number
  mass: number
}

export const SPRINGS = {
  screen: {
    focused: { stiffness: 250, damping: 40, mass: 2.25 },
    smooth: { stiffness: 170, damping: 50, mass: 3 },
  },
  cursor: {
    smooth: { stiffness: 470, damping: 70, mass: 3 },
    medium: { stiffness: 340, damping: 60, mass: 3 },
    rapid: { stiffness: 530, damping: 40, mass: 1 },
  },
  drag: { stiffness: 1000, damping: 40, mass: 1 },
  preClick: { stiffness: 530, damping: 40, mass: 1 },
  opacity: { stiffness: 340, damping: 60, mass: 3 },
  typingFade: { stiffness: 600, damping: 50, mass: 1 },
  tilt: { stiffness: 120, damping: 8, mass: 1 },
  follow: { stiffness: 320, damping: 28, mass: 1 },
  layout: { stiffness: 220, damping: 34, mass: 1.4 },
} satisfies Record<string, Spring | Record<string, Spring>>

export interface Point {
  x: number
  y: number
}

export interface Rect01 {
  x: number
  y: number
  width: number
  height: number
}

export interface GradientStop {
  color: string
  at: number
}

export type BackgroundType = 'wallpaper' | 'gradient' | 'color' | 'image'

export interface BackgroundSettings {
  type: BackgroundType
  /** Built-in wallpaper id ("builtin:aurora-3") or an absolute image path for system wallpapers. */
  wallpaper: string
  color: string
  gradient: { angle: number; stops: GradientStop[] }
  image: string | null
  /** Pixels of blur at 1080p output; applies to wallpaper and image backgrounds. */
  blur: number
}

export interface StyleSettings {
  background: BackgroundSettings
  /** Corner radius in pixels at a 1920px-wide stage. */
  screenRadius: number
  inset: { size: number; color: string; alpha: number }
  shadow: { intensity: number; distance: number; angle: number; blur: number; directional: boolean }
}

export type ClickEffect = 'none' | 'circle' | 'ripple'

/** Cursor art sets; the ids are stored in project files, so existing ones never change. */
export type CursorSetId =
  | 'macos' | 'outline' | 'mono' | 'neon' | 'recorded'
  | 'sunset' | 'ocean' | 'aurora' | 'ember' | 'bubblegum' | 'mint' | 'sapphire' | 'crimson'
  | 'gold' | 'chrome' | 'titanium' | 'copper' | 'obsidian'
  | 'frosted' | 'wire' | 'ink' | 'soft' | 'halo' | 'pixel'
  | 'touch' | 'beacon' | 'ring'

export interface CursorSettings {
  hide: boolean
  /** Rendered cursor height in pixels at a 1080p stage. */
  size: number
  set: CursorSetId
  rotationMode: 'none' | 'tilt' | 'follow'
  tiltAmount: number
  baseRotation: number
  alwaysPointer: boolean
  hideWhenIdleMs: number | null
  loopBeforeEndMs: number | null
  stopMovementLastMs: number
  removeShakePx: number
  optimizeCursorTypes: boolean
  clickEffect: ClickEffect
  clickEffectColor: string
  hideWhileTyping: boolean
}

export interface AnimationSettings {
  screenSpring: Spring
  screenPreset: 'focused' | 'smooth' | 'custom'
  /** Null disables cursor smoothing. */
  cursorSpring: Spring | null
  cursorPreset: 'none' | 'rapid' | 'medium' | 'smooth' | 'custom'
  motionBlur: number
  cameraMotionBlur: boolean
}

export interface ZoomSettings {
  defaultLevel: number
  startAnimationEarly: boolean
  autoZoom: boolean
}

export type LayoutType = 'camera-overlay' | 'screen-only' | 'split-screen' | 'fullscreen-camera' | 'cutout-camera'
export type CameraAnchor = 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'

export interface LayoutSettings {
  type: LayoutType
  overlayAnchor: CameraAnchor
  overlaySize: number
  overlayAspect: '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  /** Camera scale while the screen is zoomed in; 1 keeps it the same size. */
  overlayZoomedScale: number
  splitDirection: 'auto' | 'horizontal' | 'vertical'
  splitFlip: boolean
  splitRatio: number
  splitFill: boolean
  cutoutPosition: 0 | 0.5 | 1
  cutoutSize: number
  /** Frame around the cutout: free silhouette, or clipped to a shape. */
  cutoutShape: CutoutShape
}

export type CutoutShape = 'free' | 'circle' | 'square' | 'rounded' | 'hexagon'

export type CameraLook = 'none' | 'studio' | 'cinema' | 'film' | 'golden' | 'cream' | 'terra' | 'moody' | 'arctic' | 'neon' | 'punch' | 'fade' | 'mono'

export interface CameraSettings {
  hide: boolean
  mirror: boolean
  radiusRatio: number
  shadow: number
  border: number
  borderColor: string
  look: CameraLook
  lookIntensity: number
  sharpen: number
  grain: number
  brightness: number
  backgroundBlur: number
  removeBackground: boolean
  hideDuringSilenceMs: number | null
  /** Zoom into the camera frame (crop), 1 = none. */
  zoom: number
  offset: Point
  /** Keep the face framed using the analysed face track (replaces zoom/offset while on). */
  faceTracking: boolean
}

export interface CaptionSettings {
  enabled: boolean
  font: 'sans-serif' | 'serif' | 'mono'
  size: number
  color: string
  background: string
  backgroundOpacity: number
  position: Point
  wordsReveal: 'line-by-line' | 'word-by-word'
  lineGrowth: 'entire-line' | 'left-anchored' | 'centered'
  wordEntrance: 'appear' | 'fade-in' | 'slide-in'
  highlightColor: string
  showSoundLabels: boolean
}

export interface KeystrokeSettings {
  enabled: boolean
  size: number
  showSingleKeys: boolean
  hidden: string[]
  theme: 'dark' | 'light'
}

export interface AudioSettings {
  volume: number
  muteMic: boolean
  micPreset: 'original' | 'voice' | 'noise-reduction' | 'podcast'
  muteSystem: boolean
  systemVolume: number
  music: string | null
  musicVolume: number
  muteMusic: boolean
  musicFade: boolean
  musicDucking: boolean
  clickSound: 'none' | 'soft' | 'mechanical'
  clickVolume: number
}

export interface DeviceSettings {
  enableFrame: boolean
  frame: string | null
}

export interface OutputSettings {
  aspectRatio: 'auto' | number
  padding: number
  crop: Rect01
}

export interface StyleConfig {
  output: OutputSettings
  style: StyleSettings
  cursor: CursorSettings
  animations: AnimationSettings
  zooms: ZoomSettings
  layout: LayoutSettings
  camera: CameraSettings
  captions: CaptionSettings
  keystrokes: KeystrokeSettings
  audio: AudioSettings
  device: DeviceSettings
}

// Timeline items ------------------------------------------------------------------------------

export interface Slice {
  id: string
  start: number
  end: number
  /** Playback speed multiplier (2 = twice as fast). */
  speed: number
  volume: number
  systemVolume: number
  hideCursor: boolean
  disableSmoothing: boolean
}

export type ZoomMode = 'auto' | 'manual'

export interface Zoom {
  id: string
  start: number
  end: number
  level: number
  mode: ZoomMode
  /** Normalised (0..1) point inside the cropped screen; used by manual zooms. */
  target: Point
  presentation: 'screen' | 'loupe'
  loupeRadius: number
  instant: boolean
  disabled: boolean
  generated?: boolean
}

export interface LayoutSegment {
  id: string
  start: number
  end: number
  layout: LayoutType
  disabled: boolean
}

/** Where masked content moved over time; offsets are normalised to the cropped screen. */
export interface ScrollTrack {
  version: 1
  /** Mask start and rect when the track was analysed; a moved mask needs a new track. */
  start: number
  rect: Rect01
  /** [source ms, dx, dy] */
  samples: [number, number, number][]
}

export interface Mask {
  id: string
  start: number
  end: number
  type: 'blur' | 'highlight' | 'pixelate'
  rect: Rect01
  blur: number
  opacity: number
  radius: number
  disabled: boolean
  /** Follow the content under the mask as it scrolls (needs `track`). */
  followScroll?: boolean
  track?: ScrollTrack
}

export interface TextOverlay {
  id: string
  start: number
  end: number
  text: string
  position: Point
  size: number
  color: string
  background: string
  weight: 400 | 600 | 800
  disabled: boolean
}

export interface VoiceOver {
  id: string
  /** Source time where the voiceover starts. */
  start: number
  /** Length of the audio file in ms. */
  duration: number
  /** End on the source timeline (start + duration for synced voiceovers). */
  end: number
  file: string
  source: 'speech' | 'recording'
  text?: string
  voice?: string
  volume: number
  /** Independent plays at normal speed across cuts; synced follows cuts and speed changes. */
  attach: 'independent' | 'synced'
  muteOriginal: boolean
  disabled: boolean
}

export interface TranscriptWord {
  index: number
  start: number
  end: number
  text: string
  type?: 'word' | 'sound-label'
  hidden?: boolean
}

export interface Transcript {
  language: string
  model: string
  words: TranscriptWord[]
  createdAt: string
}

export interface Timeline {
  slices: Slice[]
  zooms: Zoom[]
  layouts: LayoutSegment[]
  masks: Mask[]
  texts: TextOverlay[]
  voiceOvers: VoiceOver[]
  /** Keystroke group starts (ms) whose typing speed-up suggestion was applied or dismissed. */
  resolvedTypingSuggestions: number[]
  hiddenShortcutGroups: number[]
}

export interface ProjectConfig {
  style: StyleConfig
  timeline: Timeline
  transcript: Transcript | null
}

export interface Preset {
  id: string
  name: string
  style: StyleConfig
  createdAt: string
}

// Defaults ------------------------------------------------------------------------------------

export const DEFAULT_GRADIENT: GradientStop[] = [
  { color: '#4776e6', at: 0 },
  { color: '#8e54e9', at: 1 },
]

export function defaultStyle(): StyleConfig {
  return {
    output: { aspectRatio: 'auto', padding: 0.1, crop: { x: 0, y: 0, width: 1, height: 1 } },
    style: {
      background: {
        type: 'wallpaper',
        wallpaper: 'builtin:graphite',
        color: '#4776e6',
        gradient: { angle: 135, stops: DEFAULT_GRADIENT },
        image: null,
        blur: 0,
      },
      screenRadius: 16,
      inset: { size: 0, color: '#000000', alpha: 0.5 },
      shadow: { intensity: 0.3, distance: 25, angle: 45, blur: 20, directional: true },
    },
    cursor: {
      hide: false,
      size: 48,
      set: 'macos',
      rotationMode: 'tilt',
      tiltAmount: 0.5,
      baseRotation: 0,
      alwaysPointer: false,
      hideWhenIdleMs: null,
      loopBeforeEndMs: null,
      stopMovementLastMs: 0,
      removeShakePx: 500,
      optimizeCursorTypes: true,
      clickEffect: 'circle',
      clickEffectColor: '#dedede',
      hideWhileTyping: true,
    },
    animations: {
      screenSpring: SPRINGS.screen.focused,
      screenPreset: 'focused',
      cursorSpring: SPRINGS.cursor.medium,
      cursorPreset: 'medium',
      motionBlur: 1,
      cameraMotionBlur: true,
    },
    zooms: { defaultLevel: 2, startAnimationEarly: false, autoZoom: true },
    layout: {
      type: 'camera-overlay',
      overlayAnchor: 'bottom-right',
      overlaySize: 0.35,
      overlayAspect: '1:1',
      overlayZoomedScale: 0.8,
      splitDirection: 'auto',
      splitFlip: false,
      splitRatio: 0.5,
      splitFill: false,
      cutoutPosition: 1,
      cutoutSize: 0.5,
      cutoutShape: 'free',
    },
    camera: {
      hide: false,
      mirror: false,
      radiusRatio: 0.5,
      shadow: 0.35,
      border: 0,
      borderColor: '#ffffff',
      look: 'none',
      lookIntensity: 1,
      sharpen: 0,
      grain: 0,
      brightness: 1,
      backgroundBlur: 0,
      removeBackground: false,
      hideDuringSilenceMs: null,
      zoom: 1,
      offset: { x: 0, y: 0 },
      faceTracking: false,
    },
    captions: {
      enabled: false,
      font: 'sans-serif',
      size: 0.05,
      color: '#ffffff',
      background: '#000000',
      backgroundOpacity: 0.72,
      position: { x: 0.5, y: 1 },
      wordsReveal: 'line-by-line',
      lineGrowth: 'left-anchored',
      wordEntrance: 'appear',
      highlightColor: '#ffd84d',
      showSoundLabels: false,
    },
    keystrokes: { enabled: false, size: 0.1, showSingleKeys: false, hidden: [], theme: 'dark' },
    audio: {
      volume: 1,
      muteMic: false,
      micPreset: 'voice',
      muteSystem: false,
      systemVolume: 1,
      music: null,
      musicVolume: 0.05,
      muteMusic: false,
      musicFade: true,
      musicDucking: false,
      clickSound: 'none',
      clickVolume: 0.25,
    },
    device: { enableFrame: true, frame: null },
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function defaultSlice(start: number, end: number): Slice {
  return { id: uid(), start, end, speed: 1, volume: 1, systemVolume: 1, hideCursor: false, disableSmoothing: false }
}

export function emptyTimeline(duration: number): Timeline {
  return {
    slices: [defaultSlice(0, duration)],
    zooms: [],
    layouts: [],
    masks: [],
    texts: [],
    voiceOvers: [],
    resolvedTypingSuggestions: [],
    hiddenShortcutGroups: [],
  }
}

/** Deep-merges stored settings over defaults so projects survive schema additions. */
export function normalizeStyle(partial: Partial<StyleConfig> | undefined): StyleConfig {
  const base = defaultStyle()
  const merge = (a: any, b: any): any => {
    if (b === undefined) return a
    if (a === null || typeof a !== 'object' || Array.isArray(a) || b === null || typeof b !== 'object' || Array.isArray(b)) return b
    const out: any = { ...a }
    for (const k of Object.keys(b)) out[k] = merge(a[k], b[k])
    return out
  }
  return merge(base, partial)
}

export const MIN_DURATION = { slice: 100, zoom: 100, layout: 500, mask: 100, text: 200 }
export const NEW_ITEM_DURATION = 3000
