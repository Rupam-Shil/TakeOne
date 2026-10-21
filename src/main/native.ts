import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CaptureSources, PermissionStatus, Rect } from '@shared/recording'

const HELPER = join('Studio Clone Helper.app', 'Contents', 'MacOS', 'studio-recorder')

export function helperPath(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'bin', HELPER),
    join(app.getAppPath(), 'resources', 'bin', HELPER),
    join(__dirname, '../../resources/bin', HELPER),
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error('studio-recorder helper is missing — run `npm run build:native`')
  return found
}

/** Runs a one-shot helper command and resolves with its first JSON event. */
function runOnce<T>(args: string[], timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), args)
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`studio-recorder ${args[0]} timed out`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const line = out.split('\n').find((l) => l.trim().startsWith('{'))
      if (!line) return reject(new Error(err || `studio-recorder ${args[0]} produced no output`))
      try {
        const parsed = JSON.parse(line)
        if (parsed.event === 'error') return reject(new Error(parsed.message))
        resolve(parsed as T)
      } catch (e) {
        reject(e as Error)
      }
    })
  })
}

let inflight: Promise<CaptureSources> | null = null
let cached: { at: number; value: CaptureSources } | null = null
let mobile: { at: number; value: CaptureSources['mobileDevices'] } = { at: 0, value: [] }
let mobileInflight: Promise<void> | null = null

/** iPhone/iPad discovery is slow (CoreMediaIO), so it refreshes in the background. */
function refreshMobile() {
  if (mobileInflight || Date.now() - mobile.at < 10000) return
  mobileInflight = runOnce<CaptureSources>(['list', '--devices', '--exclude-pid', String(process.pid)], 30000)
    .then((r) => void (mobile = { at: Date.now(), value: r.mobileDevices }))
    .catch(() => void (mobile.at = Date.now()))
    .finally(() => (mobileInflight = null))
}

/** Displays, windows and devices; concurrent callers share one helper run. */
export async function listSources(force = false): Promise<CaptureSources> {
  refreshMobile()
  if (force) cached = null
  if (cached && Date.now() - cached.at < 1500) return { ...cached.value, mobileDevices: mobile.value }
  inflight ??= runOnce<CaptureSources>(['list', '--exclude-pid', String(process.pid)])
    .then((value) => {
      cached = { at: Date.now(), value }
      return value
    })
    .finally(() => (inflight = null))
  const value = await inflight
  return { ...value, mobileDevices: mobile.value }
}

/** Resizes a window through the helper (needs Accessibility); the source cache is dropped so frames refresh. */
export async function resizeWindow(windowId: number, width: number, height: number): Promise<Rect> {
  const r = await runOnce<{ frame: Rect }>(['resize-window', String(windowId), String(Math.round(width)), String(Math.round(height))])
  cached = null
  return r.frame
}

export function permissionStatus(): Promise<PermissionStatus> {
  return runOnce<PermissionStatus>(['permissions'])
}

export function requestPermission(kind: keyof PermissionStatus): Promise<PermissionStatus> {
  return runOnce<PermissionStatus>(['request-permission', kind], 120000)
}

export interface HelperEvent {
  event: string
  [k: string]: unknown
}

/** A live recording process controlled over stdin. */
export class RecordingProcess {
  private child: ChildProcessWithoutNullStreams
  private buffer = ''
  private listeners = new Set<(e: HelperEvent) => void>()
  readonly exited: Promise<number | null>

  constructor(config: object) {
    this.child = spawn(helperPath(), ['record', JSON.stringify(config)])
    this.child.stdout.on('data', (d: Buffer) => {
      this.buffer += d.toString()
      let i: number
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim()
        this.buffer = this.buffer.slice(i + 1)
        if (!line.startsWith('{')) continue
        try {
          const e = JSON.parse(line) as HelperEvent
          this.listeners.forEach((l) => l(e))
        } catch {
          /* ignore partial lines */
        }
      }
    })
    this.child.stderr.on('data', (d) => process.stderr.write(d))
    this.child.on('error', (e) => this.listeners.forEach((l) => l({ event: 'error', message: e.message })))
    this.child.stdin.on('error', () => {})
    this.exited = new Promise((resolve) => this.child.on('close', (code) => resolve(code)))
  }

  on(listener: (e: HelperEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  waitFor(names: string[], timeoutMs = 20000): Promise<HelperEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`timed out waiting for ${names.join('/')}`))
      }, timeoutMs)
      const off = this.on((e) => {
        if (names.includes(e.event) || e.event === 'error') {
          clearTimeout(timer)
          off()
          e.event === 'error' && !names.includes('error') ? reject(new Error(String(e.message))) : resolve(e)
        }
      })
    })
  }

  send(command: 'go' | 'pause' | 'resume' | 'stop' | 'cancel' | 'marker') {
    if (!this.child.stdin.destroyed) this.child.stdin.write(command + '\n')
  }

  kill() {
    this.child.kill('SIGKILL')
  }
}

export interface TranscribedWord {
  index: number
  text: string
  start: number
  end: number
  confidence: number
}

export function transcriptionLocales(): Promise<{ supported: string[]; installed: string[]; available: boolean }> {
  return runOnce(['locales'], 30000)
}

/** Streams word timings from the on-device recognizer; `onProgress` receives 0..1. */
export function transcribe(file: string, locale: string, onProgress: (p: number, phase: 'download' | 'transcribe') => void): Promise<TranscribedWord[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), ['transcribe', file, '--locale', locale])
    const words: TranscribedWord[] = []
    let buf = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith('{')) continue
        try {
          const e = JSON.parse(line)
          if (e.event === 'word') {
            words.push({ index: e.index, text: e.text, start: e.start, end: e.end, confidence: e.confidence })
            onProgress(e.progress ?? 0, 'transcribe')
          } else if (e.event === 'download') onProgress(e.progress ?? 0, 'download')
          else if (e.event === 'error') err = e.message
        } catch {
          /* a consumer went away or a line was malformed; keep going */
        }
      }
    })
    child.stderr.on('data', (d) => process.stderr.write(d))
    child.on('error', (e) => reject(e))
    child.on('close', (code) => (code === 0 && !err ? resolve(words) : reject(new Error(err || `transcription exited with ${code}`))))
  })
}
