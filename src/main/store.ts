import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, mergeSettings, type AppSettings, type SettingsPatch } from '@shared/settings'

const file = () => join(app.getPath('userData'), 'settings.json')

let cache: AppSettings | null = null
const listeners = new Set<(s: AppSettings) => void>()

export function getSettings(): AppSettings {
  if (cache) return cache
  const defaults = defaultSettings({
    projectsDir: join(app.getPath('videos'), 'Take One'),
    exportDir: app.getPath('downloads'),
  })
  try {
    const { shareTokenEnc, ...raw } = JSON.parse(readFileSync(file(), 'utf8'))
    cache = mergeSettings(defaults, raw)
    try {
      if (shareTokenEnc && safeStorage.isEncryptionAvailable()) {
        cache!.share.token = safeStorage.decryptString(Buffer.from(shareTokenEnc, 'base64'))
      }
    } catch {
      /* keychain changed; the user re-enters the token */
    }
  } catch {
    cache = defaults
  }
  return cache!
}

/** The share token is kept encrypted with the login keychain, never in plain JSON. */
function serialize(s: AppSettings) {
  if (!s.share.token || !safeStorage.isEncryptionAvailable()) return JSON.stringify({ ...s, share: { ...s.share, token: '' } }, null, 2)
  const shareTokenEnc = safeStorage.encryptString(s.share.token).toString('base64')
  return JSON.stringify({ ...s, share: { ...s.share, token: '' }, shareTokenEnc }, null, 2)
}

export function updateSettings(patch: SettingsPatch): AppSettings {
  cache = mergeSettings(getSettings(), patch)
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = file() + '.tmp'
  writeFileSync(tmp, serialize(cache))
  renameSync(tmp, file())
  listeners.forEach((l) => l(cache!))
  return cache
}

export function onSettingsChanged(l: (s: AppSettings) => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}
