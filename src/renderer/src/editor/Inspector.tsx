import type { ReactNode } from 'react'
import { AudioLines, Captions, Image, Keyboard, LayoutTemplate, MicVocal, MousePointer2, ScrollText, Smartphone, Sparkles, Video } from 'lucide-react'
import { useEditor, type PanelId } from './store'
import { BackgroundPanel } from './panels/BackgroundPanel'
import { AnimationsPanel, CursorPanel } from './panels/CursorPanel'
import { CameraPanel, LayoutPanel } from './panels/CameraPanels'
import { AudioPanel, DevicePanel, KeystrokesPanel } from './panels/AudioPanel'
import { CaptionsPanel, TranscriptPanel } from './panels/TranscriptPanels'
import { MaskPanel, SlicePanel, TextPanel, ZoomPanel } from './panels/ItemPanels'
import { VoiceoverPanel } from './panels/VoiceoverPanel'

/** The tool dock. `label` names the panel in menus; `short` is what the dock shows under the icon. */
export const RAIL: { id: PanelId; label: string; short: string; icon: ReactNode; key: string }[] = [
  { id: 'background', label: 'Background', short: 'Look', icon: <Image />, key: '1' },
  { id: 'cursor', label: 'Cursor', short: 'Cursor', icon: <MousePointer2 />, key: '2' },
  { id: 'layout', label: 'Camera layout', short: 'Layout', icon: <LayoutTemplate />, key: '3' },
  { id: 'camera', label: 'Camera style', short: 'Camera', icon: <Video />, key: '4' },
  { id: 'captions', label: 'Captions', short: 'Captions', icon: <Captions />, key: '5' },
  { id: 'transcript', label: 'Edit by transcript', short: 'Words', icon: <ScrollText />, key: '6' },
  { id: 'audio', label: 'Audio', short: 'Audio', icon: <AudioLines />, key: '7' },
  { id: 'keystrokes', label: 'Keyboard shortcuts', short: 'Keys', icon: <Keyboard />, key: '8' },
  { id: 'animations', label: 'Animations', short: 'Motion', icon: <Sparkles />, key: '9' },
  { id: 'device', label: 'Device frame', short: 'Device', icon: <Smartphone />, key: '0' },
  { id: 'voiceover', label: 'Voiceover', short: 'Voice', icon: <MicVocal />, key: '' },
]

/** Which dock entry a panel belongs to (item panels light up the dock entry they relate to). */
const DOCK_FOR: Partial<Record<PanelId, PanelId>> = { zoom: 'animations', slice: 'audio', mask: 'background', text: 'background' }

export function Inspector({ onCrop }: { onCrop: () => void }) {
  const panel = useEditor((s) => s.panel)
  const selection = useEditor((s) => s.selection)
  const set = useEditor((s) => s.set)
  const select = useEditor((s) => s.select)

  const body = () => {
    switch (panel) {
      case 'background':
        return <BackgroundPanel onCrop={onCrop} />
      case 'cursor':
        return <CursorPanel />
      case 'layout':
        return <LayoutPanel />
      case 'camera':
        return <CameraPanel />
      case 'captions':
        return <CaptionsPanel />
      case 'transcript':
        return <TranscriptPanel />
      case 'audio':
        return <AudioPanel />
      case 'keystrokes':
        return <KeystrokesPanel />
      case 'animations':
        return <AnimationsPanel />
      case 'device':
        return <DevicePanel />
      case 'zoom':
        return selection?.kind === 'zoom' ? <ZoomPanel /> : null
      case 'slice':
        return selection?.kind === 'slice' ? <SlicePanel /> : null
      case 'mask':
        return selection?.kind === 'mask' ? <MaskPanel /> : null
      case 'text':
        return selection?.kind === 'text' ? <TextPanel /> : null
      case 'voiceover':
        return <VoiceoverPanel />
    }
  }
  const active = DOCK_FOR[panel] ?? panel

  return (
    <aside className="flex shrink-0 min-h-0 bg-panel border-r border-line-soft">
      <nav aria-label="Editor tools" className="w-[78px] shrink-0 flex flex-col items-center gap-0.5 pt-2 pb-2 px-2 border-r border-line-soft overflow-y-auto">
        {RAIL.map((r) => (
          <button
            key={r.id}
            className="dock-btn"
            data-active={active === r.id}
            aria-label={r.label}
            aria-pressed={active === r.id}
            title={r.key ? `${r.label} (⌘${r.key})` : r.label}
            onClick={() => {
              select(null)
              set({ panel: r.id })
            }}
          >
            {r.icon}
            <span>{r.short}</span>
          </button>
        ))}
      </nav>
      <div key={panel} className="w-[316px] overflow-y-auto rise-in">
        {body()}
      </div>
    </aside>
  )
}
