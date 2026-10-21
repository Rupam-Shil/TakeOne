import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { Wallpaper } from '@shared/ipc'

const run = promisify(execFile)
const DESKTOP_PICTURES = '/System/Library/Desktop Pictures'

function cacheDir(name: string) {
  const d = join(app.getPath('userData'), 'cache', name)
  mkdirSync(d, { recursive: true })
  return d
}

/** Chromium can't decode HEIC, so wallpapers are converted to JPEG once with `sips`. */
async function toJpeg(src: string, maxSize: number, dir: string) {
  const out = join(dir, `${basename(src, extname(src))}-${maxSize}.jpg`)
  if (!existsSync(out)) {
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', String(maxSize), src, '--out', out])
  }
  return out
}

let wallpaperCache: Wallpaper[] | null = null

export async function systemWallpapers(): Promise<Wallpaper[]> {
  if (wallpaperCache) return wallpaperCache
  const dir = cacheDir('wallpapers')
  const sources: { name: string; path: string }[] = []
  try {
    for (const f of readdirSync(DESKTOP_PICTURES)) {
      if (/\.(heic|jpg|jpeg|png)$/i.test(f)) sources.push({ name: basename(f, extname(f)), path: join(DESKTOP_PICTURES, f) })
    }
    // Downloadable "madesktop" wallpapers only ship thumbnails locally; still usable as soft backgrounds.
    const thumbs = join(DESKTOP_PICTURES, '.thumbnails')
    if (existsSync(thumbs)) {
      for (const f of readdirSync(thumbs)) {
        const name = basename(f, extname(f))
        if (/\.(heic|jpg|png)$/i.test(f) && !sources.some((s) => s.name === name)) sources.push({ name, path: join(thumbs, f) })
      }
    }
  } catch {
    return []
  }
  const out: Wallpaper[] = []
  for (const s of sources.slice(0, 80)) {
    try {
      out.push({ name: s.name, path: await toJpeg(s.path, 3840, dir), thumbnail: await toJpeg(s.path, 320, dir) })
    } catch {
      /* skip undecodable */
    }
  }
  wallpaperCache = out
  return out
}

export async function currentWallpaper(): Promise<string | null> {
  try {
    const { stdout } = await run('osascript', ['-e', 'tell application "System Events" to get picture of current desktop'])
    const p = stdout.trim()
    if (!p || !existsSync(p)) return null
    return await toJpeg(p, 3840, cacheDir('wallpapers'))
  } catch {
    return null
  }
}

export function playSound(name: 'start' | 'stop') {
  const file = name === 'start' ? '/System/Library/Sounds/Tink.aiff' : '/System/Library/Sounds/Pop.aiff'
  execFile('afplay', ['-v', '0.33', file], () => {})
}

export function ffmpegPath(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'bin', 'ffmpeg'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ]
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string
    if (p) candidates.unshift(p.replace('app.asar', 'app.asar.unpacked'))
  } catch {
    /* optional dependency */
  }
  const found = candidates.find((c) => c && existsSync(c))
  if (!found) throw new Error('ffmpeg not found (needed for GIF export)')
  return found
}

export async function gifEncode(input: string, output: string, opts: { fps: number; width: number; loop: boolean; colors: number }) {
  // High quality: error-diffusion dithering. Standard: ordered dithering, which compresses far better.
  const dither = opts.colors >= 256 ? 'sierra2_4a' : 'bayer:bayer_scale=4'
  const filter = `fps=${opts.fps},scale=${opts.width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${opts.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`
  await run(ffmpegPath(), ['-y', '-i', input, '-filter_complex', filter, '-loop', opts.loop ? '0' : '-1', output], {
    maxBuffer: 1024 * 1024 * 64,
  })
}

export const privacyPane: Record<string, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
}

export async function listVoices() {
  const { stdout } = await run('say', ['-v', '?'])
  return stdout
    .split('\n')
    .map((l) => /^(.+?)\s{2,}([a-z]{2,3}_[A-Z0-9]{2,3})\s+#\s?(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ name: m[1].trim(), locale: m[2], sample: m[3] }))
}

export async function audioDuration(path: string) {
  const { stdout } = await run('afinfo', [path])
  const m = /estimated duration: ([\d.]+) sec/.exec(stdout)
  return m ? Math.round(parseFloat(m[1]) * 1000) : 0
}

/** On-device text-to-speech with the system voices, saved as AAC. */
export async function synthesizeSpeech(text: string, voice: string, rate: number, outDir: string) {
  const clean = text.slice(0, 2000)
  mkdirSync(outDir, { recursive: true })
  const base = join(outDir, `voiceover-${Date.now()}`)
  const args = ['--file-format=m4af', '--data-format=aac', '-o', `${base}.m4a`, '-r', String(Math.round(Math.min(360, Math.max(90, rate))))]
  if (voice) args.unshift('-v', voice)
  args.push('--', clean)
  await run('say', args)
  return { path: `${base}.m4a`, duration: await audioDuration(`${base}.m4a`) }
}
