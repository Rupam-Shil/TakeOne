import { useEffect, useState } from 'react'
import type { Bridge, MainEvents } from '@shared/ipc'
import type { AppSettings } from '@shared/settings'

declare global {
  interface Window {
    bridge: Bridge
  }
}

export const bridge = window.bridge
export const api = window.bridge.api

export function useMainEvent<K extends keyof MainEvents>(channel: K, cb: (payload: MainEvents[K]) => void) {
  useEffect(() => bridge.on(channel, cb), [channel, cb])
}

export function useSettings(): [AppSettings | null, (patch: Parameters<typeof api.updateSettings>[0]) => void] {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  useEffect(() => {
    api.getSettings().then(setSettings)
    return bridge.on('settings:changed', setSettings)
  }, [])
  return [settings, (patch) => void api.updateSettings(patch).then(setSettings)]
}

export function useQuery(): URLSearchParams {
  const hash = window.location.hash
  const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  return new URLSearchParams(q)
}

export function formatTime(seconds: number, withFrames = false) {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
  if (!withFrames) return base
  const cs = Math.floor((s % 1) * 100)
  return `${base}.${String(cs).padStart(2, '0')}`
}
