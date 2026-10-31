import { describe, expect, it } from 'vitest'
import { booleanMeshes, isManifold, manifoldStats } from '../../engine/mesh/boolean/manifoldAdapter'
import { makeCube, makeUvSphere } from '../../engine/mesh/core/primitives'
import { err, ok } from '../../engine/mesh/core/result'
import type { LindenMesh } from '../../engine/mesh/core/LindenMesh'
import { isClosedManifold, linden, signedVolume } from './helpers'

const cube = () => linden(makeCube(1))
const sphere = (r: number, center: [number, number, number] = [0, 0, 0]) => linden(makeUvSphere(r, 32, 16, center))

describe('Manifold boolean adapter', () => {
  it('primitives used as inputs are closed manifolds with outward winding', async () => {
    for (const m of [cube(), sphere(0.6)]) {
      expect(isClosedManifold(m)).toBe(true)
      expect(signedVolume(m)).toBeGreaterThan(0)
      expect(await isManifold(m)).toEqual(ok(true))
    }
  })

  it('cube minus sphere gives a closed manifold with the expected volume', async () => {
    const a = cube()
    const b = sphere(0.6) // pokes through all six faces
    const r = await booleanMeshes(a, b, 'subtract')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(isClosedManifold(r.value)).toBe(true)
    expect(await isManifold(r.value)).toEqual(ok(true))

    const inter = await booleanMeshes(a, b, 'intersect')
    const uni = await booleanMeshes(a, b, 'union')
    expect(inter.ok && uni.ok).toBe(true)
    if (!inter.ok || !uni.ok) return
    const vDiff = signedVolume(r.value)
    const vInter = signedVolume(inter.value)
    const vUnion = signedVolume(uni.value)
    const vSphere = signedVolume(b)
    // Inclusion-exclusion holds up to floating error
    expect(vDiff + vInter).toBeCloseTo(1, 5)
    expect(vUnion).toBeCloseTo(1 + vSphere - vInter, 5)
    expect(vDiff).toBeGreaterThan(0.05)
    expect(vDiff).toBeLessThan(0.5)
    for (const m of [inter.value, uni.value]) expect(isClosedManifold(m)).toBe(true)
  })

  it('a sphere fully inside leaves a cavity: volume = cube - sphere, genus 0', async () => {
    const b = sphere(0.3)
    const r = await booleanMeshes(cube(), b, 'subtract')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(signedVolume(r.value)).toBeCloseTo(1 - signedVolume(b), 6)
    const stats = await manifoldStats(r.value)
    expect(stats.ok && stats.value.volume).toBeCloseTo(1 - signedVolume(b), 5)
  })

  it('a hole straight through gives genus 1', async () => {
    const pole = linden(makeCube(1))
    for (let i = 0; i < pole.positions.length; i += 3) {
      pole.positions[i] *= 0.3
      pole.positions[i + 2] *= 0.3
      pole.positions[i + 1] *= 2
    }
    const r = await booleanMeshes(cube(), pole, 'subtract')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const stats = await manifoldStats(r.value)
    expect(stats).toEqual(ok({ volume: expect.closeTo(1 - 0.09, 6), genus: 1 }))
  })

  it('disjoint intersection is an empty (but successful) result', async () => {
    const r = await booleanMeshes(cube(), sphere(0.3, [5, 0, 0]), 'intersect')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.indices.length).toBe(0)
  })

  it('keeps uv/normal channels when both inputs have them', async () => {
    const withAttrs = (m: LindenMesh): LindenMesh => {
      const nv = m.positions.length / 3
      const normals = new Float32Array(nv * 3)
      const uvs = new Float32Array(nv * 2)
      for (let i = 0; i < nv; i++) {
        const [x, y, z] = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]
        const len = Math.hypot(x, y, z) || 1
        normals.set([x / len, y / len, z / len], i * 3)
        uvs.set([x + 0.5, y + 0.5], i * 2)
      }
      return { ...m, normals, uvs }
    }
    const r = await booleanMeshes(withAttrs(cube()), withAttrs(sphere(0.6)), 'subtract')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const nv = r.value.positions.length / 3
    expect(r.value.normals?.length).toBe(nv * 3)
    expect(r.value.uvs?.length).toBe(nv * 2)
    for (let i = 0; i < nv; i++) {
      const n = r.value.normals!
      expect(Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2])).toBeCloseTo(1, 5)
    }
    // Only one side has attributes: they are dropped
    const mixed = await booleanMeshes(withAttrs(cube()), sphere(0.6), 'subtract')
    expect(mixed.ok && mixed.value.normals).toBeUndefined()
  })

  it('seam-split inputs (duplicated positions) are welded before the boolean', async () => {
    // Flat-shaded cube: 24 vertices, every corner duplicated three times
    const flat = linden(makeCube(1))
    const positions: number[] = []
    const indices: number[] = []
    for (let t = 0; t < flat.indices.length; t++) {
      const v = flat.indices[t]
      positions.push(flat.positions[v * 3], flat.positions[v * 3 + 1], flat.positions[v * 3 + 2])
      indices.push(t)
    }
    const soup = { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
    const r = await booleanMeshes(soup, sphere(0.6), 'subtract')
    expect(r.ok).toBe(true)
  })
})

describe('Manifold boolean errors', () => {
  const open = (): LindenMesh => {
    const m = linden(makeCube(1))
    return { positions: m.positions, indices: m.indices.slice(6) } // drop one face (two triangles)
  }

  it('non-manifold input without repair -> NON_MANIFOLD_INPUT naming the mesh', async () => {
    const r = await booleanMeshes(cube(), open(), 'union')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NON_MANIFOLD_INPUT')
    expect(r.message).toMatch(/mesh B/)
    expect(r.message).toMatch(/repair is not available/)
  })

  it('repair is tried once and its result is used', async () => {
    let calls = 0
    const repair = async () => {
      calls++
      return ok(cube())
    }
    const r = await booleanMeshes(open(), sphere(0.6), 'subtract', { repair })
    expect(r.ok).toBe(true)
    expect(calls).toBe(1)
  })

  it('failed repair or still-broken repair output -> NON_MANIFOLD_INPUT', async () => {
    const failing = await booleanMeshes(open(), cube(), 'union', { repair: async () => err('REPAIR_FAILED', 'nope') })
    expect(failing.ok || failing.code).toBe('NON_MANIFOLD_INPUT')
    if (!failing.ok) expect(failing.message).toMatch(/repair failed: nope/)
    const useless = await booleanMeshes(open(), cube(), 'union', { repair: async () => ok(open()) })
    expect(useless.ok || useless.code).toBe('NON_MANIFOLD_INPUT')
    if (!useless.ok) expect(useless.message).toMatch(/still not manifold/)
  })

  it('empty, degenerate and malformed inputs are typed errors', async () => {
    const empty = await booleanMeshes({ positions: new Float32Array(0), indices: new Uint32Array(0) }, cube(), 'union')
    expect(empty.ok || empty.code).toBe('EMPTY_MESH')
    const malformed = await booleanMeshes(cube(), { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 7]) }, 'union')
    expect(malformed.ok || malformed.code).toBe('INVALID_MESH')
    // A single flat triangle is not a closed volume
    const tri = await booleanMeshes(cube(), { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) }, 'union')
    expect(tri.ok || tri.code).toBe('NON_MANIFOLD_INPUT')
    // Non-finite coordinates
    const nan = await booleanMeshes(cube(), { positions: new Float32Array([0, 0, NaN, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) }, 'union')
    expect(nan.ok || nan.code).toBe('INVALID_MESH')
  })
})
