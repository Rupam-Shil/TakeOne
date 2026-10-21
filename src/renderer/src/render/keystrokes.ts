import type { KeystrokeSettings } from '@shared/project'
import type { Key } from './input'

export interface KeyPress {
  t: number
  tokens: string[]
  label: string
}

export interface KeyGroup {
  start: number
  end: number
  presses: KeyPress[]
}

const MOD_SYMBOL: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘', fn: 'fn' }
const MOD_ORDER = ['fn', 'ctrl', 'alt', 'shift', 'cmd']
const KEY_SYMBOL: Record<string, string> = {
  return: '↩', enter: '⌤', tab: '⇥', space: 'Space', delete: '⌫', forwardDelete: '⌦', escape: 'esc',
  left: '←', right: '→', up: '↑', down: '↓', home: '↖', end: '↘', pageUp: '⇞', pageDown: '⇟',
}

export function pressTokens(k: Key): string[] {
  const mods = MOD_ORDER.filter((m) => k.modifiers.includes(m)).map((m) => MOD_SYMBOL[m])
  const key = k.key ? (KEY_SYMBOL[k.key] ?? (k.key.length === 1 ? k.key.toUpperCase() : k.key)) : null
  return key ? [...mods, key] : mods
}

/** Shortcut presses grouped when they happen within 2s of each other. */
export function buildKeyGroups(keys: Key[], settings: KeystrokeSettings): KeyGroup[] {
  const presses: KeyPress[] = []
  for (const k of keys) {
    if (k.type !== 'down' || k.isRepeat || !k.key) continue
    const isCombo = k.modifiers.some((m) => m === 'cmd' || m === 'ctrl' || m === 'alt')
    const isSpecial = k.key.length > 1
    if (!isCombo && !settings.showSingleKeys && !(isSpecial && k.modifiers.length)) continue
    const tokens = pressTokens(k)
    const label = tokens.join('')
    if (settings.hidden.includes(label)) continue
    presses.push({ t: k.t, tokens, label })
  }
  const groups: KeyGroup[] = []
  for (const p of presses) {
    const last = groups[groups.length - 1]
    if (last && p.t - last.end < 2000) {
      last.presses.push(p)
      last.end = p.t
    } else groups.push({ start: p.t, end: p.t, presses: [p] })
  }
  return groups
}

export const KEY_HOLD_MS = 1400

export function keyStateAt(groups: KeyGroup[], ms: number): { press: KeyPress; age: number; fadeOut: number } | null {
  for (const g of groups) {
    if (ms < g.start || ms > g.end + KEY_HOLD_MS + 250) continue
    let press = g.presses[0]
    for (const p of g.presses) if (p.t <= ms) press = p
    const fadeOut = Math.max(0, (ms - (g.end + KEY_HOLD_MS)) / 250)
    return { press, age: ms - press.t, fadeOut: Math.min(1, fadeOut) }
  }
  return null
}

/** Typing bursts that could be sped up: gaps < 500ms, ≥ 1.5s long, ≥ 2 keys/s. */
export function typingRanges(keys: Key[]): { start: number; end: number; count: number }[] {
  const downs = keys.filter((k) => k.type === 'down' && !k.isRepeat).map((k) => k.t)
  const out: { start: number; end: number; count: number }[] = []
  let start = -1
  let prev = -1
  let count = 0
  const flush = () => {
    if (start >= 0 && prev - start >= 1500 && count / ((prev - start) / 1000) >= 2) out.push({ start, end: prev, count })
  }
  for (const t of downs) {
    if (start < 0 || t - prev >= 500) {
      flush()
      start = t
      count = 0
    }
    prev = t
    count++
  }
  flush()
  return out
}
