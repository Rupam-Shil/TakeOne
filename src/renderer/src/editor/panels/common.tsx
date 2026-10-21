import type { ReactNode } from 'react'
import type { ProjectConfig, StyleConfig } from '@shared/project'
import { useEditor } from '../store'

/** Reads one style section and returns a coalescing updater for it. */
export function useStyleSection<K extends keyof StyleConfig>(key: K): [StyleConfig[K], (fn: (s: StyleConfig[K]) => void, gesture?: string) => void] {
  const value = useEditor((s) => s.config!.style[key])
  const update = useEditor((s) => s.update)
  return [value, (fn, gesture) => update((d: ProjectConfig) => fn(d.style[key]), gesture ? `${String(key)}.${gesture}` : undefined)]
}

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-line-soft">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {children}
    </div>
  )
}

export function Thumb({ selected, onClick, children, title, style }: { selected?: boolean; onClick: () => void; children?: ReactNode; title?: string; style?: React.CSSProperties }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={style}
      className={`relative aspect-[16/10] rounded-[7px] overflow-hidden bg-raised bg-cover bg-center transition-shadow ${
        selected ? 'ring-2 ring-fg ring-offset-2 ring-offset-panel' : 'ring-1 ring-white/10 hover:ring-white/30'
      }`}
    >
      {children}
    </button>
  )
}

export const pct = (v: number) => `${Math.round(v * 100)}%`
