import { protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.webm': 'video/webm',
}

export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true },
    },
    // The packaged renderer is served from app:// so fetch() works for wasm/model assets.
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ])
}

/** app://renderer/<path> → files under the built renderer directory. */
export function handleAppProtocol(root: string) {
  protocol.handle('app', async (request) => {
    let rel: string
    try {
      rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
    } catch {
      return new Response('bad request', { status: 400 })
    }
    const file = join(root, normalize(rel))
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return new Response('forbidden', { status: 403 })
    try {
      const data = await readFile(file)
      const types: Record<string, string> = { ...MIME, '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.map': 'application/json' }
      return new Response(data, { headers: { 'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

/** media://local/<absolute path> → file contents, with HTTP range support for video seeking. */
export function handleMediaProtocol() {
  protocol.handle('media', (request) => {
    let path: string
    try {
      path = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('bad request', { status: 400 })
    }
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    }
    const range = request.headers.get('range')
    const match = range && /bytes=(\d*)-(\d*)/.exec(range)
    if (match && (match[1] || match[2])) {
      const start = match[1] ? parseInt(match[1], 10) : Math.max(0, size - parseInt(match[2], 10))
      const end = match[1] && match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1
      if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      headers['Content-Length'] = String(end - start + 1)
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
      return new Response(stream, { status: 206, headers })
    }
    headers['Content-Length'] = String(size)
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { status: 200, headers })
  })
}

export { mediaUrl } from '@shared/media'
