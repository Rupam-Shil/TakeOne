import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor } from './store'
import { runtime, useScene } from './runtime'
import { needsMatte } from '@/render/scene'
import { PersonMatte } from '@/render/segmentation'
import { PreviewOverlay } from './PreviewOverlay'

const MAX_PREVIEW_HEIGHT = 1440

export function Preview() {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // Low-res copy of the frame, blurred by CSS, so the video lights the surfaces around it.
  const glow = useRef<HTMLCanvasElement>(null)
  const glowFrame = useRef(0)
  const scene = useScene()
  const [box, setBox] = useState({ width: 0, height: 0 })
  const bgRef = useRef<OffscreenCanvas | null>(null)
  const needsDraw = useRef(true)
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const safeZones = useEditor((s) => s.safeZones)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit the stage into the available space.
  const aspect = scene?.aspect ?? 16 / 9
  let cssW = box.width
  let cssH = cssW / aspect
  if (cssH > box.height) {
    cssH = box.height
    cssW = cssH * aspect
  }
  const dpr = window.devicePixelRatio || 1
  const scale = Math.min(dpr, MAX_PREVIEW_HEIGHT / Math.max(1, cssH))
  const pxW = Math.max(2, Math.round(cssW * scale))
  const pxH = Math.max(2, Math.round(cssH * scale))

  const bg = scene?.config.style.style.background
  useEffect(() => {
    if (!bg) return
    let alive = true
    runtime.background.get(bg, pxW, pxH).then((c) => {
      if (!alive) return
      bgRef.current = c
      needsDraw.current = true
    })
    return () => {
      alive = false
    }
  }, [bg, pxW, pxH])

  const cursorSet = scene?.config.style.cursor.set
  useEffect(() => {
    if (scene) void runtime.ensureCursors(scene.config.style.cursor).then(() => (needsDraw.current = true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorSet, !!scene])

  useEffect(() => {
    needsDraw.current = true
  }, [scene, pxW, pxH, safeZones])

  // Seek media when the playhead moves while paused.
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (s.playing || !runtime.playback || !sceneRef.current) return
        if (s.playMs !== prev.playMs || s.config !== prev.config) {
          const src = sceneRef.current.timeMap.toSource(s.playMs)
          void runtime.playback.seek(src).then(() => (needsDraw.current = true))
          needsDraw.current = true
        }
      }),
    [],
  )

  useEffect(() => {
    const off = () => (needsDraw.current = true)
    runtime.listeners.add(off)
    const v = runtime.playback?.screen
    v?.addEventListener('seeked', off)
    v?.addEventListener('loadeddata', off)
    runtime.playback?.camera?.addEventListener('seeked', off)
    return () => {
      runtime.listeners.delete(off)
      v?.removeEventListener('seeked', off)
      v?.removeEventListener('loadeddata', off)
      runtime.playback?.camera?.removeEventListener('seeked', off)
    }
  }, [])

  const wantsMatte = !!scene && scene.hasCamera && needsMatte(scene.config)
  const matter = useRef<PersonMatte | null>(null)
  useEffect(() => {
    if (!wantsMatte) return
    let alive = true
    PersonMatte.get().then((m) => {
      if (alive) {
        matter.current = m
        needsDraw.current = true
      }
    })
    return () => {
      alive = false
      matter.current = null
    }
  }, [wantsMatte])

  useEffect(() => {
    let raf = 0
    const ctx = canvas.current?.getContext('2d', { alpha: false })
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const sc = sceneRef.current
      const pb = runtime.playback
      if (!ctx || !sc || !pb) return
      const st = useEditor.getState()
      let sourceMs: number
      if (st.playing) {
        const play = pb.tick(sc.timeMap, sc.config)
        if (play === null) {
          useEditor.setState({ playing: false, playMs: sc.timeMap.duration })
          return
        }
        useEditor.setState({ playMs: play })
        sourceMs = pb.sourceMs
      } else {
        if (!needsDraw.current) return
        sourceMs = sc.timeMap.toSource(st.playMs)
      }
      needsDraw.current = false
      const g = glow.current
      if (g && (!st.playing || glowFrame.current++ % 6 === 0)) {
        const gc = g.getContext('2d')
        if (gc) gc.drawImage(ctx.canvas, 0, 0, g.width, g.height)
      }
      const cam = pb.camera
      const cameraMatte = matter.current && cam && cam.readyState >= 2 ? matter.current.matte(cam, performance.now()) : null
      runtime.compositor.render(ctx, sc, sourceMs, { screen: pb.screen, camera: cam, cameraMatte }, {
        width: ctx.canvas.width,
        height: ctx.canvas.height,
        background: bgRef.current,
        cursorImage: runtime.compositor.cursorBitmap ?? (() => null),
        frameMs: 1000 / 60,
        motionBlurSamples: st.playing ? 3 : 6,
        showSafeZones: st.safeZones === 'tiktok' ? 'tiktok' : 'none',
      })
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrap} className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center">
      <div className="relative" style={{ width: cssW, height: cssH }}>
        <canvas ref={glow} width={96} height={Math.max(2, Math.round(96 / aspect))} className="ambient" aria-hidden />
        <canvas
          ref={canvas}
          data-preview-canvas
          width={pxW}
          height={pxH}
          className="absolute inset-0 size-full rounded-[8px] shadow-[0_30px_80px_-30px_#000,0_0_0_1px_#ffffff14]"
        />
        {scene && <PreviewOverlay scene={scene} width={cssW} height={cssH} />}
      </div>
    </div>
  )
}
