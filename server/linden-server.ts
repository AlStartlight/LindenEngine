/**
 * Linden multiplayer server for an exported web build (bundled to server/linden-server.mjs):
 * serves the game files and the room server (WebSocket at /net) from one Node process.
 *
 *   node server/linden-server.mjs [--port 8080] [--host 0.0.0.0] [--static ..] [--max-players 16]
 *                                 [--origins https://a.com,https://b.com] [--no-static]
 *
 * Environment variables PORT, HOST, LINDEN_MAX_PLAYERS and LINDEN_ORIGINS work too.
 * Put it behind a TLS reverse proxy (Caddy, nginx) for https/wss in production.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RoomServer } from './net/RoomServer'
import { MIME_TYPES } from '../shared/mime'

export interface ServerArgs {
  port: number
  host: string
  staticDir: string | null
  maxPlayers: number
  origins: string[]
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv, here: string): ServerArgs {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const staticArg = get('static')
  return {
    port: Number(get('port') ?? env.PORT ?? 8080),
    host: get('host') ?? env.HOST ?? '0.0.0.0',
    // The build lays out <build>/index.html and <build>/server/linden-server.mjs
    staticDir: argv.includes('--no-static') ? null : path.resolve(here, staticArg ?? '..'),
    maxPlayers: Number(get('max-players') ?? env.LINDEN_MAX_PLAYERS ?? 16),
    origins: list(get('origins') ?? env.LINDEN_ORIGINS),
  }
}

/** File inside `root` for a URL path, or null (traversal, missing, directory without index) */
export function resolveStatic(root: string, urlPath: string): string | null {
  let rel: string
  try {
    rel = decodeURIComponent(urlPath.split('?')[0])
  } catch {
    return null
  }
  if (rel.includes('\0')) return null
  const full = path.resolve(root, `.${rel.startsWith('/') ? rel : `/${rel}`}`)
  if (full !== root && !full.startsWith(root + path.sep)) return null
  // The server's own folder is not part of the game
  if (full.startsWith(path.join(root, 'server') + path.sep)) return null
  let file = full
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    return fs.statSync(file).isFile() ? file : null
  } catch {
    return null
  }
}

export function createStaticHandler(root: string | null): http.RequestListener {
  return (req, res) => {
    if (!root) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Linden multiplayer server: WebSocket di /net')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }
    const file = resolveStatic(root, req.url ?? '/')
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 Not Found')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'X-Content-Type-Options': 'nosniff',
    })
    if (req.method === 'HEAD') return void res.end()
    fs.createReadStream(file).pipe(res)
  }
}

export async function startLindenServer(args: ServerArgs, log: (msg: string) => void = console.log) {
  const httpServer = http.createServer(createStaticHandler(args.staticDir && fs.existsSync(args.staticDir) ? fs.realpathSync(args.staticDir) : null))
  const rooms = new RoomServer({ server: httpServer, maxPlayers: args.maxPlayers, allowedOrigins: args.origins, log })
  await rooms.start()
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(args.port, args.host, () => resolve())
  })
  const addr = httpServer.address()
  const port = typeof addr === 'object' && addr ? addr.port : args.port
  log(`Linden server di http://${args.host === '0.0.0.0' ? 'localhost' : args.host}:${port} (WebSocket /net, maks ${args.maxPlayers} pemain/room)`)
  if (args.staticDir) log(`Menyajikan game dari ${args.staticDir}`)
  return {
    port,
    rooms,
    close: async () => {
      await rooms.close()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

// Entry point when run directly (node linden-server.mjs)
const self = typeof process !== 'undefined' && process.argv[1] ? path.resolve(process.argv[1]) : ''
const thisFile = (() => {
  try {
    return fileURLToPath(import.meta.url)
  } catch {
    return ''
  }
})()
const real = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}
// argv[1] may go through a symlink (/var -> /private/var on macOS); import.meta.url does not
if (thisFile && self && real(self) === real(thisFile)) {
  const args = parseArgs(process.argv.slice(2), process.env, path.dirname(thisFile))
  startLindenServer(args).then(
    (srv) => {
      const stop = () => srv.close().then(() => process.exit(0))
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
    },
    (err) => {
      console.error(`Gagal menjalankan server: ${err.message}`)
      process.exit(1)
    }
  )
}
