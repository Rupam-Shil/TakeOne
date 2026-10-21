import { useEffect } from 'react'

/** Closes an overlay on Escape before the editor's own shortcuts see the key. */
export function useEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose, enabled])
}
