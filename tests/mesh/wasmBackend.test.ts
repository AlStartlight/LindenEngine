import { describe, expect, it } from 'vitest'
import { makeCube, makeUvSphere } from '../../engine/mesh/core/primitives'
import { createGeometryHandler } from '../../engine/mesh/worker/handler'
import { createWasmBackend } from '../../engine/mesh/worker/wasmBackend'
import { WorkerGeometryOps, type WorkerLike } from '../../engine/mesh/worker/WorkerGeometryOps'
import { isClosedManifold, linden } from './helpers'

/** Same in-process worker as worker.test.ts, wired to the real WASM backend */
class WasmFakeWorker implements WorkerLike {
  private listeners: ((e: { data: unknown }) => void)[] = []
  private handle = createGeometryHandler(createWasmBackend())

  postMessage(message: unknown, transfer: Transferable[]): void {
    const cloned = structuredClone(message, { transfer })
    void this.handle(cloned).then(({ response, transfer: back }) => {
      const reply = structuredClone(response, { transfer: back })
      this.listeners.forEach((l) => l({ data: reply }))
    })
  }

  addEventListener(type: 'message' | 'error', listener: (e: never) => void): void {
    if (type === 'message') this.listeners.push(listener as (e: { data: unknown }) => void)
  }

  terminate(): void {}
}

describe('geometry worker with the WASM backend', () => {
  const ops = new WorkerGeometryOps(() => new WasmFakeWorker())

  it('boolean through the worker protocol', async () => {
    const r = await ops.boolean(linden(makeCube(1)), linden(makeUvSphere(0.6)), 'subtract')
    expect(r.ok).toBe(true)
    if (r.ok) expect(isClosedManifold(r.value)).toBe(true)
  })

  it('typed errors cross the worker boundary intact', async () => {
    const r = await ops.subdivide(makeCube(), 1, 'loop')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_TOPOLOGY')
  })

  it('simplify, LODs and vertex-cache optimisation', async () => {
    const s = linden(makeUvSphere(1, 48, 24))
    const simplified = await ops.simplify(s, 0.5, 0.01)
    expect(simplified.ok && simplified.value.indices.length).toBeLessThanOrEqual(s.indices.length / 2)
    const lods = await ops.generateLODs(s, [0.5, 0.2])
    expect(lods.ok && lods.value.length).toBe(2)
    const opt = await ops.optimizeVertexCache(s)
    expect(opt.ok && opt.value.indices.length).toBe(s.indices.length)
  })

  it('GLB export with Draco and import round trip', async () => {
    const s = linden(makeUvSphere(1, 32, 16))
    const glb = await ops.exportGlb(s, { draco: true })
    expect(glb.ok).toBe(true)
    if (!glb.ok) return
    const back = await ops.importGltf(glb.value)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.value.mesh.indices.length).toBe(s.indices.length)
  })

  it('subdivide (OpenSubdiv) through the worker: cube level 2 = 96 quads', async () => {
    const r = await ops.subdivide(makeCube(), 2, 'catmull-clark')
    expect(r.ok && r.value.faceCount).toBe(96)
  })

  it('unwrapUV, smooth, remesh and repair (Geogram) through the worker', async () => {
    const s = linden(makeUvSphere(1, 24, 12))
    const uv = await ops.unwrapUV(s, 'abf')
    expect(uv.ok && uv.value.uvs!.length).toBe(uv.ok ? (uv.value.positions.length / 3) * 2 : -1)
    expect((await ops.smooth(s, 2)).ok).toBe(true)
    expect((await ops.remesh(s, 150)).ok).toBe(true)
    expect((await ops.repair(s)).ok).toBe(true)
  })

  it('boolean auto-repairs a non-manifold input through Geogram', async () => {
    const cube = linden(makeCube(1))
    const r = await ops.boolean({ positions: cube.positions, indices: cube.indices.slice(6) }, linden(makeUvSphere(0.6)), 'subtract')
    expect(r.ok).toBe(true)
    if (r.ok) expect(isClosedManifold(r.value)).toBe(true)
  })
})
