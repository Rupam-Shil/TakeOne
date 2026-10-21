import type { CursorSettings } from '@shared/project'
import { joinPath, mediaUrl } from '@shared/media'
import type { LoadedProject } from '@/editor/loader'
import { recordedCursor, vectorCursor, type CursorBitmap } from './cursor-assets'

export const DEFAULT_CURSOR = '__default'

/**
 * Resolves every cursor shape seen in the recording to a drawable bitmap: crisp vector art for
 * shapes we know, the captured image for app-specific cursors (or when "As recorded" is chosen).
 */
export async function loadCursorBitmaps(project: LoadedProject, settings: CursorSettings): Promise<Map<string, CursorBitmap>> {
  const out = new Map<string, CursorBitmap>()
  const images = project.events?.cursorImages ?? {}
  await Promise.all(
    Object.entries(images).map(async ([id, info]) => {
      let bmp: CursorBitmap | null = null
      if (settings.set !== 'recorded' && info.type) bmp = await vectorCursor(info.type, settings.set)
      if (!bmp && info.file) {
        bmp = await recordedCursor(mediaUrl(joinPath(project.recordingDir, info.file)), info.hotspotX, info.hotspotY, info.width, info.height)
      }
      if (!bmp && settings.set !== 'recorded') bmp = await vectorCursor('arrow', settings.set)
      if (bmp) out.set(id, bmp)
    }),
  )
  const fallback = await vectorCursor('arrow', settings.set === 'recorded' ? 'macos' : settings.set)
  if (fallback) out.set(DEFAULT_CURSOR, fallback)
  return out
}

export const resolveCursor = (map: Map<string, CursorBitmap>) => (id: string | null) =>
  (id ? map.get(id) : undefined) ?? map.get(DEFAULT_CURSOR) ?? null
