import { useEffect, useState } from 'react'
import { Pause, Play, RotateCcw, Trash2 } from 'lucide-react'
import type { RecorderState } from '@shared/recording'
import { api, bridge, formatTime } from '@/lib/bridge'
import { cx } from '@/ui/controls'

/** Floating pill shown while recording. The window is non-focusable so clicks don't steal focus. */
export default function Controls() {
  const [state, setRaw] = useState<(RecorderState & { receivedAt: number }) | null>(null)
  const [, tick] = useState(0)
  // Restart and discard throw the take away, so they ask once; the question clears itself after a moment.
  const [confirm, setConfirm] = useState<'restart' | 'discard' | null>(null)
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(null), 4000)
    return () => clearTimeout(t)
  }, [confirm])

  useEffect(() => {
    const setState = (s: RecorderState) => setRaw({ ...s, receivedAt: Date.now() })
    api.recorderState().then(setState)
    const off = bridge.on('recorder:state', setState)
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  if (!state) return null
  const paused = state.phase === 'paused'
  // `elapsed` is a snapshot from main; extrapolate locally while running.
  const elapsed = state.elapsed + (state.phase === 'recording' ? (Date.now() - state.receivedAt) / 1000 : 0)

  return (
    <div className="h-full w-full flex items-center justify-center px-6 py-5 font-[system-ui] antialiased">
      <div className="drag soft-pill h-[64px] rounded-full flex items-center p-1.5 gap-1.5">
        <button
          className="no-drag soft-pill-dark h-[52px] pl-4 pr-5 rounded-full inline-flex items-center gap-3 text-[17px] font-bold tabular soft-tab"
          onClick={() => api.stopRecording()}
          title="Stop recording"
          aria-label="Stop recording"
        >
          <span className={cx('size-3 rounded-[3px] bg-[#ff4f43]', !paused && 'tally-pulse')} />
          {formatTime(elapsed)}
        </button>
        {confirm ? (
          <div className="no-drag flex items-center gap-2 pl-3 pr-1">
            <span className="text-[14px] font-semibold text-[#8e8e93] whitespace-nowrap mr-1">{confirm === 'restart' ? 'Start over?' : 'Discard take?'}</span>
            <button
              className="h-10 px-4 rounded-full bg-[linear-gradient(180deg,#ff5f52,#e8392e)] text-white text-[14px] font-bold soft-tab shadow-[inset_0_1px_0_#ffffff40]"
              onClick={() => {
                setConfirm(null)
                void (confirm === 'restart' ? api.restartRecording() : api.cancelRecording())
              }}
            >
              {confirm === 'restart' ? 'Restart' : 'Discard'}
            </button>
            <button className="h-10 px-4 rounded-full text-[14px] font-semibold text-[#1a1a1c] hover:bg-black/5 mr-1" onClick={() => setConfirm(null)}>
              Keep
            </button>
          </div>
        ) : (
          <>
            <CtrlButton label={paused ? 'Resume' : 'Pause'} onClick={() => api.togglePause()}>
              {paused ? <Play className="size-5 fill-current" /> : <Pause className="size-5 fill-current" />}
            </CtrlButton>
            <CtrlButton label="Restart" onClick={() => setConfirm('restart')}>
              <RotateCcw className="size-5" />
            </CtrlButton>
            <CtrlButton label="Discard" onClick={() => setConfirm('discard')}>
              <Trash2 className="size-5" />
            </CtrlButton>
          </>
        )}
      </div>
    </div>
  )
}

function CtrlButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="no-drag soft-tab size-[52px] rounded-full inline-flex items-center justify-center text-[#1a1a1c] hover:bg-black/5 [&>svg]:stroke-[2.2]"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  )
}
