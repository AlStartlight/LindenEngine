import { describe, expect, it } from 'vitest'
import { generateLODs, optimizeVertexCache, simplifyMesh } from '../../engine/mesh/optimize/meshoptAdapter'
import { makeCube, makeUvSphere } from '../../engine/mesh/core/primitives'
import { validateLindenMesh, type LindenMesh } from '../../engine/mesh/core/LindenMesh'
import { bbox, linden, maxDeviation } from './helpers'

const sphere = () => linden(makeUvSphere(1, 64, 32)) // 4032 triangles
const tris = (m: LindenMesh) => m.indices.length / 3

describe('meshoptimizer simplify', () => {
  it('reduces a sphere to 50% with the error under the threshold', async () => {
    const input = sphere()
    const maxError = 0.01
    const r = await simplifyMesh(input, 0.5, maxError)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { mesh, error, absoluteError } = r.value
    expect(tris(mesh)).toBeLessThanOrEqual(tris(input) / 2)
    expect(tris(mesh)).toBeGreaterThan(tris(input) / 2 - 50)
    expect(error).toBeLessThanOrEqual(maxError)
    expect(validateLindenMesh(mesh).ok).toBe(true)
    // Independent measurement (one-sided Hausdorff, original vertices -> simplified surface), relative to
    // the extents meshopt uses (2 for a unit sphere). This is the real contract: it must stay under maxError.
    const measured = maxDeviation(input, mesh)
    expect(measured / 2).toBeLessThanOrEqual(maxError)
    // meshopt's reported error is a quadric estimate, not a bound; it is close but can be lower
    expect(measured).toBeLessThan(absoluteError * 2)
  })

  it('the error bound wins over the ratio', async () => {
    const input = sphere()
    const r = await simplifyMesh(input, 0.05, 0.001)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.error).toBeLessThanOrEqual(0.001)
    expect(tris(r.value.mesh)).toBeGreaterThan(tris(input) * 0.05)
  })

  it('drops unused vertices and keeps attribute arrays aligned', async () => {
    const m = sphere()
    const nv = m.positions.length / 3
    m.normals = new Float32Array(m.positions)
    m.uvs = new Float32Array(nv * 2).map((_, i) => (i % 2 ? m.positions[(i >> 1) * 3 + 1] : m.positions[(i >> 1) * 3]))
    const r = await simplifyMesh(m, 0.25, 0.05)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const out = r.value.mesh
    const outNv = out.positions.length / 3
    expect(outNv).toBeLessThan(nv)
    expect(out.normals!.length).toBe(outNv * 3)
    expect(out.uvs!.length).toBe(outNv * 2)
    const used = new Set(out.indices)
    expect(used.size).toBe(outNv)
    // Attributes still belong to their vertex
    for (let i = 0; i < outNv; i++) expect(out.normals![i * 3]).toBeCloseTo(out.positions[i * 3], 6)
  })

  it('a cube cannot lose triangles without error', async () => {
    const r = await simplifyMesh(linden(makeCube()), 0.5, 0)
    expect(r.ok && tris(r.value.mesh)).toBe(12)
  })

  it('rejects bad parameters and empty meshes with typed errors', async () => {
    const m = sphere()
    for (const [ratio, e] of [[0, 0.01], [1.5, 0.01], [NaN, 0.01], [0.5, -1]]) {
      const r = await simplifyMesh(m, ratio, e)
      expect(r.ok || r.code).toBe('INVALID_MESH')
    }
    const empty = await simplifyMesh({ positions: new Float32Array(0), indices: new Uint32Array(0) }, 0.5, 0.01)
    expect(empty.ok || empty.code).toBe('EMPTY_MESH')
  })

  it('degenerate triangles and duplicate vertices do not break it', async () => {
    const m = sphere()
    const extra = new Uint32Array(m.indices.length + 6)
    extra.set(m.indices)
    extra.set([0, 0, 1, 5, 5, 5], m.indices.length)
    const r = await simplifyMesh({ positions: m.positions, indices: extra }, 0.5, 0.01)
    expect(r.ok).toBe(true)
  })
})

describe('meshoptimizer LODs and vertex cache', () => {
  it('generateLODs returns one mesh per ratio with decreasing size', async () => {
    const r = await generateLODs(sphere(), [0.5, 0.25, 0.1])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const counts = r.value.map(tris)
    expect(counts).toHaveLength(3)
    expect(counts[0]).toBeGreaterThan(counts[1])
    expect(counts[1]).toBeGreaterThan(counts[2])
    for (const lod of r.value) {
      const b = bbox(lod.positions)
      expect(b.max[1]).toBeGreaterThan(0.9)
    }
  })

  it('optimizeVertexCache keeps the same triangles', async () => {
    const m = sphere()
    const r = await optimizeVertexCache(m)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const key = (mesh: LindenMesh, t: number) => {
      const corners = [0, 1, 2].map((k) => Array.from(mesh.positions.subarray(mesh.indices[t + k] * 3, mesh.indices[t + k] * 3 + 3)).join(','))
      const start = corners.indexOf([...corners].sort()[0])
      return [0, 1, 2].map((k) => corners[(start + k) % 3]).join('|')
    }
    const before = new Set<string>()
    for (let t = 0; t < m.indices.length; t += 3) before.add(key(m, t))
    const after = new Set<string>()
    for (let t = 0; t < r.value.indices.length; t += 3) after.add(key(r.value, t))
    expect(after).toEqual(before)
    expect(r.value.positions.length).toBe(m.positions.length)
  })
})
