import { useEffect, useState } from 'react'
import { Crop, Dices, ImagePlus, Monitor } from 'lucide-react'
import type { Wallpaper } from '@shared/ipc'
import { mediaUrl } from '@shared/media'
import { api } from '@/lib/bridge'
import { Button, ColorInput, Field, Section, Segmented, Select, Slider, Toggle } from '@/ui/controls'
import { ASPECTS } from '@/render/layout'
import { cssGradient, cssWallpaper, GRADIENT_PRESETS, rotateHue, WALLPAPERS } from '@/render/wallpapers'
import { useEditor } from '../store'
import { PanelHeader, Thumb, pct, useStyleSection } from './common'

export function BackgroundPanel({ onCrop }: { onCrop: () => void }) {
  const [style, setStyle] = useStyleSection('style')
  const [output, setOutput] = useStyleSection('output')
  const bg = style.background
  const project = useEditor((s) => s.project)
  const [system, setSystem] = useState<Wallpaper[] | null>(null)
  const [hue, setHue] = useState(0)

  useEffect(() => {
    if (bg.type === 'wallpaper' && !system) api.systemWallpapers().then(setSystem)
  }, [bg.type, system])

  const pickImage = async () => {
    const [p] = await api.showOpenDialog({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic'] }] })
    if (!p || !project) return
    const copied = await api.copyIntoProject(project.path, p, 'assets')
    setStyle((s) => {
      s.background.type = 'image'
      s.background.image = copied
    })
  }

  const randomize = () => {
    if (bg.type === 'wallpaper') {
      const all = [...WALLPAPERS.map((w) => `builtin:${w.id}`), ...(system ?? []).map((w) => w.path)]
      setStyle((s) => void (s.background.wallpaper = all[Math.floor(Math.random() * all.length)]))
    } else if (bg.type === 'gradient') {
      const g = GRADIENT_PRESETS[Math.floor(Math.random() * GRADIENT_PRESETS.length)]
      setStyle((s) => void (s.background.gradient = { angle: g.angle, stops: g.stops }))
    } else {
      const c = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`
      setStyle((s) => void (s.background.color = c))
    }
  }

  return (
    <>
      <PanelHeader title="Background">
        <Button size="sm" variant="ghost" onClick={randomize} title="Pick random">
          <Dices className="size-3.5" />
        </Button>
      </PanelHeader>
      <Section title="Backdrop">
        <Segmented
          value={bg.type}
          onChange={(v) => setStyle((s) => void (s.background.type = v))}
          options={[
            { value: 'wallpaper', label: 'Wallpaper' },
            { value: 'gradient', label: 'Gradient' },
            { value: 'color', label: 'Color' },
            { value: 'image', label: 'Image' },
          ]}
        />
        {bg.type === 'wallpaper' && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {WALLPAPERS.map((w) => (
                <Thumb
                  key={w.id}
                  title={w.name}
                  selected={bg.wallpaper === `builtin:${w.id}`}
                  onClick={() => setStyle((s) => void (s.background.wallpaper = `builtin:${w.id}`))}
                  style={{ background: cssWallpaper(w) }}
                />
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted">macOS</span>
              <button
                className="text-[12px] text-muted hover:text-fg inline-flex items-center gap-1"
                onClick={async () => {
                  const p = await api.currentWallpaper()
                  if (p) setStyle((s) => void (s.background.wallpaper = p))
                }}
              >
                <Monitor className="size-3" /> Use my desktop
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 max-h-[220px] overflow-y-auto pr-1">
              {system === null && <span className="col-span-4 text-[12px] text-faint">Loading wallpapers…</span>}
              {system?.map((w) => (
                <Thumb
                  key={w.path}
                  title={w.name}
                  selected={bg.wallpaper === w.path}
                  onClick={() => setStyle((s) => void (s.background.wallpaper = w.path))}
                  style={{ backgroundImage: `url("${mediaUrl(w.thumbnail ?? w.path)}")` }}
                />
              ))}
            </div>
          </>
        )}
        {bg.type === 'gradient' && (
          <>
            <div className="grid grid-cols-6 gap-2">
              {GRADIENT_PRESETS.map((g) => (
                <Thumb
                  key={g.name}
                  title={g.name}
                  selected={JSON.stringify(bg.gradient.stops) === JSON.stringify(g.stops)}
                  onClick={() => {
                    setHue(0)
                    setStyle((s) => void (s.background.gradient = { angle: g.angle, stops: g.stops }))
                  }}
                  style={{ background: cssGradient(g.angle, g.stops), aspectRatio: '1' }}
                />
              ))}
            </div>
            <Slider label="Angle" value={bg.gradient.angle} min={0} max={360} step={1} format={(v) => `${v}°`} onChange={(v) => setStyle((s) => void (s.background.gradient.angle = v), 'angle')} />
            <Slider
              label="Hue"
              value={hue}
              min={0}
              max={360}
              step={1}
              format={(v) => `${v}°`}
              onChange={(v) => {
                const delta = v - hue
                setHue(v)
                setStyle((s) => void (s.background.gradient.stops = s.background.gradient.stops.map((st) => ({ ...st, color: rotateHue(st.color, delta) }))), 'hue')
              }}
            />
            <div className="flex gap-2 flex-wrap">
              {bg.gradient.stops.map((st, i) => (
                <ColorInput key={i} value={st.color} onChange={(c) => setStyle((s) => void (s.background.gradient.stops[i].color = c), `stop${i}`)} />
              ))}
            </div>
          </>
        )}
        {bg.type === 'color' && (
          <div className="flex flex-col gap-2">
            <ColorInput value={bg.color} onChange={(c) => setStyle((s) => void (s.background.color = c), 'color')} />
            <div className="grid grid-cols-8 gap-1.5">
              {['#4776e6', '#111216', '#f2f2f5', '#ff5f57', '#ffbd2e', '#28c840', '#8e8e93', '#00b4d8', '#ff7a9a', '#2b2d34', '#e9e4da', '#14532d', '#1e3a8a', '#7c2d12', '#c026d3', '#0f766e'].map((c) => (
                <button key={c} className="aspect-square rounded-[5px] ring-1 ring-white/10" style={{ background: c }} onClick={() => setStyle((s) => void (s.background.color = c))} />
              ))}
            </div>
          </div>
        )}
        {bg.type === 'image' && (
          <div className="flex flex-col gap-2">
            {bg.image ? (
              <Thumb selected onClick={pickImage} style={{ backgroundImage: `url("${mediaUrl(bg.image)}")` }} />
            ) : null}
            <Button onClick={pickImage}>
              <ImagePlus className="size-4" /> {bg.image ? 'Replace image' : 'Choose image'}
            </Button>
          </div>
        )}
        {(bg.type === 'wallpaper' || bg.type === 'image') && (
          <Slider label="Blur" value={bg.blur} min={0} max={100} step={0.5} format={(v) => v.toFixed(0)} onChange={(v) => setStyle((s) => void (s.background.blur = v), 'blur')} />
        )}
      </Section>

      <Section title="Frame">
        <Field label="Aspect ratio">
          <div className="flex gap-2">
            <Select
              className="flex-1"
              value={String(output.aspectRatio)}
              options={ASPECTS.map((a) => ({ value: String(a.value), label: a.label }))}
              onChange={(v) => setOutput((o) => void (o.aspectRatio = v === 'auto' ? 'auto' : Number(v)))}
            />
            <Button onClick={onCrop} title="Crop recording">
              <Crop className="size-4" /> Crop
            </Button>
          </div>
        </Field>
        <Slider label="Padding" value={output.padding} min={0} max={0.25} step={0.005} format={pct} onChange={(v) => setOutput((o) => void (o.padding = v), 'padding')} />
        <Slider label="Roundness" value={style.screenRadius} min={0} max={128} step={1} format={(v) => `${v}px`} onChange={(v) => setStyle((s) => void (s.screenRadius = v), 'radius')} />
      </Section>

      <Section title="Shadow">
        <Slider label="Intensity" value={style.shadow.intensity} min={0} max={0.6} step={0.01} format={(v) => pct(v / 0.6)} onChange={(v) => setStyle((s) => void (s.shadow.intensity = v), 'shadow-i')} />
        <Slider label="Softness" value={style.shadow.blur} min={0} max={30} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => setStyle((s) => void (s.shadow.blur = v), 'shadow-b')} />
        <Segmented
          value={style.shadow.directional ? 'dir' : 'classic'}
          onChange={(v) => setStyle((s) => void (s.shadow.directional = v === 'dir'))}
          options={[
            { value: 'classic', label: 'Classic' },
            { value: 'dir', label: 'Directional' },
          ]}
        />
        {style.shadow.directional && (
          <>
            <Slider label="Distance" value={style.shadow.distance} min={0} max={100} step={1} format={(v) => v.toFixed(0)} onChange={(v) => setStyle((s) => void (s.shadow.distance = v), 'shadow-d')} />
            <Slider label="Angle" value={style.shadow.angle} min={0} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => setStyle((s) => void (s.shadow.angle = v), 'shadow-a')} />
          </>
        )}
      </Section>

      <Section title="Inset" defaultOpen={style.inset.size > 0}>
        <Toggle label="Show inset border" checked={style.inset.size > 0} onChange={(v) => setStyle((s) => void (s.inset.size = v ? 4 : 0))} />
        {style.inset.size > 0 && (
          <>
            <Slider label="Size" value={style.inset.size} min={0.125} max={24} step={0.125} format={(v) => v.toFixed(1)} onChange={(v) => setStyle((s) => void (s.inset.size = v), 'inset-s')} />
            <Slider label="Opacity" value={style.inset.alpha} min={0} max={1} step={0.01} format={pct} onChange={(v) => setStyle((s) => void (s.inset.alpha = v), 'inset-a')} />
            <ColorInput value={style.inset.color} onChange={(c) => setStyle((s) => void (s.inset.color = c), 'inset-c')} />
          </>
        )}
      </Section>
    </>
  )
}
