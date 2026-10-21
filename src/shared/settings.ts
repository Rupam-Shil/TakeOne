import type { Size } from './recording'

export interface ShortcutSettings {
  startStopRecording: string
  recordDisplay: string
  recordWindow: string
  recordArea: string
  pauseResumeRecording: string
  restartRecording: string
  cancelRecording: string
  addMarker: string
  toggleSpeakerNotes: string
}

export interface AppSettings {
  recording: {
    fps: 30 | 60
    cameraId: string | null
    microphoneId: string | null
    systemAudio: boolean
    /** Bundle ids whose audio to record; empty records every app. */
    systemAudioApps: string[]
    /** Window sizes (points) the user saved for "resize before recording". */
    windowSizes: Size[]
    hideDesktopIcons: boolean
    countdown: 0 | 3 | 5 | 10
    keystrokes: 'off' | 'shortcuts' | 'all'
    showCameraPreview: boolean
    playSounds: boolean
    /** Dim everything outside the recorded area/window while recording. */
    highlightRecordedArea: boolean
    autoZoom: boolean
    cameraMaxHeight: 720 | 1080 | 2160
    afterRecording: 'open-editor' | 'export-clipboard' | 'export-file' | 'export-link'
    speakerNotes: { enabled: boolean; text: string; speed: number; opacity: number; fontSize: number }
  }
  export: {
    format: 'mp4' | 'gif'
    fps: number
    height: number
    quality: 'studio' | 'social-media' | 'web-high' | 'web-low'
    codec: 'h264' | 'h265' | 'av1' | 'both'
    gifFps: number
    gifHeight: number
    gifHighQuality: boolean
    gifLoop: boolean
    target: 'file' | 'clipboard' | 'link'
  }
  share: { endpoint: string; token: string; visibility: 'public' | 'private' }
  general: {
    projectsDir: string
    openEditorAfterRecording: boolean
    launchAtLogin: boolean
    showInDock: boolean
    defaultPresetId: string | null
    exportDir: string
    autosave: boolean
    useLastProjectSettings: boolean
    onboarded: boolean
  }
  shortcuts: ShortcutSettings
}

export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  startStopRecording: 'CommandOrControl+Control+Return',
  recordDisplay: 'CommandOrControl+Alt+3',
  recordWindow: 'CommandOrControl+Alt+4',
  recordArea: 'CommandOrControl+Alt+5',
  pauseResumeRecording: 'CommandOrControl+Alt+P',
  restartRecording: 'CommandOrControl+Alt+Backspace',
  cancelRecording: '',
  addMarker: 'CommandOrControl+Control+Alt+F',
  toggleSpeakerNotes: 'CommandOrControl+Alt+.',
}

export function defaultSettings(home: { projectsDir: string; exportDir: string }): AppSettings {
  return {
    recording: {
      fps: 60,
      cameraId: null,
      microphoneId: null,
      systemAudio: true,
      systemAudioApps: [],
      windowSizes: [],
      hideDesktopIcons: false,
      countdown: 3,
      keystrokes: 'shortcuts',
      showCameraPreview: true,
      playSounds: true,
      highlightRecordedArea: true,
      autoZoom: true,
      cameraMaxHeight: 1080,
      afterRecording: 'open-editor',
      speakerNotes: { enabled: false, text: '', speed: 5, opacity: 1, fontSize: 14 },
    },
    export: {
      format: 'mp4',
      fps: 60,
      height: 1080,
      quality: 'social-media',
      codec: 'h264',
      gifFps: 15,
      gifHeight: 480,
      gifHighQuality: true,
      gifLoop: true,
      target: 'file',
    },
    share: { endpoint: '', token: '', visibility: 'public' },
    general: {
      projectsDir: home.projectsDir,
      openEditorAfterRecording: true,
      launchAtLogin: false,
      showInDock: true,
      defaultPresetId: null,
      exportDir: home.exportDir,
      autosave: true,
      useLastProjectSettings: true,
      onboarded: false,
    },
    shortcuts: { ...DEFAULT_SHORTCUTS },
  }
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }
export type SettingsPatch = DeepPartial<AppSettings>

export function mergeSettings<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null) {
      out[k] = mergeSettings(out[k], v as any)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}
