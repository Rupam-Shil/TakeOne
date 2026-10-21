import { existsSync, rmSync, statfsSync } from 'node:fs'
import { join } from 'node:path'
import { Notification } from 'electron'
import { playSound } from './system'
import type { RecordTarget, RecorderState } from '@shared/recording'
import { RecordingProcess } from './native'
import { finalizeProject, recoverUnfinished, reserveProject } from './projects'
import { getSettings } from './store'
import { sleep } from './util'
import {
  broadcast,
  closeCameraPreview,
  closeControls,
  closeOverlays,
  closeToolbar,
  openCameraPreview,
  openControls,
  openEditor,
  openHome,
  openOverlays,
  openSpeakerNotes,
  closeSpeakerNotes,
  overlayWindows,
} from './windows'

let state: RecorderState = { phase: 'idle', elapsed: 0, startedAt: null, target: null }
let proc: RecordingProcess | null = null
let current: { path: string; name: string; recordingDir: string } | null = null
let accumulated = 0
let countdownAbort: (() => void) | null = null
const stateListeners = new Set<(s: RecorderState) => void>()

export const getRecorderState = () => ({
  ...state,
  elapsed: accumulated + (state.phase === 'recording' && state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0),
})

export const onRecorderState = (l: (s: RecorderState) => void) => {
  stateListeners.add(l)
  return () => stateListeners.delete(l)
}

function setState(patch: Partial<RecorderState>) {
  state = { ...state, ...patch }
  const s = getRecorderState()
  broadcast('recorder:state', s)
  stateListeners.forEach((l) => l(s))
}

/** Opens the per-display overlays so the user can pick what to record. */
export function beginSelection(mode: 'display' | 'window' | 'area') {
  if (state.phase !== 'idle' && state.phase !== 'selecting') return
  setState({ phase: 'selecting', error: undefined })
  openOverlays({ mode })
}

/** Drops a helper that was warming the camera up for a countdown that got cancelled. */
async function discardWarmup() {
  const p = proc
  const project = current
  proc = null
  current = null
  if (!p) return
  p.send('cancel')
  const exited = await Promise.race([p.exited.then(() => true), sleep(3000).then(() => false)])
  if (!exited) p.kill()
  if (project) rmSync(project.path, { recursive: true, force: true })
}

export function cancelSelection() {
  if (state.phase !== 'selecting' && state.phase !== 'countdown') return
  countdownAbort?.()
  closeOverlays()
  setState({ phase: 'idle', target: null })
}

/** Helper config for a take; `waitForGo` lets it warm the camera up during the countdown. */
function recorderConfig(target: RecordTarget, recordingDir: string, waitForGo: boolean) {
  const settings = getSettings().recording
  return {
    outputDir: recordingDir,
    source: target,
    fps: settings.fps,
    microphoneId: settings.microphoneId,
    cameraId: settings.cameraId,
    captureSystemAudio: settings.systemAudio,
    systemAudioApps: settings.systemAudioApps,
    hideDesktopIcons: settings.hideDesktopIcons,
    // Our own windows are not excluded by process: the recording UI hides itself via content protection,
    // and the main window must stay recordable (people demo the editor itself).
    keystrokes: settings.keystrokes,
    cameraMaxHeight: settings.cameraMaxHeight,
    waitForGo,
  }
}

/** Called by an overlay (or the toolbar for devices) once a target is chosen. */
export async function startRecording(target: RecordTarget) {
  if (state.phase !== 'idle' && state.phase !== 'selecting') return
  const settings = getSettings().recording
  setState({ phase: 'countdown', target })

  const countdown = settings.countdown > 0 && target.type !== 'device'
  // A camera needs about 1.5 s before it delivers real frames. Launching the helper now lets it warm up
  // behind the countdown; it only starts capturing when it gets "go".
  if (countdown && settings.cameraId) {
    current = reserveProject()
    accumulated = 0
    proc = new RecordingProcess(recorderConfig(target, current.recordingDir, true))
  }

  if (countdown) {
    if (!overlayWindows().length) openOverlays({ mode: 'countdown' })
    broadcast('recorder:countdown', { seconds: settings.countdown, target })
    const aborted = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), settings.countdown * 1000)
      countdownAbort = () => {
        clearTimeout(timer)
        resolve(true)
      }
    })
    countdownAbort = null
    if (aborted) {
      await discardWarmup()
      return
    }
  }
  // Overlays must be gone before the first frame or they'd be captured on other displays.
  const keepHighlight = settings.highlightRecordedArea && target.type !== 'display' && target.type !== 'device'
  if (keepHighlight) {
    for (const w of overlayWindows()) w.setIgnoreMouseEvents(true)
    broadcast('recorder:highlight', target)
  } else closeOverlays()
  closeToolbar()
  setState({ phase: 'starting' })

  try {
    if (proc && current) {
      proc.send('go')
    } else {
      current = reserveProject()
      accumulated = 0
      proc = new RecordingProcess(recorderConfig(target, current.recordingDir, false))
    }
    proc.on((e) => {
      if (e.event === 'streamError') {
        new Notification({ title: 'Recording interrupted', body: String(e.message ?? '') }).show()
        void stopRecording()
      }
    })
    const started = proc
    proc.exited.then(() => {
      if (proc !== started || (state.phase !== 'recording' && state.phase !== 'paused')) return
      // The helper died mid-take: keep what it wrote and turn it into a project right away.
      proc = null
      current = null
      teardownRecordingUi()
      setState({ phase: 'idle', error: 'Recorder exited unexpectedly', target: null, startedAt: null })
      new Notification({ title: 'Recording stopped unexpectedly', body: 'Recovering what was captured…' }).show()
      void recoverUnfinished().then((paths) => {
        broadcast('projects:changed', null)
        if (paths.length) openEditor(paths[0])
      })
    })
    await Promise.race([
      proc.waitFor(['firstFrame'], 15000),
      proc.exited.then(() => {
        throw new Error('The recorder quit before capturing a frame')
      }),
    ])
    if (settings.playSounds) playSound('start')
    setState({ phase: 'recording', startedAt: Date.now() })
    startDiskWatch()
    openControls(target.displayId)
    if (settings.cameraId && settings.showCameraPreview) {
      openCameraPreview(cameraLabel(settings.cameraId))
    }
    if (settings.speakerNotes.enabled) openSpeakerNotes()
  } catch (err) {
    proc?.kill()
    proc = null
    closeOverlays()
    if (current) rmSync(current.path, { recursive: true, force: true })
    current = null
    const message = err instanceof Error ? err.message : String(err)
    setState({ phase: 'idle', error: message, target: null, startedAt: null })
    new Notification({ title: 'Could not start recording', body: message }).show()
  }
}

let knownCameras: { id: string; name: string }[] = []
export const rememberCameras = (cams: { id: string; name: string }[]) => (knownCameras = cams)
const cameraLabel = (id: string) => knownCameras.find((c) => c.id === id)?.name ?? id

export function togglePause() {
  if (!proc) return
  if (state.phase === 'recording') {
    accumulated += state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0
    proc.send('pause')
    setState({ phase: 'paused', startedAt: null })
  } else if (state.phase === 'paused') {
    proc.send('resume')
    setState({ phase: 'recording', startedAt: Date.now() })
  }
}

function teardownRecordingUi() {
  stopDiskWatch()
  closeControls()
  closeCameraPreview()
  closeSpeakerNotes()
  closeOverlays()
}

let diskTimer: NodeJS.Timeout | null = null

/** Stops the recording before the disk fills up (checked every 2.5s, < 1 GB free). */
function startDiskWatch() {
  stopDiskWatch()
  diskTimer = setInterval(() => {
    if (!current) return
    try {
      const st = statfsSync(current.recordingDir)
      if (st.bavail * st.bsize < 1024 ** 3) {
        new Notification({ title: 'Recording stopped due to low disk space', body: 'Free up some space to keep recording.' }).show()
        void stopRecording()
      }
    } catch {
      /* folder vanished */
    }
  }, 2500)
}

function stopDiskWatch() {
  if (diskTimer) clearInterval(diskTimer)
  diskTimer = null
}

export function addMarker() {
  if (state.phase === 'recording') proc?.send('marker')
}

export async function stopRecording() {
  if (!proc || !current || (state.phase !== 'recording' && state.phase !== 'paused')) return
  const p = proc
  const project = current
  setState({ phase: 'stopping' })
  teardownRecordingUi()
  p.send('stop')
  try {
    await p.waitFor(['finished'], 60000)
    if (getSettings().recording.playSounds) playSound('stop')
    finalizeProject(project.path, project.name)
    proc = null
    current = null
    setState({ phase: 'idle', target: null, startedAt: null })
    broadcast('projects:changed', null)
    const after = getSettings().recording.afterRecording
    if (after !== 'open-editor') openEditor(project.path, after.replace('export-', ''))
    else if (getSettings().general.openEditorAfterRecording) openEditor(project.path)
    else openHome()
  } catch (err) {
    p.kill()
    // Nothing usable was written: don't leave a ghost package behind.
    if (!existsSync(join(project.recordingDir, 'screen.mp4'))) rmSync(project.path, { recursive: true, force: true })
    proc = null
    current = null
    setState({ phase: 'idle', error: err instanceof Error ? err.message : String(err), target: null, startedAt: null })
    broadcast('projects:changed', null)
  }
}

export async function cancelRecording() {
  if (state.phase === 'selecting' || state.phase === 'countdown') return cancelSelection()
  if (!proc || (state.phase !== 'recording' && state.phase !== 'paused' && state.phase !== 'starting')) return
  const p = proc
  const project = current
  // Leaving the recording phase first keeps the helper's exit from reading as a crash.
  setState({ phase: 'stopping' })
  teardownRecordingUi()
  p.send('cancel')
  stopDiskWatch()
  const exited = await Promise.race([p.exited.then(() => true), sleep(5000).then(() => false)])
  if (!exited) p.kill()
  if (project) rmSync(project.path, { recursive: true, force: true })
  proc = null
  current = null
  setState({ phase: 'idle', target: null, startedAt: null, error: undefined })
  broadcast('projects:changed', null)
}

export async function restartRecording() {
  const target = state.target
  if (!target || !proc || (state.phase !== 'recording' && state.phase !== 'paused')) return
  await cancelRecording()
  await sleep(300)
  await startRecording(target)
}
