/** Electron accelerator → macOS key glyphs in the conventional ⌃⌥⇧⌘ order. */
export function formatShortcut(accelerator: string): string {
  if (!accelerator) return ''
  const parts = accelerator.split('+')
  const mods = { ctrl: false, alt: false, shift: false, cmd: false }
  let key = ''
  for (const p of parts) {
    switch (p) {
      case 'CommandOrControl':
      case 'Command':
      case 'Cmd':
      case 'Super':
        mods.cmd = true
        break
      case 'Control':
      case 'Ctrl':
        mods.ctrl = true
        break
      case 'Alt':
      case 'Option':
        mods.alt = true
        break
      case 'Shift':
        mods.shift = true
        break
      default:
        key = p
    }
  }
  const KEYS: Record<string, string> = {
    Return: '↩',
    Enter: '↩',
    Backspace: '⌫',
    Delete: '⌦',
    Escape: '⎋',
    Space: 'Space',
    Tab: '⇥',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
  }
  return `${mods.ctrl ? '⌃' : ''}${mods.alt ? '⌥' : ''}${mods.shift ? '⇧' : ''}${mods.cmd ? '⌘' : ''}${KEYS[key] ?? key.toUpperCase()}`
}
