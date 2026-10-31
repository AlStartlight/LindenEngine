import { describe, expect, it } from 'vitest'
import { fromLindenMesh, toLindenMesh } from '../../engine/mesh/core/convert'
import { HalfEdgeMesh } from '../../engine/mesh/core/HalfEdgeMesh'
import { validateLindenMesh, type LindenMesh } from '../../engine/mesh/core/LindenMesh'
import { makeCube, makeCylinder, makeLShape, makeNgon } from '../../engine/mesh/core/primitives'
import { validateTopology } from '../../engine/mesh/core/validate'

function toHalfEdge(mesh: LindenMesh, weld = false): HalfEdgeMesh {
  const r = fromLindenMesh(mesh, { weld })
  if (!r.ok) throw new Error(r.message)
  return r.value.mesh
}

function faceLoops(m: HalfEdgeMesh): number[][] {
  const out: number[][] = []
  for (let f = 0; f < m.faceSlots; f++) if (m.isFaceAlive(f)) out.push(m.faceVertices(f))
  return out
}

const shapes: [string, () => HalfEdgeMesh][] = [
  ['cube', () => makeCube()],
  ['cylinder', () => makeCylinder(12)],
  ['n-gon', () => makeNgon(9)],
  ['non-convex n-gon', () => makeLShape()],
]

describe('LindenMesh <-> HalfEdgeMesh round trip', () => {
  for (const [name, make] of shapes) {
    it(`${name}: HalfEdge -> Linden -> HalfEdge is identical`, () => {
      const he = make()
      const back = toHalfEdge(toLindenMesh(he))
      expect(back.toData()).toEqual(he.toData())
      expect(faceLoops(back)).toEqual(faceLoops(he))
      expect(validateTopology(back)).toEqual([])
    })

    it(`${name}: Linden -> HalfEdge -> Linden is identical`, () => {
      const linden = toLindenMesh(make())
      expect(validateLindenMesh(linden).ok).toBe(true)
      const again = toLindenMesh(toHalfEdge(linden))
      expect(again).toEqual(linden)
    })
  }

  it('triangulates n-gons: triangle count is sum(n - 2)', () => {
    const l = toLindenMesh(makeCylinder(12))
    // 12 quads -> 24, two 12-gons -> 20
    expect(l.indices.length / 3).toBe(44)
    expect(Array.from(l.polygons!.sizes)).toEqual([...Array(12).fill(4), 12, 12])
  })

  it('without polygons the triangles become the faces', () => {
    const l = toLindenMesh(makeCube(), { polygons: false })
    expect(l.polygons).toBeUndefined()
    const he = toHalfEdge(l)
    expect(he.faceCount).toBe(12)
    expect(he.edgeCount).toBe(18)
    expect(validateTopology(he)).toEqual([])
    expect(toLindenMesh(he, { polygons: false })).toEqual(l)
  })

  it('compacts dead slots on the way out', () => {
    const he = makeCube()
    he.removeFace(1)
    const l = toLindenMesh(he)
    expect(l.positions.length).toBe(24)
    expect(l.polygons!.sizes.length).toBe(5)
    expect(toHalfEdge(l).faceCount).toBe(5)
  })
})

describe('corner attributes', () => {
  /** Flat-shaded cube: each corner gets its face normal and a per-face uv square */
  function flatCube(): HalfEdgeMesh {
    const m = makeCube()
    m.enableCornerNormals()
    m.enableCornerUvs()
    const square = [0, 0, 1, 0, 1, 1, 0, 1]
    for (let f = 0; f < m.faceCount; f++) {
      const n = m.faceNormal(f)
      const len = Math.hypot(...n)
      m.faceHalfEdges(f).forEach((h, k) => {
        for (let c = 0; c < 3; c++) m.cornerNormals![h * 3 + c] = n[c] / len
        m.cornerUvs![h * 2] = square[k * 2]
        m.cornerUvs![h * 2 + 1] = square[k * 2 + 1]
      })
    }
    return m
  }

  it('seams split vertices: a flat cube has 24 render vertices', () => {
    const l = toLindenMesh(flatCube())
    expect(l.positions.length / 3).toBe(24)
    expect(l.normals!.length).toBe(72)
    expect(l.uvs!.length).toBe(48)
    expect(validateLindenMesh(l).ok).toBe(true)
  })

  it('welding restores the closed 8-vertex cube with per-corner attributes', () => {
    const l = toLindenMesh(flatCube())
    const r = fromLindenMesh(l, { weld: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const he = r.value.mesh
    expect(r.value.report.verticesWelded).toBe(16)
    expect([he.vertexCount, he.edgeCount, he.faceCount]).toEqual([8, 12, 6])
    expect(validateTopology(he)).toEqual([])
    expect(toLindenMesh(he)).toEqual(l)
  })

  it('without welding the seams stay open (6 separate quads)', () => {
    const he = toHalfEdge(toLindenMesh(flatCube()))
    expect(he.vertexCount).toBe(24)
    expect(he.edgeCount).toBe(24)
  })
})

describe('fromLindenMesh edge cases', () => {
  it('empty mesh converts to an empty half-edge mesh', () => {
    const r = fromLindenMesh({ positions: new Float32Array(0), indices: new Uint32Array(0) })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.mesh.faceCount).toBe(0)
    expect(toLindenMesh(new HalfEdgeMesh())).toEqual({
      positions: new Float32Array(0), indices: new Uint32Array(0),
      polygons: { sizes: new Uint32Array(0), indices: new Uint32Array(0) },
    })
  })

  it('rejects structurally invalid input with INVALID_MESH', () => {
    const bad: LindenMesh[] = [
      { positions: new Float32Array(4), indices: new Uint32Array(0) },
      { positions: new Float32Array(9), indices: new Uint32Array([0, 1]) },
      { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 3]) },
      { positions: new Float32Array([0, 0, NaN, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) },
      { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), uvs: new Float32Array(4) },
      { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), normals: new Float32Array(3) },
      {
        positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
        polygons: { sizes: new Uint32Array([4]), indices: new Uint32Array([0, 1, 2]) },
      },
    ]
    for (const m of bad) {
      const r = fromLindenMesh(m)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('INVALID_MESH')
    }
  })

  it('skips degenerate triangles (repeated index) and reports them', () => {
    const r = fromLindenMesh({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 0, 1]),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.mesh.faceCount).toBe(1)
    expect(r.value.report.degenerateFacesSkipped).toBe(1)
  })

  it('duplicate vertices: kept apart by default, merged with weld (collapsed faces skipped)', () => {
    // Quad as two triangles, but the shared diagonal uses duplicated vertices 4 and 5
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0])
    const indices = new Uint32Array([0, 1, 2, 4, 5, 3])
    const plain = fromLindenMesh({ positions, indices })
    expect(plain.ok && plain.value.mesh.edgeCount).toBe(6)
    const welded = fromLindenMesh({ positions, indices }, { weld: true })
    expect(welded.ok).toBe(true)
    if (!welded.ok) return
    expect(welded.value.mesh.vertexCount).toBe(4)
    expect(welded.value.mesh.edgeCount).toBe(5)
    expect(validateTopology(welded.value.mesh)).toEqual([])

    // A triangle whose corners weld together collapses and is skipped
    const collapsed = fromLindenMesh(
      { positions: new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0]), indices: new Uint32Array([0, 1, 2]) },
      { weld: true },
    )
    expect(collapsed.ok && collapsed.value.report.degenerateFacesSkipped).toBe(1)
  })

  it('non-manifold edge (3 faces): split by default, error when asked', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1])
    // Edge 0-1 is shared by three triangles
    const indices = new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 4])
    const r = fromLindenMesh({ positions, indices })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.report.nonManifoldFacesSplit).toBe(1)
    expect(r.value.mesh.faceCount).toBe(3)
    expect(r.value.mesh.vertexCount).toBe(8)
    expect(validateTopology(r.value.mesh).filter((i) => i.severity === 'error')).toEqual([])

    const strict = fromLindenMesh({ positions, indices }, { nonManifold: 'error' })
    expect(strict.ok).toBe(false)
    if (!strict.ok) expect(strict.code).toBe('NON_MANIFOLD_INPUT')
  })

  it('inconsistent winding between neighbours is split, not corrupted', () => {
    // Both triangles use the directed edge 2->0, so the second one faces the other way
    const flipped = fromLindenMesh({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 2, 0, 3]),
    })
    expect(flipped.ok).toBe(true)
    if (!flipped.ok) return
    expect(flipped.value.report.nonManifoldFacesSplit).toBe(1)
    expect(validateTopology(flipped.value.mesh).filter((i) => i.severity === 'error')).toEqual([])
  })
})
