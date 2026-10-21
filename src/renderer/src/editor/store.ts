import { create } from 'zustand'
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer'
import type { ProjectConfig } from '@shared/project'
import type { LoadedProject } from './loader'

enablePatches()

export type PanelId =
  | 'background'
  | 'cursor'
  | 'layout'
  | 'camera'
  | 'captions'
  | 'transcript'
  | 'audio'
  | 'keystrokes'
  | 'animations'
  | 'device'
  | 'zoom'
  | 'slice'
  | 'mask'
  | 'text'
  | 'voiceover'

export type Selection = { kind: 'zoom' | 'slice' | 'layout' | 'mask' | 'text' | 'voiceover'; id: string } | null

interface HistoryEntry {
  undo: Patch[]
  redo: Patch[]
  at: number
  key?: string
}

interface EditorState {
  project: LoadedProject | null
  config: ProjectConfig | null
  /** Playback time in ms (after cuts and speed changes). */
  playMs: number
  playing: boolean
  selection: Selection
  panel: PanelId
  /** Timeline scale in pixels per second of playback. */
  pxPerSec: number
  dirty: boolean
  past: HistoryEntry[]
  future: HistoryEntry[]
  scissors: boolean
  previewMode: boolean
  safeZones: 'none' | 'tiktok'
  /** Last rail panel, restored when a timeline item is deselected. */
  lastRail: PanelId
  /** Bumped when runtime-side analysis (face track) changes so scenes rebuild. */
  analysisRev: number

  load(p: LoadedProject): void
  update(recipe: (draft: ProjectConfig) => void, coalesceKey?: string): void
  undo(): void
  redo(): void
  set(patch: Partial<EditorState>): void
  select(sel: Selection): void
}

const ITEM_PANELS: PanelId[] = ['zoom', 'slice', 'mask', 'text']
const COALESCE_MS = 100
const MAX_HISTORY = 1000

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  config: null,
  playMs: 0,
  playing: false,
  selection: null,
  panel: 'background',
  pxPerSec: 60,
  dirty: false,
  past: [],
  future: [],
  scissors: false,
  previewMode: false,
  safeZones: 'none',
  lastRail: 'background',
  analysisRev: 0,

  load(p) {
    set({ project: p, config: p.config, past: [], future: [], dirty: false, playMs: 0 })
  },

  update(recipe, coalesceKey) {
    const { config, past } = get()
    if (!config) return
    const [next, redo, undo] = produceWithPatches(config, recipe)
    if (!redo.length) return
    const now = performance.now()
    const last = past[past.length - 1]
    let nextPast: HistoryEntry[]
    // Edits in quick succession (slider drags) collapse into one undo step.
    // Slider drags pass a key and keep merging while they continue; other edits merge within 100ms.
    const sameGesture = coalesceKey ? last?.key === coalesceKey && now - last.at < 600 : !!last && !last.key && now - last.at < COALESCE_MS
    if (last && sameGesture) {
      nextPast = [...past.slice(0, -1), { undo: [...undo, ...last.undo], redo: [...last.redo, ...redo], at: now, key: coalesceKey }]
    } else {
      nextPast = [...past, { undo, redo, at: now, key: coalesceKey }].slice(-MAX_HISTORY)
    }
    set({ config: next, past: nextPast, future: [], dirty: true })
  },

  undo() {
    const { config, past, future } = get()
    const entry = past[past.length - 1]
    if (!config || !entry) return
    set({ config: applyPatches(config, entry.undo), past: past.slice(0, -1), future: [entry, ...future], dirty: true })
  },

  redo() {
    const { config, past, future } = get()
    const entry = future[0]
    if (!config || !entry) return
    set({ config: applyPatches(config, entry.redo), past: [...past, { ...entry, at: 0 }], future: future.slice(1), dirty: true })
  },

  set(patch) {
    const rail = patch.panel && !ITEM_PANELS.includes(patch.panel) ? { lastRail: patch.panel } : {}
    set({ ...patch, ...rail })
  },

  select(sel) {
    const panel: Partial<Record<NonNullable<Selection>['kind'], PanelId>> = { zoom: 'zoom', slice: 'slice', mask: 'mask', text: 'text', layout: 'layout', voiceover: 'voiceover' }
    if (sel) return set({ selection: sel, panel: panel[sel.kind] ?? get().panel })
    const cur = get().panel
    set({ selection: null, ...(ITEM_PANELS.includes(cur) ? { panel: get().lastRail } : {}) })
  },
}))

export const style = () => useEditor.getState().config!.style
