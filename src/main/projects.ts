import { shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ffmpegPath } from './system'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PROJECT_EXT, isProjectPath, projectName } from '@shared/project-path'
import { randomUUID } from 'node:crypto'
import { getSettings } from './store'
import type { ProjectFile, ProjectSummary } from '@shared/project-file'
import type { RecordingMeta } from '@shared/recording'

export { PROJECT_EXT, isProjectPath, projectName }
const execFileAsync = promisify(execFile)

export function projectsDir() {
  const dir = getSettings().general.projectsDir
  mkdirSync(dir, { recursive: true })
  return dir
}

function timestampName(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Recording ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
}

function uniquePath(dir: string, name: string) {
  let candidate = join(dir, name + PROJECT_EXT)
  let i = 2
  while (existsSync(candidate)) candidate = join(dir, `${name} ${i++}${PROJECT_EXT}`)
  return candidate
}

/** Reserves a project package and returns where the helper should write the raw recording. */
export function reserveProject() {
  const name = timestampName()
  const path = uniquePath(projectsDir(), name)
  mkdirSync(join(path, 'recording'), { recursive: true })
  return { path, name: projectName(path), recordingDir: join(path, 'recording') }
}

export function finalizeProject(path: string, name: string) {
  const file: ProjectFile = {
    version: 1,
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    recordings: ['recording'],
    config: null,
  }
  writeFileSync(join(path, 'project.json'), JSON.stringify(file, null, 2))
  return file
}

export function readProject(path: string): ProjectFile {
  return JSON.parse(readFileSync(join(path, 'project.json'), 'utf8'))
}

export function writeProject(path: string, file: ProjectFile) {
  file.updatedAt = new Date().toISOString()
  const tmp = join(path, 'project.json.tmp')
  writeFileSync(tmp, JSON.stringify(file))
  renameSync(tmp, join(path, 'project.json'))
}

export function saveThumbnail(path: string, jpeg: Buffer) {
  writeFileSync(join(path, 'thumbnail.jpg'), jpeg)
}

export function listProjects(): ProjectSummary[] {
  const dir = projectsDir()
  const out: ProjectSummary[] = []
  for (const entry of readdirSync(dir)) {
    if (!isProjectPath(entry)) continue
    const path = join(dir, entry)
    try {
      const file = readProject(path)
      let duration = 0
      try {
        const meta: RecordingMeta = JSON.parse(readFileSync(join(path, file.recordings[0], 'meta.json'), 'utf8'))
        duration = meta.duration
      } catch {
        /* recording still being written */
      }
      const thumb = join(path, 'thumbnail.jpg')
      out.push({
        path,
        id: file.id,
        name: file.name,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt ?? statSync(path).mtime.toISOString(),
        duration,
        thumbnail: existsSync(thumb) ? thumb : null,
      })
    } catch {
      /* not a valid project */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function renameProject(path: string, name: string) {
  const clean = name.replace(/[/:]/g, '-').trim() || 'Untitled'
  const target = uniquePath(dirname(path), clean)
  renameSync(path, target)
  const file = readProject(target)
  file.name = projectName(target)
  writeProject(target, file)
  return target
}

export function duplicateProject(path: string) {
  const file = readProject(path)
  const target = uniquePath(dirname(path), `${file.name} copy`)
  cpSync(path, target, { recursive: true })
  const copy = readProject(target)
  copy.id = randomUUID()
  copy.name = projectName(target)
  copy.createdAt = new Date().toISOString()
  writeProject(target, copy)
  return target
}

export async function trashProject(path: string) {
  await shell.trashItem(path)
}

/**
 * Turns packages left behind by a crash (no project.json yet) into projects. The helper writes
 * fragmented MP4s plus meta.partial.json/events.json checkpoints, so most of the take survives.
 */
export async function recoverUnfinished(activeRecordingDir?: string): Promise<string[]> {
  const recovered: string[] = []
  const dir = projectsDir()
  for (const entry of readdirSync(dir)) {
    if (!isProjectPath(entry)) continue
    const path = join(dir, entry)
    const rec = join(path, 'recording')
    if (existsSync(join(path, 'project.json')) || rec === activeRecordingDir) continue
    if (!existsSync(join(rec, 'screen.mp4'))) continue
    if (!existsSync(join(rec, 'meta.json')) && existsSync(join(rec, 'meta.partial.json'))) {
      cpSync(join(rec, 'meta.partial.json'), join(rec, 'meta.json'))
    }
    // A crash leaves fragmented files without their index; a stream copy rebuilds a normal MP4.
    for (const f of ['screen.mp4', 'camera.mp4', 'mic.m4a', 'system.m4a']) {
      const src = join(rec, f)
      if (!existsSync(src)) continue
      const tmp = join(rec, `fixed-${f}`)
      try {
        await execFileAsync(ffmpegPath(), ['-v', 'error', '-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', tmp])
        renameSync(tmp, src)
      } catch {
        /* keep the original; partial data is better than none */
      }
    }
    finalizeProject(path, `${projectName(path)} (recovered)`)
    recovered.push(path)
  }
  return recovered
}
