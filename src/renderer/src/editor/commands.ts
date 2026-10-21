import { useEditor } from './store'
import { runtime } from './runtime'
import { addItem, duplicateItem, newZoom, removeItem, removeSlice, rippleDeleteBack, splitItemAt, splitSliceAt, type TrackKind } from './ops'
import { toast } from './toast'

const KIND_TO_TRACK: Record<string, TrackKind> = { zoom: 'zooms', layout: 'layouts', mask: 'masks', text: 'texts', voiceover: 'voiceOvers' }

export async function togglePlay() {
  const st = useEditor.getState()
  const scene = runtime.buildScene()
  const pb = runtime.playback
  if (!scene || !pb || !st.config) return
  if (st.playing) {
    pb.pause()
    useEditor.setState({ playing: false })
  } else {
    useEditor.setState({ playing: true })
    await pb.play(scene.timeMap, st.playMs, st.config)
  }
}

export function pausePlayback() {
  runtime.playback?.pause()
  useEditor.setState({ playing: false })
}

export function seekTo(playMs: number) {
  const scene = runtime.buildScene()
  if (!scene) return
  const ms = Math.max(0, Math.min(scene.timeMap.duration, playMs))
  if (useEditor.getState().playing) {
    pausePlayback()
  }
  useEditor.setState({ playMs: ms })
}

export function seekBy(deltaMs: number) {
  seekTo(useEditor.getState().playMs + deltaMs)
}

export function stepFrame(dir: 1 | -1) {
  const fps = useEditor.getState().project?.meta.fps ?? 60
  seekBy((dir * 1000) / fps)
}

const playheadSource = () => runtime.buildScene()?.timeMap.toSource(useEditor.getState().playMs) ?? 0

/** C: split the selected item (or the clip) at the playhead. */
export function splitAtPlayhead() {
  const { selection, update } = useEditor.getState()
  const t = playheadSource()
  try {
    if (selection && selection.kind !== 'slice') {
      const track = KIND_TO_TRACK[selection.kind]
      let did = false
      update((d) => void (did = !!splitItemAt(d, track, t)))
      if (did) return
    }
    update((d) => void splitSliceAt(d, t))
  } catch (e) {
    toast((e as Error).message)
  }
}

export function deleteSelection() {
  const { selection, update, select } = useEditor.getState()
  if (!selection) return
  try {
    update((d) => {
      if (selection.kind === 'slice') removeSlice(d, selection.id)
      else removeItem(d, KIND_TO_TRACK[selection.kind], selection.id)
    })
    select(null)
  } catch (e) {
    toast((e as Error).message)
  }
}

export function rippleDelete() {
  const t = playheadSource()
  try {
    useEditor.getState().update((d) => rippleDeleteBack(d, t))
  } catch (e) {
    toast((e as Error).message)
  }
}

export function addZoomAtPlayhead() {
  const st = useEditor.getState()
  if (!st.project) return
  const t = playheadSource()
  let id: string | null = null
  st.update((d) => {
    const z = addItem(d, 'zooms', t, st.project!.meta.duration * 1000, (s, e) => newZoom(s, e, d.style.zooms.defaultLevel) as never)
    id = (z as { id: string } | null)?.id ?? null
  })
  if (id) st.select({ kind: 'zoom', id })
  else toast('There is already a zoom at the playhead')
}

export function setZoomLevel(level: number | ((l: number) => number)) {
  const { selection, update } = useEditor.getState()
  if (selection?.kind !== 'zoom') return
  update((d) => {
    const z = d.timeline.zooms.find((x) => x.id === selection.id)
    if (!z) return
    z.level = Math.round(Math.min(4, Math.max(1, typeof level === 'function' ? level(z.level) : level)) * 10) / 10
    d.style.zooms.defaultLevel = z.level
  }, `zoom-level-${selection.id}`)
}

export function duplicateSelection() {
  const { selection, update, select, project } = useEditor.getState()
  if (!selection || selection.kind === 'slice' || !project) return
  let id: string | null = null
  update((d) => void (id = duplicateItem(d, KIND_TO_TRACK[selection.kind], selection.id, project.meta.duration * 1000)))
  if (id) select({ kind: selection.kind, id })
}
