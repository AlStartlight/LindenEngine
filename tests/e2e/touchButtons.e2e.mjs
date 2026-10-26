// E2E: developer-customizable mobile action buttons (SPEC-Mobile-Action-Buttons-Custom TC-TOUCH-01..06)
// in the real Electron app. Needs the Vite dev server (`npm run dev`):
//   npm run test:e2e:touch
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-touch-e2e-'))
console.log(`work folder: ${work}`)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- fixture ----------
const project = path.join(work, 'TouchGame')
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true })
  fs.writeFileSync(path.join(project, rel), content)
}
write(
  'project.linden.json',
  JSON.stringify(
    {
      name: 'TouchGame',
      version: '0.1.0',
      scenesInBuild: ['scenes/Main.lscene'],
      input: {
        actions: [
          { name: 'Move', type: 'vector2', composites: [{ up: ['Keyboard/KeyW'], down: ['Keyboard/KeyS'], left: ['Keyboard/KeyA'], right: ['Keyboard/KeyD'] }], bindings: ['Touch/Joystick'], deadzone: 0.15 },
          { name: 'Jump', type: 'button', bindings: ['Keyboard/Space'] },
          { name: 'Attack', type: 'button', bindings: ['Mouse/LeftButton'] },
          { name: 'Interact', type: 'button', bindings: ['Keyboard/KeyF'] },
          { name: 'Dash', type: 'button', bindings: ['Keyboard/KeyG'] },
          { name: 'Look', type: 'vector2', bindings: ['Touch/Look'] },
        ],
        touch: {
          enabled: 'auto',
          scale: 'auto',
          joystick: { side: 'left', mode: 'fixed', radius: 64 },
          look: { enabled: true, area: 'right-half', sensitivity: 1 },
          opacity: 0.7,
          safeArea: true,
          buttons: [
            { id: 'Hit', action: 'Attack', label: 'HIT', icon: 'asset:assets/ui/sword.svg', behavior: 'tap', cooldown: 0.6, anchor: 'bottom-right', x: 110, y: 40, size: 72, color: '#dc2626' },
            { id: 'Jump', action: 'Jump', label: 'JUMP', icon: 'jump', anchor: 'bottom-right', x: 20, y: 24, size: 80 },
            { id: 'Use', action: 'Interact', label: 'USE', icon: 'use', behavior: 'tap', visible: false, anchor: 'bottom-right', x: 30, y: 130, size: 56 },
          ],
          layouts: {
            vehicle: {
              look: { enabled: false },
              buttons: [
                { id: 'Gas', action: 'Jump', label: 'GAS', anchor: 'bottom-right', x: 24, y: 24, size: 90, shape: 'rounded' },
                { id: 'Brake', action: 'Attack', label: 'REM', anchor: 'bottom-right', x: 130, y: 24, size: 72, shape: 'rounded' },
                { id: 'Exit', action: 'Interact', label: 'KELUAR', anchor: 'top-right', x: 16, y: 16, size: 52 },
              ],
            },
          },
        },
      },
    },
    null,
    2
  )
)
write('assets/ui/sword.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 3h7v7L10 21l-2-2L19 8V5h-3L5 16l-2-2z" fill="white"/></svg>')
write(
  'scripts/Probe.ts',
  `export default class Probe {
  ctx: any
  attacks = 0
  dashes = 0
  onInit(ctx: any) {
    this.ctx = ctx
    ctx.ui.bind('#attacks', () => this.attacks)
    ctx.ui.bind('#dashes', () => this.dashes)
    ctx.ui.bind('#z', () => ctx.entity.getTransform().position.z.toFixed(2))
    ctx.ui.bind('#layout', () => ctx.touch.layout)
  }
  onUpdate() {
    if (this.ctx.input.isActionJustPressed('Attack')) this.attacks++
    if (this.ctx.input.isActionJustPressed('Dash')) this.dashes++
    if (this.ctx.input.isActionJustPressed('Interact')) this.ctx.touch.setLayout('vehicle')
  }
  onTriggerEnter(other: any) {
    if (other.name === 'Door') this.ctx.touch.show('Use')
  }
  onTriggerExit(other: any) {
    if (other.name === 'Door') this.ctx.touch.hide('Use')
  }
}
`
)
write('ui/probe.html', '<div style="position:absolute;top:4px;left:4px;font:12px monospace">a=<span id="attacks"></span> d=<span id="dashes"></span> z=<span id="z"></span> l=<span id="layout"></span></div>')
const T = (p, r = [0, 0, 0], s = [1, 1, 1]) => ({ type: 'Transform', data: { position: p, rotation: r, scale: s } })
write(
  'scenes/Main.lscene',
  JSON.stringify({
    format: 'linden-scene',
    version: 2,
    name: 'Main',
    entities: [
      { id: 'cam', name: 'Main Camera', active: true, static: false, tags: [], layer: 0, parentId: null, components: [T([0, 6, 10], [-25, 0, 0]), { type: 'Camera', data: { fov: 60, isActive: true } }] },
      { id: 'ground', name: 'Ground', active: true, static: true, tags: [], layer: 0, parentId: null, components: [T([0, -0.5, 0], [0, 0, 0], [100, 1, 100]), { type: 'MeshRenderer', data: { primitive: 'box', color: '#22c55e' } }, { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } }] },
      { id: 'door', name: 'Door', active: true, static: true, tags: [], layer: 0, parentId: null, components: [T([0, 1, -5]), { type: 'MeshRenderer', data: { primitive: 'box', color: '#a855f7' } }, { type: 'BoxCollider', data: { size: { x: 3, y: 2, z: 2 }, isTrigger: true } }] },
      {
        id: 'player', name: 'Player', active: true, static: false, tags: ['Player'], layer: 0, parentId: null,
        components: [
          T([0, 1.05, 0]),
          { type: 'MeshRenderer', data: { primitive: 'capsule', color: '#38bdf8' } },
          { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } },
          { type: 'CharacterController', data: {} },
          { type: 'CharacterMovement', data: { walkSpeed: 4, orientToMovement: false } },
          { type: 'Script', data: { src: 'scripts/Probe.ts', props: {} } },
          { type: 'HtmlUI', data: { src: 'ui/probe.html', mode: 'screen', zIndex: 0, pointerEvents: false, pixelSize: 0.01 } },
        ],
      },
    ],
  })
)

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
const readConfig = () => JSON.parse(fs.readFileSync(path.join(project, 'project.linden.json'), 'utf-8'))

await page.evaluate((p) => window.electronAPI.addRecentProject({ name: 'TouchGame', path: p, lastOpened: Date.now() }), project)
await page.reload()
await page.waitForFunction(() => !!window.electronAPI)
await page.waitForTimeout(1500)
await bindStore()
await page.getByText('TouchGame', { exact: true }).first().click()
await page.waitForFunction((p) => window.__store.getState().projectPath === p, project, { timeout: 15000 })
await page.waitForTimeout(800)

const gameFrame = async () => {
  for (let i = 0; i < 100; i++) {
    const f = page.frames().find((fr) => fr.url().startsWith('linden-game://'))
    if (f) {
      try {
        await f.waitForFunction(() => !!document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#z')?.textContent, null, { timeout: 20000 })
        return f
      } catch {
        /* replaced by a reload */
      }
    }
    await page.waitForTimeout(200)
  }
  throw new Error('game frame not ready')
}
const probe = (f) =>
  f.evaluate(() => {
    const root = document.querySelector('#linden-ui-root > div')?.shadowRoot
    const t = (id) => root?.querySelector(`#${id}`)?.textContent
    return { attacks: Number(t('attacks')), dashes: Number(t('dashes')), z: Number(t('z')), layout: t('layout') }
  })
const buttonInfo = (f) =>
  f.evaluate(() =>
    [...document.querySelectorAll('[data-linden-touch^="button:"]')].map((b) => ({
      id: b.getAttribute('data-linden-touch').slice(7),
      visible: getComputedStyle(b).display !== 'none',
    }))
  )
const tap = async (f, id, holdMs = 60) => {
  const box = await f.locator(`[data-linden-touch="button:${id}"]`).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(holdMs)
  await page.mouse.up()
}

try {
  // ---------- TC-TOUCH-01: add a DASH button from the editor ----------
  await store((s) => s.getState().setActiveWindow('inputActions'))
  await page.getByRole('button', { name: 'Kontrol Sentuh' }).click()
  await page.locator('[data-testid="add-touch-button"]').selectOption('Dash')
  await page.waitForTimeout(900) // debounced save
  const afterAdd = readConfig().input.touch.buttons.find((b) => b.id === 'Dash')
  check('Editor adds a button already connected to its action', afterAdd?.action === 'Dash', JSON.stringify(afterAdd))
  const problems = await page.locator('[data-testid="touch-problems"]').innerText()
  check('Editor validation lists layout problems (or none)', /validasi/i.test(problems), problems.split('\n').slice(0, 3).join(' | '))
  await page.screenshot({ path: path.join(work, '0-editor.png') })

  // ---------- TC-TOUCH-02: rename Hit -> Smash keeps it connected ----------
  await page.locator('[data-testid="touch-editor"]').getByText('HIT', { exact: true }).first().click()
  const idInput = page.locator('[data-testid="touch-button-props"] input').first()
  await idInput.fill('Smash')
  await idInput.blur()
  await page.waitForTimeout(900)
  const renamed = readConfig().input.touch.buttons.find((b) => b.id === 'Smash')
  check('Renaming a button id keeps its action', renamed?.action === 'Attack' && !readConfig().input.touch.buttons.some((b) => b.id === 'Hit'), JSON.stringify(renamed))
  await page.getByRole('button', { name: 'Done' }).click()

  // ---------- Play with touch controls ----------
  await store(async (s) => s.getState().startPlay())
  await page.waitForTimeout(500)
  await page.locator('select[title^="Kontrol sentuh"]').selectOption('always')
  let frame = await gameFrame()
  await page.waitForTimeout(800)
  let info = await buttonInfo(frame)
  check('Play shows the customized buttons (Use hidden at start)', info.some((b) => b.id === 'Dash' && b.visible) && info.some((b) => b.id === 'Use' && !b.visible), JSON.stringify(info))

  await tap(frame, 'Dash')
  await page.waitForTimeout(150)
  check('New DASH button triggers the Dash action', (await probe(frame)).dashes === 1)

  // ---------- TC-TOUCH-03: tap + cooldown ----------
  const a0 = (await probe(frame)).attacks
  await tap(frame, 'Smash', 1000) // held for 1 s: still one attack
  await page.waitForTimeout(100)
  const a1 = (await probe(frame)).attacks
  await tap(frame, 'Smash') // still cooling down (0.6 s from the press, released after 1 s -> already over)
  await page.waitForTimeout(100)
  const a2 = (await probe(frame)).attacks
  await tap(frame, 'Smash')
  await page.waitForTimeout(150)
  const a3 = (await probe(frame)).attacks
  const cooling = await frame.evaluate(() => getComputedStyle(document.querySelector('[data-linden-touch="button:Smash"] div > div:last-child')).display)
  check('Tap fires once per press even when held', a1 - a0 === 1, `${a0} -> ${a1}`)
  check('Cooldown ignores taps until it ends', a2 - a1 === 1 && a3 === a2 && cooling === 'flex', `a=${a1},${a2},${a3} overlay=${cooling}`)
  const swordLoaded = await frame.evaluate(() => {
    const img = document.querySelector('[data-linden-touch="button:Smash"] img')
    return img ? img.complete && img.naturalWidth > 0 : false
  })
  check('Asset icon (assets/ui/sword.svg) is shown', swordLoaded)

  // ---------- TC-TOUCH-04: contextual Use button from a door trigger ----------
  const box = await page.locator('iframe[title="Game"]').boundingBox()
  const stick = { x: box.x + 104 * Math.min(1.5, Math.max(0.8, Math.min(box.width, box.height) / 390)), y: box.y + box.height - 104 * Math.min(1.5, Math.max(0.8, Math.min(box.width, box.height) / 390)) }
  const walk = async (ms) => {
    await page.mouse.move(stick.x, stick.y)
    await page.mouse.down()
    await page.mouse.move(stick.x, stick.y - 90, { steps: 4 })
    await page.waitForTimeout(ms)
    await page.mouse.up()
    await page.waitForTimeout(200)
  }
  /** Hold the joystick (dir -1 = forward, +1 = back) until `until` holds or time runs out */
  const walkUntil = async (dir, until, maxMs = 4000) => {
    await page.mouse.move(stick.x, stick.y)
    await page.mouse.down()
    await page.mouse.move(stick.x, stick.y + dir * 90, { steps: 4 })
    const started = Date.now()
    let ok = false
    while (Date.now() - started < maxMs) {
      await page.waitForTimeout(60)
      if (await until()) {
        ok = true
        break
      }
    }
    await page.mouse.up()
    await page.waitForTimeout(200)
    return ok
  }
  const useVisible = async () => !!(await buttonInfo(frame)).find((b) => b.id === 'Use')?.visible
  const shownAtDoor = await walkUntil(-1, useVisible)
  const atDoor = await probe(frame)
  const hiddenAfter = await walkUntil(-1, async () => !(await useVisible()))
  const pastDoor = await probe(frame)
  check('Script shows USE inside the door trigger and hides it after', shownAtDoor && hiddenAfter, `shown at z=${atDoor.z}, hidden at z=${pastDoor.z}`)
  await page.screenshot({ path: path.join(work, '1-play.png') })

  // ---------- TC-TOUCH-05: switch layout from a script ----------
  // Walk back into the door to reveal USE, tap it: the script switches to the vehicle layout
  await walkUntil(1, useVisible)
  await tap(frame, 'Use')
  await page.waitForTimeout(300)
  const vehicle = await buttonInfo(frame)
  const lookZone = await frame.evaluate(() => !!document.querySelector('[data-linden-touch="look-zone"]'))
  const layoutNow = (await probe(frame)).layout
  check('ctx.touch.setLayout("vehicle") swaps the buttons', layoutNow === 'vehicle' && vehicle.map((b) => b.id).join(',') === 'Gas,Brake,Exit' && !lookZone, `${layoutNow}: ${vehicle.map((b) => b.id).join(',')} look=${lookZone}`)
  await page.screenshot({ path: path.join(work, '2-vehicle.png') })
  await store((s) => s.getState().stopPlay())

  // ---------- TC-TOUCH-06: exported build on phone and tablet ----------
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
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const webUrl = `http://127.0.0.1:${server.address().port}/index.html`
  for (const device of [{ name: 'iPhone SE', width: 667, height: 375 }, { name: 'iPad', width: 1180, height: 820 }]) {
    await app.evaluate(({ BrowserWindow }, { url, width, height }) => {
      const w = new BrowserWindow({ width, height, useContentSize: true, show: true })
      w.loadURL(`${url}?d=${width}`)
    }, { url: webUrl, width: device.width, height: device.height })
    let web = null
    for (let i = 0; i < 100 && !web; i++) {
      web = app.windows().find((w) => w.url().includes(`?d=${device.width}`)) ?? null
      if (!web) await page.waitForTimeout(200)
    }
    const cdp = await app.context().newCDPSession(web)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await web.reload()
    await web.waitForFunction(() => document.querySelectorAll('[data-linden-touch^="button:"]').length > 0, null, { timeout: 30000 })
    await web.waitForTimeout(800)
    const rects = await web.evaluate(() =>
      [...document.querySelectorAll('[data-linden-touch^="button:"]')]
        .filter((b) => getComputedStyle(b).display !== 'none')
        .map((b) => {
          const r = b.firstElementChild.getBoundingClientRect()
          return { id: b.getAttribute('data-linden-touch').slice(7), x: r.x, y: r.y, w: r.width, h: r.height }
        })
    )
    const vw = await web.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    const overlaps = []
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j]
        const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ow > 2 && oh > 2) overlaps.push(`${a.id}/${b.id}`)
      }
    const offscreen = rects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > vw.w + 1 || r.y + r.h > vw.h + 1).map((r) => r.id)
    check(`${device.name}: buttons fit without overlapping`, overlaps.length === 0 && offscreen.length === 0, `${rects.map((r) => `${r.id}:${Math.round(r.w)}px`).join(' ')} overlaps=${overlaps} offscreen=${offscreen}`)
    await web.screenshot({ path: path.join(work, `3-web-${device.width}.png`) })
    await web.close()
  }
  server.close()
} catch (e) {
  check('e2e script', false, e.stack)
} finally {
  await app.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
