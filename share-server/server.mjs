// Self-hosted shareable links for Studio Clone exports. No dependencies; Node 22+.
//
//   SHARE_TOKEN=secret PORT=8787 PUBLIC_URL=https://share.example.com node share-server/server.mjs
//
// API (Bearer SHARE_TOKEN):
//   POST /api/videos {title, filename, size, contentType, visibility} → {id, uploadUrl, url}
//   PUT  /api/videos/:id/upload   (raw body)
//   POST /api/videos/:id/complete
//   DELETE /api/videos/:id
// Pages:
//   GET /v/:id[?k=key]   watch page        GET /v/:id/video.mp4   range-streamed file
//   GET /dashboard       manage links (asks for the token once, stored in a cookie)

import { createServer } from 'node:http'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

const PORT = Number(process.env.PORT ?? 8787)
const TOKEN = process.env.SHARE_TOKEN ?? ''
const DATA = resolve(process.env.DATA_DIR ?? join(import.meta.dirname, 'data'))
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, '')
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 4 * 1024 ** 3)

if (!TOKEN || TOKEN.length < 12) {
  console.error('Set SHARE_TOKEN to a random string of at least 12 characters.')
  process.exit(1)
}
mkdirSync(DATA, { recursive: true })

const DB_FILE = join(DATA, 'videos.json')
const db = existsSync(DB_FILE) ? JSON.parse(readFileSync(DB_FILE, 'utf8')) : {}
const lookup = (id) => (id && Object.hasOwn(db, id) ? db[id] : null)
const save = () => writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
const newId = () => randomBytes(9).toString('base64url')

function authorized(req) {
  const header = req.headers.authorization ?? ''
  const cookie = /(?:^|;\s*)share_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
  const given = header.startsWith('Bearer ') ? header.slice(7) : cookie ? decodeURIComponent(cookie) : ''
  const a = Buffer.from(given)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

const send = (res, status, body, headers = {}) => {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body)
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json' : 'text/html; charset=utf-8', ...headers })
  res.end(isObj ? JSON.stringify(body) : body)
}

const readJson = async (req) => {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 64 * 1024) throw new Error('body too large')
  }
  return raw ? JSON.parse(raw) : {}
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function linkFor(v) {
  return `${PUBLIC_URL}/v/${v.id}${v.visibility === 'private' ? `?k=${v.key}` : ''}`
}

function canView(v, url) {
  return v && v.ready && (v.visibility !== 'private' || url.searchParams.get('k') === v.key)
}

function watchPage(v, url) {
  const src = `/v/${v.id}/video.mp4${v.visibility === 'private' ? `?k=${encodeURIComponent(url.searchParams.get('k'))}` : ''}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(v.title)}</title>
<meta property="og:title" content="${esc(v.title)}"><meta property="og:type" content="video.other"><meta property="og:video" content="${PUBLIC_URL}${src}">
<style>
:root{color-scheme:dark;--bg:#16171b;--fg:#eceef2;--muted:#9b9ea9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 16px 48px}
video{width:100%;border-radius:14px;background:#000;box-shadow:0 30px 80px -30px #000}
h1{font-size:22px;margin:22px 0 4px}p{color:var(--muted);margin:0}
.row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:6px}
a.btn,button{appearance:none;border:0;border-radius:9px;padding:8px 14px;background:#2d3038;color:var(--fg);font:inherit;text-decoration:none;cursor:pointer}
a.btn:hover,button:hover{background:#3b3e47}
</style></head><body><main>
<video src="${src}" controls playsinline preload="metadata"></video>
<div class="row"><div><h1>${esc(v.title)}</h1><p>${new Date(v.createdAt).toLocaleDateString('en', { dateStyle: 'long' })} · ${v.views} view${v.views === 1 ? '' : 's'}</p></div>
<div class="row"><button onclick="navigator.clipboard.writeText(location.href);this.textContent='Link copied'">Copy link</button><a class="btn" href="${src}${src.includes('?') ? '&' : '?'}download=1">Download</a></div></div>
</main></body></html>`
}

function dashboard() {
  const rows = Object.values(db)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(
      (v) => `<tr><td><a href="${esc(linkFor(v))}">${esc(v.title)}</a></td><td>${v.visibility}</td><td>${v.views}</td><td>${(v.size / 1e6).toFixed(1)} MB</td>
<td>${new Date(v.createdAt).toLocaleString('en')}</td><td><button onclick="del('${v.id}')">Delete</button></td></tr>`,
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shareable links</title>
<style>:root{color-scheme:dark}body{margin:0;background:#16171b;color:#eceef2;font:14px -apple-system,sans-serif}main{max-width:1000px;margin:0 auto;padding:32px 16px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px 8px;border-bottom:1px solid #2e3037}a{color:#8aa4ff}button{background:#33363e;color:#eceef2;border:0;border-radius:7px;padding:6px 10px;cursor:pointer}
.wrap{overflow-x:auto}</style></head><body><main><h1>Shareable links</h1><div class="wrap"><table><tr><th>Title</th><th>Visibility</th><th>Views</th><th>Size</th><th>Created</th><th></th></tr>${rows || '<tr><td colspan=6>No videos yet.</td></tr>'}</table></div>
<script>async function del(id){if(!confirm('Delete this video? The link stops working.'))return;await fetch('/api/videos/'+id,{method:'DELETE'});location.reload()}</script></main></body></html>`
}

function loginPage(error) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16171b;color:#eceef2;font:14px -apple-system,sans-serif}
form{display:flex;flex-direction:column;gap:10px;width:min(320px,90vw)}input,button{padding:10px;border-radius:8px;border:0;font:inherit}input{background:#2d3038;color:#eceef2}button{background:#eceef2;color:#16171b;font-weight:600}</style></head>
<body><form method="post" action="/dashboard"><h1>Shareable links</h1>${error ? '<p>That token is not valid.</p>' : ''}<input type="password" name="token" placeholder="Upload token" autofocus><button>Open dashboard</button></form></body></html>`
}

function streamFile(req, res, file, download, filename) {
  const size = statSync(file).size
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' }
  if (download) headers['Content-Disposition'] = `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}.mp4"`
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size) return send(res, 416, '', { 'Content-Range': `bytes */${size}` })
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  createReadStream(file).pipe(res)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, PUBLIC_URL)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[0] === 'api' && parts[1] === 'videos') {
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' })
      const id = parts[2]
      if (req.method === 'POST' && !id) {
        const body = await readJson(req)
        if (!(body.size > 0) || body.size > MAX_BYTES) return send(res, 413, { error: 'file too large' })
        const v = {
          id: newId(),
          key: randomBytes(12).toString('base64url'),
          title: String(body.title ?? 'Untitled').slice(0, 200),
          size: Number(body.size),
          visibility: body.visibility === 'private' ? 'private' : 'public',
          createdAt: new Date().toISOString(),
          views: 0,
          ready: false,
        }
        db[v.id] = v
        save()
        return send(res, 200, { id: v.id, uploadUrl: `${PUBLIC_URL}/api/videos/${v.id}/upload`, url: linkFor(v), visibility: v.visibility })
      }
      const v = lookup(id)
      if (!v) return send(res, 404, { error: 'not found' })
      if (req.method === 'PUT' && parts[3] === 'upload') {
        const declared = Number(req.headers['content-length'] ?? 0)
        if (declared > MAX_BYTES) return send(res, 413, { error: 'file too large' })
        await pipeline(req, createWriteStream(join(DATA, `${v.id}.mp4`)))
        v.size = statSync(join(DATA, `${v.id}.mp4`)).size
        save()
        return send(res, 200, { ok: true })
      }
      if (req.method === 'POST' && parts[3] === 'complete') {
        v.ready = existsSync(join(DATA, `${v.id}.mp4`))
        save()
        return send(res, 200, { url: linkFor(v), ready: v.ready })
      }
      if (req.method === 'DELETE') {
        rmSync(join(DATA, `${v.id}.mp4`), { force: true })
        delete db[id]
        save()
        return send(res, 200, { ok: true })
      }
      return send(res, 405, { error: 'method not allowed' })
    }

    if (parts[0] === 'v' && parts[1]) {
      const v = lookup(parts[1])
      if (!canView(v, url)) return send(res, 404, '<h1>Video not found</h1>')
      if (parts[2] === 'video.mp4') return streamFile(req, res, join(DATA, `${v.id}.mp4`), url.searchParams.has('download'), v.title)
      v.views += 1
      save()
      return send(res, 200, watchPage(v, url))
    }

    if (parts[0] === 'dashboard') {
      if (req.method === 'POST') {
        const form = new URLSearchParams(await new Response(req).text())
        const token = form.get('token') ?? ''
        const ok = token.length === TOKEN.length && timingSafeEqual(Buffer.from(token), Buffer.from(TOKEN))
        if (!ok) return send(res, 401, loginPage(true))
        return send(res, 303, '', {
          Location: '/dashboard',
          'Set-Cookie': `share_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/${PUBLIC_URL.startsWith('https') ? '; Secure' : ''}`,
        })
      }
      return authorized(req) ? send(res, 200, dashboard()) : send(res, 200, loginPage(false))
    }

    if (url.pathname === '/') return send(res, 200, '<p>Studio Clone share server is running.</p>')
    send(res, 404, '<h1>Not found</h1>')
  } catch (err) {
    console.error(err)
    if (!res.headersSent) send(res, 500, { error: 'server error' })
  }
}).listen(PORT, () => console.log(`share server on ${PUBLIC_URL} (data in ${DATA})`))
