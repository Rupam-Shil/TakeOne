import type { CameraAnchor, CameraLook, CutoutShape, LayoutType } from '@shared/project'
import { Circle, Hexagon, PersonStanding, Square, Squircle } from 'lucide-react'
import { Button, ColorInput, Field, Section, Segmented, Slider, Toggle, cx } from '@/ui/controls'
import { useEditor } from '../store'
import { runtime } from '../runtime'
import { PanelHeader, pct, useStyleSection } from './common'

const LAYOUTS: { id: LayoutType; label: string; hint: string }[] = [
  { id: 'camera-overlay', label: 'Overlay', hint: 'Camera floats over the screen' },
  { id: 'split-screen', label: 'Split', hint: 'Screen and camera side by side' },
  { id: 'cutout-camera', label: 'Cutout', hint: 'You, without your background' },
  { id: 'screen-only', label: 'Screen', hint: 'Hide the camera' },
  { id: 'fullscreen-camera', label: 'Camera', hint: 'Camera fills the frame' },
]

function LayoutIcon({ type }: { type: LayoutType }) {
  const cam = 'bg-layout'
  const scr = 'bg-white/70'
  return (
    <span className="relative w-12 h-8 rounded-[5px] bg-white/8 overflow-hidden">
      {type === 'camera-overlay' && (
        <>
          <span className={`absolute inset-1 rounded-[2px] ${scr}`} />
          <span className={`absolute right-1 bottom-1 size-3 rounded-full ${cam}`} />
        </>
      )}
      {type === 'split-screen' && (
        <>
          <span className={`absolute left-1 top-1 bottom-1 w-[55%] rounded-[2px] ${scr}`} />
          <span className={`absolute right-1 top-1 bottom-1 w-[30%] rounded-[2px] ${cam}`} />
        </>
      )}
      {type === 'cutout-camera' && (
        <>
          <span className={`absolute inset-1 rounded-[2px] ${scr}`} />
          <span className={`absolute right-2 bottom-0 w-3 h-4 rounded-t-full ${cam}`} />
        </>
      )}
      {type === 'screen-only' && <span className={`absolute inset-1 rounded-[2px] ${scr}`} />}
      {type === 'fullscreen-camera' && <span className={`absolute inset-1 rounded-[2px] ${cam}`} />}
    </span>
  )
}

export function LayoutPanel() {
  const [l, set] = useStyleSection('layout')
  const selection = useEditor((s) => s.selection)
  const segment = useEditor((s) => (selection?.kind === 'layout' ? s.config!.timeline.layouts.find((x) => x.id === selection.id) : null))
  const update = useEditor((s) => s.update)
  const hasCamera = useEditor((s) => !!s.project?.meta.tracks.camera)
  const current = segment?.layout ?? l.type
  const choose = (t: LayoutType) => {
    if (segment) update((d) => void (d.timeline.layouts.find((x) => x.id === segment.id)!.layout = t))
    else set((s) => void (s.type = t))
  }
  return (
    <>
      <PanelHeader title={segment ? 'Layout segment' : 'Camera layout'} />
      {!hasCamera && <p className="px-4 pt-3 text-[12.5px] text-muted">This recording has no camera. Pick a camera in the recording bar to use layouts.</p>}
      <Section title={segment ? 'Layout for this segment' : 'Default layout'}>
        <div className="grid grid-cols-3 gap-1.5">
          {LAYOUTS.filter((x) => segment || x.id !== 'screen-only' && x.id !== 'fullscreen-camera').map((x) => (
            <button
              key={x.id}
              title={x.hint}
              onClick={() => choose(x.id)}
              className={cx('flex flex-col items-center gap-1.5 py-2.5 rounded-[8px] text-[11.5px]', current === x.id ? 'bg-white/10 ring-1 ring-white/40' : 'hover:bg-white/5 text-muted')}
            >
              <LayoutIcon type={x.id} />
              {x.label}
            </button>
          ))}
        </div>
        {segment && (
          <Toggle label="Disable segment" checked={segment.disabled} onChange={(v) => update((d) => void (d.timeline.layouts.find((x) => x.id === segment.id)!.disabled = v))} />
        )}
      </Section>
      {current === 'camera-overlay' && (
        <Section title="Overlay">
          <Field label="Position">
            <div className="grid grid-cols-3 gap-1 w-[132px]">
              {['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'].map((a) =>
                a === 'center' ? (
                  <span key={a} />
                ) : (
                  <button
                    key={a}
                    onClick={() => set((s) => void (s.overlayAnchor = a as CameraAnchor))}
                    className={cx('h-8 rounded-[5px]', l.overlayAnchor === a ? 'bg-layout' : 'bg-white/8 hover:bg-white/15')}
                    aria-label={a}
                  />
                ),
              )}
            </div>
          </Field>
          <Slider label="Size" value={l.overlaySize} min={0.1} max={0.75} step={0.01} format={pct} onChange={(v) => set((s) => void (s.overlaySize = v), 'size')} />
          <Field label="Shape">
            <Segmented
              value={l.overlayAspect}
              onChange={(v) => set((s) => void (s.overlayAspect = v))}
              options={(['16:9', '4:3', '1:1', '3:4', '9:16'] as const).map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Toggle label="Smaller while zoomed" checked={l.overlayZoomedScale < 1} onChange={(v) => set((s) => void (s.overlayZoomedScale = v ? 0.8 : 1))} />
          {l.overlayZoomedScale < 1 && (
            <Slider label="Zoomed size" value={l.overlayZoomedScale} min={0.25} max={0.95} step={0.01} format={pct} onChange={(v) => set((s) => void (s.overlayZoomedScale = v), 'zscale')} />
          )}
        </Section>
      )}
      {current === 'split-screen' && (
        <Section title="Split">
          <Segmented
            value={l.splitDirection}
            onChange={(v) => set((s) => void (s.splitDirection = v))}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'horizontal', label: 'Side by side' },
              { value: 'vertical', label: 'Stacked' },
            ]}
          />
          <Slider label="Screen share" value={l.splitRatio} min={0.2} max={0.8} step={0.01} format={pct} onChange={(v) => set((s) => void (s.splitRatio = v), 'ratio')} />
          <Toggle label="Swap sides" checked={l.splitFlip} onChange={(v) => set((s) => void (s.splitFlip = v))} />
          <Toggle label="Fill frame" hint="No padding around the two halves." checked={l.splitFill} onChange={(v) => set((s) => void (s.splitFill = v))} />
        </Section>
      )}
      {current === 'cutout-camera' && (
        <Section title="Cutout">
          <Segmented
            value={l.cutoutPosition}
            onChange={(v) => set((s) => void (s.cutoutPosition = v))}
            options={[
              { value: 0, label: 'Left' },
              { value: 0.5, label: 'Center' },
              { value: 1, label: 'Right' },
            ]}
          />
          <Slider label="Size" value={l.cutoutSize} min={0.2} max={1} step={0.01} format={pct} onChange={(v) => set((s) => void (s.cutoutSize = v), 'csize')} />
          <Field label="Shape">
            <div className="flex gap-1.5">
              {CUTOUT_SHAPES.map((o) => {
                const active = (l.cutoutShape ?? 'free') === o.id
                return (
                  <button
                    key={o.id}
                    title={o.label}
                    aria-label={o.label}
                    aria-pressed={active}
                    onClick={() => set((s) => void (s.cutoutShape = o.id))}
                    className={cx('flex-1 h-10 rounded-[12px] inline-flex items-center justify-center [&>svg]:size-[18px]', active ? 'bg-fg text-on-fg' : 'btn-soft text-muted')}
                  >
                    {o.icon}
                  </button>
                )
              })}
            </div>
          </Field>
          <p className="text-[12px] text-muted">Background removal runs on your Mac; the first preview takes a moment.</p>
        </Section>
      )}
    </>
  )
}

const CUTOUT_SHAPES: { id: CutoutShape; label: string; icon: React.ReactNode }[] = [
  { id: 'free', label: 'Free silhouette', icon: <PersonStanding /> },
  { id: 'circle', label: 'Circle', icon: <Circle /> },
  { id: 'rounded', label: 'Rounded square', icon: <Squircle /> },
  { id: 'square', label: 'Square', icon: <Square /> },
  { id: 'hexagon', label: 'Hexagon', icon: <Hexagon /> },
]

const LOOKS: { id: CameraLook; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'studio', label: 'Studio' },
  { id: 'cinema', label: 'Cinema' },
  { id: 'film', label: 'Film' },
  { id: 'golden', label: 'Golden' },
  { id: 'cream', label: 'Cream' },
  { id: 'terra', label: 'Terra' },
  { id: 'moody', label: 'Moody' },
  { id: 'arctic', label: 'Arctic' },
  { id: 'neon', label: 'Neon' },
  { id: 'punch', label: 'Punch' },
  { id: 'fade', label: 'Fade' },
  { id: 'mono', label: 'Mono' },
]

export function CameraPanel() {
  const [c, set] = useStyleSection('camera')
  const hasCamera = useEditor((s) => !!s.project?.meta.tracks.camera)
  const analysisRev = useEditor((s) => s.analysisRev)
  const hasFaces = !!runtime.faces?.length && analysisRev >= 0
  return (
    <>
      <PanelHeader title="Camera style" />
      {hasCamera && (
        <Section title="Framing">
          <Toggle
            label="Follow my face"
            hint="Keeps you centred as you move. The camera is analysed once, on your Mac."
            checked={c.faceTracking}
            onChange={(v) => {
              set((s) => void (s.faceTracking = v))
              if (v) void runtime.ensureFaces()
            }}
          />
          {c.faceTracking && (
            <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
              <span>{hasFaces ? 'Face track ready' : 'Analysing the camera…'}</span>
              <Button size="sm" variant="ghost" onClick={() => void runtime.ensureFaces(true)}>
                Analyse again
              </Button>
            </div>
          )}
        </Section>
      )}
      <Section title="Appearance">
        <Toggle label="Hide camera" checked={c.hide} onChange={(v) => set((s) => void (s.hide = v))} />
        <Toggle label="Mirror" checked={c.mirror} onChange={(v) => set((s) => void (s.mirror = v))} />
        <Slider label="Roundness" value={c.radiusRatio} min={0} max={0.5} step={0.01} format={(v) => (v >= 0.5 ? 'Circle' : pct(v * 2))} onChange={(v) => set((s) => void (s.radiusRatio = v), 'radius')} />
        <Slider label="Shadow" value={c.shadow} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((s) => void (s.shadow = v), 'shadow')} />
        <Slider label="Border" value={c.border} min={0} max={12} step={0.5} format={(v) => (v ? `${v}px` : 'None')} onChange={(v) => set((s) => void (s.border = v), 'border')} />
        {c.border > 0 && <ColorInput value={c.borderColor} onChange={(v) => set((s) => void (s.borderColor = v), 'border-c')} />}
        <Slider label="Zoom" value={c.zoom} min={1} max={3} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set((s) => void (s.zoom = v), 'zoom')} disabled={c.faceTracking} />
        {c.zoom > 1 && !c.faceTracking && (
          <>
            <Slider label="Horizontal" value={c.offset.x} min={-1} max={1} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => set((s) => void (s.offset.x = v), 'ox')} />
            <Slider label="Vertical" value={c.offset.y} min={-1} max={1} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => set((s) => void (s.offset.y = v), 'oy')} />
          </>
        )}
      </Section>
      <Section title="Look">
        <div className="grid grid-cols-4 gap-1.5">
          {LOOKS.map((l) => (
            <button
              key={l.id}
              onClick={() => set((s) => void (s.look = l.id))}
              className={cx('h-8 rounded-[6px] text-[11.5px]', c.look === l.id ? 'bg-white/12 ring-1 ring-white/40' : 'bg-white/5 text-muted hover:text-fg')}
            >
              {l.label}
            </button>
          ))}
        </div>
        {c.look !== 'none' && (
          <Slider label="Look strength" value={c.lookIntensity} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((s) => void (s.lookIntensity = v), 'lookInt')} />
        )}
        <Slider label="Brightness" value={c.brightness} min={0.5} max={1.5} step={0.01} format={(v) => `${v >= 1 ? '+' : '−'}${Math.abs(Math.round((v - 1) * 100))}%`} onChange={(v) => set((s) => void (s.brightness = v), 'bright')} />
        <Slider label="Grain" value={c.grain} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((s) => void (s.grain = v), 'grain')} />
      </Section>
      <Section title="Background">
        <Toggle label="Remove background" checked={c.removeBackground} onChange={(v) => set((s) => void (s.removeBackground = v))} />
        <Slider label="Blur background" value={c.backgroundBlur} min={0} max={40} step={0.5} format={(v) => (v ? v.toFixed(0) : 'Off')} onChange={(v) => set((s) => void (s.backgroundBlur = v), 'bgblur')} />
      </Section>
      <Section title="Silence">
        <Toggle
          label="Hide while silent"
          hint="Fade the camera out during long pauses in your voice."
          checked={c.hideDuringSilenceMs !== null}
          onChange={(v) => set((s) => void (s.hideDuringSilenceMs = v ? 5000 : null))}
        />
        {c.hideDuringSilenceMs !== null && (
          <Slider
            label="Minimum silence"
            value={c.hideDuringSilenceMs}
            min={2000}
            max={15000}
            step={500}
            format={(v) => `${(v / 1000).toFixed(1)}s`}
            onChange={(v) => set((s) => void (s.hideDuringSilenceMs = v), 'silence')}
          />
        )}
      </Section>
    </>
  )
}
