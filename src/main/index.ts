import { APP_NAME } from './migrate'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { basename, dirname, extname, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Api, ExportedFile } from '@shared/ipc'
import { handleAppProtocol, handleMediaProtocol, registerMediaScheme } from './protocol'
import { listSources, permissionStatus, requestPermission, resizeWindow, transcribe, transcriptionLocales } from './native'
import { getSettings, onSettingsChanged, updateSettings } from './store'
import * as projects from './projects'
import * as presets from './presets'
import * as rec from './recording'
import { audioDuration, currentWallpaper, gifEncode, listVoices, playSound, privacyPane, synthesizeSpeech, systemWallpapers } from './system'
import { isSafeExternalUrl } from './util'
import { allWindows, broadcast, openEditor, openHome, openSettings, openToolbar, openWelcome, toggleSpeakerNotes } from './windows'

registerMediaScheme()
const execFileAsync = promisify(execFile)

/** Journal of files this app exported; the library lists these rather than scanning the export folder. */
const exportsFile = () => join(app.getPath('userData'), 'exports.json')
function readExports(): ExportedFile[] {
  try {
    const list = JSON.parse(readFileSync(exportsFile(), 'utf8'))
    return Array.isArray(list) ? list.filter((e) => e && typeof e.path === 'string') : []
  } catch {
    return []
  }
}
/** Paths handed out by a save dialog this session: the only ones outside the export folder a renderer may journal. */
const issuedSavePaths = new Set<string>()
const EXPORT_EXTS = new Set(['.mp4', '.mov', '.gif'])
const realOrNull = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}
const isInside = (real: string, dir: string) => {
  const d = realOrNull(dir)
  return !!d && real.startsWith(d + sep)
}

function writeExports(list: ExportedFile[]) {
  try {
    writeFileSync(exportsFile(), JSON.stringify(list))
  } catch (err) {
    console.warn('exports journal', err)
  }
}

const openFiles = new Map<number, number>()
/** The webContents of the IPC call being handled (read synchronously at the top of a handler). */
let callerContents: Electron.WebContents | null = null
const callerWindow = () => (callerContents ? BrowserWindow.fromWebContents(callerContents) : null)
let nextHandle = 1

const handlers: Api = {
  async platform() {
    return {
      arch: process.arch,
      version: app.getVersion(),
      userData: app.getPath('userData'),
      home: app.getPath('home'),
      resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
    }
  },
  async openExternal(url) {
    if (!isSafeExternalUrl(url)) throw new Error('Only web links can be opened')
    await shell.openExternal(url)
  },
  async revealInFinder(path) {
    shell.showItemInFolder(path)
  },
  async showOpenDialog(opts) {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], ...opts })
    return r.canceled ? [] : r.filePaths
  },
  async showSaveDialog(opts) {
    const r = await dialog.showSaveDialog(opts)
    if (!r.canceled && r.filePath) issuedSavePaths.add(r.filePath)
    return r.canceled ? null : (r.filePath ?? null)
  },
  async copyFileToClipboard(path) {
    // A file reference on the pasteboard pastes as the video itself in Finder, Slack, Mail…
    await execFileAsync('osascript', ['-e', `set the clipboard to (POSIX file ${JSON.stringify(path)})`])
  },
  systemWallpapers,
  currentWallpaper,
  async playSound(name) {
    playSound(name)
  },

  async getSettings() {
    return getSettings()
  },
  async updateSettings(patch) {
    return updateSettings(patch)
  },

  async listSources(force) {
    const s = await listSources(force)
    rec.rememberCameras(s.cameras ?? [])
    return s
  },
  resizeWindow,
  permissionStatus,
  requestPermission,
  async openPrivacySettings(kind) {
    await shell.openExternal(privacyPane[kind])
  },

  async recorderState() {
    return rec.getRecorderState()
  },
  async beginSelection(mode) {
    rec.beginSelection(mode)
  },
  async cancelSelection() {
    rec.cancelSelection()
  },
  async startRecording(target) {
    void rec.startRecording(target)
  },
  async stopRecording() {
    await rec.stopRecording()
  },
  async togglePause() {
    rec.togglePause()
  },
  async restartRecording() {
    await rec.restartRecording()
  },
  async cancelRecording() {
    await rec.cancelRecording()
  },
  async showDeviceMenu(kind) {
    const sources = await handlers.listSources()
    if (kind === 'mobile') {
      Menu.buildFromTemplate(
        sources.mobileDevices.length
          ? sources.mobileDevices.map((d) => ({ label: `Record ${d.name}`, click: () => void rec.startRecording({ type: 'device', deviceId: d.id }) }))
          : [{ label: 'No iPhone or iPad connected', enabled: false }],
      ).popup()
      return
    }
    const s = getSettings().recording
    if (kind === 'systemAudio') {
      const selected = new Set(s.systemAudioApps)
      const toggleApp = (id: string) => {
        const next = selected.has(id) ? s.systemAudioApps.filter((x) => x !== id) : [...s.systemAudioApps, id]
        updateSettings({ recording: { systemAudio: true, systemAudioApps: next } })
      }
      Menu.buildFromTemplate([
        { label: 'All apps', type: 'radio', checked: s.systemAudio && !selected.size, click: () => updateSettings({ recording: { systemAudio: true, systemAudioApps: [] } }) },
        { label: 'No system audio', type: 'radio', checked: !s.systemAudio, click: () => updateSettings({ recording: { systemAudio: false } }) },
        { type: 'separator' },
        { label: 'Only these apps', enabled: false },
        ...sources.apps.map((a) => ({ label: a.name, type: 'checkbox' as const, checked: s.systemAudio && selected.has(a.bundleId), click: () => toggleApp(a.bundleId) })),
      ]).popup()
      return
    }
    const list = kind === 'camera' ? sources.cameras : sources.microphones
    const selected = kind === 'camera' ? s.cameraId : s.microphoneId
    const set = (id: string | null) =>
      updateSettings({ recording: kind === 'camera' ? { cameraId: id } : { microphoneId: id } })
    const menu = Menu.buildFromTemplate([
      { label: kind === 'camera' ? 'No camera' : 'No microphone', type: 'radio', checked: !selected, click: () => set(null) },
      { type: 'separator' },
      ...list.map((d) => ({ label: d.name, type: 'radio' as const, checked: selected === d.id, click: () => set(d.id) })),
    ])
    menu.popup()
  },
  async setOverlayFocus() {
    const w = callerWindow()
    if (w && !w.isFocused()) w.focus()
  },

  async openHome() {
    openHome()
  },
  async openToolbar() {
    openToolbar()
  },
  async openSettings() {
    openSettings()
  },
  async openEditor(path) {
    openEditor(path)
  },
  async closeWindow() {
    callerWindow()?.close()
  },
  async setWindowTitle(title) {
    callerWindow()?.setTitle(title)
  },
  async setProgress(progress) {
    callerWindow()?.setProgressBar(progress < 0 ? -1 : Math.min(1, progress))
    app.dock?.setBadge(progress < 0 ? '' : `${Math.round(progress * 100)}%`)
  },

  async listProjects() {
    return projects.listProjects()
  },
  async readProject(path) {
    return projects.readProject(path)
  },
  async writeProject(path, file) {
    projects.writeProject(path, file)
  },
  async renameProject(path, name) {
    const p = projects.renameProject(path, name)
    broadcast('projects:changed', null)
    return p
  },
  async duplicateProject(path) {
    const p = projects.duplicateProject(path)
    broadcast('projects:changed', null)
    return p
  },
  async trashProject(path) {
    await projects.trashProject(path)
    broadcast('projects:changed', null)
  },
  async saveThumbnail(path, jpeg) {
    projects.saveThumbnail(path, Buffer.from(jpeg))
    broadcast('projects:changed', null)
  },
  async importVideo() {
    return importVideoAsProject()
  },
  async listExports() {
    const { statSync } = await import('node:fs')
    const kept = readExports().filter((e) => existsSync(e.path))
    if (kept.length !== readExports().length) writeExports(kept)
    return kept
      .map((e) => {
        const st = statSync(e.path)
        return { ...e, size: st.size, modifiedAt: st.mtime.toISOString() }
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  },
  async recordExport(path, project) {
    // Only files this app could have written: an export-extension file in the export folder, or a path a save dialog issued.
    const real = realOrNull(path)
    if (!real || !EXPORT_EXTS.has(extname(real).toLowerCase())) return
    const issued = issuedSavePaths.has(path) || issuedSavePaths.has(real) || issuedSavePaths.has(path.replace(/ \(HEVC\)\.mp4$/i, '.mp4'))
    if (!issued && !isInside(real, getSettings().general.exportDir)) return
    const rest = readExports().filter((e) => e.path !== path)
    writeExports([{ name: basename(path), path, project, size: 0, modifiedAt: new Date().toISOString() }, ...rest].slice(0, 500))
  },
  async openPath(path) {
    const real = realOrNull(path)
    if (!real) throw new Error('File not found')
    const journaled = readExports().some((e) => realOrNull(e.path) === real) && EXPORT_EXTS.has(extname(real).toLowerCase())
    const project = projects.isProjectPath(real) && isInside(real, getSettings().general.projectsDir)
    if (!journaled && !project) throw new Error('Only exported files and projects can be opened')
    await shell.openPath(real)
  },
  async readText(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
  async writeText(path, text) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  },
  async readBinary(path) {
    try {
      return new Uint8Array(readFileSync(path))
    } catch {
      return null
    }
  },
  async copyIntoProject(projectPath, source, folder) {
    // A plain sub-folder name only, so the copy can't land outside the project.
    if (!/^[\w-]+$/.test(folder) || !projects.isProjectPath(projectPath)) throw new Error('Invalid project folder')
    const dir = join(projectPath, folder)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, `${Date.now()}-${basename(source)}`)
    copyFileSync(source, target)
    return target
  },

  async fileOpen(path) {
    mkdirSync(dirname(path), { recursive: true })
    const fd = openSync(path, 'w')
    const h = nextHandle++
    openFiles.set(h, fd)
    return h
  },
  async fileWrite(handle, position, data) {
    const fd = openFiles.get(handle)
    if (fd === undefined) throw new Error('bad file handle')
    writeSync(fd, data, 0, data.byteLength, position)
  },
  async fileClose(handle) {
    const fd = openFiles.get(handle)
    if (fd !== undefined) closeSync(fd)
    openFiles.delete(handle)
  },
  async tempPath(name) {
    const dir = join(tmpdir(), 'take-one')
    mkdirSync(dir, { recursive: true })
    return join(dir, `${Date.now()}-${name}`)
  },
  gifEncode,
  async deleteFile(path) {
    rmSync(path, { force: true })
  },

  async listPresets() {
    return presets.listPresets()
  },
  async savePreset(p) {
    return presets.savePreset(p)
  },
  async deletePreset(id) {
    return presets.deletePreset(id)
  },
  exportPreset: presets.exportPreset,
  importPreset: presets.importPreset,

  listVoices,
  synthesizeSpeech,
  audioDuration,
  async ensureModel(name, url) {
    if (!/^https:\/\/storage\.googleapis\.com\//.test(url) || /[/\\]/.test(name)) throw new Error('Unsupported model source')
    const dir = join(app.getPath('userData'), 'models')
    const file = join(dir, name)
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true })
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Model download failed (${res.status})`)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    }
    return new Uint8Array(readFileSync(file))
  },
  transcriptionLocales,
  async transcribe(audioPath, locale) {
    const sender = callerContents
    return transcribe(audioPath, locale, (progress, phase) => {
      if (sender && !sender.isDestroyed()) sender.send('transcribe:progress', { progress, phase })
    })
  },

  async shareUpload(path, opts) {
    const { shareUpload } = await import('./share')
    return shareUpload(path, opts, (progress) => broadcast('share:progress', { path, progress }))
  },
}

/** Wraps an existing video file as a project so it can be styled like a recording. */
async function importVideoAsProject() {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v'] }],
  })
  if (r.canceled || !r.filePaths[0]) return null
  const src = r.filePaths[0]
  const reserved = projects.reserveProject()
  const ext = extname(src).toLowerCase() || '.mp4'
  copyFileSync(src, join(reserved.recordingDir, `screen${ext}`))
  writeFileSync(join(reserved.recordingDir, 'import.json'), JSON.stringify({ file: `screen${ext}`, source: src }))
  projects.finalizeProject(reserved.path, basename(src, extname(src)))
  broadcast('projects:changed', null)
  openEditor(reserved.path)
  return reserved.path
}

/** Only the app's own pages may call the main-process API (it can read and write files). */
function trustedSender(e: Electron.IpcMainInvokeEvent) {
  const url = e.senderFrame?.url ?? ''
  if (url.startsWith('app://renderer/')) return true
  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  return !!devUrl && url.startsWith(devUrl)
}

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(name, (e, ...args) => {
    if (!trustedSender(e)) throw new Error(`Blocked ${name} from an untrusted page`)
    callerContents = e.sender
    return (fn as (...a: unknown[]) => unknown)(...args)
  })
}

let tray: Tray | null = null

function trayIcon(recording: boolean) {
  // Template images adapt to light/dark menu bars.
  const svg = recording
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect x="4" y="4" width="10" height="10" rx="2" fill="black"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="7" fill="none" stroke="black" stroke-width="1.6"/><circle cx="9" cy="9" r="3.6" fill="black"/></svg>`
  const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))
  const resized = img.resize({ width: 18, height: 18 })
  resized.setTemplateImage(true)
  return resized
}

function setupTray() {
  tray = new Tray(trayIcon(false))
  tray.setToolTip(APP_NAME)
  const idleMenu = () =>
    Menu.buildFromTemplate([
      { label: 'New Recording…', accelerator: getSettings().shortcuts.startStopRecording, click: () => openToolbar() },
      { label: 'Record Display', click: () => rec.beginSelection('display') },
      { label: 'Record Window', click: () => rec.beginSelection('window') },
      { label: 'Record Area', click: () => rec.beginSelection('area') },
      { type: 'separator' },
      { label: 'Projects', click: () => openHome() },
      { label: 'Settings…', click: () => openSettings() },
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, role: 'quit' },
    ])
  const recordingMenu = (paused: boolean) =>
    Menu.buildFromTemplate([
      { label: 'Finish Recording', click: () => void rec.stopRecording() },
      { label: paused ? 'Resume' : 'Pause', click: () => rec.togglePause() },
      { label: 'Restart Recording', click: () => void rec.restartRecording() },
      { type: 'separator' },
      { label: 'Discard Recording', click: () => void rec.cancelRecording() },
    ])
  tray.on('click', () => {
    const s = rec.getRecorderState()
    if (s.phase === 'recording' || s.phase === 'paused') void rec.stopRecording()
    else tray?.popUpContextMenu(idleMenu())
  })
  tray.on('right-click', () => {
    const s = rec.getRecorderState()
    if (s.phase === 'recording' || s.phase === 'paused') tray?.popUpContextMenu(recordingMenu(s.phase === 'paused'))
    else tray?.popUpContextMenu(idleMenu())
  })
  rec.onRecorderState((s) => {
    const active = s.phase === 'recording' || s.phase === 'paused'
    tray?.setImage(trayIcon(active))
    tray?.setTitle(active ? formatTime(s.elapsed) : '')
  })
  setInterval(() => {
    const s = rec.getRecorderState()
    if (s.phase === 'recording') tray?.setTitle(formatTime(s.elapsed))
  }, 500)
}

const formatTime = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function registerShortcuts() {
  globalShortcut.unregisterAll()
  const sc = getSettings().shortcuts
  const bind = (acc: string, fn: () => void) => {
    if (!acc) return
    try {
      globalShortcut.register(acc, fn)
    } catch {
      /* invalid accelerator */
    }
  }
  bind(sc.startStopRecording, () => {
    const s = rec.getRecorderState()
    if (s.phase === 'recording' || s.phase === 'paused') void rec.stopRecording()
    else if (s.phase === 'idle') openToolbar()
  })
  bind(sc.recordDisplay, () => rec.beginSelection('display'))
  bind(sc.recordWindow, () => rec.beginSelection('window'))
  bind(sc.recordArea, () => rec.beginSelection('area'))
  bind(sc.addMarker, () => rec.addMarker())
  bind(sc.toggleSpeakerNotes, () => toggleSpeakerNotes())
  bind(sc.pauseResumeRecording, () => rec.togglePause())
  bind(sc.restartRecording, () => void rec.restartRecording())
  bind(sc.cancelRecording, () => void rec.cancelRecording())
}

/** Text fields keep native undo; everywhere else undo edits the project. */
function editOrSend(w: Electron.BaseWindow | undefined, command: 'undo' | 'redo') {
  const win = w as BrowserWindow | undefined
  if (!win?.webContents) return
  win.webContents
    .executeJavaScript(`!!document.activeElement?.closest('input,textarea,[contenteditable="true"]')`)
    .then((inField: boolean) => (inField ? win.webContents[command]() : win.webContents.send('menu:command', command)))
    .catch(() => win.webContents.send('menu:command', command))
}

function sendMenu(command: string) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', command)
}

function setupMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => openSettings() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Recording', accelerator: 'CommandOrControl+N', click: () => openToolbar() },
        { label: 'Speaker Notes', click: () => toggleSpeakerNotes() },
        { label: 'Import Video…', accelerator: 'CommandOrControl+O', click: () => void importVideoAsProject() },
        { label: 'Projects', accelerator: 'CommandOrControl+Shift+O', click: () => openHome() },
        { type: 'separator' },
        { label: 'Export…', accelerator: 'CommandOrControl+Shift+E', click: () => sendMenu('export') },
        { label: 'Export to Clipboard', accelerator: 'CommandOrControl+Alt+C', click: () => sendMenu('export-clipboard') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CommandOrControl+Z', click: (_m, w) => editOrSend(w, 'undo') },
        { label: 'Redo', accelerator: 'CommandOrControl+Shift+Z', click: (_m, w) => editOrSend(w, 'redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Timeline',
      submenu: [
        { label: 'Play / Pause', accelerator: 'Space', registerAccelerator: false, click: () => sendMenu('play') },
        { label: 'Split at Playhead', accelerator: 'C', registerAccelerator: false, click: () => sendMenu('split') },
        { label: 'Add Zoom', accelerator: 'Z', registerAccelerator: false, click: () => sendMenu('add-zoom') },
        { label: 'Delete Selection', accelerator: 'Backspace', registerAccelerator: false, click: () => sendMenu('delete') },
        { type: 'separator' },
        { label: 'Zoom In Timeline', accelerator: 'CommandOrControl+=', click: () => sendMenu('timeline-zoom-in') },
        { label: 'Zoom Out Timeline', accelerator: 'CommandOrControl+-', click: () => sendMenu('timeline-zoom-out') },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ])
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(async () => {
  handleMediaProtocol()
  handleAppProtocol(join(__dirname, '../renderer'))
  setupMenu()
  setupTray()
  registerShortcuts()
  let launchAtLogin = getSettings().general.launchAtLogin
  onSettingsChanged((s) => {
    registerShortcuts()
    broadcast('settings:changed', s)
    if (s.general.launchAtLogin !== launchAtLogin) {
      launchAtLogin = s.general.launchAtLogin
      try {
        app.setLoginItemSettings({ openAtLogin: launchAtLogin })
      } catch {
        /* unsigned builds can't register login items */
      }
    }
    if (s.general.showInDock) void app.dock?.show()
    else app.dock?.hide()
  })
  if (!getSettings().general.showInDock) app.dock?.hide()
  const iconPath = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources', 'icon.png')
  if (existsSync(iconPath)) app.dock?.setIcon(iconPath)
  // Recovery remuxes with ffmpeg and can take a while; don't hold the first window for it.
  void projects.recoverUnfinished().then((recovered) => {
    if (!recovered.length) return
    broadcast('projects:changed', null)
    new Notification({ title: 'Recovered an unfinished recording', body: 'It was saved to your projects so nothing is lost.' }).show()
  })

  const openArg = process.argv.find((a) => projects.isProjectPath(a)) ?? process.env.STUDIO_OPEN_PROJECT
  if (openArg && existsSync(openArg)) openEditor(openArg)
  else if (!getSettings().general.onboarded) openWelcome()
  else openHome()

  app.on('activate', () => {
    if (!allWindows().some((w) => w.isVisible())) openHome()
  })
})

app.on('window-all-closed', () => {
  // Stay alive in the menu bar like a recorder should.
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('open-file', (e, path) => {
  e.preventDefault()
  if (projects.isProjectPath(path)) app.whenReady().then(() => openEditor(path))
})
