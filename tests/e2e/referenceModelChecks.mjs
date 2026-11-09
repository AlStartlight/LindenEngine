// Shared checks: rebuild an object from a reference image with Linden's own tools (img2threejs off).
// Used by referenceModel.e2e.mjs (dev build) and packagedReferenceModel.e2e.mjs (packaged app).
import fs from 'node:fs'
import path from 'node:path'

export function makeProject(repo, project) {
  fs.mkdirSync(path.join(project, 'scenes'), { recursive: true })
  fs.mkdirSync(path.join(project, 'references'), { recursive: true })
  fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'Ref', scenesInBuild: ['scenes/Main.lscene'] }))
  fs.writeFileSync(path.join(project, 'scenes/Main.lscene'), JSON.stringify({ format: 'linden-scene', version: 2, name: 'Main', entities: [] }))
  // As the agent panel saves an attachment
  fs.copyFileSync(path.join(repo, 'tests/fixtures/img2threejs/mug.png'), path.join(project, 'references/stool.png'))
}

export async function runChecks({ app, repo, project, check }) {
  for (let i = 0; i < 150 && !(await app.evaluate(() => typeof globalThis.__lindenRunTool === 'function')); i++) await new Promise((r) => setTimeout(r, 100))
  const runTool = (name, args) => app.evaluate(async (_e, a) => globalThis.__lindenRunTool(a.project, a.name, a.args), { project, name, args })

  // img2threejs is off: none of its tools reach the agent, the prompt does not mention it
  const names = await app.evaluate(() => globalThis.__lindenToolNames())
  check('img2threejs tools are not registered', !names.some((n) => n.startsWith('linden_img2_')), names.filter((n) => n.startsWith('linden_img2_')).join(', '))
  check('reference tools are registered', names.includes('linden_reference_view') && names.includes('linden_factory_write'))

  // 1. The attached image is visible to the agent
  const list = await runTool('linden_reference_view', {})
  check('reference_view lists references/', list.success && JSON.stringify(list.data.references) === '["references/stool.png"]', JSON.stringify(list.data ?? list.error))
  const ref = await runTool('linden_reference_view', { reference: 'references/stool.png' })
  check('reference_view returns the image', ref.success && ref.images?.length === 1 && ref.images[0].mimeType === 'image/png', ref.error)
  const escape = await runTool('linden_reference_view', { reference: '../../etc/passwd' })
  check('reference_view refuses paths outside references/ and assets/', !escape.success)

  // 2. The agent writes its own three.js factory (with an addon) and it compiles
  const content = fs.readFileSync(path.join(repo, 'tests/fixtures/reference-model/createStoolModel.ts'), 'utf-8')
  const bad = await runTool('linden_factory_write', { path: 'models/stool/createStoolModel.ts', content: content.replace('new THREE.Group()', 'new THREE.Group(') })
  check('factory_write reports compile errors', !bad.success && /Kompilasi factory gagal/.test(bad.error ?? ''), bad.error?.slice(0, 120))
  const outside = await runTool('linden_factory_write', { path: 'scripts/evil.ts', content })
  check('factory_write only writes models/**.ts', !outside.success)
  const write = await runTool('linden_factory_write', { path: 'models/stool/createStoolModel.ts', content })
  check('factory_write writes and compiles the factory', write.success, write.error)

  // 3. Place, measure (sandboxed probe), render, compare
  const build = await runTool('linden_model_build', { name: 'Stool', entityId: 'stool', model: { factory: 'models/stool/createStoolModel.ts', fitHeight: 0.65, placement: 'floor', collider: 'compound' } })
  check('model_build measures the hand-written factory', build.success && Math.abs(build.data.validation.size[1] - 0.65) < 0.01, build.error ?? JSON.stringify(build.data?.validation?.size))
  if (build.success) {
    const scene = JSON.parse(fs.readFileSync(path.join(project, 'scenes/Main.lscene'), 'utf-8'))
    const model = scene.entities.find((e) => e.id === 'stool').components.find((c) => c.type === 'Model').data
    check('one compound box per declared collider, socket found', model.bake.boxes.length === 5 && JSON.stringify(build.data.stats.sockets) === '["cushionTop"]', JSON.stringify({ boxes: model.bake.boxes.length, sockets: build.data.stats.sockets }))
  }
  const preview = await runTool('linden_render_preview', { entityId: 'stool', views: ['front', 'threeQuarter'], size: 256 })
  check('render_preview of the factory', preview.success && preview.images?.length === 2, preview.error)
  const cmp = await runTool('linden_reference_view', { reference: 'references/stool.png', entityId: 'stool', views: ['front', 'threeQuarter', 'top'] })
  check(
    'reference_view shows reference + renders, and names the missing view',
    cmp.success && cmp.images?.length === 3 && JSON.stringify(cmp.data.missingViews) === '["top"]',
    cmp.error ?? JSON.stringify({ n: cmp.images?.length, missing: cmp.data?.missingViews })
  )

  // 4. Physics with the baked colliders, GLB bake
  const scenePath = path.join(project, 'scenes/Main.lscene')
  const scene = JSON.parse(fs.readFileSync(scenePath, 'utf-8'))
  scene.entities.push({
    id: 'floor', name: 'Floor', active: true, static: true, tags: [], layer: 0, parentId: null,
    components: [
      { type: 'Transform', data: { position: [0, -0.05, 0], rotation: [0, 0, 0], scale: [4, 0.1, 4] } },
      { type: 'MeshRenderer', data: { primitive: 'cube', color: '#64748b' } },
      { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } },
    ],
  })
  const stool = scene.entities.find((e) => e.id === 'stool')
  stool.static = false
  stool.components.find((c) => c.type === 'Transform').data.position = [0, 0.5, 0]
  stool.components.push({ type: 'Rigidbody', data: { bodyType: 'dynamic', mass: 4 } })
  fs.writeFileSync(scenePath, JSON.stringify(scene))
  const play = await runTool('linden_play', { scenePath: 'scenes/Main.lscene', durationSeconds: 2 })
  const y = play.data?.finalPositions?.Stool?.[1]
  check('stool falls and rests on the floor', play.success && play.data.errors.length === 0 && typeof y === 'number' && y > -0.05 && y < 0.1, play.error ?? `y=${y} ${JSON.stringify(play.data?.errors)}`)
  const glb = await runTool('linden_model_bake_glb', { entityId: 'stool' })
  check('bake the factory to GLB', glb.success, glb.error)

  // 5. The editor protocol never serves factory modules
  const served = await app.evaluate(async ({ net }) => {
    try {
      return (await net.fetch('linden-asset://project/game-models/stool/createStoolModel.js')).status
    } catch (e) {
      return `error ${e?.message ?? e}`
    }
  })
  check('linden-asset:// does not serve compiled factories', served !== 200, String(served))
  return { runTool }
}
