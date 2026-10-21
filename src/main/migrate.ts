import { app } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Take One was called Studio Clone. This runs before anything reads the data folder: it names the app
 * and moves the old folder (settings, presets, exports list, downloaded models) over once.
 */
export const APP_NAME = 'Take One'
const LEGACY_NAME = 'Studio Clone'

app.setName(APP_NAME)
const dataDir = join(app.getPath('appData'), APP_NAME)
const legacyDir = join(app.getPath('appData'), LEGACY_NAME)
if (!existsSync(dataDir) && existsSync(legacyDir)) {
  try {
    renameSync(legacyDir, dataDir)
  } catch (err) {
    console.warn('Could not move the old data folder; using it where it is', err)
  }
}
app.setPath('userData', existsSync(dataDir) || !existsSync(legacyDir) ? dataDir : legacyDir)
