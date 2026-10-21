import { app, dialog } from 'electron'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Preset } from '@shared/project'

const dir = () => {
  const d = join(app.getPath('userData'), 'presets')
  mkdirSync(d, { recursive: true })
  return d
}

export function listPresets(): Preset[] {
  const out: Preset[] = []
  for (const f of readdirSync(dir())) {
    if (!f.endsWith('.json')) continue
    try {
      const p = JSON.parse(readFileSync(join(dir(), f), 'utf8'))
      if (isPreset(p)) out.push(p)
    } catch {
      /* skip corrupt preset */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const isPreset = (p: unknown): p is Preset => !!p && typeof p === 'object' && typeof (p as Preset).name === 'string' && !!(p as Preset).style && typeof (p as Preset).style === 'object'
const safeId = (id: string) => /^[\w-]+$/.test(id)

export function savePreset(preset: Preset) {
  if (!isPreset(preset)) throw new Error('Not a valid preset')
  const p = { ...preset, id: preset.id && safeId(preset.id) ? preset.id : randomUUID() }
  writeFileSync(join(dir(), `${p.id}.json`), JSON.stringify(p, null, 2))
  return listPresets()
}

export function deletePreset(id: string) {
  if (safeId(id)) rmSync(join(dir(), `${id}.json`), { force: true })
  return listPresets()
}

/** Presets travel as `<name>.takeonepreset` folders holding preset.json, mirroring project packages. */
export async function exportPreset(preset: Preset) {
  const r = await dialog.showSaveDialog({
    defaultPath: `${preset.name}.takeonepreset`,
    filters: [{ name: 'Take One Preset', extensions: ['takeonepreset'] }],
  })
  if (r.canceled || !r.filePath) return null
  mkdirSync(r.filePath, { recursive: true })
  writeFileSync(join(r.filePath, 'preset.json'), JSON.stringify(preset, null, 2))
  return r.filePath
}

export async function importPreset() {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'openDirectory'],
    // .studiopreset is the format from before the rename to Take One.
    filters: [{ name: 'Take One Preset', extensions: ['takeonepreset', 'studiopreset', 'json'] }],
  })
  for (const p of r.filePaths) {
    try {
      const file = p.endsWith('.json') ? p : join(p, 'preset.json')
      const preset = JSON.parse(readFileSync(file, 'utf8')) as Preset
      if (isPreset(preset)) savePreset({ ...preset, id: randomUUID() })
    } catch {
      /* ignore invalid files */
    }
  }
  return listPresets()
}
