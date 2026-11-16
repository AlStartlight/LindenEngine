// E2E: the viewport "UI" toggle (docs/specs/SPEC-Toggle-UI-Overlay-Viewport.md) in the real
// Electron app. A full-screen opaque menu covers the scene; turning UI off must reveal it in
// edit mode and in Play (Game Frame) without restarting the game.
//
// Needs the Vite dev server (`npm run dev`) and a built main process:
//   npm run test:e2e:ui-toggle
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-ui-toggle-e2e-'))
console.log(`work folder: ${work}`)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const project = path.join(work, 'UiToggleGame')
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true })
  fs.writeFileSync(path.join(project, rel), content)
}
write('project.linden.json', JSON.stringify({ name: 'UiToggleGame', version: '0.1.0', scenesInBuild: ['scenes/Main.lscene'] }, null, 2))
write('ui/menu.html', `<style>#menu{position:absolute;inset:0;background:#111;color:#fff;font:20px sans-serif}</style><div id="menu">MENU <span id="t">0</span></div>`)
write('ui/label.html', `<div id="label" style="font:12px sans-serif">LABEL</div>`)
write(
  'scripts/Counter.ts',
  `export default class Counter {
  n = 0
  onInit(ctx: any) {
    ctx.ui.bind('#t', () => String(this.n))
  }
  onUpdate() {
    this.n++
  }
}
`
)
write('scenes/Main.lscene', JSON.stringify({
  format: 'linden-scene',
  version: 2,
  name: 'Main',
  entities: [
    { id: 'cam', name: 'Main Camera', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 3, 10], rotation: [-10, 0, 0], scale: [1, 1, 1] } },
      { type: 'Camera', data: { fov: 60, near: 0.1, far: 1000, isActive: true } },
    ] },
    { id: 'menu', name: 'Menu', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { type: 'Script', data: { src: 'scripts/Counter.ts' } },
      { type: 'HtmlUI', data: { src: 'ui/menu.html', mode: 'screen', zIndex: 0, pointerEvents: false, pixelSize: 0.01 } },
    ] },
    { id: 'box', name: 'Box', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { type: 'MeshRenderer', data: { primitive: 'box', color: '#ef4444' } },
      { type: 'HtmlUI', data: { src: 'ui/label.html', mode: 'world', zIndex: 0, pointerEvents: false, pixelSize: 0.01 } },
    ] },
  ],
}, null, 2))

const app = await electron.launch({
  args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`],
  cwd: repo,
})
let page = null
for (let i = 0; i < 100 && !page; i++) {
  page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? null
  if (!page) await new Promise((r) => setTimeout(r, 200))
}
if (!page) throw new Error('editor window not found')
await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 30000 })
await page.waitForTimeout(1500)

const bindStore = () => page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/editor/store/editorStore.ts'))
  window.__store = (await import(url)).useEditorStore
})
const store = (fn, arg) => page.evaluate(`(${fn.toString()})(window.__store, ${JSON.stringify(arg ?? null)})`)

const openProject = async () => {
  await page.evaluate((p) => window.electronAPI.addRecentProject({ name: 'UiToggleGame', path: p, lastOpened: Date.now() }), project)
  await page.reload()
  await page.waitForFunction(() => !!window.electronAPI)
  await page.waitForTimeout(1500)
  await bindStore()
  await page.getByText('UiToggleGame', { exact: true }).first().click()
  await page.waitForFunction((p) => window.__store.getState().projectPath === p, project, { timeout: 15000 })
  await page.waitForTimeout(1200)
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
const previewCount = () => page.locator('iframe[title^="UI preview"]').count()
const hiddenLabel = () => page.getByText('UI disembunyikan', { exact: true }).isVisible()
const editUiButton = () => page.getByRole('button', { name: 'UI', exact: true }).first()

try {
  await openProject()

  // U1: preview shown by default
  check('U1 edit: UI preview visible by default', (await previewCount()) === 1)
  await page.screenshot({ path: path.join(work, 'u1-ui-on.png') })

  // U2: click → hidden, label shown, button not pressed
  await editUiButton().click()
  await page.waitForTimeout(300)
  check('U2 edit: click UI hides the preview', (await previewCount()) === 0)
  check('U2 edit: "UI disembunyikan" label shown', await hiddenLabel())
  check('U2 edit: button aria-pressed=false', (await editUiButton().getAttribute('aria-pressed')) === 'false')
  await page.screenshot({ path: path.join(work, 'u2-ui-off.png') })

  // U3: click again → back
  await editUiButton().click()
  await page.waitForTimeout(500)
  check('U3 edit: click again shows the preview', (await previewCount()) === 1 && !(await hiddenLabel()))

  // U4: U key toggles
  await page.locator('canvas').first().click({ position: { x: 50, y: 300 } })
  await page.keyboard.press('KeyU')
  await page.waitForTimeout(300)
  check('U4 edit: U key hides the UI', (await previewCount()) === 0)

  // U5: survives reopening the project
  await openProject()
  check('U5 edit: hidden state kept after reopening the project', (await store((s) => s.getState().uiOverlayVisible)) === false && (await previewCount()) === 0)

  // U10: Play starts with the UI hidden
  await store(async (s) => s.getState().startPlay())
  let frame = await findGameFrame()
  check('Game Frame mounted', !!frame)
  await frame.waitForFunction(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#menu'), null, { timeout: 30000 })
  await page.waitForTimeout(500)
  const rootDisplay = () => frame.evaluate(() => getComputedStyle(document.getElementById('linden-ui-root')).display)
  const worldDisplay = () => frame.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => d.style.zIndex === '9' && d.id !== 'linden-ui-root')
    return el ? getComputedStyle(el).display : 'missing'
  })
  const counter = () => frame.evaluate(() => Number(document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#t')?.textContent))
  check('U10 play: starts with UI hidden', (await rootDisplay()) === 'none', await rootDisplay())
  check('U9 play: world-space UI hidden too', (await worldDisplay()) === 'none', await worldDisplay())
  await page.screenshot({ path: path.join(work, 'u10-play-ui-off.png') })

  // U6/U8: toggle on from the Game Frame toolbar, game keeps running and binding shows latest value
  const gameUiButton = page.getByRole('button', { name: 'UI', exact: true }).last()
  const before = await counter()
  await page.waitForTimeout(500)
  await gameUiButton.click()
  await page.waitForTimeout(300)
  const after = await counter()
  check('U6 play: Game Frame UI button shows the game UI', (await rootDisplay()) !== 'none' && (await worldDisplay()) !== 'none')
  check('U8 play: game kept running and the binding shows the latest value', after > before, `${before} -> ${after}`)
  await page.screenshot({ path: path.join(work, 'u6-play-ui-on.png') })

  await gameUiButton.click()
  await page.waitForTimeout(300)
  check('U6 play: clicking again hides the game UI without a reload', (await rootDisplay()) === 'none' && (await counter()) >= after)

  // U11: Reload keeps the hidden state
  await page.getByRole('button', { name: 'Reload', exact: true }).first().click()
  await page.waitForTimeout(1000)
  frame = await findGameFrame()
  await frame.waitForFunction(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#menu'), null, { timeout: 30000 })
  await page.waitForTimeout(500)
  check('U11 play: UI stays hidden after Reload', (await rootDisplay()) === 'none', await rootDisplay())

  await store((s) => s.getState().stopPlay())
} catch (e) {
  check('run', false, e.message)
} finally {
  await app.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
