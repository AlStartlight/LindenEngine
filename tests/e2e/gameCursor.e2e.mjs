// E2E: Project Settings → Cursor in the real Electron app (pointer lock only works there, not in
// Playwright-driven Chrome). Dizzle repro: a mouse-look game (Look → Mouse/Delta) set to
// "Selalu tampil" must keep the cursor after a click.
//
// Needs the Vite dev server (`npm run dev`) and a built main process:
//   npm run test:e2e:cursor
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-cursor-e2e-'))
console.log(`work folder: ${work}`)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const project = path.join(work, 'CursorGame')
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true })
  fs.writeFileSync(path.join(project, rel), content)
}
write('project.linden.json', JSON.stringify({
  name: 'CursorGame',
  version: '0.1.0',
  scenesInBuild: ['scenes/Main.lscene'],
  input: { actions: [{ name: 'Look', type: 'vector2', bindings: ['Mouse/Delta'] }] },
  cursor: { mode: 'visible', style: 'crosshair', hotspot: [0, 0] },
}, null, 2))
write('scenes/Main.lscene', JSON.stringify({
  format: 'linden-scene',
  version: 2,
  name: 'Main',
  entities: [
    { id: 'cam', name: 'Main Camera', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 3, 10], rotation: [-10, 0, 0], scale: [1, 1, 1] } },
      { type: 'Camera', data: { fov: 60, near: 0.1, far: 1000, isActive: true } },
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

const findGameFrame = async (timeout = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const f = page.frames().find((fr) => fr.url().startsWith('linden-game://'))
    if (f) return f
    await page.waitForTimeout(200)
  }
  return null
}
const clickGame = async () => {
  await page.locator('iframe[title="Game"]').click({ position: { x: 200, y: 200 } })
  await page.waitForTimeout(500)
}

try {
  await page.evaluate((p) => window.electronAPI.addRecentProject({ name: 'CursorGame', path: p, lastOpened: Date.now() }), project)
  await page.reload()
  await page.waitForFunction(() => !!window.electronAPI)
  await page.waitForTimeout(1500)
  await bindStore()
  await page.getByText('CursorGame', { exact: true }).first().click()
  await page.waitForFunction((p) => window.__store.getState().projectPath === p, project, { timeout: 15000 })
  await page.waitForTimeout(800)

  await store((s) => s.getState().startPlay())
  const frame = await findGameFrame()
  check('Game Frame mounted', !!frame)
  await frame.waitForFunction(() => document.querySelector('canvas')?.style.cursor, null, { timeout: 30000 })
  const locked = () => frame.evaluate(() => !!document.pointerLockElement)

  // K1: "Selalu tampil" + mouse-look game: click keeps the cursor
  check('K1 visible: canvas uses the configured shape', (await frame.evaluate(() => document.querySelector('canvas').style.cursor)) === 'crosshair')
  await clickGame()
  check('K1 visible: click does not lock the cursor', !(await locked()))

  // K6 (and K3): switch to locked while playing → click locks, without Stop/Play
  await store(async (s) => s.getState().saveCursorSettings({ mode: 'locked' }))
  await page.waitForTimeout(300)
  await clickGame()
  check('K3 locked: click locks the cursor (live update, no restart)', await locked())

  // K6: back to visible while locked → released immediately
  await store(async (s) => s.getState().saveCursorSettings({ mode: 'visible' }))
  await page.waitForTimeout(500)
  check('K6 locked → visible releases the lock without Esc', !(await locked()))

  // K2: a game script locking on click in visible mode gets released
  await frame.evaluate(() => document.querySelector('canvas').addEventListener('click', () => document.body.requestPointerLock()))
  await clickGame()
  check('K2 visible: lock taken by a script is released', !(await locked()))
  const consoleText = await page.evaluate(() => document.body.innerText)
  check('K2 visible: warning shown in the editor Console', /pointer lock dilepas/.test(consoleText))

  const saved = JSON.parse(fs.readFileSync(path.join(project, 'project.linden.json'), 'utf-8')).cursor
  check('Setting saved to project.linden.json', saved?.mode === 'visible', JSON.stringify(saved))

  await store((s) => s.getState().stopPlay())
} catch (e) {
  check('run', false, e.message)
} finally {
  await app.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
