import { useEffect, useState } from 'react'
import { AppWindow, Camera, CameraOff, Crop, Mic, MicOff, Monitor, Settings2, Smartphone, Volume2, VolumeX, X } from 'lucide-react'
import type { CaptureSources, PermissionStatus } from '@shared/recording'
import { api, useSettings } from '@/lib/bridge'
import { cx } from '@/ui/controls'

type Mode = 'display' | 'window' | 'area' | 'device'
const MODE_KEY = 'studio.sourceMode'

/**
 * The floating recording controls: a row of status pills for the devices, and a tab bar for the
 * source. The window is transparent; each pill casts its own shadow.
 */
export default function Toolbar() {
  const [settings] = useSettings()
  const [sources, setSources] = useState<CaptureSources | null>(null)
  const [perms, setPerms] = useState<PermissionStatus | null>(null)
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) || 'display')

  useEffect(() => {
    const refresh = () => api.listSources().then(setSources).catch(() => {})
    refresh()
    // iPhones show up a few seconds after they're plugged in and trusted.
    const t = setInterval(refresh, 4000)
    api.permissionStatus().then(setPerms).catch(() => {})
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.closeWindow()
      if (e.key === '1') choose('display')
      if (e.key === '2') choose('window')
      if (e.key === '3') choose('area')
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(t)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = (m: Mode) => {
    setMode(m)
    localStorage.setItem(MODE_KEY, m)
    if (m === 'device') {
      const devices = sources?.mobileDevices ?? []
      if (devices.length === 1) api.startRecording({ type: 'device', deviceId: devices[0].id })
      else api.showDeviceMenu('mobile')
      return
    }
    api.beginSelection(m)
  }

  if (!settings) return null
  const rec = settings.recording
  const camName = sources?.cameras.find((c) => c.id === rec.cameraId)?.name
  const micName = sources?.microphones.find((m) => m.id === rec.microphoneId)?.name
  const audioApps = rec.systemAudioApps
  const audioLabel = !rec.systemAudio
    ? 'No system audio'
    : audioApps.length === 1
      ? `${sources?.apps.find((a) => a.bundleId === audioApps[0])?.name ?? '1 app'} audio`
      : audioApps.length > 1
        ? `System audio (${audioApps.length} apps)`
        : 'System audio'
  const needsScreen = perms && perms.screen !== 'granted'
  const hasDevice = !!sources?.mobileDevices.length

  return (
    <div className="h-full w-full flex flex-col items-center justify-end gap-3 pb-2 px-3 font-[system-ui] antialiased">
      <div className="no-drag flex items-center gap-2.5">
        <RoundButton label="Close (Esc)" onClick={() => api.closeWindow()}>
          <X className="size-4" />
        </RoundButton>
        <StatusPill on={!!rec.cameraId} icon={rec.cameraId ? <Camera /> : <CameraOff />} label={camName ?? (rec.cameraId ? 'Camera' : 'No camera')} onClick={() => api.showDeviceMenu('camera')} />
        <StatusPill on={!!rec.microphoneId} icon={rec.microphoneId ? <Mic /> : <MicOff />} label={micName ?? (rec.microphoneId ? 'Microphone' : 'No microphone')} onClick={() => api.showDeviceMenu('microphone')} />
        <StatusPill on={rec.systemAudio} icon={rec.systemAudio ? <Volume2 /> : <VolumeX />} label={audioLabel} onClick={() => api.showDeviceMenu('systemAudio')} />
        <RoundButton label="Settings" onClick={() => api.openSettings()}>
          <Settings2 className="size-4" />
        </RoundButton>
      </div>

      {needsScreen ? (
        <div className="drag soft-pill h-[68px] rounded-full flex items-center gap-4 pl-6 pr-2">
          <span className="text-[15px] font-semibold text-[#1a1a1c]">Screen recording access is off</span>
          <button
            className="no-drag soft-pill-dark h-[52px] px-6 rounded-full text-[15px] font-bold"
            onClick={async () => {
              await api.requestPermission('screen')
              await api.openPrivacySettings('screen')
            }}
          >
            Open privacy settings
          </button>
        </div>
      ) : (
        <div className="drag soft-pill h-[58px] rounded-full flex items-center p-1.5 gap-1">
          <Tab active={mode === 'display'} icon={<Monitor />} label="Display" hint="Record a display (1)" onClick={() => choose('display')} />
          <Tab active={mode === 'window'} icon={<AppWindow />} label="Window" hint="Record a window (2)" onClick={() => choose('window')} />
          <Tab active={mode === 'area'} icon={<Crop />} label="Area" hint="Record an area (3)" onClick={() => choose('area')} />
          <Tab
            active={mode === 'device'}
            disabled={!hasDevice}
            icon={<Smartphone />}
            label="Device"
            hint={hasDevice ? 'Record a connected iPhone or iPad' : 'Connect an iPhone or iPad with a cable and unlock it'}
            onClick={() => choose('device')}
          />
        </div>
      )}
    </div>
  )
}

function Tab({ active, icon, label, hint, onClick, disabled }: { active: boolean; icon: React.ReactNode; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      title={hint}
      onClick={onClick}
      className={cx(
        'no-drag soft-tab h-[46px] px-5 rounded-full inline-flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em] [&>svg]:size-[18px] [&>svg]:stroke-[2.2]',
        active ? 'soft-pill-dark' : 'text-[#1a1a1c] hover:bg-black/5',
        disabled && 'opacity-30 pointer-events-none',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function StatusPill({ icon, label, on, onClick }: { icon: React.ReactNode; label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cx(
        'soft-btn h-[42px] pl-3 pr-4 rounded-full inline-flex items-center gap-2 max-w-[220px] text-[15px] font-semibold tracking-[-0.01em] [&>svg]:size-[18px] [&>svg]:stroke-[2.1] [&>svg]:shrink-0',
        on ? 'text-[#1a1a1c]' : 'text-[#8e8e93]',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="soft-btn size-[42px] rounded-full inline-flex items-center justify-center text-[#1a1a1c] [&>svg]:stroke-[2.2]">
      {children}
    </button>
  )
}
