// E2E: an exported multiplayer web build played in two Chrome pages against its own
// server/linden-server.mjs (SPEC-Multiplayer-WebSocket M5). Opt-in, needs Google Chrome:
//   npm run test:e2e:multiplayer-web
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'
import { WebBuildRunner } from '../../electron/build/WebBuildRunner'
import { findServerBundle } from '../../electron/build/multiplayerServer'

const enabled = process.env.LINDEN_E2E === '1'

const HUD_SCRIPT = `export default class Hud {
  ctx: any
  onInit(ctx: any) {
    this.ctx = ctx
    ctx.ui.bind('#out', () => JSON.stringify(this.read()))
  }
  read() {
    const net = this.ctx.net
    const ships = this.ctx.world.getEntities().filter((e: any) => e.name.startsWith('Ship (')).map((e: any) => {
      const p = e.getTransform().position
      return { id: e.id, mine: net.owner(e) === net.playerId, x: +p.x.toFixed(3), z: +p.z.toFixed(3) }
    })
    return { me: net.players.find((p: any) => p.isLocal)?.name ?? null, connected: net.connected, players: net.players.length, ships }
  }
}
`

const entity = (id: string, name: string, parentId: string | null, components: any[]) => ({ id, name, active: true, static: false, tags: [], layer: 0, parentId, components })
const tf = (position: number[], rotation = [0, 0, 0], scale = [1, 1, 1]) => ({ type: 'Transform', data: { position, rotation, scale } })

const scene = {
  format: 'linden-scene',
  version: 2,
  name: 'Main',
  entities: [
    entity('cam', 'Main Camera', null, [tf([0, 8, 12], [-30, 0, 0]), { type: 'Camera', data: { fov: 60, near: 0.1, far: 1000, isActive: true } }]),
    entity('ground', 'Ground', null, [tf([0, -0.5, 0], [0, 0, 0], [100, 1, 100]), { type: 'MeshRenderer', data: { primitive: 'box', color: '#22c55e' } }, { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } }]),
    entity('ship', 'Ship', null, [
      tf([0, 1.05, 0]),
      { type: 'MeshRenderer', data: { primitive: 'capsule', color: '#38bdf8' } },
      { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } },
      { type: 'CharacterController', data: {} },
      { type: 'CharacterMovement', data: { walkSpeed: 4 } },
      { type: 'NetworkSync', data: { template: 'player' } },
    ]),
    entity('hud', 'Hud', null, [tf([0, 0, 0]), { type: 'Script', data: { src: 'scripts/Hud.ts', props: {} } }, { type: 'HtmlUI', data: { src: 'ui/hud.html', mode: 'screen', zIndex: 0, pointerEvents: false, pixelSize: 0.01 } }]),
  ],
}

async function hud(page: Page): Promise<any> {
  const text = await page.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#out')?.textContent ?? '')
  return text ? JSON.parse(text) : null
}

async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 30000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!pred(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 250))
    v = await fn()
  }
  return v
}

describe.skipIf(!enabled)('exported multiplayer web build in two browsers', () => {
  let dir = ''
  let server: ChildProcess | null = null
  let browser: Browser | null = null
  afterAll(async () => {
    await browser?.close()
    server?.kill()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('two players see each other move', async () => {
    if (!findServerBundle()) {
      const { buildServer } = await import('../../scripts/build-server.mjs')
      await buildServer('dist-electron/linden-server.mjs')
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-mp-web-'))
    const files: Record<string, string> = {
      'project.linden.json': JSON.stringify({ name: 'NetWeb', version: '1', scenesInBuild: ['scenes/Main.lscene'], multiplayer: { enabled: true, tickRate: 20 } }),
      'scenes/Main.lscene': JSON.stringify(scene),
      'scripts/Hud.ts': HUD_SCRIPT,
      'ui/hud.html': '<div style="position:absolute;bottom:4px;left:4px;font:10px monospace;color:#fff"><span id="out"></span></div>',
    }
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      fs.writeFileSync(path.join(dir, rel), content)
    }
    const res = await WebBuildRunner.runBuild({
      projectPath: dir,
      preset: { id: 'web', name: 'Web', platform: 'web', backend: 'linden', arch: ['wasm'], output: 'build/web', mode: 'release', zipOutput: false },
    })
    expect(res.error).toBeUndefined()
    const out = path.join(dir, 'build/web')

    server = spawn(process.execPath, [path.join(out, 'server/linden-server.mjs'), '--port', '0', '--host', '127.0.0.1'])
    const port = await new Promise<number>((resolve, reject) => {
      let log = ''
      const timer = setTimeout(() => reject(new Error(log)), 10000)
      server!.stdout!.on('data', (d) => {
        log += d
        const m = log.match(/:(\d+) \(WebSocket/)
        if (m) {
          clearTimeout(timer)
          resolve(Number(m[1]))
        }
      })
    })

    browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
    const pageA = await (await browser.newContext({ viewport: { width: 640, height: 400 } })).newPage()
    const pageB = await (await browser.newContext({ viewport: { width: 640, height: 400 } })).newPage()
    await pageA.goto(`http://127.0.0.1:${port}/?name=Asep`)
    await pageB.goto(`http://127.0.0.1:${port}/?name=Budi`)

    const a = await waitFor(() => hud(pageA), (h) => h?.players === 2 && h.ships.length === 2)
    const b = await waitFor(() => hud(pageB), (h) => h?.players === 2 && h.ships.length === 2)
    expect(a.me).toBe('Asep')
    expect(b.me).toBe('Budi')
    expect(a.connected && b.connected).toBe(true)

    await pageA.locator('canvas').first().click({ position: { x: 200, y: 200 } })
    const start = a.ships.find((s: any) => s.mine)
    await pageA.keyboard.down('KeyW')
    await pageA.waitForTimeout(1200)
    await pageA.keyboard.up('KeyW')
    await pageA.waitForTimeout(700)
    const a2 = await hud(pageA)
    const b2 = await hud(pageB)
    const mine = a2.ships.find((s: any) => s.mine)
    const seen = b2.ships.find((s: any) => s.id === mine.id)
    expect(Math.hypot(mine.x - start.x, mine.z - start.z)).toBeGreaterThan(1)
    expect(Math.hypot(mine.x - seen.x, mine.z - seen.z)).toBeLessThan(0.1)
    fs.mkdirSync(path.join(process.cwd(), 'test-results'), { recursive: true })
    await pageA.screenshot({ path: path.join(process.cwd(), 'test-results', 'multiplayer-web-a.png') })
    await pageB.screenshot({ path: path.join(process.cwd(), 'test-results', 'multiplayer-web-b.png') })
  }, 180_000)
})
