// E2E: an img2threejs factory (models/*.ts) as a Linden Model in the real Electron app.
// linden_model_build measures it in a hidden window (bake, fit), linden_render_preview renders it
// through the player runtime, headless linden_play drops it on the floor with the baked collider,
// linden_img2_run packages a comparison sheet, linden_model_bake_glb writes a GLB, and the web
// export ships the compiled factory.
//   npm run test:e2e:img2threejs   (optional skill, enabled with LINDEN_IMG2THREEJS=1)
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-img2-e2e-'))
const project = path.join(work, 'Img2')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

fs.mkdirSync(path.join(project, 'scenes'), { recursive: true })
fs.mkdirSync(path.join(project, 'models', 'mug'), { recursive: true })
fs.mkdirSync(path.join(project, 'references'), { recursive: true })
fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'Img2', scenesInBuild: ['scenes/Main.lscene'] }))
fs.copyFileSync(path.join(repo, 'tests/fixtures/img2threejs/createCeramicMugModel.ts'), path.join(project, 'models/mug/createCeramicMugModel.ts'))
fs.copyFileSync(path.join(repo, 'tests/fixtures/img2threejs/mug.png'), path.join(project, 'references/mug.png'))
fs.writeFileSync(
  path.join(project, 'scenes/Main.lscene'),
  JSON.stringify({
    format: 'linden-scene',
    version: 2,
    name: 'Main',
    settings: { environment: 'room' },
    entities: [
      {
        id: 'floor',
        name: 'Floor',
        active: true,
        static: true,
        tags: [],
        layer: 0,
        parentId: null,
        components: [
          { type: 'Transform', data: { position: [0, -0.05, 0], rotation: [0, 0, 0], scale: [4, 0.1, 4] } },
          { type: 'MeshRenderer', data: { primitive: 'cube', color: '#64748b' } },
          { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } },
        ],
      },
    ],
  })
)

const app = await electron.launch({
  args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`],
  // img2threejs is off by default (electron/agent/features.ts); this test covers the optional mode
  env: { ...process.env, LINDEN_E2E: '1', LINDEN_IMG2THREEJS: '1' },
})
const runTool = (name, args) => app.evaluate(async (_electron, a) => globalThis.__lindenRunTool(a.project, a.name, a.args), { project, name, args })

try {
  for (let i = 0; i < 100 && !(await app.evaluate(() => typeof globalThis.__lindenRunTool === 'function')); i++) await new Promise((r) => setTimeout(r, 100))

  // 1. Place and measure the factory
  const build = await runTool('linden_model_build', {
    name: 'Mug',
    entityId: 'mug',
    position: [0, 0, 0],
    model: { factory: 'models/mug/createCeramicMugModel.ts', category: 'mug', collider: 'compound' },
    meshesOut: '.linden/img2threejs/mug/meshes.json',
  })
  check('model_build with factory succeeds', build.success, build.error ?? JSON.stringify(build.data?.validation?.fit))
  if (build.success) {
    const v = build.data.validation
    check('fit from the mug category (height 0.095 m)', v.fit.basis === 'category' && Math.abs(v.size[1] - 0.095) < 0.002, JSON.stringify(v.size))
    check('two meshes, triangles counted', build.data.stats.meshes === 2 && build.data.stats.triangles > 100, JSON.stringify(build.data.stats))
    const scene = JSON.parse(fs.readFileSync(path.join(project, 'scenes/Main.lscene'), 'utf-8'))
    const model = scene.entities.find((e) => e.id === 'mug').components.find((c) => c.type === 'Model').data
    check('bake has boxes and a hull', model.bake.boxes.length === 2 && model.bake.hull.length >= 30, `${model.bake.boxes.length} boxes, ${model.bake.hull.length / 3} hull points`)
    check('resting on the floor', Math.abs(model.bounds[0][1]) < 1e-4, JSON.stringify(model.bounds))
    const meshes = JSON.parse(fs.readFileSync(path.join(project, '.linden/img2threejs/mug/meshes.json'), 'utf-8')).meshes
    check('meshes.json written for self_intersection', meshes.length === 2 && meshes[0].vertices.length > 10)
  }

  // 2. Render it through the player runtime
  const preview = await runTool('linden_render_preview', { entityId: 'mug', views: ['front', 'threeQuarter'], size: 384 })
  check('render_preview of the factory model', preview.success, preview.error ?? `${preview.data?.triangles} tris, size ${JSON.stringify(preview.data?.size)}`)
  if (preview.success) {
    const sizes = preview.images.map((i) => Buffer.from(i.data, 'base64').length)
    check('preview frames have content', sizes.every((n) => n > 8_000), sizes.join(', '))
    if (process.env.E2E_OUT) {
      fs.mkdirSync(process.env.E2E_OUT, { recursive: true })
      for (const img of preview.images) fs.writeFileSync(path.join(process.env.E2E_OUT, `mug-${img.label}.png`), Buffer.from(img.data, 'base64'))
    }
    check('no factory warnings in the preview', !(preview.data.warnings ?? []).some((w) => /Factory/.test(w)), JSON.stringify(preview.data.warnings))
    check('preview size matches the fit', Math.abs(preview.data.size[1] - 0.095) < 0.01, JSON.stringify(preview.data.size))
  }

  // 3. Headless physics with the baked collider: the mug falls onto the floor and stays there
  const scenePath = path.join(project, 'scenes/Main.lscene')
  const scene = JSON.parse(fs.readFileSync(scenePath, 'utf-8'))
  const mug = scene.entities.find((e) => e.id === 'mug')
  mug.components.find((c) => c.type === 'Transform').data.position = [0, 0.5, 0]
  mug.components.push({ type: 'Rigidbody', data: { bodyType: 'dynamic', mass: 0.35 } })
  mug.static = false
  fs.writeFileSync(scenePath, JSON.stringify(scene))
  const play = await runTool('linden_play', { scenePath: 'scenes/Main.lscene', durationSeconds: 2 })
  const finalY = play.data?.finalPositions?.Mug?.[1]
  check('linden_play runs without errors', play.success && play.data.errors.length === 0, play.error ?? JSON.stringify({ errors: play.data?.errors, warnings: play.data?.warnings }))
  check('no stale-bake warning', play.success && !play.data.warnings.some((w) => /factory/i.test(w)), JSON.stringify(play.data?.warnings))
  check('mug rests on the floor (baked compound collider)', typeof finalY === 'number' && finalY > -0.05 && finalY < 0.1, `y=${finalY}`)

  // 4. Comparison sheet from the preview (needs Python >= 3.10)
  const status = await runTool('linden_img2_status', {})
  if (!status.data?.ready) console.log(`SKIP comparison sheet: ${status.data?.pythonError}`)
  else {
    const sheet = await runTool('linden_img2_run', {
      job: 'mug',
      script: 'stage4_review/make_comparison_sheet.py',
      args: ['--reference', 'references/mug.png', '--render', '.linden/previews/mug-front.png', '--out', 'cmp.png', '--json'],
    })
    check('comparison sheet from reference + Linden render', sheet.success && sheet.data.exitCode === 0 && sheet.images?.length === 1, sheet.error ?? sheet.data?.stderr?.slice(-300))
    if (process.env.E2E_OUT && sheet.images?.[0]) fs.writeFileSync(path.join(process.env.E2E_OUT, 'cmp.png'), Buffer.from(sheet.images[0].data, 'base64'))
  }

  // 5. Bake to GLB
  const glb = await runTool('linden_model_bake_glb', { entityId: 'mug' })
  check('bake GLB', glb.success, glb.error ?? `${glb.data?.bytes} bytes`)
  if (glb.success) {
    const buf = fs.readFileSync(path.join(project, glb.data.path))
    check('GLB file is valid glTF binary', buf.readUInt32LE(0) === 0x46546c67 && buf.readUInt32LE(8) === buf.length)
    const inspect = await runTool('linden_asset_import', { source: glb.data.path })
    check('GLB measures like the Model (meters, on the floor)', inspect.success && Math.abs(inspect.data.size[1] - 0.095) < 0.01, JSON.stringify(inspect.data?.size ?? inspect.error))
  }

  // 6. Web export ships the compiled factory
  const exp = await runTool('linden_export_web', {})
  const outDir = exp.data?.outputPath && (exp.data.outputPath.endsWith('.html') ? path.dirname(exp.data.outputPath) : exp.data.outputPath)
  const shipped = outDir && fs.existsSync(path.join(outDir, 'game-models/mug/createCeramicMugModel.js'))
  check('web export contains game-models/mug/createCeramicMugModel.js', exp.success && !!shipped, exp.error ?? outDir)
  check('web export does not ship the factory source', exp.success && outDir && !fs.existsSync(path.join(outDir, 'models')))

  // 7. Editor viewport: the factory runs in the sandboxed probe and arrives as GLB; importing it
  //    into the editor renderer is impossible (needs `npm run dev`)
  const devUp = await fetch('http://127.0.0.1:5173').then((r) => r.ok, () => false)
  if (!devUp) console.log('SKIP editor viewport (start `npm run dev` to include it)')
  else {
    // Big enough to see from the editor's default camera
    const sc = JSON.parse(fs.readFileSync(scenePath, 'utf-8'))
    const t = sc.entities.find((e) => e.id === 'mug').components.find((c) => c.type === 'Transform').data
    t.position = [0, 0, 0]
    t.scale = [8, 8, 8]
    fs.writeFileSync(scenePath, JSON.stringify(sc))
    let page = null
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? null
      if (!page) await new Promise((r) => setTimeout(r, 200))
    }
    const errors = []
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()))
    await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 30000 })
    await page.evaluate((p) => window.electronAPI.addRecentProject({ name: 'Img2', path: p, lastOpened: Date.now() }), project)
    await page.reload()
    await page.waitForFunction(() => !!window.electronAPI)
    await page.waitForTimeout(1500)
    await page.getByText('Img2', { exact: true }).first().click()
    await page.waitForTimeout(6000)
    const body = await page.evaluate(() => document.body.innerText)
    const factoryErrors = [...errors, ...body.split('\n')].filter((t) => /Factory|game-models|Content Security Policy|linden-asset/i.test(t))
    check('editor: factory model loads in the viewport without errors', factoryErrors.length === 0, factoryErrors.slice(0, 3).join(' | '))
    // Security: project factory code never runs in the editor renderer (it holds electronAPI)
    const imported = await page.evaluate(async () => {
      try {
        await import('linden-asset://project/game-models/mug/createCeramicMugModel.js')
        return 'imported'
      } catch (e) {
        return `blocked: ${String(e?.message ?? e).slice(0, 80)}`
      }
    })
    check('editor: factory module cannot be imported into the editor renderer', imported.startsWith('blocked'), imported)
    const ranHere = await page.evaluate(() => typeof globalThis.__LINDEN_THREE__ !== 'undefined')
    check('editor: no factory ran in the editor renderer (__LINDEN_THREE__ unset)', !ranHere)
    const previews = fs.readdirSync(path.join(work, 'userData', 'factory-previews')).filter((f) => f.endsWith('.glb'))
    check('editor: factory output came from the sandboxed probe as GLB', previews.length >= 1, previews.join(', '))
    if (process.env.E2E_OUT) {
      await page.screenshot({ path: path.join(process.env.E2E_OUT, 'editor-full.png') })
      await page.locator('canvas').first().screenshot({ path: path.join(process.env.E2E_OUT, 'editor-viewport.png') })
    }
  }
} catch (err) {
  check('no exception', false, err?.stack ?? String(err))
} finally {
  await app.close().catch(() => {})
  fs.rmSync(work, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
