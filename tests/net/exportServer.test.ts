import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import WebSocket from 'ws'
import { parseArgs, resolveStatic, startLindenServer } from '../../server/linden-server'
import { writeMultiplayerServer, findServerBundle } from '../../electron/build/multiplayerServer'
import { normalizeMultiplayer } from '../../shared/net/config'
import { NET_PROTOCOL_VERSION } from '../../shared/net/protocol'
import { WebBuildRunner } from '../../electron/build/WebBuildRunner'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'linden-export-server-'))

/** Join a room and return the welcome */
function join(url: string, name: string): Promise<{ ws: WebSocket; welcome: any }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: NET_PROTOCOL_VERSION, name })))
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.t === 'welcome') resolve({ ws, welcome: msg })
    })
    ws.on('error', reject)
  })
}

const dirs: string[] = []
const procs: ChildProcess[] = []
afterEach(() => {
  for (const p of procs.splice(0)) p.kill()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('linden-server (exported multiplayer server)', () => {
  it('parses options from flags and env', () => {
    expect(parseArgs([], {}, '/srv/game/server')).toEqual({ port: 8080, host: '0.0.0.0', staticDir: '/srv/game', maxPlayers: 16, origins: [] })
    expect(parseArgs(['--port', '9000', '--max-players', '4', '--origins', 'https://a.com, https://b.com', '--no-static'], {}, '/x').staticDir).toBeNull()
    expect(parseArgs([], { PORT: '7000', LINDEN_ORIGINS: 'https://c.com' }, '/x')).toMatchObject({ port: 7000, origins: ['https://c.com'] })
  })

  it('serves only game files inside the build', () => {
    const root = fs.realpathSync(tmp())
    dirs.push(root)
    fs.mkdirSync(path.join(root, 'server'))
    fs.mkdirSync(path.join(root, 'scenes'))
    fs.writeFileSync(path.join(root, 'index.html'), 'x')
    fs.writeFileSync(path.join(root, 'scenes/Main.lscene'), '{}')
    fs.writeFileSync(path.join(root, 'server/linden-server.mjs'), 'secret')
    expect(resolveStatic(root, '/')).toBe(path.join(root, 'index.html'))
    expect(resolveStatic(root, '/scenes/Main.lscene?v=1')).toBe(path.join(root, 'scenes/Main.lscene'))
    expect(resolveStatic(root, '/server/linden-server.mjs')).toBeNull()
    expect(resolveStatic(root, '/../../etc/passwd')).toBeNull()
    expect(resolveStatic(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
    expect(resolveStatic(root, '/missing.js')).toBeNull()
  })

  it('serves the game and the room server on one port', async () => {
    const root = tmp()
    dirs.push(root)
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>game</h1>')
    const srv = await startLindenServer({ port: 0, host: '127.0.0.1', staticDir: root, maxPlayers: 4, origins: [] }, () => {})
    try {
      const page = await fetch(`http://127.0.0.1:${srv.port}/`)
      expect(await page.text()).toBe('<h1>game</h1>')
      expect(page.headers.get('cross-origin-embedder-policy')).toBe('require-corp')
      const a = await join(`ws://127.0.0.1:${srv.port}/net`, 'A')
      const b = await join(`ws://127.0.0.1:${srv.port}/net`, 'B')
      expect(b.welcome.players.map((p: any) => p.name)).toEqual(['A', 'B'])
      a.ws.close()
      b.ws.close()
    } finally {
      await srv.close()
    }
  })
})

describe('web build of a multiplayer project', () => {
  it('ships server/ and the bundled server runs on plain Node', async () => {
    // CI tests before building: bundle the server here when dist-electron has none yet
    if (!findServerBundle()) {
      const { buildServer } = await import('../../scripts/build-server.mjs')
      await buildServer('dist-electron/linden-server.mjs')
    }
    expect(findServerBundle()).toBeTruthy()
    const project = tmp()
    dirs.push(project)
    const files: Record<string, string> = {
      'project.linden.json': JSON.stringify({ name: 'Net Game', version: '1', scenesInBuild: ['scenes/Main.lscene'], multiplayer: { enabled: true, maxPlayers: 8 } }),
      'scenes/Main.lscene': JSON.stringify({ format: 'linden-scene', version: 2, name: 'Main', entities: [] }),
    }
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true })
      fs.writeFileSync(path.join(project, rel), content)
    }
    const res = await WebBuildRunner.runBuild({
      projectPath: project,
      preset: { id: 'web', name: 'Web', platform: 'web', backend: 'linden', arch: ['wasm'], output: 'build/web', mode: 'release', zipOutput: false },
    })
    expect(res.error).toBeUndefined()
    const out = path.join(project, 'build/web')
    for (const f of ['linden-server.mjs', 'README.md', 'Dockerfile', 'package.json']) expect(fs.existsSync(path.join(out, 'server', f))).toBe(true)
    expect(fs.readFileSync(path.join(out, 'server/Dockerfile'), 'utf-8')).toContain('LINDEN_MAX_PLAYERS=8')
    expect(JSON.parse(fs.readFileSync(path.join(out, 'project.json'), 'utf-8')).multiplayer.enabled).toBe(true)

    // A separate Node process with nothing installed next to it
    const child = spawn(process.execPath, [path.join(out, 'server/linden-server.mjs'), '--port', '0', '--host', '127.0.0.1'], { cwd: os.tmpdir() })
    procs.push(child)
    const port = await new Promise<number>((resolve, reject) => {
      let log = ''
      const timer = setTimeout(() => reject(new Error(`server tidak start: ${log}`)), 10000)
      child.stdout.on('data', (d) => {
        log += d
        const m = log.match(/:(\d+) \(WebSocket/)
        if (m) {
          clearTimeout(timer)
          resolve(Number(m[1]))
        }
      })
      child.stderr.on('data', (d) => (log += d))
    })
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
    expect(html).toContain('<canvas')
    expect((await fetch(`http://127.0.0.1:${port}/server/linden-server.mjs`)).status).toBe(404)
    const a = await join(`ws://127.0.0.1:${port}/net`, 'A')
    expect(a.welcome.players).toHaveLength(1)
    a.ws.close()
  }, 120_000)

  it('is skipped (with a warning) when multiplayer is off or the bundle is missing', () => {
    const out = tmp()
    dirs.push(out)
    const res = writeMultiplayerServer(out, normalizeMultiplayer({ enabled: true }), 'X', null)
    expect(res).toEqual({ ok: false, reason: expect.stringMatching(/build:electron/) })
    expect(fs.existsSync(path.join(out, 'server'))).toBe(false)
  })
})
