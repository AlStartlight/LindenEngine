import { describe, expect, it } from 'vitest'
import { HalfEdgeMesh } from '../../engine/mesh/core/HalfEdgeMesh'
import { makeCube, makeCylinder, makeLShape, makeNgon, meshFromPolygons } from '../../engine/mesh/core/primitives'
import { checkTopology, validateTopology } from '../../engine/mesh/core/validate'
import { triangulatePolygon } from '../../engine/mesh/core/triangulate'

const errors = (m: HalfEdgeMesh) => validateTopology(m).filter((i) => i.severity === 'error')
const isClosed = (m: HalfEdgeMesh) => {
  for (let h = 0; h < m.halfEdgeSlots; h++) if (m.heFace[h] >= 0 && m.heTwin[h] < 0) return false
  return true
}

describe('HalfEdgeMesh primitives', () => {
  it('cube: 8 vertices, 12 edges, 6 quads, closed, Euler 2', () => {
    const m = makeCube()
    expect([m.vertexCount, m.edgeCount, m.faceCount]).toEqual([8, 12, 6])
    expect(m.vertexCount - m.edgeCount + m.faceCount).toBe(2)
    expect(isClosed(m)).toBe(true)
    expect(validateTopology(m)).toEqual([])
    for (let f = 0; f < 6; f++) expect(m.faceSize(f)).toBe(4)
  })

  it('cube faces point outward', () => {
    const m = makeCube(2)
    for (let f = 0; f < m.faceCount; f++) {
      const n = m.faceNormal(f)
      const c = [0, 0, 0]
      for (const v of m.faceVertices(f)) for (let k = 0; k < 3; k++) c[k] += m.positions[v * 3 + k] / 4
      expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0)
    }
  })

  it('cylinder: quad sides and n-gon caps, closed, Euler 2', () => {
    const m = makeCylinder(16)
    expect([m.vertexCount, m.edgeCount, m.faceCount]).toEqual([32, 48, 18])
    expect(m.vertexCount - m.edgeCount + m.faceCount).toBe(2)
    expect(isClosed(m)).toBe(true)
    expect(validateTopology(m)).toEqual([])
    expect(m.faceSize(16)).toBe(16)
  })

  it('open n-gon: every edge is a boundary', () => {
    const m = makeNgon(7)
    expect(m.faceCount).toBe(1)
    expect(m.edgeCount).toBe(7)
    expect(validateTopology(m)).toEqual([])
    for (let v = 0; v < 7; v++) expect(m.vertexOutgoing(v)).toHaveLength(1)
  })

  it('vertex fans: 3 around a cube corner, open fans walked both ways', () => {
    const cube = makeCube()
    for (let v = 0; v < 8; v++) expect(cube.vertexOutgoing(v)).toHaveLength(3)
    // 2x2 grid of quads: the centre vertex has 4 outgoing edges, edge midpoints 3 (open fan)
    const grid = meshFromPolygons(
      [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0, 0, 2, 0, 1, 2, 0, 2, 2, 0],
      [[0, 1, 4, 3], [1, 2, 5, 4], [3, 4, 7, 6], [4, 5, 8, 7]],
    )
    expect(grid.vertexOutgoing(4)).toHaveLength(4)
    expect(grid.vertexOutgoing(1)).toHaveLength(2)
    expect(grid.vertexOutgoing(0)).toHaveLength(1)
    const out = grid.vertexOutgoing(4)
    expect(new Set(out.map((h) => grid.heTarget(h)))).toEqual(new Set([1, 3, 5, 7]))
  })
})

describe('HalfEdgeMesh editing primitives', () => {
  it('rejects repeated vertices and reused directed edges without changing the mesh', () => {
    const m = makeCube()
    const r1 = m.addFace([0, 1, 1])
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.code).toBe('INVALID_TOPOLOGY')
    const r2 = m.addFace([0, 2, 3]) // 0->2 already used by the -Z face
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.code).toBe('NON_MANIFOLD_INPUT')
    expect(m.addFace([0, 1]).ok).toBe(false)
    expect(m.addFace([0, 1, 99]).ok).toBe(false)
    expect(m.faceCount).toBe(6)
    expect(validateTopology(m)).toEqual([])
  })

  it('removeFace opens a boundary and keeps the topology valid', () => {
    const m = makeCube()
    m.removeFace(0)
    expect(m.faceCount).toBe(5)
    expect(m.halfEdgeCount).toBe(20)
    expect(errors(m)).toEqual([])
    expect(m.edgeCount).toBe(12)
    for (let v = 0; v < 8; v++) expect(m.vertexOutgoing(v).length).toBeGreaterThan(0)
    m.removeFace(0) // already removed: no-op
    expect(m.faceCount).toBe(5)
  })

  it('removing every face isolates the vertices, which can then be removed', () => {
    const m = makeCube()
    for (let f = 0; f < 6; f++) m.removeFace(f)
    expect(m.faceCount).toBe(0)
    expect(m.halfEdgeCount).toBe(0)
    expect(errors(m)).toEqual([])
    for (let v = 0; v < 8; v++) expect(m.vertexHalfEdge[v]).toBe(-1)
    expect(m.removeVertex(0)).toBe(true)
    expect(m.vertexCount).toBe(7)
  })

  it('removeVertex refuses a vertex still used by faces', () => {
    const m = makeCube()
    expect(m.removeVertex(0)).toBe(false)
  })

  it('compact drops dead slots and remaps indices', () => {
    const m = makeCube()
    m.removeFace(2)
    m.removeFace(3)
    const { mesh, faceMap } = m.compact()
    expect(mesh.faceCount).toBe(4)
    expect(mesh.faceSlots).toBe(4)
    expect(mesh.halfEdgeSlots).toBe(16)
    expect(faceMap[2]).toBe(-1)
    expect(faceMap[4]).toBe(2)
    expect(errors(mesh)).toEqual([])
    expect(mesh.faceVertices(faceMap[5])).toEqual(m.faceVertices(5))
  })

  it('toData/fromData and clone preserve everything', () => {
    const m = makeCylinder(5)
    m.removeFace(1)
    const c = m.clone()
    expect(c.toData()).toEqual(m.toData())
    expect(c.faceCount).toBe(m.faceCount)
    expect(c.vertexCount).toBe(m.vertexCount)
    expect(validateTopology(c)).toEqual(validateTopology(m))
    // The clone is independent
    c.setPosition(0, 9, 9, 9)
    expect(m.positions[0]).not.toBe(9)
  })

  it('grows past its initial capacity', () => {
    const m = makeCylinder(500)
    expect(m.faceCount).toBe(502)
    expect(checkTopology(m).ok).toBe(true)
  })
})

describe('validateTopology', () => {
  it('detects a broken next pointer', () => {
    const m = makeCube()
    m.heNext[0] = 5
    const codes = errors(m).map((i) => i.code)
    expect(codes).toContain('BAD_NEXT')
    const r = checkTopology(m)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_TOPOLOGY')
  })

  it('detects an asymmetric twin', () => {
    const m = makeCube()
    const t = m.heTwin[0]
    m.heTwin[t] = -1
    expect(errors(m).map((i) => i.code)).toContain('BAD_TWIN')
  })

  it('detects a vertex pointing at a half-edge that does not leave it', () => {
    const m = makeCube()
    m.vertexHalfEdge[0] = m.heNext[m.vertexHalfEdge[0]]
    expect(errors(m).map((i) => i.code)).toContain('BAD_VERTEX_HALF_EDGE')
  })

  it('warns about zero-area faces and bow-tie vertices', () => {
    const flat = meshFromPolygons([0, 0, 0, 1, 0, 0, 2, 0, 0], [[0, 1, 2]])
    expect(validateTopology(flat).map((i) => i.code)).toEqual(['ZERO_AREA_FACE'])
    expect(checkTopology(flat).ok).toBe(true)

    // Two triangles touching only at vertex 0
    const bowtie = meshFromPolygons([0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0], [[0, 1, 2], [0, 3, 4]])
    const issues = validateTopology(bowtie)
    expect(issues.map((i) => i.code)).toEqual(['NON_MANIFOLD_VERTEX'])
    expect(issues[0].index).toBe(0)
  })

  it('an empty mesh is valid', () => {
    expect(validateTopology(new HalfEdgeMesh())).toEqual([])
  })
})

describe('triangulatePolygon', () => {
  const area2d = (pts: number[], tris: number[]) => {
    let a = 0
    for (let i = 0; i < tris.length; i += 3) {
      const [p, q, r] = [tris[i], tris[i + 1], tris[i + 2]]
      a += ((pts[q * 3] - pts[p * 3]) * (pts[r * 3 + 1] - pts[p * 3 + 1])
        - (pts[q * 3 + 1] - pts[p * 3 + 1]) * (pts[r * 3] - pts[p * 3])) / 2
    }
    return a
  }

  it('fans a convex polygon', () => {
    const pts = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]
    expect(triangulatePolygon(pts)).toEqual([0, 1, 2, 0, 2, 3])
  })

  it('ear-clips a non-convex polygon with correct area and winding', () => {
    const m = makeLShape()
    const pts = Array.from(m.positions.subarray(0, 18))
    const tris = triangulatePolygon(pts)
    expect(tris).toHaveLength(12)
    // Every triangle keeps CCW winding, so the signed area equals the L's area (3)
    expect(area2d(pts, tris)).toBeCloseTo(3)
    for (let i = 0; i < tris.length; i += 3) expect(area2d(pts, tris.slice(i, i + 3))).toBeGreaterThan(0)
  })

  it('handles polygons in other planes and clockwise orientation', () => {
    // Same L in the YZ plane, reversed
    const xy = [0, 0, 2, 0, 2, 1, 1, 1, 1, 2, 0, 2]
    const pts: number[] = []
    for (let i = 5; i >= 0; i--) pts.push(0, xy[i * 2], xy[i * 2 + 1])
    const tris = triangulatePolygon(pts)
    expect(tris).toHaveLength(12)
    expect(new Set(tris).size).toBe(6)
  })
})
