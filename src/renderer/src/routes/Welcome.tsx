import { useEffect, useState } from 'react'
import { ArrowRight, Check, Keyboard, Monitor, MousePointerClick, Video } from 'lucide-react'
import type { PermissionStatus } from '@shared/recording'
import { api } from '@/lib/bridge'
import { Button, cx } from '@/ui/controls'

export const PERMISSION_COPY: { kind: keyof PermissionStatus; title: string; why: string; required?: boolean }[] = [
  { kind: 'screen', title: 'Screen recording', why: 'Needed to capture your displays and windows.', required: true },
  { kind: 'accessibility', title: 'Accessibility', why: 'Lets the recorder follow your clicks so zooms land in the right place.' },
  { kind: 'inputMonitoring', title: 'Input monitoring', why: 'Shows the keyboard shortcuts you press in your videos.' },
  { kind: 'camera', title: 'Camera and microphone', why: 'Only if you want your face or voice in recordings.' },
]

const ICONS: Record<string, React.ReactNode> = {
  screen: <Monitor className="size-4" />,
  accessibility: <MousePointerClick className="size-4" />,
  inputMonitoring: <Keyboard className="size-4" />,
  camera: <Video className="size-4" />,
}

/** First-run walkthrough of the macOS permissions the recorder needs. */
export default function Welcome() {
  const [status, setStatus] = useState<PermissionStatus | null>(null)
  useEffect(() => {
    const poll = () => api.permissionStatus().then(setStatus).catch(() => {})
    poll()
    const t = setInterval(poll, 1500)
    return () => clearInterval(t)
  }, [])

  const allow = async (kind: keyof PermissionStatus) => {
    const s = await api.requestPermission(kind)
    if (kind === 'camera') await api.requestPermission('microphone')
    setStatus(s)
    if (s[kind] !== 'granted') api.openPrivacySettings(kind)
  }

  const finish = async () => {
    await api.updateSettings({ general: { onboarded: true } })
    await api.openHome()
  }

  const granted = (k: keyof PermissionStatus) => status?.[k] === 'granted' && (k !== 'camera' || status.microphone === 'granted')
  const done = PERMISSION_COPY.filter((s) => granted(s.kind)).length

  return (
    <div className="h-full app-surface flex flex-col">
      <div className="drag h-12 shrink-0" />
      <div className="relative flex-1 min-h-0 w-full max-w-[820px] mx-auto px-10 flex flex-col overflow-y-auto">
        <img src="./icon.png?v=3" alt="" className="size-16 -ml-1 mb-5 shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.03em]">
          Record once.
          <br />
          Everything else is <span className="font-serif italic font-normal tracking-normal">automatic.</span>
        </h1>
        <p className="text-muted mt-3 max-w-[440px] text-[14px] font-medium">
          Zooms follow your clicks, the cursor moves smoothly and a background is added for you. A few macOS permissions make that possible.
        </p>
        <ol className="mt-6 flex flex-col gap-2.5 pb-4">
          {PERMISSION_COPY.map((s) => {
            const ok = granted(s.kind)
            return (
              <li key={s.kind} className="flex items-center gap-3.5 card px-4 py-3.5">
                <span className={cx('size-9 rounded-full inline-flex items-center justify-center', ok ? 'bg-fg text-on-fg' : 'bg-control text-muted')}>
                  {ok ? <Check className="size-4" /> : ICONS[s.kind]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold">
                    {s.title} {!s.required && <span className="text-faint font-medium text-[12.5px]">(optional)</span>}
                  </div>
                  <div className="text-[12.5px] text-muted font-medium">{s.why}</div>
                </div>
                {ok ? (
                  <span className="text-[13px] text-muted font-semibold pr-1">Allowed</span>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => allow(s.kind)}>
                    Allow…
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      </div>
      <div className="shrink-0 w-full max-w-[820px] mx-auto px-10 py-5 flex items-center gap-3">
        <span className="text-[13px] text-muted font-medium">
          {granted('screen') ? (done === PERMISSION_COPY.length ? 'All set.' : 'Screen recording is on. The rest can wait.') : 'Allow screen recording to continue.'}
          <span className="text-faint tabular"> {done} of {PERMISSION_COPY.length} allowed</span>
        </span>
        <div className="flex-1" />
        <Button variant="ghost" onClick={finish}>
          Skip for now
        </Button>
        <Button variant="primary" size="lg" onClick={finish} disabled={!granted('screen')}>
          Continue <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
