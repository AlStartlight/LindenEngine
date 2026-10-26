// E2E: Play in the viewport (Game Frame) for scene projects (scripts + HtmlUI), the web export,
// and HTML Game projects, driven through the real Electron app.
//
// Needs the Vite dev server (`npm run dev`) and a built main process (`npm run build:electron`):
//   npm run test:e2e:play            (screenshots land in the printed work folder)
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-play-e2e-'))
console.log(`work folder: ${work}`)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- fixture: scene project with script + HUD ----------
const sceneProject = path.join(work, 'SceneGame')
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(sceneProject, rel)), { recursive: true })
  fs.writeFileSync(path.join(sceneProject, rel), content)
}
write('project.linden.json', JSON.stringify({ name: 'SceneGame', version: '0.1.0', renderer: 'webgpu', scenesInBuild: ['scenes/Main.lscene'] }, null, 2))
write(
  'scripts/Mover.ts',
  `import { Vector3 } from 'three'
export default class Mover {
  speed: number = 1
  ctx: any
  onInit(ctx: any) {
    this.ctx = ctx
    ctx.ui.bind('#pos', () => this.ctx.entity.getTransform().position.x.toFixed(2))
    ctx.ui.bind('#keys', () => (ctx.input.isKeyDown('KeyD') ? 'D' : '-'))
    new Vector3()
  }
  onUpdate(dt: number) {
    const t = this.ctx.entity.getTransform()
    if (this.ctx.input.isKeyDown('KeyD')) t.position.x += 50 * dt
    t.position.x += this.speed * dt * 0
  }
}
`
)
write('scripts/Crash.ts', `export default class Crash {\n  onUpdate() {\n    throw new Error('boom-from-script')\n  }\n}\n`)
write('ui/hud.html', `<style>#hud{position:absolute;top:8px;left:8px;font:16px sans-serif}</style><div id="hud">X=<span id="pos">?</span> K=<span id="keys">?</span><button id="b" onclick="alert(1)">b</button><script>window.__evil=1</script></div>`)
const scene = {
  format: 'linden-scene',
  version: 2,
  name: 'Main',
  entities: [
    { id: 'cam', name: 'Main Camera', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 3, 10], rotation: [-10, 0, 0], scale: [1, 1, 1] } },
      { type: 'Camera', data: { fov: 60, near: 0.1, far: 1000, isActive: true } },
    ] },
    { id: 'ground', name: 'Ground', active: true, static: true, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [20, 1, 20] } },
      { type: 'MeshRenderer', data: { primitive: 'box', color: '#22c55e' } },
    ] },
    { id: 'player', name: 'Player', active: true, static: false, tags: ['Player'], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { type: 'MeshRenderer', data: { primitive: 'box', color: '#ef4444' } },
      { type: 'Script', data: { src: 'scripts/Mover.ts', props: { speed: 2 } } },
      { type: 'HtmlUI', data: { src: 'ui/hud.html', mode: 'screen', zIndex: 0, pointerEvents: false, pixelSize: 0.01 } },
    ] },
    { id: 'crasher', name: 'Crasher', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [3, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { type: 'Script', data: { src: 'scripts/Crash.ts' } },
    ] },
  ],
}
write('scenes/Main.lscene', JSON.stringify(scene, null, 2))

const userData = path.join(work, 'userData')
const app = await electron.launch({
  args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${userData}`],
  cwd: repo,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
})
let page = null
for (let i = 0; i < 100 && !page; i++) {
  page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? null
  if (!page) await new Promise((r) => setTimeout(r, 200))
}
if (!page) throw new Error('editor window not found: ' + app.windows().map((w) => w.url()).join(', '))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [renderer error]', m.text().slice(0, 160), JSON.stringify(m.location()))
})
await page.waitForLoadState('domcontentloaded')
await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 30000 })
await page.waitForTimeout(1500)

// Use the exact module instance the app loaded (Vite appends ?t= to HMR-updated modules)
const bindStore = () => page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/editor/store/editorStore.ts'))
  window.__store = (await import(url)).useEditorStore
  return url
})
console.log('  store module:', await bindStore())
// fn receives (store, arg); runs in the page via CDP (not subject to the editor CSP)
const store = (fn, arg) => page.evaluate(`(${fn.toString()})(window.__store, ${JSON.stringify(arg ?? null)})`)

const openProject = async (projectPath) => {
  // Same path as a user: the project appears in Project Manager's recent list and gets opened from there
  await page.evaluate((p) => window.electronAPI.addRecentProject({ name: p.split('/').pop(), path: p, lastOpened: Date.now() }), projectPath)
  await store(async (s) => s.getState().closeProject())
  await page.evaluate(() => window.electronAPI.closeProject?.())
  await page.reload()
  await page.waitForFunction(() => !!window.electronAPI)
  await page.waitForTimeout(1500)
  await bindStore()
  const name = projectPath.split('/').pop()
  await page.getByText(name, { exact: true }).first().click()
  await page.waitForFunction((p) => window.__store.getState().projectPath === p, projectPath, { timeout: 15000 })
  await page.waitForTimeout(1000)
}

const findGameFrame = async (timeout = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const f = page.frames().find((fr) => fr.url().startsWith('linden-game://'))
    if (f) return f
    await page.waitForTimeout(200)
  }
  return null
}

try {
  // ---------- Scene project ----------
  await openProject(sceneProject)
  await store((s) => s.getState().selectEntity('player'))
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(work, '0-edit-mode.png') })
  const editErrors = await page.evaluate(() => document.body.innerText.match(/Failed to load viewport[^\n]*/)?.[0] ?? null)
  check('Editor viewport renders after the three.js upgrade', editErrors === null, editErrors ?? '')

  await store(async (s) => s.getState().startPlay())
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(work, '1-play-start.png') })
  const session = await store((s) => s.getState().playSession)
  check('Play starts a Game Frame session (scene mode)', !!session && session.mode === 'scene', JSON.stringify(session))

  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(work, '1a-after-play.png') })
  console.log('  iframes in DOM:', await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src + ' ' + f.title)))
  console.log('  frames:', page.frames().map((f) => f.url()))
  const frame = await findGameFrame()
  check('iframe on linden-game:// is mounted', !!frame, frame?.url())
  await frame.waitForFunction(() => !document.getElementById('loading-screen') || getComputedStyle(document.getElementById('loading-screen')).opacity === '0', null, { timeout: 30000 })
  await page.waitForTimeout(1200)

  const hudText = await frame.evaluate(() => {
    const host = document.querySelector('#linden-ui-root > div')
    return host?.shadowRoot?.querySelector('#hud')?.textContent ?? null
  })
  check('HtmlUI HUD rendered with bound value from script', !!hudText && /X=0\.00/.test(hudText), hudText)

  const sanitized = await frame.evaluate(() => {
    const root = document.querySelector('#linden-ui-root > div')?.shadowRoot
    return { script: !!root?.querySelector('script'), onclick: root?.querySelector('#b')?.getAttribute('onclick') ?? null, evil: window.__evil ?? null }
  })
  check('HtmlUI fragment sanitized (no <script>, no onclick)', !sanitized.script && sanitized.onclick === null && sanitized.evil === null, JSON.stringify(sanitized))

  // Keyboard input reaches the game
  await page.locator('iframe[title="Game"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.down('KeyD')
  await page.waitForTimeout(500)
  await page.keyboard.up('KeyD')
  await page.waitForTimeout(300)
  const hudAfter = await frame.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#pos')?.textContent)
  check('Script moves Player with keyboard input', Number(hudAfter) > 5, `x=${hudAfter}`)

  // Scene camera is used (not editor orbit camera): camera entity at z=10 looking at origin, red player near center
  await page.screenshot({ path: path.join(work, '1-play-scene.png') })

  // Console got the script error with original file:line
  const consoleText = await page.evaluate(() => document.body.innerText)
  check('Script error reported in editor Console with .ts location', /boom-from-script/.test(consoleText) && /scripts\/Crash\.ts:3/.test(consoleText),
    (consoleText.match(/.*boom-from-script.*/) || [''])[0].slice(0, 200))
  const statsLine = consoleText.replace(/\n/g, ' ')
  check('Game stats shown in viewport overlay (FPS + triangles)', /Game\s+(WebGPU|WebGL2)\s+\d+ FPS .*?[1-9]\d* Tris/.test(statsLine), (statsLine.match(/Game\s+Web\w+.{0,50}Batches/) || [''])[0])

  // Security: game cannot reach the editor or the network
  const sec = await frame.evaluate(async () => {
    const out = {}
    try { out.parentApi = typeof window.parent.electronAPI } catch (e) { out.parentApi = 'blocked:' + e.name }
    try { await fetch('https://example.com'); out.net = 'allowed' } catch (e) { out.net = 'blocked' }
    try { const r = await fetch('../secret'); out.trav = r.status } catch (e) { out.trav = 'err' }
    out.ownApi = typeof window.electronAPI
    return out
  })
  check('Game frame cannot access window.parent.electronAPI', String(sec.parentApi).startsWith('blocked'), JSON.stringify(sec))
  check('Game frame has no electronAPI of its own', sec.ownApi === 'undefined')
  check('Network blocked by CSP by default', sec.net === 'blocked')

  // WebGPU renderer (project.renderer = 'webgpu')
  const ui = (await page.evaluate(() => document.body.innerText)).replace(/\n/g, ' ')
  check('Game uses WebGPU when the project asks for it', /Renderer: WebGPU/.test(ui) && /Game\s+WebGPU/.test(ui), (ui.match(/Renderer: \w+/) || [''])[0])

  // Hot reload: script, UI, and a broken save while the game keeps running
  const hud = () => frame.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#hud')?.textContent ?? '')
  const posBefore = Number(await frame.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#pos')?.textContent))
  write('scripts/Mover.ts', fs.readFileSync(path.join(sceneProject, 'scripts/Mover.ts'), 'utf-8').replace("(ctx.input.isKeyDown('KeyD') ? 'D' : '-')", "'HOT'"))
  let hot = ''
  for (let i = 0; i < 40 && !/K=HOT/.test(hot); i++) { await page.waitForTimeout(150); hot = await hud() }
  const posAfter = Number(await frame.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#pos')?.textContent))
  check('Script hot reload applies without restarting (state kept)', /K=HOT/.test(hot) && Math.abs(posAfter - posBefore) < 0.01, `${hot} | x ${posBefore} -> ${posAfter}`)

  write('ui/hud.html', fs.readFileSync(path.join(sceneProject, 'ui/hud.html'), 'utf-8').replace('X=', 'POS='))
  let hud2 = ''
  for (let i = 0; i < 40 && !/POS=/.test(hud2); i++) { await page.waitForTimeout(150); hud2 = await hud() }
  check('HTML UI hot reload keeps bindings', /POS=\d/.test(hud2) && /K=HOT/.test(hud2), hud2)

  write('scripts/Mover.ts', 'export default class Mover {\n  x = \n}\n')
  let txt = ''
  for (let i = 0; i < 40 && !/Hot reload dibatalkan/.test(txt); i++) { await page.waitForTimeout(150); txt = await page.evaluate(() => document.body.innerText) }
  const stillRunning = /K=HOT/.test(await hud())
  check('Broken save during Play reports error and keeps old version', /Hot reload dibatalkan/.test(txt) && /scripts\/Mover\.ts:3/.test(txt) && stillRunning)
  write('scripts/Mover.ts', fs.readFileSync(path.join(sceneProject, 'scripts/Mover.ts'), 'utf-8') === '' ? '' : `import { Vector3 } from 'three'
export default class Mover {
  speed: number = 1
  ctx: any
  onInit(ctx: any) {
    this.ctx = ctx
    ctx.ui.bind('#pos', () => this.ctx.entity.getTransform().position.x.toFixed(2))
    ctx.ui.bind('#keys', () => (ctx.input.isKeyDown('KeyD') ? 'D' : '-'))
    new Vector3()
  }
  onUpdate(dt: number) {
    const t = this.ctx.entity.getTransform()
    if (this.ctx.input.isKeyDown('KeyD')) t.position.x += 50 * dt
  }
}
`)
  write('ui/hud.html', fs.readFileSync(path.join(sceneProject, 'ui/hud.html'), 'utf-8').replace('POS=', 'X='))
  await page.waitForTimeout(1200)

  // Pause freezes the simulation
  await store((s) => s.getState().pausePlay())
  await page.waitForTimeout(200)
  const p1 = await frame.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#pos')?.textContent)
  await frame.locator('body').press('KeyD')
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD')
  const p2 = await frame.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#pos')?.textContent)
  check('Pause freezes the game', p1 === p2, `${p1} -> ${p2}`)
  await store((s) => s.getState().pausePlay())

  // Stop returns to editor with world untouched
  await store((s) => s.getState().stopPlay())
  await page.waitForTimeout(500)
  const afterStop = await store((s) => {
    const st = s.getState()
    return { state: st.playState, session: st.playSession, x: st.world.getEntity('player').getTransform().position.x }
  })
  check('Stop removes the frame and editor world is untouched', afterStop.state === 'stopped' && !afterStop.session && afterStop.x === 0 && !page.frames().some((f) => f.url().startsWith('linden-game://')), JSON.stringify(afterStop))

  // Compile error blocks Play with file:line
  fs.writeFileSync(path.join(sceneProject, 'scripts/Broken.ts'), 'export default class B {\n  x = \n}\n')
  const err = await store(async (s) => { try { await s.getState().startPlay(); return 'started' } catch (e) { return e.message } })
  check('Compile error prevents Play and names file:line', /scripts\/Broken\.ts:3/.test(err), err.split('\n').slice(0, 2).join(' | '))
  fs.rmSync(path.join(sceneProject, 'scripts/Broken.ts'))

  // ---------- Web export of the scene project runs in a plain browser window ----------
  const build = await page.evaluate((p) => window.electronAPI.runWebExport({
    projectPath: p,
    preset: { id: 'w', name: 'Web', platform: 'web', backend: 'linden', arch: ['wasm'], output: 'build/web', mode: 'release', zipOutput: false },
  }), sceneProject)
  check('Web export of scene project succeeds', build.success, build.error || '')
  const outDir = path.join(sceneProject, 'build/web')
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'
    const file = path.join(outDir, rel)
    if (!file.startsWith(outDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end() }
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.json') || file.endsWith('.lscene') ? 'application/json' : 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const webUrl = `http://127.0.0.1:${server.address().port}/index.html`
  await app.evaluate(({ BrowserWindow }, url) => {
    const w = new BrowserWindow({ width: 900, height: 600, show: true })
    w.loadURL(url)
  }, webUrl)
  let web = null
  for (let i = 0; i < 50 && !web; i++) {
    web = app.windows().find((w) => w.url() === webUrl) ?? null
    if (!web) await page.waitForTimeout(200)
  }
  await web.waitForFunction(() => !document.getElementById('loading-screen'), null, { timeout: 30000 })
  await web.waitForTimeout(800)
  const webHud = await web.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#hud')?.textContent)
  check('Exported game renders HUD from script', /X=0\.00/.test(webHud ?? ''), webHud)
  await web.locator('#game-canvas').click()
  await web.keyboard.down('KeyD'); await web.waitForTimeout(400); await web.keyboard.up('KeyD'); await web.waitForTimeout(200)
  const webX = await web.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#pos')?.textContent)
  check('Exported game script reacts to keyboard', Number(webX) > 5, `x=${webX}`)
  const webBackend = await web.evaluate(() => (navigator.gpu ? 'gpu' : 'nogpu'))
  check('Exported game ships the renderer preference', JSON.parse(fs.readFileSync(path.join(outDir, 'project.json'), 'utf-8')).renderer === 'webgpu', webBackend)
  await web.screenshot({ path: path.join(work, '1b-web-export.png') })
  await web.close()
  server.close()

  // ---------- HTML Game project from the template ----------
  const created = await page.evaluate(async (loc) => {
    const mod = await import('/editor/project/projectIO.ts')
    return mod.createNewProject({ name: 'HtmlGame', location: loc, template: 'html-threejs', renderer: 'webgl' })
  }, work)
  check('HTML Game template creates web/ + vendor three.js', created.status === 'ok' && fs.existsSync(path.join(work, 'HtmlGame/web/vendor/three.module.js')) && created.config.runtime === 'html', created.message || '')
  await openProject(path.join(work, 'HtmlGame'))
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(work, '2-html-edit.png') })
  await store(async (s) => s.getState().startPlay())
  const hsession = await store((s) => s.getState().playSession)
  check('Play starts HTML Game session', hsession?.mode === 'html', hsession?.url)
  const hframe = await findGameFrame()
  await hframe.waitForFunction(() => !!window.linden, null, { timeout: 20000 })
  await page.waitForTimeout(2000)
  const hstate = await hframe.evaluate(() => ({ bridge: !!window.linden, score: document.getElementById('score')?.textContent, canvas: !!document.getElementById('game') }))
  check('HTML Game runs with linden bridge', hstate.bridge && hstate.canvas, JSON.stringify(hstate))
  const overlay = (await page.evaluate(() => document.body.innerText)).replace(/\n/g, ' ')
  const tris = overlay.match(/(\d+) Tris/)
  check('HTML Game 3D render stats reach the editor (FPS + triangles)', !!tris && Number(tris[1]) > 0, (overlay.match(/Game.{0,60}Batches/) || [''])[0])
  await page.screenshot({ path: path.join(work, '3-html-play.png') })

  // live reload on file change
  const before = hframe.url()
  fs.appendFileSync(path.join(work, 'HtmlGame/web/style.css'), '\n/* touch */\n')
  await page.waitForTimeout(1500)
  const reloaded = page.frames().find((f) => f.url().startsWith('linden-game://'))
  const marker = await reloaded?.evaluate(() => performance.timeOrigin)
  check('HTML Game reloads when web/ files change', !!reloaded && reloaded !== hframe, `${before}`)

  await store((s) => s.getState().stopPlay())
} catch (e) {
  check('e2e script', false, e.stack)
} finally {
  await app.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
