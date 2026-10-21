import { app } from 'electron'

export const is = {
  get dev() {
    return !app.isPackaged
  },
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Only web and mail links may leave the app through the OS opener. */
export function isSafeExternalUrl(url: string) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
