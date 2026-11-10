// E2E: multiplayer over WebSocket in the real editor (SPEC-Multiplayer-WebSocket M4).
// Play starts a local room server; the Game View runs two clients side by side; moving the avatar
// in client 1 must show up in client 2. Needs the Vite dev server (`npm run dev`):
//   npm run test:e2e:multiplayer
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-mp-e2e-'))
console.log(`work folder: ${work}`)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- fixture ----------
const project = path.join(work, 'NetGame')
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true })
  fs.writeFileSync(path.join(project, rel), content)
}
write(
  'project.linden.json',
  JSON.stringify({ name: 'NetGame', version: '0.1.0', scenesInBuild: ['scenes/Main.lscene'], multiplayer: { enabled: true, tickRate: 20 } }, null, 2)
)
// HUD on a non-networked entity: every client reports what it sees
write(
  'scripts/Hud.ts',
  `export default class Hud {
  ctx: any
  onInit(ctx: any) {
    this.ctx = ctx
    ctx.ui.bind('#out', () => JSON.stringify(this.read()))
  }
  read() {
    const net = this.ctx.net
    const ships = this.ctx.world
      .getEntities()
      .filter((e: any) => e.name.startsWith('Ship ('))
      .map((e: any) => {
        const p = e.getTransform().position
        return { id: e.id, mine: net.owner(e) === net.playerId, x: +p.x.toFixed(3), z: +p.z.toFixed(3) }
      })
    return { me: net.players.find((p: any) => p.isLocal)?.name ?? null, connected: net.connected, players: net.players.length, host: net.isHost, ships }
  }
}
`
)
write('ui/hud.html', '<div style="position:absolute;bottom:4px;left:4px;font:10px monospace;color:#fff"><span id="out"></span></div>')
const scene = {
  format: 'linden-scene',
  version: 2,
  name: 'Main',
  entities: [
    { id: 'cam', name: 'Main Camera', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 8, 12], rotation: [-30, 0, 0], scale: [1, 1, 1] } },
      { type: 'Camera', data: { fov: 60, near: 0.1, far: 1000, isActive: true } },
    ] },
    { id: 'ground', name: 'Ground', active: true, static: true, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [100, 1, 100] } },
      { type: 'MeshRenderer', data: { primitive: 'box', color: '#22c55e' } },
      { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } },
    ] },
    { id: 'ship', name: 'Ship', active: true, static: false, tags: ['Player'], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 1.05, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { type: 'MeshRenderer', data: { primitive: 'capsule', color: '#38bdf8' } },
      { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } },
      { type: 'CharacterController', data: {} },
      { type: 'CharacterMovement', data: { walkSpeed: 4, sprintSpeed: 7, jumpHeight: 1.2 } },
      { type: 'NetworkSync', data: { template: 'player' } },
    ] },
    { id: 'shipcam', name: 'Ship Camera', active: true, static: false, tags: [], layer: 0, parentId: 'ship', components: [
      { type: 'Transform', data: { position: [0, 3, 6], rotation: [-20, 0, 0], scale: [1, 1, 1] } },
      { type: 'Camera', data: { fov: 60, near: 0.1, far: 1000, isActive: true } },
    ] },
    { id: 'hud', name: 'Hud', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { type: 'Script', data: { src: 'scripts/Hud.ts', props: {} } },
      { type: 'HtmlUI', data: { src: 'ui/hud.html', mode: 'screen', zIndex: 0, pointerEvents: false, pixelSize: 0.01 } },
    ] },
  ],
}
write('scenes/Main.lscene', JSON.stringify(scene, null, 2))

// ---------- app ----------
const app = await electron.launch({ args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`], cwd: repo })
let page = null
for (let i = 0; i < 100 && !page; i++) {
  page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? null
  if (!page) await new Promise((r) => setTimeout(r, 200))
}
if (!page) throw new Error('editor window not found')
page.on('console', (m) => m.type() === 'error' && !/Autofill/.test(m.text()) && console.log('  [renderer error]', m.text().slice(0, 200)))
await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 30000 })

const bindStore = () =>
  page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/editor/store/editorStore.ts'))
    window.__store = (await import(url)).useEditorStore
  })
const store = (fn, arg) => page.evaluate(`(${fn.toString()})(window.__store, ${JSON.stringify(arg ?? null)})`)

/** HUD state of every game frame that is ready, keyed by the client's player name */
async function huds() {
  const out = {}
  for (const f of page.frames().filter((fr) => fr.url().startsWith('linden-game://'))) {
    try {
      const text = await f.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#out')?.textContent ?? '')
      if (!text) continue
      const hud = JSON.parse(text)
      if (hud.me) out[hud.me] = { ...hud, frame: f }
    } catch {
      /* frame reloading */
    }
  }
  return out
}
async function waitHuds(pred, ms = 20000) {
  const end = Date.now() + ms
  let last = {}
  while (Date.now() < end) {
    last = await huds()
    if (pred(last)) return last
    await page.waitForTimeout(250)
  }
  return last
}

let exitCode = 0
try {
  await page.evaluate((p) => window.electronAPI.addRecentProject({ name: 'NetGame', path: p, lastOpened: Date.now() }), project)
  await page.reload()
  await page.waitForFunction(() => !!window.electronAPI)
  await page.waitForTimeout(1500)
  await bindStore()
  await page.getByText('NetGame', { exact: true }).first().click()
  await page.waitForFunction((p) => window.__store.getState().projectPath === p, project, { timeout: 15000 })
  await page.waitForTimeout(800)

  await store(async (s) => s.getState().startPlay())
  const session = await store((s) => s.getState().playSession)
  check('Play starts a local room server for the session', /^ws:\/\/127\.0\.0\.1:\d+\/net$/.test(session?.multiplayer?.serverUrl ?? ''), session?.multiplayer?.serverUrl)

  await page.locator('[data-testid=net-clients]').selectOption('2')
  const both = await waitHuds((h) => h['Klien 1']?.players === 2 && h['Klien 2']?.players === 2 && h['Klien 1'].ships.length === 2 && h['Klien 2'].ships.length === 2)
  const c1 = both['Klien 1']
  const c2 = both['Klien 2']
  check('Two Game View clients join the same room', !!c1 && !!c2 && c1.connected && c2.connected, JSON.stringify({ c1: c1?.players, c2: c2?.players }))
  check('Exactly one host', !!c1 && !!c2 && c1.host !== c2.host)
  check('Each client sees its own avatar and the other one', !!c1 && c1.ships.filter((s) => s.mine).length === 1 && c1.ships.filter((s) => !s.mine).length === 1)

  // Drive client 1 with the keyboard
  const frame1 = page.locator('[data-testid=game-frame-0] iframe')
  await frame1.click({ position: { x: 40, y: 120 } })
  await page.waitForTimeout(300)
  const start1 = (await huds())['Klien 1'].ships.find((s) => s.mine)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1200)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(600)
  const after = await huds()
  const mine1 = after['Klien 1'].ships.find((s) => s.mine)
  const seenBy2 = after['Klien 2'].ships.find((s) => s.id === mine1.id)
  const moved = Math.hypot(mine1.x - start1.x, mine1.z - start1.z)
  const error = Math.hypot(mine1.x - seenBy2.x, mine1.z - seenBy2.z)
  check('Client 1 moves its avatar with the keyboard', moved > 1, `moved ${moved.toFixed(2)} m`)
  check('Client 2 sees client 1 at the same place', error < 0.1, `error ${error.toFixed(3)} m`)
  const own2 = after['Klien 2'].ships.find((s) => s.mine)
  const own2Start = c2.ships.find((s) => s.mine)
  check("Client 2's own avatar did not move", Math.hypot(own2.x - own2Start.x, own2.z - own2Start.z) < 0.05)
  await page.screenshot({ path: path.join(work, 'multiplayer.png') })

  // Back to one client: client 2 leaves the room
  await page.locator('[data-testid=net-clients]').selectOption('1')
  const solo = await waitHuds((h) => h['Klien 1']?.players === 1 && h['Klien 1'].ships.length === 1, 10000)
  check('A client that leaves takes its avatar with it', solo['Klien 1']?.ships.length === 1)

  await store(async (s) => s.getState().stopPlay())
} catch (err) {
  console.error(err)
  exitCode = 1
} finally {
  await app.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length || exitCode) process.exit(1)
fs.rmSync(work, { recursive: true, force: true })
