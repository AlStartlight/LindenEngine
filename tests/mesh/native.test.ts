import { describe, expect, it } from 'vitest'
import { booleanMeshes } from '../../engine/mesh/boolean/manifoldAdapter'
import { toLindenMesh } from '../../engine/mesh/core/convert'
import { editablePrimitive } from '../../engine/mesh/core/editablePrimitives'
import { HalfEdgeMesh } from '../../engine/mesh/core/HalfEdgeMesh'
import type { LindenMesh } from '../../engine/mesh/core/LindenMesh'
import { makeCube, makeCylinder, makeUvSphere } from '../../engine/mesh/core/primitives'
import { validateTopology } from '../../engine/mesh/core/validate'
import { subdivideMesh } from '../../engine/mesh/subdiv/opensubdivAdapter'
import { remesh, repair, smooth, unwrapUV } from '../../engine/mesh/uv/geogramAdapter'
import { bbox, isClosedManifold, linden, signedVolume, surfaceArea } from './helpers'
import { makeGrid } from './modeling/harness'
import { buildElf } from './modeling/elfModel'

const errors = (m: HalfEdgeMesh) => validateTopology(m).filter((i) => i.severity === 'error')
const faceSizes = (m: HalfEdgeMesh) => Array.from({ length: m.faceSlots }, (_, f) => m.faceSize(f))

describe('OpenSubdiv subdivision', () => {
  it('cube, Catmull-Clark level 2: 96 quads, closed, valid, Euler 2', async () => {
    const r = await subdivideMesh(makeCube(1), 2, 'catmull-clark')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const m = r.value
    expect(m.faceCount).toBe(96)
    expect(faceSizes(m).every((n) => n === 4)).toBe(true)
    expect(m.vertexCount - m.edgeCount + m.faceCount).toBe(2)
    expect(errors(m)).toEqual([])
    const l = toLindenMesh(m, { polygons: false })
    expect(isClosedManifold(l)).toBe(true)
    // The limit surface shrinks well inside the cage (a unit cube's level-2 surface encloses about 0.35)
    const vol = signedVolume(l)
    expect(vol).toBeGreaterThan(0.3)
    expect(vol).toBeLessThan(1)
    const b = bbox(l.positions)
    for (let k = 0; k < 3; k++) expect(b.max[k]).toBeLessThan(0.5)
  })

  it('level 1 gives one quad per face corner (n-gons included); level 0 returns the mesh', async () => {
    const cyl = makeCylinder(12)
    const corners = faceSizes(cyl).reduce((a, b) => a + b, 0)
    const r1 = await subdivideMesh(cyl, 1, 'catmull-clark')
    expect(r1.ok && r1.value.faceCount).toBe(corners)
    const r0 = await subdivideMesh(cyl, 0, 'catmull-clark')
    expect(r0.ok && r0.value.toData()).toEqual(cyl.compact().mesh.toData())
  })

  it('Loop needs triangles: triangulated cube level 2 = 192 triangles; quads are rejected', async () => {
    const tris = new HalfEdgeMesh()
    const l = toLindenMesh(makeCube(1), { polygons: false })
    for (let i = 0; i < l.positions.length; i += 3) tris.addVertex(l.positions[i], l.positions[i + 1], l.positions[i + 2])
    for (let t = 0; t < l.indices.length; t += 3) tris.addFace([l.indices[t], l.indices[t + 1], l.indices[t + 2]])
    const r = await subdivideMesh(tris, 2, 'loop')
    expect(r.ok && r.value.faceCount).toBe(192)
    expect(r.ok && faceSizes(r.value).every((n) => n === 3)).toBe(true)
    const bad = await subdivideMesh(makeCube(), 1, 'loop')
    expect(bad.ok || bad.code).toBe('INVALID_TOPOLOGY')
  })

  it('carries corner uvs (face-varying) and keeps them in range', async () => {
    const r = await subdivideMesh(editablePrimitive('box'), 2, 'catmull-clark')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.cornerUvs).not.toBeNull()
    for (let i = 0; i < r.value.halfEdgeSlots * 2; i++) {
      expect(r.value.cornerUvs![i]).toBeGreaterThanOrEqual(-1e-6)
      expect(r.value.cornerUvs![i]).toBeLessThanOrEqual(1 + 1e-6)
    }
  })

  it('open meshes keep their boundary', async () => {
    const r = await subdivideMesh(makeGrid(3), 1, 'catmull-clark')
    expect(r.ok && r.value.faceCount).toBe(36)
    expect(r.ok && errors(r.value)).toEqual([])
  })

  it('typed errors for bad levels and empty meshes', async () => {
    for (const lv of [-1, 1.5, 7]) {
      const r = await subdivideMesh(makeCube(), lv, 'catmull-clark')
      expect(r.ok || r.code).toBe('INVALID_MESH')
    }
    const empty = await subdivideMesh(new HalfEdgeMesh(), 1, 'catmull-clark')
    expect(empty.ok || empty.code).toBe('EMPTY_MESH')
  })

  it('smooths the box-modeled elf: level 2 stays closed, valid and symmetric', async () => {
    const { editor } = await buildElf()
    const r = await subdivideMesh(editor.mesh, 2, 'catmull-clark')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.faceCount).toBeGreaterThan(editor.mesh.faceCount * 10)
    expect(errors(r.value)).toEqual([])
    expect(isClosedManifold(toLindenMesh(r.value, { polygons: false }))).toBe(true)
  }, 60_000)
})

// ------------------------------------------------------------------ UV overlap check (independent of Geogram)

type P2 = [number, number]
const cross2 = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Separating-axis test for two triangles' interiors (shared edges/vertices do not count as overlap) */
function trianglesOverlap(t1: P2[], t2: P2[], eps: number): boolean {
  for (const [tri, other] of [[t1, t2], [t2, t1]]) {
    const orient = Math.sign(cross2(tri[0], tri[1], tri[2]))
    for (let i = 0; i < 3; i++) {
      const a = tri[i]
      const b = tri[(i + 1) % 3]
      // `other` entirely on the outer side of edge ab (within eps) -> separated
      if (other.every((p) => orient * cross2(a, b, p) <= eps)) return false
    }
  }
  return true
}

/** Number of overlapping triangle pairs in UV space (uniform grid broad phase) */
function uvOverlaps(m: LindenMesh): number {
  const uv = m.uvs!
  const tris: P2[][] = []
  for (let t = 0; t < m.indices.length; t += 3) {
    tris.push([0, 1, 2].map((k) => [uv[m.indices[t + k] * 2], uv[m.indices[t + k] * 2 + 1]] as P2))
  }
  const cells = 64
  const grid = new Map<number, number[]>()
  tris.forEach((tri, i) => {
    const xs = tri.map((p) => p[0]), ys = tri.map((p) => p[1])
    for (let x = Math.floor(Math.min(...xs) * cells); x <= Math.floor(Math.max(...xs) * cells); x++) {
      for (let y = Math.floor(Math.min(...ys) * cells); y <= Math.floor(Math.max(...ys) * cells); y++) {
        const key = x * 4096 + y
        grid.set(key, [...(grid.get(key) ?? []), i])
      }
    }
  })
  const seen = new Set<string>()
  let overlaps = 0
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const key = `${list[a]}:${list[b]}`
        if (seen.has(key)) continue
        seen.add(key)
        // Tolerance: a tiny fraction of the area of a typical triangle
        if (trianglesOverlap(tris[list[a]], tris[list[b]], 1e-9)) overlaps++
      }
    }
  }
  return overlaps
}

describe('Geogram UV unwrap', () => {
  const cases: [string, () => LindenMesh][] = [
    ['sphere', () => linden(makeUvSphere(1, 24, 12))],
    ['cube', () => linden(makeCube(1))],
    ['torus', () => toLindenMesh(editablePrimitive('torus'), { polygons: false })],
  ]
  for (const method of ['lscm', 'abf'] as const) {
    for (const [name, make] of cases) {
      it(`${method} on ${name}: uvs in [0,1], no overlapping triangles, no degenerate ones, same surface`, async () => {
        const input = make()
        const r = await unwrapUV(input, method)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        const m = r.value
        const uv = m.uvs!
        expect(uv.length).toBe((m.positions.length / 3) * 2)
        for (const x of uv) {
          expect(x).toBeGreaterThanOrEqual(-1e-6)
          expect(x).toBeLessThanOrEqual(1 + 1e-6)
        }
        expect(uvOverlaps(m)).toBe(0)
        for (let t = 0; t < m.indices.length; t += 3) {
          const p = [0, 1, 2].map((k) => [uv[m.indices[t + k] * 2], uv[m.indices[t + k] * 2 + 1]] as P2)
          expect(Math.abs(cross2(p[0], p[1], p[2]))).toBeGreaterThan(0)
        }
        expect(surfaceArea(m)).toBeCloseTo(surfaceArea(input), 4)
      }, 60_000)
    }
  }

  it('the overlap checker itself detects overlaps', () => {
    const m: LindenMesh = {
      positions: new Float32Array(18), indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      uvs: new Float32Array([0, 0, 0.5, 0, 0, 0.5, 0.1, 0.1, 0.6, 0.1, 0.1, 0.6]),
    }
    expect(uvOverlaps(m)).toBe(1)
    m.uvs = new Float32Array([0, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, 0.5]) // two halves of a square
    expect(uvOverlaps(m)).toBe(0)
  })
})

describe('Geogram remesh, smooth, repair', () => {
  it('remesh a sphere to about 500 vertices, staying on the surface', async () => {
    const r = await remesh(linden(makeUvSphere(1, 64, 32)), 500)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const nv = r.value.positions.length / 3
    expect(nv).toBeGreaterThan(400)
    expect(nv).toBeLessThan(600)
    for (let v = 0; v < nv; v++) {
      const p = r.value.positions
      expect(Math.abs(Math.hypot(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]) - 1)).toBeLessThan(0.01)
    }
    expect(isClosedManifold(r.value)).toBe(true)
  }, 60_000)

  it('smooth reduces noise, keeps topology and uvs, and seams do not crack', async () => {
    const base = linden(makeUvSphere(1, 32, 16))
    let seed = 3
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
    const noisy = base.positions.slice()
    for (let v = 0; v < noisy.length / 3; v++) {
      const s = 1 + rand() * 0.1
      for (let k = 0; k < 3; k++) noisy[v * 3 + k] *= s
    }
    const radiusSpread = (p: Float32Array) => {
      const r = Array.from({ length: p.length / 3 }, (_, v) => Math.hypot(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]))
      const mean = r.reduce((a, b) => a + b, 0) / r.length
      return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length)
    }
    const input: LindenMesh = { positions: noisy, indices: base.indices, uvs: new Float32Array(noisy.length / 3 * 2).fill(0.5) }
    const r = await smooth(input, 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(radiusSpread(r.value.positions)).toBeLessThan(radiusSpread(noisy) / 2)
    expect(r.value.indices).toEqual(input.indices)
    expect(r.value.uvs).toEqual(input.uvs)

    // Flat-shaded cube: 24 vertices, every corner split three times; copies must move together
    const flat = toLindenMesh(editablePrimitive('box'), { polygons: false })
    const s = await smooth(flat, 2)
    expect(s.ok).toBe(true)
    if (!s.ok) return
    const groups = new Map<string, string>()
    for (let v = 0; v < flat.positions.length / 3; v++) {
      const before = Array.from(flat.positions.subarray(v * 3, v * 3 + 3)).join()
      const after = Array.from(s.value.positions.subarray(v * 3, v * 3 + 3)).join()
      if (groups.has(before)) expect(after).toBe(groups.get(before))
      groups.set(before, after)
    }
    // (Plain Laplacian shrinks a cube symmetrically, so corners may legitimately meet; only finiteness here)
    expect(Array.from(s.value.positions).every(Number.isFinite)).toBe(true)
  }, 60_000)

  it('repair closes an open, unwelded, partly degenerate cube', async () => {
    const flat = toLindenMesh(makeCube(1), { polygons: false })
    // Triangle soup without the top face, plus a degenerate triangle
    const positions: number[] = []
    for (let t = 0; t < flat.indices.length; t++) {
      const v = flat.indices[t]
      positions.push(flat.positions[v * 3], flat.positions[v * 3 + 1], flat.positions[v * 3 + 2])
    }
    const keep: number[] = []
    for (let t = 0; t < flat.indices.length / 3; t++) {
      const ys = [0, 1, 2].map((k) => positions[(t * 3 + k) * 3 + 1])
      if (!ys.every((y) => y > 0.49)) keep.push(t * 3, t * 3 + 1, t * 3 + 2)
    }
    keep.push(0, 0, 1)
    const broken: LindenMesh = { positions: new Float32Array(positions), indices: new Uint32Array(keep) }
    expect(isClosedManifold(broken)).toBe(false)
    const r = await repair(broken)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(isClosedManifold(r.value)).toBe(true)
    expect(Math.abs(signedVolume(r.value))).toBeCloseTo(1, 5)
  }, 60_000)

  it('boolean falls back to repair for a non-manifold input', async () => {
    const cube = linden(makeCube(1))
    const open = { positions: cube.positions, indices: cube.indices.slice(6) }
    const sphere = linden(makeUvSphere(0.6, 24, 12))
    const without = await booleanMeshes(open, sphere, 'subtract')
    expect(without.ok || without.code).toBe('NON_MANIFOLD_INPUT')
    const withRepair = await booleanMeshes(open, sphere, 'subtract', { repair: (m) => repair(m) })
    expect(withRepair.ok).toBe(true)
    if (withRepair.ok) expect(isClosedManifold(withRepair.value)).toBe(true)
  }, 60_000)

  it('typed errors for empty input and bad parameters', async () => {
    const empty: LindenMesh = { positions: new Float32Array(0), indices: new Uint32Array(0) }
    for (const r of [await unwrapUV(empty, 'lscm'), await remesh(empty, 100), await smooth(empty, 2), await repair(empty)]) {
      expect(r.ok || r.code).toBe('EMPTY_MESH')
    }
    const s = linden(makeUvSphere(1, 8, 4))
    expect((await remesh(s, 2)).ok).toBe(false)
    expect((await smooth(s, -1)).ok).toBe(false)
  })
})
