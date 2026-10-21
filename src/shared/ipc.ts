import type { AppSettings, SettingsPatch } from './settings'
import type { CaptureSources, PermissionStatus, RecorderState, RecordTarget, Rect } from './recording'
import type { ProjectFile, ProjectSummary } from './project-file'
import type { Preset } from './project'

export interface OpenDialogOptions {
  title?: string
  filters?: { name: string; extensions: string[] }[]
  properties?: ('openFile' | 'openDirectory' | 'multiSelections')[]
  defaultPath?: string
}

export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface ExportedFile {
  name: string
  path: string
  project: string
  size: number
  modifiedAt: string
}

export interface Wallpaper {
  name: string
  path: string
  thumbnail?: string
}

/** Every method is an ipcMain.handle channel of the same name; the preload builds the proxy. */
export interface Api {
  // app
  platform(): Promise<{ arch: string; version: string; userData: string; home: string; resources: string }>
  openExternal(url: string): Promise<void>
  revealInFinder(path: string): Promise<void>
  showOpenDialog(opts: OpenDialogOptions): Promise<string[]>
  showSaveDialog(opts: SaveDialogOptions): Promise<string | null>
  copyFileToClipboard(path: string): Promise<void>
  systemWallpapers(): Promise<Wallpaper[]>
  currentWallpaper(): Promise<string | null>
  playSound(name: 'start' | 'stop'): Promise<void>

  // settings
  getSettings(): Promise<AppSettings>
  updateSettings(patch: SettingsPatch): Promise<AppSettings>

  // capture sources & permissions
  listSources(force?: boolean): Promise<CaptureSources>
  /** Resizes another app's window (points) and centres it on its display; returns the new frame. */
  resizeWindow(windowId: number, width: number, height: number): Promise<Rect>
  permissionStatus(): Promise<PermissionStatus>
  requestPermission(kind: keyof PermissionStatus): Promise<PermissionStatus>
  openPrivacySettings(kind: keyof PermissionStatus): Promise<void>

  // recorder
  recorderState(): Promise<RecorderState>
  beginSelection(mode: 'display' | 'window' | 'area'): Promise<void>
  cancelSelection(): Promise<void>
  startRecording(target: RecordTarget): Promise<void>
  stopRecording(): Promise<void>
  togglePause(): Promise<void>
  restartRecording(): Promise<void>
  cancelRecording(): Promise<void>
  showDeviceMenu(kind: 'camera' | 'microphone' | 'mobile' | 'systemAudio'): Promise<void>
  setOverlayFocus(): Promise<void>

  // windows
  openHome(): Promise<void>
  openToolbar(): Promise<void>
  openSettings(): Promise<void>
  openEditor(projectPath: string): Promise<void>
  closeWindow(): Promise<void>
  setWindowTitle(title: string): Promise<void>
  /** 0..1 shows progress on the Dock icon; a negative value clears it. */
  setProgress(progress: number): Promise<void>

  // projects & files
  listProjects(): Promise<ProjectSummary[]>
  readProject(path: string): Promise<ProjectFile>
  writeProject(path: string, file: ProjectFile): Promise<void>
  renameProject(path: string, name: string): Promise<string>
  duplicateProject(path: string): Promise<string>
  trashProject(path: string): Promise<void>
  saveThumbnail(path: string, jpeg: Uint8Array): Promise<void>
  importVideo(): Promise<string | null>
  /** Files this app exported, newest first (ones deleted since are dropped). */
  listExports(): Promise<ExportedFile[]>
  /** Remembers a finished export so the library can list it. */
  recordExport(path: string, project: string): Promise<void>
  /** Opens an exported file or a project with its default app. */
  openPath(path: string): Promise<void>
  readText(path: string): Promise<string | null>
  writeText(path: string, text: string): Promise<void>
  readBinary(path: string): Promise<Uint8Array | null>
  copyIntoProject(projectPath: string, source: string, folder: string): Promise<string>

  // export file streaming
  fileOpen(path: string): Promise<number>
  fileWrite(handle: number, position: number, data: Uint8Array): Promise<void>
  fileClose(handle: number): Promise<void>
  tempPath(name: string): Promise<string>
  gifEncode(input: string, output: string, opts: { fps: number; width: number; loop: boolean; colors: number }): Promise<void>
  deleteFile(path: string): Promise<void>

  // presets
  listPresets(): Promise<Preset[]>
  savePreset(preset: Preset): Promise<Preset[]>
  deletePreset(id: string): Promise<Preset[]>
  exportPreset(preset: Preset): Promise<string | null>
  importPreset(): Promise<Preset[]>

  // voiceover
  listVoices(): Promise<{ name: string; locale: string; sample: string }[]>
  synthesizeSpeech(text: string, voice: string, rate: number, outDir: string): Promise<{ path: string; duration: number }>
  audioDuration(path: string): Promise<number>

  // models
  /** Downloads a model file once into the app's model cache and returns its bytes. */
  ensureModel(name: string, url: string): Promise<Uint8Array>

  // transcription
  transcriptionLocales(): Promise<{ supported: string[]; installed: string[]; available: boolean }>
  transcribe(audioPath: string, locale: string): Promise<{ index: number; text: string; start: number; end: number; confidence: number }[]>

  // sharing
  shareUpload(path: string, opts: { title: string; endpoint: string; token: string; visibility?: 'public' | 'private' }): Promise<{ url: string }>
}

export type ApiMethod = keyof Api

export const API_METHODS = [
  'platform',
  'openExternal',
  'revealInFinder',
  'showOpenDialog',
  'showSaveDialog',
  'copyFileToClipboard',
  'systemWallpapers',
  'currentWallpaper',
  'playSound',
  'getSettings',
  'updateSettings',
  'listSources',
  'resizeWindow',
  'permissionStatus',
  'requestPermission',
  'openPrivacySettings',
  'recorderState',
  'beginSelection',
  'cancelSelection',
  'startRecording',
  'stopRecording',
  'togglePause',
  'restartRecording',
  'cancelRecording',
  'showDeviceMenu',
  'setOverlayFocus',
  'openHome',
  'openToolbar',
  'openSettings',
  'openEditor',
  'closeWindow',
  'setWindowTitle',
  'setProgress',
  'listProjects',
  'readProject',
  'writeProject',
  'renameProject',
  'duplicateProject',
  'trashProject',
  'saveThumbnail',
  'importVideo',
  'listExports',
  'recordExport',
  'openPath',
  'readText',
  'writeText',
  'readBinary',
  'copyIntoProject',
  'fileOpen',
  'fileWrite',
  'fileClose',
  'tempPath',
  'gifEncode',
  'deleteFile',
  'listPresets',
  'savePreset',
  'deletePreset',
  'exportPreset',
  'importPreset',
  'listVoices',
  'synthesizeSpeech',
  'audioDuration',
  'ensureModel',
  'transcriptionLocales',
  'transcribe',
  'shareUpload',
] as const satisfies readonly (keyof Api)[]

// Compile-time guard: every Api method must be listed above.
type MissingMethods = Exclude<keyof Api, (typeof API_METHODS)[number]>
export const _apiComplete: MissingMethods extends never ? true : MissingMethods = true

export interface MainEvents {
  'recorder:state': RecorderState
  'recorder:countdown': { seconds: number; target: RecordTarget }
  'recorder:highlight': RecordTarget
  'projects:changed': null
  'settings:changed': AppSettings
  'camera:device': string
  'menu:command': string
  /** The main window should show another page. */
  navigate: { route: string; query: Record<string, string> }
  'share:progress': { path: string; progress: number }
  'transcribe:progress': { progress: number; phase: 'download' | 'transcribe' }
}

export interface Bridge {
  api: Api
  on<K extends keyof MainEvents>(channel: K, cb: (payload: MainEvents[K]) => void): () => void
  pathForFile(file: File): string
}
