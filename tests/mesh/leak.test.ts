import { beforeAll, describe, expect, it } from 'vitest'
import { makeCube, makeUvSphere } from '../../engine/mesh/core/primitives'
import { liveWasmObjects } from '../../engine/mesh/wasm/WasmScope'
import { linden } from './helpers'

/*
 * 1000-operation leak checks. Besides the per-library live-object counters, the WASM linear memories are
 * captured at instantiation: after warm-up their size must not grow (WASM memory never shrinks, so a
 * leak of any allocation shows up as growth over 1000 iterations).
 */
const memories: WebAssembly.Memory[] = []

function captureMemories(): void {
  const original = WebAssembly.instantiate.bind(WebAssembly) as (...args: unknown[]) => Promise<unknown>
  const patched = async (...args: unknown[]): Promise<unknown> => {
    const result = await original(...args)
    const instance = (result as { instance?: WebAssembly.Instance }).instance ?? (result as WebAssembly.Instance)
    for (const e of Object.values(instance.exports)) if (e instanceof WebAssembly.Memory) memories.push(e)
    return result
  }
  ;(WebAssembly as { instantiate: unknown }).instantiate = patched
}

const memoryBytes = () => memories.reduce((n, m) => n + m.buffer.byteLength, 0)
const ITERATIONS = 1000

beforeAll(() => captureMemories())

describe('no WASM leaks after 1000 operations', () => {
  it('Manifold boolean (success and error paths)', async () => {
    const { booleanMeshes } = await import('../../engine/mesh/boolean/manifoldAdapter')
    const a = linden(makeCube(1))
    const b = linden(makeUvSphere(0.6, 12, 6))
    const open = { positions: a.positions, indices: a.indices.slice(6) }
    const before = memories.length
    for (let i = 0; i < 20; i++) await booleanMeshes(a, b, 'subtract') // warm-up
    expect(memories.length).toBeGreaterThan(before)
    const baseline = memoryBytes()
    for (let i = 0; i < ITERATIONS; i++) {
      const r = await booleanMeshes(a, b, i % 3 === 0 ? 'union' : i % 3 === 1 ? 'subtract' : 'intersect')
      expect(r.ok).toBe(true)
      const bad = await booleanMeshes(a, open, 'union')
      expect(bad.ok).toBe(false)
    }
    expect(liveWasmObjects('manifold')).toBe(0)
    expect(memoryBytes()).toBe(baseline)
  }, 60_000)

  it('Draco encode/decode', async () => {
    const { exportGlb, importGltf } = await import('../../engine/mesh/io/gltf')
    // Large enough that leaking one encoder mesh per iteration outgrows the heap's initial headroom
    const m = linden(makeUvSphere(1, 64, 32))
    const before = memories.length
    for (let i = 0; i < 20; i++) {
      const g = await exportGlb(m, { draco: true })
      if (g.ok) await importGltf(g.value)
    }
    expect(memories.length).toBe(before + 2) // encoder + decoder
    const baseline = memoryBytes()
    for (let i = 0; i < ITERATIONS; i++) {
      const glb = await exportGlb(m, { draco: true })
      expect(glb.ok).toBe(true)
      if (!glb.ok) return
      const back = await importGltf(glb.value)
      expect(back.ok).toBe(true)
    }
    expect(liveWasmObjects('draco')).toBe(0)
    expect(memoryBytes()).toBe(baseline)
  }, 60_000)

  it('meshoptimizer simplify', async () => {
    const { simplifyMesh } = await import('../../engine/mesh/optimize/meshoptAdapter')
    const m = linden(makeUvSphere(1, 24, 12))
    const before = memories.length
    for (let i = 0; i < 20; i++) await simplifyMesh(m, 0.5, 0.01)
    expect(memories.length).toBeGreaterThan(before)
    const baseline = memoryBytes()
    for (let i = 0; i < ITERATIONS; i++) expect((await simplifyMesh(m, 0.5, 0.01)).ok).toBe(true)
    expect(memoryBytes()).toBe(baseline)
  }, 60_000)

  it('OpenSubdiv subdivide', async () => {
    const { subdivideMesh } = await import('../../engine/mesh/subdiv/opensubdivAdapter')
    const { editablePrimitive } = await import('../../engine/mesh/core/editablePrimitives')
    const cage = editablePrimitive('cylinder') // n-gons + uvs (face-varying path)
    const before = memories.length
    for (let i = 0; i < 20; i++) await subdivideMesh(cage, 2, 'catmull-clark')
    expect(memories.length).toBeGreaterThan(before)
    const baseline = memoryBytes()
    for (let i = 0; i < ITERATIONS; i++) {
      const r = await subdivideMesh(cage, 2, 'catmull-clark')
      expect(r.ok).toBe(true)
      expect((await subdivideMesh(cage, 1, 'loop')).ok).toBe(false) // error path
    }
    expect(memoryBytes()).toBe(baseline)
  }, 60_000)

  it('Geogram smooth / repair / unwrap', async () => {
    const g = await import('../../engine/mesh/uv/geogramAdapter')
    const m = linden(makeUvSphere(1, 16, 8))
    const before = memories.length
    for (let i = 0; i < 20; i++) {
      await g.smooth(m, 2)
      await g.repair(m)
      await g.unwrapUV(m, 'lscm')
    }
    expect(memories.length).toBeGreaterThan(before)
    const baseline = memoryBytes()
    for (let i = 0; i < ITERATIONS; i++) {
      expect((await g.smooth(m, 2)).ok).toBe(true)
      expect((await g.repair(m)).ok).toBe(true)
      if (i % 10 === 0) expect((await g.unwrapUV(m, 'lscm')).ok).toBe(true)
    }
    expect(memoryBytes()).toBe(baseline)
  }, 120_000)

  it('all tracked objects were released', () => {
    expect(liveWasmObjects()).toBe(0)
  })
})
