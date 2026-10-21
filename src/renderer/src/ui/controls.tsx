import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'record' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }) {
  const variants: Record<ButtonVariant, string> = {
    // The selected tone of the scheme: a black pill on light surfaces, a white one in the dark editor.
    primary: 'bg-fg text-on-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_24px_-12px_rgba(0,0,0,0.8)] hover:brightness-110 active:brightness-95',
    secondary: 'btn-soft',
    ghost: 'bg-transparent text-muted hover:text-fg hover:bg-fg/6',
    record: 'text-white bg-[linear-gradient(180deg,#ff5f52,#e8392e)] shadow-[inset_0_1px_0_#ffffff40,0_10px_24px_-10px_#ff3b30cc] hover:brightness-110 active:brightness-95',
    danger: 'bg-transparent text-tally hover:bg-tally/12',
  }
  const sizes = { sm: 'h-7 px-3 text-[12px] gap-1.5', md: 'h-9 px-4 text-[13px] gap-2', lg: 'h-11 px-6 text-[14px] gap-2' }
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center rounded-full font-semibold transition-[background-color,filter,transform] duration-100 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function IconButton({
  active,
  className,
  children,
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center size-8 rounded-full transition-colors disabled:opacity-35',
        active ? 'bg-fg text-on-fg shadow-[0_6px_14px_-8px_rgba(0,0,0,0.8)]' : 'text-muted hover:text-fg hover:bg-fg/8',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
  disabled,
  fill,
}: {
  label?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  disabled?: boolean
  fill?: string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className={cx('flex flex-col gap-0.5', disabled && 'opacity-40 pointer-events-none')}>
      {label && (
        <span className="flex justify-between text-[12px] text-muted">
          <span>{label}</span>
          <span className="tabular text-fg/85">{format ? format(value) : value.toFixed(step < 1 ? 2 : 0)}</span>
        </span>
      )}
      <input
        type="range"
        className="fader"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--fader-pct' as string]: `${pct}%`, ['--fader-fill' as string]: fill }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-0.5">
      {label && (
        <span className="flex flex-col">
          <span className="text-[13px]">{label}</span>
          {hint && <span className="text-[11.5px] text-muted leading-snug">{hint}</span>}
        </span>
      )}
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onChange(!checked)
          }
        }}
        className={cx(
          'relative shrink-0 h-[24px] w-[42px] rounded-full transition-colors duration-150 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]',
          checked ? 'bg-fg' : 'bg-control',
        )}
      >
        <span
          className={cx(
            'absolute left-0 top-[3px] size-[18px] rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.45)] transition-[transform,background-color] duration-150',
            checked ? 'translate-x-[21px] bg-on-fg' : 'translate-x-[3px] bg-white',
          )}
        />
      </button>
    </label>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div role="radiogroup" className={cx('seg-track flex p-[3px] rounded-full', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 min-w-0 h-8 px-2 rounded-full text-[12.5px] font-semibold transition-[background-color,color] duration-150 inline-flex items-center justify-center gap-1.5 truncate',
            o.value === value ? 'seg-pill' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
  label?: string
}) {
  return (
    <div className={cx('relative', className)}>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none w-full h-9 pl-3 pr-8 rounded-full btn-soft text-[13px] font-semibold outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-muted pointer-events-none" />
    </div>
  )
}

export function Field({ label, children, inline }: { label: ReactNode; children: ReactNode; inline?: boolean }) {
  return (
    <label className={cx(inline ? 'flex items-center justify-between gap-3' : 'flex flex-col gap-1.5')}>
      <span className="text-[12px] text-muted">{label}</span>
      {children}
    </label>
  )
}

export function Section({ title, children, right, defaultOpen = true }: { title: ReactNode; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-line-soft last:border-b-0">
      <header className="flex items-center justify-between h-11 px-4">
        <button className="flex items-center gap-1.5 text-[13px] font-semibold text-fg" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown className={cx('size-3.5 text-faint transition-transform duration-150', !open && '-rotate-90')} />
          {title}
        </button>
        {right}
      </header>
      {open && <div className="px-4 pb-4 flex flex-col gap-3.5 rise-in">{children}</div>}
    </section>
  )
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative inline-flex items-center gap-2 h-9 pl-1.5 pr-3 rounded-full btn-soft">
      <span className="size-6 rounded-full border border-black/15" style={{ background: value }} />
      <span className="tabular text-[12px] uppercase text-fg/80">{value.replace('#', '')}</span>
      <input type="color" aria-label="Color" className="absolute inset-0 opacity-0" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** Lightweight anchored popover that closes on outside click / Escape. */
export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  className,
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end' | 'center'
  side?: 'bottom' | 'top'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative inline-flex">
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div
          data-popover
          className={cx(
            'absolute z-50 min-w-[200px] rounded-[16px] card p-1.5 rise-in',
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
            align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ children, onClick, active, danger }: { children: ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'w-full flex items-center gap-2 h-8 px-3 rounded-full text-left text-[13px] font-medium',
        danger ? 'text-tally hover:bg-tally/12' : 'hover:bg-fg/8',
        active && 'bg-fg/8',
      )}
    >
      {children}
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="keycap">{children}</kbd>
}
