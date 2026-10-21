import { useMemo } from 'react'
import { SPRINGS, type CursorSetId, type Spring } from '@shared/project'
import { ColorInput, Field, Section, Segmented, Slider, Toggle, cx } from '@/ui/controls'
import { CURSOR_GROUPS, CURSOR_SETS, cursorPreview } from '@/render/cursor-assets'
import { PanelHeader, pct, useStyleSection } from './common'

function CursorSwatch({ set, selected, onClick, name }: { set: CursorSetId; selected: boolean; onClick: () => void; name: string }) {
  const preview = useMemo(() => cursorPreview(set), [set])
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      title={name}
      className={cx(
        'flex flex-col items-center gap-1.5 pt-2 pb-1.5 rounded-[10px] text-[11px] leading-none transition-colors',
        selected ? 'bg-fg/10 text-fg' : 'text-muted hover:bg-fg/5 hover:text-fg',
      )}
    >
      <span
        className={cx(
          'size-11 rounded-[11px] flex items-center justify-center bg-[linear-gradient(160deg,#3c3c43,#1b1b1e)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_1px_2px_rgba(0,0,0,0.45)]',
          selected && 'ring-2 ring-fg',
        )}
      >
        <img src={preview.src} className="size-9" style={preview.pixel ? { imageRendering: 'pixelated' } : undefined} alt="" draggable={false} />
      </span>
      <span className="max-w-full truncate px-1">{name}</span>
    </button>
  )
}

/** Cursor art picker, grouped by family. */
function CursorSets({ value, onChange }: { value: CursorSetId; onChange: (id: CursorSetId) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {CURSOR_GROUPS.map((group) => {
        const sets = CURSOR_SETS.filter((s) => s.group === group)
        if (!sets.length) return null
        return (
          <div key={group} className="flex flex-col gap-1">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint px-1">{group}</div>
            <div className="grid grid-cols-3 gap-1">
              {sets.map((cs) => (
                <CursorSwatch key={cs.id} set={cs.id} name={cs.name} selected={value === cs.id} onClick={() => onChange(cs.id)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function CursorPanel() {
  const [c, set] = useStyleSection('cursor')
  return (
    <>
      <PanelHeader title="Cursor" />
      <Section title="Appearance">
        <Toggle label="Hide cursor" checked={c.hide} onChange={(v) => set((s) => void (s.hide = v))} />
        {!c.hide && (
          <>
            <Slider label="Size" value={c.size} min={16} max={128} step={1} format={(v) => `${v}`} onChange={(v) => set((s) => void (s.size = v), 'size')} />
            <CursorSets value={c.set} onChange={(id) => set((s) => void (s.set = id))} />
            <Toggle label="Always use pointer" hint="Show the arrow even over text fields and links." checked={c.alwaysPointer} onChange={(v) => set((s) => void (s.alwaysPointer = v))} />
            <Toggle label="Optimize cursor changes" hint="Only switch shapes on clicks, so hovering doesn't flicker." checked={c.optimizeCursorTypes} onChange={(v) => set((s) => void (s.optimizeCursorTypes = v))} />
          </>
        )}
      </Section>
      <Section title="Clicks">
        <Field label="Click effect">
          <Segmented
            value={c.clickEffect}
            onChange={(v) => set((s) => void (s.clickEffect = v))}
            options={[
              { value: 'none', label: 'None' },
              { value: 'circle', label: 'Circle' },
              { value: 'ripple', label: 'Ripple' },
            ]}
          />
        </Field>
        {c.clickEffect !== 'none' && <ColorInput value={c.clickEffectColor} onChange={(v) => set((s) => void (s.clickEffectColor = v), 'click-color')} />}
      </Section>
      <Section title="Motion">
        <Field label="Rotation">
          <Segmented
            value={c.rotationMode}
            onChange={(v) => set((s) => void (s.rotationMode = v))}
            options={[
              { value: 'none', label: 'None' },
              { value: 'tilt', label: 'Tilt' },
              { value: 'follow', label: 'Follow' },
            ]}
          />
        </Field>
        {c.rotationMode === 'tilt' && (
          <Slider label="Tilt amount" value={c.tiltAmount} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set((s) => void (s.tiltAmount = v), 'tilt')} />
        )}
        <Slider label="Base rotation" value={c.baseRotation} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => set((s) => void (s.baseRotation = v), 'base-rot')} />
        <Slider
          label="Remove shake"
          value={c.removeShakePx}
          min={0}
          max={2000}
          step={20}
          format={(v) => (v === 0 ? 'Off' : `${v}`)}
          onChange={(v) => set((s) => void (s.removeShakePx = v), 'shake')}
        />
      </Section>
      <Section title="Behavior">
        <Toggle label="Hide when typing" checked={c.hideWhileTyping} onChange={(v) => set((s) => void (s.hideWhileTyping = v))} />
        <Toggle label="Hide when idle" checked={c.hideWhenIdleMs !== null} onChange={(v) => set((s) => void (s.hideWhenIdleMs = v ? 2000 : null))} />
        {c.hideWhenIdleMs !== null && (
          <Slider label="Idle after" value={c.hideWhenIdleMs} min={500} max={5000} step={100} format={(v) => `${(v / 1000).toFixed(1)}s`} onChange={(v) => set((s) => void (s.hideWhenIdleMs = v), 'idle')} />
        )}
        <Toggle
          label="Loop cursor position"
          hint="Return the cursor to where it started, for seamless loops."
          checked={c.loopBeforeEndMs !== null}
          onChange={(v) => set((s) => void (s.loopBeforeEndMs = v ? 1000 : null))}
        />
        {c.loopBeforeEndMs !== null && (
          <Slider label="Loop duration" value={c.loopBeforeEndMs} min={1000} max={4000} step={100} format={(v) => `${(v / 1000).toFixed(1)}s`} onChange={(v) => set((s) => void (s.loopBeforeEndMs = v), 'loop')} />
        )}
        <Slider
          label="Stop moving at the end"
          value={c.stopMovementLastMs}
          min={0}
          max={5000}
          step={50}
          format={(v) => (v ? `${(v / 1000).toFixed(1)}s` : 'Off')}
          onChange={(v) => set((s) => void (s.stopMovementLastMs = v), 'stop')}
        />
      </Section>
    </>
  )
}

const CURSOR_PRESETS: { id: 'none' | 'rapid' | 'medium' | 'smooth'; label: string; spring: Spring | null }[] = [
  { id: 'none', label: 'None', spring: null },
  { id: 'rapid', label: 'Rapid', spring: SPRINGS.cursor.rapid },
  { id: 'medium', label: 'Medium', spring: SPRINGS.cursor.medium },
  { id: 'smooth', label: 'Smooth', spring: SPRINGS.cursor.smooth },
]

function SpringEditor({ spring, onChange }: { spring: Spring; onChange: (s: Spring, key: string) => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-[9px] bg-black/20 p-3">
      <Slider label="Rigidity" value={spring.stiffness} min={5} max={600} step={1} format={(v) => v.toFixed(0)} onChange={(v) => onChange({ ...spring, stiffness: v }, 'k')} />
      <Slider label="Smoothness" value={spring.damping} min={5} max={200} step={1} format={(v) => v.toFixed(0)} onChange={(v) => onChange({ ...spring, damping: v }, 'c')} />
      <Slider label="Momentum" value={spring.mass} min={0.1} max={15} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => onChange({ ...spring, mass: v }, 'm')} />
    </div>
  )
}

export function AnimationsPanel() {
  const [a, set] = useStyleSection('animations')
  const [z, setZ] = useStyleSection('zooms')
  return (
    <>
      <PanelHeader title="Animations" />
      <Section title="Screen movement">
        <Segmented
          value={a.screenPreset}
          onChange={(v) =>
            set((s) => {
              s.screenPreset = v
              if (v !== 'custom') s.screenSpring = SPRINGS.screen[v]
            })
          }
          options={[
            { value: 'focused', label: 'Focused' },
            { value: 'smooth', label: 'Smooth' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {a.screenPreset === 'custom' && <SpringEditor spring={a.screenSpring} onChange={(sp, k) => set((s) => void (s.screenSpring = sp), `screen-${k}`)} />}
        <Toggle
          label="Start zooming early"
          hint="Begin each zoom 350ms before it starts, so it lands on time."
          checked={z.startAnimationEarly}
          onChange={(v) => setZ((s) => void (s.startAnimationEarly = v))}
        />
      </Section>
      <Section title="Cursor movement">
        <Segmented
          value={a.cursorPreset}
          onChange={(v) =>
            set((s) => {
              s.cursorPreset = v
              if (v !== 'custom') s.cursorSpring = CURSOR_PRESETS.find((p) => p.id === v)!.spring
              else s.cursorSpring ??= SPRINGS.cursor.medium
            })
          }
          options={[...CURSOR_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom' as const, label: 'Custom' }]}
        />
        {a.cursorPreset === 'custom' && a.cursorSpring && <SpringEditor spring={a.cursorSpring} onChange={(sp, k) => set((s) => void (s.cursorSpring = sp), `cursor-${k}`)} />}
      </Section>
      <Section title="Motion blur">
        <Slider label="Amount" value={a.motionBlur} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((s) => void (s.motionBlur = v), 'blur')} />
      </Section>
    </>
  )
}
