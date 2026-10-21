import { useEffect, useRef, useState } from 'react'
import { bridge, useQuery } from '@/lib/bridge'

/** Round, draggable webcam preview. The capture helper records the camera itself; this is only a mirror. */
export default function CameraPreview() {
  const q = useQuery()
  const [label, setLabel] = useState(q.get('label') ?? '')
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => bridge.on('camera:device', setLabel), [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    ;(async () => {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const match = devices.find((d) => d.kind === 'videoinput' && d.label === label)
      stream = await navigator.mediaDevices.getUserMedia({
        video: match ? { deviceId: { exact: match.deviceId }, width: 640, height: 640 } : { width: 640, height: 640 },
      })
      if (cancelled) return stream.getTracks().forEach((t) => t.stop())
      if (video.current) video.current.srcObject = stream
    })().catch(() => {})
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [label])

  return (
    <div className="drag h-full w-full p-2">
      <div className="h-full w-full rounded-full overflow-hidden bg-black shadow-[0_16px_40px_-10px_#000e,0_0_0_1px_#ffffff22,inset_0_1px_0_#ffffff30]">
        <video ref={video} autoPlay muted playsInline className="h-full w-full object-cover -scale-x-100" />
      </div>
    </div>
  )
}
