import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'

/**
 * Uploads an exported video to a self-hosted share server (see /share-server).
 * Protocol: POST {endpoint}/api/videos → { id, uploadUrl, url }, then PUT the bytes to uploadUrl,
 * then POST {endpoint}/api/videos/{id}/complete.
 */
export async function shareUpload(
  path: string,
  opts: { title: string; endpoint: string; token: string; visibility?: 'public' | 'private' },
  onProgress: (p: number) => void,
): Promise<{ url: string }> {
  const endpoint = opts.endpoint.replace(/\/+$/, '')
  const size = statSync(path).size
  const auth = { Authorization: `Bearer ${opts.token}` }
  const create = await fetch(`${endpoint}/api/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ title: opts.title, filename: basename(path), size, contentType: 'video/mp4', visibility: opts.visibility ?? 'public' }),
  })
  if (!create.ok) throw new Error(`Share server rejected the upload (${create.status})`)
  const { id, uploadUrl, url, visibility } = (await create.json()) as { id: string; uploadUrl: string; url: string; visibility?: string }
  // Fail closed: never upload a private video to a server that didn't agree to keep it private.
  const wanted = opts.visibility ?? 'public'
  if (visibility !== wanted) {
    await fetch(`${endpoint}/api/videos/${id}`, { method: 'DELETE', headers: auth }).catch(() => {})
    throw new Error(`Share server didn't confirm a ${wanted} link; nothing was uploaded`)
  }

  // The bearer token only ever goes back to the server the user configured.
  if (new URL(uploadUrl, endpoint).origin !== new URL(endpoint).origin) throw new Error('Share server returned an upload address on another host')
  let sent = 0
  const stream = createReadStream(path)
  stream.on('data', (chunk) => {
    sent += chunk.length
    onProgress(Math.min(0.99, sent / size))
  })
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), ...auth },
    body: Readable.toWeb(stream) as ReadableStream,
    // @ts-expect-error Node's fetch requires duplex for streamed bodies.
    duplex: 'half',
  })
  if (!put.ok) throw new Error(`Upload failed (${put.status})`)
  const done = await fetch(`${endpoint}/api/videos/${id}/complete`, { method: 'POST', headers: auth })
  if (!done.ok) throw new Error(`Share server couldn't finish the upload (${done.status})`)
  onProgress(1)
  return { url }
}
