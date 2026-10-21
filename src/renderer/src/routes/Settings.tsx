import { useEffect, useState, type ReactNode } from 'react'
import { Keyboard, Link2, ShieldCheck, SlidersHorizontal, Video } from 'lucide-react'
import type { CaptureSources, PermissionStatus } from '@shared/recording'
import type { ShortcutSettings } from '@shared/settings'
import { api, useSettings } from '@/lib/bridge'
import { deleteDownloadedModels, downloadedModelBytes } from '@/lib/ai-models'
import { Button, Segmented, Select, Toggle, cx } from '@/ui/controls'
import { formatShortcut } from '@/lib/shortcuts'
import { PERMISSION_COPY } from './Welcome'

type Tab = 'general' | 'recording' | 'shortcuts' | 'sharing' | 'permissions'

export default function Settings() {
  const [settings, update] = useSettings()
  const [tab, setTab] = useState<Tab>('general')
  const [sources, setSources] = useState<CaptureSources | null>(null)
  useEffect(() => {
    api.listSources().then(setSources).catch(() => {})
  }, [])
  if (!settings) return null
  const r = settings.recording
  const g = settings.general

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'general', label: 'General', icon: <SlidersHorizontal className="size-4" /> },
    { id: 'recording', label: 'Recording', icon: <Video className="size-4" /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard className="size-4" /> },
    { id: 'sharing', label: 'Sharing', icon: <Link2 className="size-4" /> },
    { id: 'permissions', label: 'Permissions', icon: <ShieldCheck className="size-4" /> },
  ]

  return (
    <div className="h-full flex">
      <aside className="drag w-[232px] shrink-0 h-full flex flex-col gap-1 px-3 pb-4 border-r border-line-soft bg-panel">
        <h1 className="h-[52px] shrink-0 flex items-center pl-3 text-[17px] font-bold">Settings</h1>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={cx(
              'no-drag flex items-center gap-2.5 h-10 px-3.5 rounded-full text-[13.5px] font-semibold transition-colors',
              tab === t.id ? 'bg-fg text-on-fg shadow-[0_8px_18px_-10px_rgba(0,0,0,0.7)]' : 'text-muted hover:text-fg hover:bg-fg/6',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="drag h-[56px] flex items-end px-8 pb-1">
          <h1 className="text-[17px] font-semibold">{tabs.find((t) => t.id === tab)?.label}</h1>
        </div>
        <div className="px-8 pb-8 pt-4 flex flex-col gap-6 max-w-[560px]">
          {tab === 'general' && (
            <>
              <Group title="Library">
                <PathRow
                  label="Projects folder"
                  value={g.projectsDir}
                  onPick={async () => {
                    const [p] = await api.showOpenDialog({ properties: ['openDirectory'], defaultPath: g.projectsDir })
                    if (p) update({ general: { projectsDir: p } })
                  }}
                />
                <PathRow
                  label="Export folder"
                  value={g.exportDir}
                  onPick={async () => {
                    const [p] = await api.showOpenDialog({ properties: ['openDirectory'], defaultPath: g.exportDir })
                    if (p) update({ general: { exportDir: p } })
                  }}
                />
              </Group>
              <Group title="Behavior">
                <Toggle label="Open editor when recording stops" checked={g.openEditorAfterRecording} onChange={(v) => update({ general: { openEditorAfterRecording: v } })} />
                <Toggle label="Launch at login" checked={g.launchAtLogin} onChange={(v) => update({ general: { launchAtLogin: v } })} />
                <Toggle
                  label="Show in Dock"
                  hint="When off, the app lives only in the menu bar."
                  checked={g.showInDock}
                  onChange={(v) => update({ general: { showInDock: v } })}
                />
                <Toggle
                  label="Reuse last project's look"
                  hint="New recordings start with the background, cursor and other settings you used last."
                  checked={g.useLastProjectSettings}
                  onChange={(v) => update({ general: { useLastProjectSettings: v } })}
                />
              </Group>
              <OnDeviceModels />
            </>
          )}

          {tab === 'recording' && (
            <>
              <Group title="Capture">
                <Row label="Frame rate">
                  <Segmented value={r.fps} options={[{ value: 30, label: '30 fps' }, { value: 60, label: '60 fps' }]} onChange={(v) => update({ recording: { fps: v } })} className="w-[180px]" />
                </Row>
                <Row label="Countdown">
                  <Segmented
                    value={r.countdown}
                    options={[0, 3, 5, 10].map((n) => ({ value: n as 0 | 3 | 5 | 10, label: n ? `${n}s` : 'Off' }))}
                    onChange={(v) => update({ recording: { countdown: v } })}
                    className="w-[220px]"
                  />
                </Row>
                <Row label="Camera">
                  <Select
                    className="w-[240px]"
                    value={r.cameraId ?? ''}
                    options={[{ value: '', label: 'No camera' }, ...(sources?.cameras ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                    onChange={(v) => update({ recording: { cameraId: v || null } })}
                  />
                </Row>
                <Row label="Microphone">
                  <Select
                    className="w-[240px]"
                    value={r.microphoneId ?? ''}
                    options={[{ value: '', label: 'No microphone' }, ...(sources?.microphones ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                    onChange={(v) => update({ recording: { microphoneId: v || null } })}
                  />
                </Row>
                <Row label="Camera resolution">
                  <Segmented
                    value={r.cameraMaxHeight}
                    options={[
                      { value: 720, label: '720p' },
                      { value: 1080, label: '1080p' },
                      { value: 2160, label: '4K' },
                    ]}
                    onChange={(v) => update({ recording: { cameraMaxHeight: v } })}
                    className="w-[200px]"
                  />
                </Row>
                <Toggle
                  label="Record system audio"
                  hint={r.systemAudio && r.systemAudioApps.length ? `Only ${r.systemAudioApps.length} selected ${r.systemAudioApps.length === 1 ? 'app' : 'apps'}. Change this in the recording bar.` : 'Pick specific apps from the recording bar.'}
                  checked={r.systemAudio}
                  onChange={(v) => update({ recording: { systemAudio: v } })}
                />
              </Group>
              <Group title="After recording">
                <Row label="When you stop">
                  <Select
                    className="w-[240px]"
                    value={r.afterRecording}
                    options={[
                      { value: 'open-editor', label: 'Open in editor' },
                      { value: 'export-clipboard', label: 'Export & copy to clipboard' },
                      { value: 'export-file', label: 'Export & save to file' },
                      { value: 'export-link', label: 'Export & create link' },
                    ]}
                    onChange={(v) => update({ recording: { afterRecording: v } })}
                  />
                </Row>
                <Toggle label="Create zooms automatically" hint="Adds a zoom around every burst of clicks." checked={r.autoZoom} onChange={(v) => update({ recording: { autoZoom: v } })} />
              </Group>
              <Group title="While recording">
                <Toggle label="Hide desktop icons" hint="Icons are left out of the capture; your wallpaper stays." checked={r.hideDesktopIcons} onChange={(v) => update({ recording: { hideDesktopIcons: v } })} />
                <Toggle label="Show camera preview" checked={r.showCameraPreview} onChange={(v) => update({ recording: { showCameraPreview: v } })} />
                <Toggle label="Dim outside the recorded area" checked={r.highlightRecordedArea} onChange={(v) => update({ recording: { highlightRecordedArea: v } })} />
                <Toggle label="Play start and stop sounds" checked={r.playSounds} onChange={(v) => update({ recording: { playSounds: v } })} />
                <Toggle
                  label="Show speaker notes"
                  hint="A teleprompter that stays out of the recording. Toggle it any time with ⌥⌘. (Option-Command-period). Change the key in the Shortcuts tab."
                  checked={r.speakerNotes.enabled}
                  onChange={(v) => update({ recording: { speakerNotes: { enabled: v } } })}
                />
              </Group>
              <Group title="Keystrokes">
                <Row label="Record keys">
                  <Segmented
                    value={r.keystrokes}
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'shortcuts', label: 'Shortcuts', title: 'Key combinations with ⌘, ⌃ or ⌥; plain typing is timed but not stored' },
                      { value: 'all', label: 'All keys' },
                    ]}
                    onChange={(v) => update({ recording: { keystrokes: v } })}
                    className="w-[260px]"
                  />
                </Row>
                <p className="text-[12px] text-muted -mt-1">
                  Shortcuts mode keeps only key combinations, so passwords you type are never written to the project.
                </p>
              </Group>
            </>
          )}

          {tab === 'shortcuts' && (
            <Group title="Global shortcuts">
              {(
                [
                  ['startStopRecording', 'Start / stop recording'],
                  ['recordDisplay', 'Record display'],
                  ['recordWindow', 'Record window'],
                  ['recordArea', 'Record area'],
                  ['pauseResumeRecording', 'Pause / resume'],
                  ['restartRecording', 'Restart recording'],
                  ['cancelRecording', 'Discard recording'],
                  ['addMarker', 'Add marker'],
                  ['toggleSpeakerNotes', 'Show speaker notes'],
                ] as [keyof ShortcutSettings, string][]
              ).map(([key, label]) => (
                <Row key={key} label={label}>
                  <ShortcutInput value={settings.shortcuts[key]} onChange={(v) => update({ shortcuts: { [key]: v } })} />
                </Row>
              ))}
            </Group>
          )}

          {tab === 'sharing' && (
            <Group title="Share server">
              <p className="text-[12.5px] text-muted -mt-1">
                Shareable links upload to a share server you run yourself. Enter its address and upload token.
              </p>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-muted">Server address</span>
                <input
                  defaultValue={settings.share.endpoint}
                  placeholder="https://share.example.com"
                  onBlur={(e) => update({ share: { endpoint: e.target.value.trim() } })}
                  className="h-8 px-2.5 rounded-[9px] bg-control text-[13px] outline-none focus:ring-1 focus:ring-fg/40"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-muted">Upload token</span>
                <input
                  type="password"
                  defaultValue={settings.share.token}
                  onBlur={(e) => update({ share: { token: e.target.value.trim() } })}
                  className="h-8 px-2.5 rounded-[9px] bg-control text-[13px] outline-none focus:ring-1 focus:ring-fg/40"
                />
              </label>
              <Toggle
                label="Private links by default"
                checked={settings.share.visibility === 'private'}
                onChange={(v) => update({ share: { visibility: v ? 'private' : 'public' } })}
              />
            </Group>
          )}

          {tab === 'permissions' && <Permissions />}
        </div>
      </main>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-muted">{title}</h2>
      <div className="flex flex-col gap-3.5 card p-5">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px]">{label}</span>
      {children}
    </div>
  )
}

function PathRow({ label, value, onPick }: { label: string; value: string; onPick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        <div className="text-[11.5px] text-muted truncate">{value}</div>
      </div>
      <Button size="sm" onClick={onPick}>
        Change…
      </Button>
    </div>
  )
}

function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false)
  const pretty = formatShortcut(value)
  return (
    <button
      className={cx(
        'h-8 min-w-[130px] px-3 rounded-[9px] text-[13px] tabular font-semibold',
        listening ? 'bg-fg text-on-fg' : 'btn-soft',
      )}
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
      onKeyDown={(e) => {
        if (!listening) return
        e.preventDefault()
        if (e.key === 'Escape') return setListening(false)
        if (['Meta', 'Shift', 'Alt', 'Control'].includes(e.key)) return
        const parts: string[] = []
        if (e.metaKey) parts.push('CommandOrControl')
        if (e.ctrlKey) parts.push('Control')
        if (e.altKey) parts.push('Alt')
        if (e.shiftKey) parts.push('Shift')
        if (!parts.length) return
        const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key === 'Backspace' ? 'Backspace' : e.key.length === 1 ? e.key.toUpperCase() : e.key
        onChange([...parts, key].join('+'))
        setListening(false)
      }}
    >
      {listening ? 'Press keys…' : pretty || 'None'}
    </button>
  )
}

const formatMb = (bytes: number) => (bytes < 1e6 && bytes > 0 ? '< 1 MB' : `${Math.round(bytes / 1e6)} MB`)

function OnDeviceModels() {
  const [bytes, setBytes] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = async () => setBytes(await downloadedModelBytes())
  useEffect(() => {
    void refresh()
  }, [])
  const remove = async () => {
    setBusy(true)
    try {
      await deleteDownloadedModels()
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Group title="On-device AI">
      <p className="text-[12.5px] text-muted -mt-1">
        Natural voices (Kokoro) and Whisper transcription run on your Mac. Models download the first time you use them and stay in the app's cache.
      </p>
      <Row label={bytes === null ? 'Downloaded: …' : `Downloaded: ${bytes ? formatMb(bytes) : 'nothing yet'}`}>
        <Button size="sm" disabled={busy || !bytes} onClick={remove}>
          {busy ? 'Deleting…' : 'Delete downloaded models'}
        </Button>
      </Row>
    </Group>
  )
}

function Permissions() {
  const [status, setStatus] = useState<PermissionStatus | null>(null)
  useEffect(() => {
    api.permissionStatus().then(setStatus)
    const t = setInterval(() => api.permissionStatus().then(setStatus), 2000)
    return () => clearInterval(t)
  }, [])
  const rows: [keyof PermissionStatus, string, string][] = [
    ...PERMISSION_COPY.filter((p) => p.kind !== 'camera').map((p) => [p.kind, p.title, p.why] as [keyof PermissionStatus, string, string]),
    ['camera', 'Camera', 'For the camera overlay.'],
    ['microphone', 'Microphone', 'For your voice.'],
  ]
  return (
    <Group title="Permissions">
      {rows.map(([k, label, hint]) => (
        <div key={k} className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px]">{label}</div>
            <div className="text-[11.5px] text-muted">{hint}</div>
          </div>
          {status?.[k] === 'granted' ? (
            <span className="text-[12px] text-speed font-semibold">Allowed</span>
          ) : (
            <Button
              size="sm"
              onClick={async () => {
                const s = await api.requestPermission(k)
                setStatus(s)
                if (s[k] !== 'granted') api.openPrivacySettings(k)
              }}
            >
              Allow…
            </Button>
          )}
        </div>
      ))}
    </Group>
  )
}
