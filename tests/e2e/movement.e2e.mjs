// E2E: character movement controls (SPEC-Character-Movement-Input-Controls TC-MOVE-01..04)
// in the real Electron app: keyboard W/E/Space, touch joystick in the Game View, Input Actions
// persistence, and touch controls in the exported web build.
//
// Needs the Vite dev server (`npm run dev`) and a built main process (`npm run build:electron`):
//   npm run test:e2e:move
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-move-e2e-'))
console.log(`work folder: ${work}`)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- fixture ----------
const project = path.join(work, 'MoveGame')
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true })
  fs.writeFileSync(path.join(project, rel), content)
}
// No input section: the project gets the default control map
write('project.linden.json', JSON.stringify({ name: 'MoveGame', version: '0.1.0', scenesInBuild: ['scenes/Main.lscene'] }, null, 2))
write(
  'scripts/Probe.ts',
  `export default class Probe {
  ctx: any
  onInit(ctx: any) {
    this.ctx = ctx
    const t = () => ctx.entity.getTransform()
    ctx.ui.bind('#x', () => t().position.x.toFixed(2))
    ctx.ui.bind('#y', () => t().position.y.toFixed(2))
    ctx.ui.bind('#z', () => t().position.z.toFixed(2))
    ctx.ui.bind('#yaw', () => t().rotation.y.toFixed(1))
    ctx.ui.bind('#grounded', () => (ctx.movement?.isGrounded ? '1' : '0'))
    ctx.ui.bind('#dash', () => (ctx.input.isActionPressed('Dash') ? '1' : '0'))
  }
}
`
)
write('ui/probe.html', '<div id="p" style="position:absolute;top:4px;left:4px;font:12px monospace">x=<span id="x"></span> y=<span id="y"></span> z=<span id="z"></span> yaw=<span id="yaw"></span> g=<span id="grounded"></span> dash=<span id="dash"></span></div>')
const scene = {
  format: 'linden-scene',
  version: 2,
  name: 'Main',
  entities: [
    { id: 'cam', name: 'Main Camera', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 6, 10], rotation: [-25, 0, 0], scale: [1, 1, 1] } },
      { type: 'Camera', data: { fov: 60, near: 0.1, far: 1000, isActive: true } },
    ] },
    { id: 'ground', name: 'Ground', active: true, static: true, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [100, 1, 100] } },
      { type: 'MeshRenderer', data: { primitive: 'box', color: '#22c55e' } },
      { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } },
    ] },
    { id: 'player', name: 'Player', active: true, static: false, tags: ['Player'], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 1.05, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { type: 'MeshRenderer', data: { primitive: 'capsule', color: '#38bdf8' } },
      { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } },
      { type: 'CharacterController', data: {} },
      { type: 'CharacterMovement', data: { walkSpeed: 4, sprintSpeed: 7, jumpHeight: 1.2 } },
      { type: 'Script', data: { src: 'scripts/Probe.ts', props: {} } },
      { type: 'HtmlUI', data: { src: 'ui/probe.html', mode: 'screen', zIndex: 0, pointerEvents: false, pixelSize: 0.01 } },
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

const bindStore = () => page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/editor/store/editorStore.ts'))
  window.__store = (await import(url)).useEditorStore
})
const store = (fn, arg) => page.evaluate(`(${fn.toString()})(window.__store, ${JSON.stringify(arg ?? null)})`)

const openProject = async (projectPath) => {
  await page.evaluate((p) => window.electronAPI.addRecentProject({ name: p.split('/').pop(), path: p, lastOpened: Date.now() }), projectPath)
  await page.reload()
  await page.waitForFunction(() => !!window.electronAPI)
  await page.waitForTimeout(1500)
  await bindStore()
  await page.getByText(projectPath.split('/').pop(), { exact: true }).first().click()
  await page.waitForFunction((p) => window.__store.getState().projectPath === p, projectPath, { timeout: 15000 })
  await page.waitForTimeout(800)
}

const gameFrame = async () => {
  for (let i = 0; i < 100; i++) {
    const f = page.frames().find((fr) => fr.url().startsWith('linden-game://'))
    if (f) {
      try {
        await f.waitForFunction(() => !!document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#x')?.textContent, null, { timeout: 20000 })
        return f
      } catch {
        /* frame was replaced (reload); look again */
      }
    }
    await page.waitForTimeout(200)
  }
  throw new Error('game frame not ready')
}
const probe = (f) =>
  f.evaluate(() => {
    const root = document.querySelector('#linden-ui-root > div')?.shadowRoot
    const v = (id) => Number(root?.querySelector(`#${id}`)?.textContent)
    return { x: v('x'), y: v('y'), z: v('z'), yaw: v('yaw'), grounded: v('grounded'), dash: v('dash') }
  })

try {
  await openProject(project)
  const defaults = await store((s) => s.getState().projectSettings.inputActions.map((a) => a.name))
  check('Project without input section gets the default control map', JSON.stringify(defaults) === JSON.stringify(['Move', 'Turn', 'Vertical', 'Look', 'Jump', 'Sprint', 'Crouch', 'Interact', 'Attack']), defaults.join(','))

  // ---------- TC-MOVE-01: keyboard ----------
  await store(async (s) => s.getState().startPlay())
  let frame = await gameFrame()
  await page.waitForTimeout(800)
  const iframe = page.locator('iframe[title="Game"]')
  await iframe.click({ position: { x: 20, y: 200 } })
  await page.keyboard.press('Escape') // leave pointer lock from the click
  await iframe.focus()
  const p0 = await probe(frame)
  check('Character starts grounded', p0.grounded === 1, JSON.stringify(p0))

  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1000)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(300)
  const p1 = await probe(frame)
  const walked = p0.z - p1.z
  check('W walks forward (away from camera) at about walkSpeed', walked > 3 && walked < 5, `dz=${walked.toFixed(2)}`)

  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1000)
  await page.keyboard.up('KeyW')
  await page.keyboard.up('ShiftLeft')
  await page.waitForTimeout(300)
  const p2 = await probe(frame)
  check('Shift+W sprints faster', p1.z - p2.z > walked * 1.4, `dz=${(p1.z - p2.z).toFixed(2)}`)

  await page.keyboard.down('ArrowLeft')
  await page.waitForTimeout(500)
  await page.keyboard.up('ArrowLeft')
  await page.waitForTimeout(300)
  const p3 = await probe(frame)
  check('Arrow keys move too (Left = -X)', p3.x < p2.x - 1, `dx=${(p3.x - p2.x).toFixed(2)}`)

  const yaw0 = (await probe(frame)).yaw
  await page.keyboard.down('KeyE')
  await page.waitForTimeout(500)
  await page.keyboard.up('KeyE')
  const yaw1 = (await probe(frame)).yaw
  const turned = ((yaw0 - yaw1 + 540) % 360) - 180
  check('E turns right (~90° in 0.5 s)', turned > 60 && turned < 110, `${yaw0} -> ${yaw1}`)

  const yStart = (await probe(frame)).y
  await page.keyboard.press('Space')
  let maxY = yStart
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(60)
    maxY = Math.max(maxY, (await probe(frame)).y)
  }
  await page.waitForTimeout(600)
  const landed = await probe(frame)
  check('Space jumps about jumpHeight and lands', maxY - yStart > 0.8 && landed.grounded === 1, `rise=${(maxY - yStart).toFixed(2)} grounded=${landed.grounded}`)
  await page.screenshot({ path: path.join(work, '1-keyboard.png') })

  // ---------- TC-MOVE-02: touch controls in the Game View (driven with the mouse) ----------
  await page.locator('select[title^="Kontrol sentuh"]').selectOption('always')
  await page.waitForTimeout(500)
  frame = await gameFrame()
  await page.waitForTimeout(600)
  const touchInfo = await frame.evaluate(() => ({
    root: !!document.getElementById('linden-touch-root'),
    buttons: [...document.querySelectorAll('[data-linden-touch^="button:"]')].map((b) => b.getAttribute('data-linden-touch').slice(7)),
  }))
  check('Touch controls appear with project buttons', touchInfo.root && touchInfo.buttons.includes('Jump') && touchInfo.buttons.includes('TurnRight'), touchInfo.buttons.join(','))

  const box = await iframe.boundingBox()
  // Joystick rest position (same formula as engine/input/touchLayoutMath: margin 40 + radius 64, scaled)
  const touchScaleNow = Math.min(1.5, Math.max(0.8, Math.min(box.width, box.height) / 390))
  const start = { x: box.x + 104 * touchScaleNow, y: box.y + box.height - 104 * touchScaleNow }
  const t0 = await probe(frame)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x, start.y - 32 * touchScaleNow, { steps: 4 }) // half of the (scaled) radius
  await page.waitForTimeout(1000)
  await page.mouse.up()
  await page.waitForTimeout(300)
  const t1 = await probe(frame)
  const halfDist = t0.z - t1.z
  check('Half-tilted joystick walks at about half speed (analog)', halfDist > 0.8 && halfDist < 2.6, `dz=${halfDist.toFixed(2)} (full ≈ ${walked.toFixed(2)})`)

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x, start.y - 100, { steps: 4 }) // past the radius: full + Sprint
  await page.waitForTimeout(1000)
  await page.mouse.up()
  await page.waitForTimeout(300)
  const t2 = await probe(frame)
  check('Fully pushed joystick runs (Sprint)', t1.z - t2.z > walked * 1.4, `dz=${(t1.z - t2.z).toFixed(2)}`)

  const jumpBtn = await frame.locator('[data-linden-touch="button:Jump"]').boundingBox()
  const jy0 = (await probe(frame)).y
  // Frame locators report page coordinates already
  await page.mouse.move(jumpBtn.x + jumpBtn.width / 2, jumpBtn.y + jumpBtn.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(80)
  await page.mouse.up()
  let jmax = jy0
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(60)
    jmax = Math.max(jmax, (await probe(frame)).y)
  }
  check('JUMP touch button jumps', jmax - jy0 > 0.8, `rise=${(jmax - jy0).toFixed(2)}`)
  await page.screenshot({ path: path.join(work, '2-touch.png') })
  await store((s) => s.getState().stopPlay())
  await page.waitForTimeout(400)

  // ---------- TC-MOVE-03: Input Actions persist and are used in Play ----------
  await store(async (s) => {
    const st = s.getState()
    const actions = [...st.projectSettings.inputActions, { name: 'Dash', type: 'button', bindings: ['Keyboard/KeyG'] }]
    return st.saveInputSettings(actions, st.projectSettings.touch)
  })
  const savedCfg = JSON.parse(fs.readFileSync(path.join(project, 'project.linden.json'), 'utf-8'))
  check('Input Actions are written to project.linden.json', savedCfg.input?.actions?.some((a) => a.name === 'Dash') && savedCfg.name === 'MoveGame' && savedCfg.scenesInBuild?.length === 1)

  await openProject(project)
  const reopened = await store((s) => s.getState().projectSettings.inputActions.some((a) => a.name === 'Dash'))
  check('Custom action survives closing and reopening the project', reopened)

  await store(async (s) => s.getState().startPlay())
  frame = await gameFrame()
  await page.waitForTimeout(600)
  await iframe.click({ position: { x: 20, y: 200 } })
  await page.keyboard.press('Escape')
  await iframe.focus()
  await page.keyboard.down('KeyG')
  await page.waitForTimeout(200)
  const dashOn = (await probe(frame)).dash
  await page.keyboard.up('KeyG')
  check('Play uses the project action (Dash on G)', dashOn === 1, `dash=${dashOn}`)
  await store((s) => s.getState().stopPlay())

  // ---------- TC-MOVE-04: exported web build on a touch device ----------
  const build = await page.evaluate((p) => window.electronAPI.runWebExport({
    projectPath: p,
    preset: { id: 'w', name: 'Web', platform: 'web', backend: 'linden', arch: ['wasm'], output: 'build/web', mode: 'release', zipOutput: false },
  }), project)
  check('Web export succeeds', build.success, build.error || '')
  const outDir = path.join(project, 'build/web')
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'
    const file = path.join(outDir, rel)
    if (!file.startsWith(outDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end() }
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const webUrl = `http://127.0.0.1:${server.address().port}/index.html`
  // A phone-sized window; touch emulation (maxTouchPoints > 0) through Playwright's own CDP session,
  // then a reload so input.touch.enabled = auto sees a touch device
  await app.evaluate(({ BrowserWindow }, url) => {
    const w = new BrowserWindow({ width: 844, height: 390, show: true })
    w.loadURL(url)
  }, webUrl)
  let web = null
  for (let i = 0; i < 100 && !web; i++) {
    web = app.windows().find((w) => w.url().startsWith(webUrl.replace('/index.html', ''))) ?? null
    if (!web) await page.waitForTimeout(200)
  }
  if (!web) throw new Error(`web window not found; windows: ${app.windows().map((w) => w.url()).join(', ')}`)
  const cdp = await app.context().newCDPSession(web)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await web.reload()
  await web.waitForFunction(() => !!document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#x')?.textContent, null, { timeout: 30000 })
  await web.waitForTimeout(800)
  const webTouch = await web.evaluate(() => !!document.getElementById('linden-touch-root'))
  check('Exported game shows touch controls automatically on a touch device', webTouch)
  const w0 = await probe(web)
  const vp = web.viewportSize() ?? { width: 844, height: 390 }
  await web.mouse.move(vp.width * 0.25, vp.height * 0.6)
  await web.mouse.down()
  await web.mouse.move(vp.width * 0.25, vp.height * 0.6 - 64, { steps: 4 })
  await web.waitForTimeout(800)
  await web.mouse.up()
  await web.waitForTimeout(200)
  const w1 = await probe(web)
  check('Exported game: joystick moves the character', w0.z - w1.z > 1.5, `dz=${(w0.z - w1.z).toFixed(2)}`)
  await web.screenshot({ path: path.join(work, '3-web-touch.png') })
  await web.close()
  server.close()
} catch (e) {
  check('e2e script', false, e.stack)
} finally {
  await app.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
