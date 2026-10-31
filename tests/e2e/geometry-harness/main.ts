// Built by tests/e2e/geometryWorker.e2e.mjs and loaded over file:// in Electron, like the packaged editor
import { toLindenMesh } from '../../../engine/mesh/core/convert'
import { makeCube, makeUvSphere } from '../../../engine/mesh/core/primitives'
import { createGeometryOps } from '../../../engine/mesh/worker/createGeometryOps'

interface Check {
  name: string
  ok: boolean
  detail: string
}

// The e2e script checks lazy loading between prepare() and run(), reading the worker's own resource timeline
// through Playwright before dispose() terminates it
let ops: ReturnType<typeof createGeometryOps> | null = null

function prepare(): boolean {
  ops = createGeometryOps()
  return ops.started
}

async function run(): Promise<Check[]> {
  const checks: Check[] = []
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail })
  if (!ops) throw new Error('prepare() first')

  const ping = await ops.call('ping')
  check('ping through a real module worker', ping.ok && ping.value === 'pong', JSON.stringify(ping))

  const cube = toLindenMesh(makeCube(1), { polygons: false })
  const sphere = toLindenMesh(makeUvSphere(0.6, 32, 16), { polygons: false })
  const t0 = performance.now()
  const diff = await ops.boolean(cube, sphere, 'subtract')
  check('boolean (Manifold WASM) in worker', diff.ok && diff.value.indices.length > 0,
    diff.ok ? `${diff.value.indices.length / 3} tris in ${(performance.now() - t0).toFixed(0)} ms` : `${diff.code}: ${diff.message}`)
  check('caller mesh still usable (copy ownership)', cube.positions.byteLength > 0)

  const bad = await ops.boolean(cube, { positions: cube.positions, indices: cube.indices.slice(6) }, 'union')
  check('typed NON_MANIFOLD_INPUT error', !bad.ok && bad.code === 'NON_MANIFOLD_INPUT', bad.ok ? 'unexpected ok' : bad.message)

  const simp = await ops.simplify(toLindenMesh(makeUvSphere(1, 64, 32), { polygons: false }), 0.5, 0.01)
  check('simplify (meshoptimizer WASM) in worker', simp.ok, simp.ok ? `${simp.value.indices.length / 3} tris` : simp.message)

  const glb = await ops.exportGlb(sphere, { draco: true })
  check('Draco encode in worker (bundled CommonJS + wasmBinary)', glb.ok, glb.ok ? `${glb.value.byteLength} bytes` : glb.message)
  if (glb.ok) {
    const back = await ops.importGltf(glb.value)
    check('Draco decode in worker', back.ok && back.value.mesh.indices.length === sphere.indices.length,
      back.ok ? `${back.value.mesh.indices.length / 3} tris` : back.message)
  }
  return checks
}

function dispose(): void {
  ops?.dispose()
}

;(window as unknown as { geometrySmoke: { prepare: typeof prepare; run: typeof run; dispose: typeof dispose } }).geometrySmoke = { prepare, run, dispose }
