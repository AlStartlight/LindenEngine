// E2E: mesh Edit Mode in the real editor (Electron + Vite dev server on :5173, like the other editor e2e
// tests). Drives the UI with mouse and keyboard: Convert to Editable, Tab, face pick, extrude, gizmo drag,
// inset, undo/redo inside Edit Mode, box select + delete, single-step undo outside, and Ctrl+S while editing.
//   npm run dev   (in another terminal)
//   npm run build:electron && node tests/e2e/meshEditMode.e2e.mjs
import { _electron as electron } from 'playwright'
import * as THREE from 'three'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-mesh-edit-e2e-'))
const shots = process.env.LINDEN_E2E_OUT ? path.resolve(process.env.LINDEN_E2E_OUT) : work
console.log(`work folder: ${work}`)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const project = path.join(work, 'MeshGame')
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true })
  fs.writeFileSync(path.join(project, rel), content)
}
write('project.linden.json', JSON.stringify({ name: 'MeshGame', version: '0.1.0', scenesInBuild: ['scenes/Main.lscene'] }, null, 2))
// The editor uses Cmd on macOS and Ctrl elsewhere
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const SCALE = 3
write('scenes/Main.lscene', JSON.stringify({
  format: 'linden-scene', version: 2, name: 'Main',
  entities: [{
    id: 'block', name: 'Block', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
      { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [SCALE, SCALE, SCALE] } },
      { type: 'MeshRenderer', data: { primitive: 'box', color: '#3b82f6' } },
    ],
  }],
}, null, 2))

const app = await electron.launch({
  args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`],
  cwd: repo,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
})
const rendererErrors = []
try {
  let page = null
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? null
    if (!page) await new Promise((r) => setTimeout(r, 200))
  }
  if (!page) throw new Error('editor window not found')
  page.on('console', (m) => { if (m.type() === 'error') rendererErrors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => rendererErrors.push(e.message))
  await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 30000 })
  await page.waitForTimeout(1500)

  const bindStore = () => page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/editor/store/editorStore.ts'))
    window.__store = (await import(url)).useEditorStore
    const enc = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/engine/mesh/core/encoding.ts'))
    window.__decode = enc ? (await import(enc)).decodeHalfEdgeMesh : null
  })
  await bindStore()
  await page.evaluate((p) => window.electronAPI.addRecentProject({ name: 'MeshGame', path: p, lastOpened: Date.now() }), project)
  await page.reload()
  await page.waitForFunction(() => !!window.electronAPI)
  await page.waitForTimeout(1500)
  await page.getByText('MeshGame', { exact: true }).first().click()
  await page.waitForFunction(() => window.__store === undefined || true)
  await bindStore()
  await page.waitForFunction((p) => window.__store.getState().projectPath === p, project, { timeout: 15000 })
  await page.waitForFunction(() => !!window.__store.getState().world.getEntity('block'), null, { timeout: 15000 })
  await page.waitForTimeout(800)

  /** Mesh summary from the committed EditableMesh component */
  const meshInfo = () => page.evaluate(async () => {
    const e = window.__store.getState().world.getEntity('block')
    const c = e?.getComponent('EditableMesh')
    if (!c) return { editable: false, meshRenderer: !!e?.getComponent('MeshRenderer') }
    if (!window.__decode) {
      const url = performance.getEntriesByType('resource').map((x) => x.name).find((n) => n.includes('/engine/mesh/core/encoding.ts'))
      window.__decode = (await import(url)).decodeHalfEdgeMesh
    }
    const r = window.__decode(c.mesh)
    if (!r.ok) return { editable: true, error: r.message }
    const m = r.value
    let maxY = -Infinity
    for (let v = 0; v < m.vertexSlots; v++) maxY = Math.max(maxY, m.positions[v * 3 + 1])
    return { editable: true, faces: m.faceCount, vertices: m.vertexCount, maxY }
  })
  const editState = () => page.evaluate(() => window.__store.getState().meshEdit)

  // Screen position of a world point, using the viewport's default camera (fov 60 at (10,10,10) -> origin)
  const canvasBox = await page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
    const r = c.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  const camera = new THREE.PerspectiveCamera(60, canvasBox.w / canvasBox.h, 0.1, 10000)
  camera.position.set(10, 10, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const screen = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera)
    return { x: canvasBox.x + ((v.x + 1) / 2) * canvasBox.w, y: canvasBox.y + ((1 - v.y) / 2) * canvasBox.h }
  }
  const top = SCALE / 2

  // ---------- Convert to Editable ----------
  await page.evaluate(() => window.__store.getState().selectEntity('block'))
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Convert to Editable' }).click()
  await page.waitForTimeout(300)
  let info = await meshInfo()
  check('Convert to Editable swaps MeshRenderer for an EditableMesh box', info.editable && info.faces === 6 && !info.meshRenderer, JSON.stringify(info))

  // ---------- Session A: face pick, extrude, gizmo drag, inset, undo/redo ----------
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  let st = await editState()
  check('Tab enters Edit Mode for the selected entity', st?.entityId === 'block', JSON.stringify(st))
  await page.keyboard.press('3')
  st = await editState()
  check('3 switches to face select mode', st?.selectMode === 'face')

  const topCenter = screen(0, top, 0)
  await page.mouse.click(topCenter.x, topCenter.y)
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'edit-face-selected.png') })
  await page.keyboard.press('e')
  await page.waitForTimeout(300)

  // Drag the gizmo's Y arrow straight up: grab just above the pivot, along the projected +Y axis
  const pivot = screen(0, top, 0)
  const up = screen(0, top + 1, 0)
  const dir = { x: up.x - pivot.x, y: up.y - pivot.y }
  const len = Math.hypot(dir.x, dir.y)
  const grab = { x: pivot.x + (dir.x / len) * 45, y: pivot.y + (dir.y / len) * 45 }
  await page.mouse.move(grab.x, grab.y)
  await page.waitForTimeout(100)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(grab.x + (dir.x / len) * 8 * i, grab.y + (dir.y / len) * 8 * i)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'edit-extruded.png') })

  await page.keyboard.press('i')
  await page.waitForTimeout(300)
  await page.keyboard.press(`${MOD}+z`) // undo inset
  await page.waitForTimeout(200)
  await page.keyboard.press(`${MOD}+Shift+z`) // redo inset
  await page.waitForTimeout(200)
  st = await editState()
  check('no operation error reported in the toolbar', !st?.status, st?.status ?? '')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  st = await editState()
  info = await meshInfo()
  check('Tab leaves Edit Mode', st === null)
  check('extrude + inset (after undo/redo) committed: 6 -> 10 -> 14 faces', info.faces === 14, JSON.stringify(info))
  check('gizmo drag moved the extruded face up (local units)', info.maxY > 0.5 + 0.05, `maxY=${info.maxY?.toFixed(3)}`)

  // ---------- Session B: box select everything, delete ----------
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  await page.keyboard.press('1')
  await page.keyboard.press('b')
  const corners = []
  for (const x of [-top, top]) for (const y of [-top, top * 3]) for (const z of [-top, top]) corners.push(screen(x, y, z))
  const minX = Math.min(...corners.map((c) => c.x)) - 20, maxX = Math.max(...corners.map((c) => c.x)) + 20
  const minY = Math.min(...corners.map((c) => c.y)) - 20, maxY = Math.max(...corners.map((c) => c.y)) + 20
  // Drag from the bottom-right corner: the top-left one can sit under the (wrapped) toolbar
  await page.mouse.move(maxX, maxY)
  await page.mouse.down()
  await page.mouse.move((minX + maxX) / 2, (minY + maxY) / 2, { steps: 4 })
  const boxVisible = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.style.border.includes('dashed')))
  check('B + drag shows the selection rectangle', boxVisible)
  await page.mouse.move(minX, minY, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'edit-box-selected.png') })
  await page.keyboard.press('x')
  await page.waitForTimeout(300)
  st = await editState()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  info = await meshInfo()
  const history = await page.evaluate(() => window.__store.getState().commandStack.history.map((c) => c.label))
  check('box select (B + drag) + X deleted the whole mesh', info.faces === 0, `${JSON.stringify(info)} status=${st?.status} box=${[minX, minY, maxX, maxY].map(Math.round)} history=${history.join(' > ')}`)

  // ---------- Object mode undo: each edit session is one step ----------
  await page.keyboard.press(`${MOD}+z`)
  await page.waitForTimeout(300)
  info = await meshInfo()
  check('Ctrl+Z outside Edit Mode undoes session B in one step', info.faces === 14, JSON.stringify(info))
  await page.keyboard.press(`${MOD}+z`)
  await page.waitForTimeout(300)
  info = await meshInfo()
  check('Ctrl+Z undoes session A in one step', info.faces === 6, JSON.stringify(info))
  await page.keyboard.press(`${MOD}+z`)
  await page.waitForTimeout(300)
  info = await meshInfo()
  check('Ctrl+Z undoes Convert (MeshRenderer back)', !info.editable && info.meshRenderer, JSON.stringify(info))
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(`${MOD}+y`)
    await page.waitForTimeout(250)
  }
  info = await meshInfo()
  check('Ctrl+Y redoes all three', info.editable && info.faces === 0, JSON.stringify(info))

  // ---------- Ctrl+S while editing commits first ----------
  await page.keyboard.press(`${MOD}+z`) // back to 14 faces
  await page.waitForTimeout(250)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  await page.keyboard.press('3')
  await page.mouse.click(topCenter.x, topCenter.y)
  await page.keyboard.press('e')
  await page.waitForTimeout(300)
  const beforeSave = await editState()
  console.log(`  before save: ${JSON.stringify(beforeSave)} scenePath=${await page.evaluate(() => window.__store.getState().currentScenePath)}`)
  await page.keyboard.press(`${MOD}+s`)
  await page.waitForTimeout(800)
  st = await editState()
  const saved = JSON.parse(fs.readFileSync(path.join(project, 'scenes/Main.lscene'), 'utf8'))
  const comp = saved.entities.find((e) => e.id === 'block')?.components.find((c) => c.type === 'EditableMesh')
  const savedFaces = await page.evaluate((m) => { const r = window.__decode(m); return r.ok ? r.value.faceCount : r.message }, comp?.data.mesh)
  check('Ctrl+S in Edit Mode commits, leaves Edit Mode and saves the edited mesh', st === null && savedFaces === 18, `faces in file: ${savedFaces}`)

  // ---------- Modifiers: evaluated by the editor's geometry worker, cached on the component ----------
  const before = await meshInfo()
  await page.evaluate(() => window.__store.getState().world.setProperty('block', 'EditableMesh', 'modifiers', [{ type: 'subdivision', levels: 1 }]))
  await page.waitForFunction(() => !!window.__store.getState().world.getEntity('block').getComponent('EditableMesh').modifierCache, null, { timeout: 30000 })
  const cache = await page.evaluate(() => {
    const c = window.__store.getState().world.getEntity('block').getComponent('EditableMesh')
    const r = window.__decode(c.modifierCache.mesh)
    return { key: c.modifierCache.key, faces: r.ok ? r.value.faceCount : -1 }
  })
  check('Subdivision modifier evaluated in the editor worker and cached', cache.faces === before.faces * 4, `${before.faces} -> ${cache.faces} faces`)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  const editing = await editState()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(600)
  const keyAfter = await page.evaluate(() => window.__store.getState().world.getEntity('block').getComponent('EditableMesh').modifierCache?.key)
  check('Edit Mode in and out without edits keeps the cached modifier result', editing?.entityId === 'block' && keyAfter === cache.key)

  // ---------- Phase 5 hotkey: Ctrl+B bevels every selected edge ----------
  await page.evaluate(() => window.__store.getState().world.setProperty('block', 'EditableMesh', 'modifiers', []))
  const plain = await meshInfo()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  // The mesh has zero-length edges from an extrude that was never moved: merge doubles first (Alt+M), as in Blender
  await page.keyboard.press('1')
  await page.keyboard.press('a')
  await page.keyboard.press('Alt+m')
  await page.waitForTimeout(300)
  await page.keyboard.press('2')
  await page.keyboard.press('a')
  await page.keyboard.press('Control+b')
  await page.waitForTimeout(500)
  const bevelState = await editState()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(500)
  const bevelled = await meshInfo()
  check('Ctrl+B in Edit Mode bevels all selected edges', !bevelState?.status && bevelled.faces > plain.faces, `${plain.faces} -> ${bevelled.faces} faces ${bevelState?.status ?? ''}`)

  // The dev server answers 504 while it re-optimizes dependencies on a cold cache (it then reloads once)
  const realErrors = rendererErrors.filter((m) => !/Outdated Optimize Dep/.test(m))
  check('no renderer errors', realErrors.length === 0, realErrors.join(' | '))
} catch (e) {
  check('e2e run', false, e instanceof Error ? e.stack ?? e.message : String(e))
} finally {
  await app.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(failed ? `\n${failed} check(s) failed (screenshots in ${shots})` : `\nall mesh edit checks passed (screenshots in ${shots})`)
process.exit(failed ? 1 : 0)
