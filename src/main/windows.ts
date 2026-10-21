import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { is, isSafeExternalUrl } from './util'

export type Route =
  | 'home'
  | 'toolbar'
  | 'overlay'
  | 'controls'
  | 'camera'
  | 'editor'
  | 'settings'
  | 'notes'
  | 'welcome'

const windows = new Map<string, BrowserWindow>()

function load(win: BrowserWindow, route: Route, query: Record<string, string> = {}) {
  const hash = `/${route}${Object.keys(query).length ? '?' + new URLSearchParams(query) : ''}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    win.loadURL(`app://renderer/index.html#${hash}`)
  }
}

function create(key: string, route: Route, opts: BrowserWindowConstructorOptions, query: Record<string, string> = {}) {
  const existing = windows.get(key)
  if (existing && !existing.isDestroyed()) return existing
  const win = new BrowserWindow({
    show: false,
    backgroundColor: opts.transparent ? '#00000000' : '#121214',
    ...opts,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
      ...opts.webPreferences,
    },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The renderer has a privileged bridge; it never navigates away from the app.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // The floating capture UI (bar, pickers, controls pill, camera preview, notes) is marked
  // non-shareable, so macOS keeps it out of every screen capture — ours and anyone else's —
  // while the main window records like any other app window.
  if (CAPTURE_UI.has(route)) win.setContentProtection(true)
  windows.set(key, win)
  win.on('closed', () => windows.delete(key))
  load(win, route, query)
  return win
}

const CAPTURE_UI: ReadonlySet<Route> = new Set<Route>(['toolbar', 'overlay', 'controls', 'camera', 'notes'])

export const getWindow = (key: string) => {
  const w = windows.get(key)
  return w && !w.isDestroyed() ? w : undefined
}

export const allWindows = () => [...windows.values()].filter((w) => !w.isDestroyed())

export function broadcast(channel: string, payload: unknown) {
  for (const w of allWindows()) w.webContents.send(channel, payload)
}

/** Library, editor, settings and onboarding are pages of one main window. */
function showMain(route: Route, query: Record<string, string> = {}) {
  const existing = getWindow('main')
  if (existing) {
    existing.webContents.send('navigate', { route, query })
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(1600, display.workArea.width - 80)
  const height = Math.min(1000, display.workArea.height - 60)
  const win = create('main', route, {
    width,
    height,
    minWidth: 1080,
    minHeight: 680,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#121214',
  }, query)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  return win
}

export const openHome = () => showMain('home')
export const openSettings = () => showMain('settings')
export const openWelcome = () => showMain('welcome')
export const openEditor = (projectPath: string, autoExport?: string) => showMain('editor', { project: projectPath, ...(autoExport ? { autoExport } : {}) })

export function openToolbar() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = 700
  const height = 160
  const win = create('toolbar', 'toolbar', {
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height - height - 28),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.once('ready-to-show', () => win.show())
  if (win.webContents.isLoading()) return win
  win.show()
  win.focus()
  return win
}

export function closeToolbar() {
  getWindow('toolbar')?.close()
}

/** One transparent full-screen overlay per display for picking displays/windows/areas and the countdown. */
export function openOverlays(query: Record<string, string>) {
  closeOverlays()
  for (const d of screen.getAllDisplays()) {
    const win = create(`overlay:${d.id}`, 'overlay', {
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      enableLargerThanScreen: true,
      focusable: true,
    }, { ...query, displayId: String(d.id) })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setBounds(d.bounds)
    win.once('ready-to-show', () => win.showInactive())
  }
}

export function closeOverlays() {
  // destroy() is synchronous, so reopening overlays in the same tick gets fresh windows.
  for (const [key, w] of windows) if (key.startsWith('overlay:') && !w.isDestroyed()) w.destroy()
}

export function overlayWindows() {
  return [...windows.entries()].filter(([k, w]) => k.startsWith('overlay:') && !w.isDestroyed()).map(([, w]) => w)
}

/** Small pill with timer / pause / stop shown during recording. */
export function openControls(nearDisplayId?: number) {
  const display = screen.getAllDisplays().find((d) => d.id === nearDisplayId) ?? screen.getPrimaryDisplay()
  // Room around the pill so its shadow and the inline confirm ("Discard take?") are never clipped.
  const width = 560
  const height = 112
  const win = create('controls', 'controls', {
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height - height - 16),
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    focusable: false,
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.once('ready-to-show', () => win.showInactive())
  return win
}

export function closeControls() {
  getWindow('controls')?.close()
}

/** Draggable round webcam preview. Excluded from capture because it belongs to this process. */
export function openCameraPreview(cameraLabel: string) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const size = 200
  const existing = getWindow('camera')
  if (existing) {
    existing.webContents.send('camera:device', cameraLabel)
    return existing
  }
  const win = create('camera', 'camera', {
    width: size,
    height: size,
    x: display.workArea.x + display.workArea.width - size - 32,
    y: display.workArea.y + display.workArea.height - size - 120,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    minWidth: 120,
    minHeight: 120,
    maxWidth: 480,
    maxHeight: 480,
  }, { label: cameraLabel })
  win.setAspectRatio(1)
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.once('ready-to-show', () => win.showInactive())
  return win
}

export function closeCameraPreview() {
  getWindow('camera')?.close()
}


/** Teleprompter for speaker notes; belongs to this process so it's never captured. */
export function openSpeakerNotes() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = 380
  const win = create('notes', 'notes', {
    width,
    height: 260,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: display.workArea.y + 12,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    minWidth: 240,
    minHeight: 120,
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.once('ready-to-show', () => win.showInactive())
  return win
}

export function closeSpeakerNotes() {
  getWindow('notes')?.close()
}

export function toggleSpeakerNotes() {
  if (getWindow('notes')) closeSpeakerNotes()
  else openSpeakerNotes()
}


