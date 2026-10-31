import { describe, expect, it } from 'vitest'
import { makeCube, makeCylinder, meshFromPolygons } from '../../../engine/mesh/core/primitives'
import { MeshSelection, edgeLoop, edgeRing } from '../../../engine/mesh/modeling/selection'
import { allEdges, edgeId, edgeVertices } from '../../../engine/mesh/modeling/topology'
import { gridVertex, makeGrid } from './harness'

describe('MeshSelection modes and flushing', () => {
  it('click replaces, shift-click toggles', () => {
    const s = new MeshSelection(makeCube())
    s.click(0)
    s.click(1)
    expect([...s.vertices]).toEqual([1])
    s.click(2, true)
    s.click(1, true)
    expect([...s.vertices]).toEqual([2])
  })

  it('vertex selection flushes to edges and faces whose vertices are all selected', () => {
    const m = makeCube()
    const s = new MeshSelection(m)
    for (const v of m.faceVertices(0)) s.click(v, true)
    expect(s.edges.size).toBe(4)
    expect([...s.faces]).toEqual([0])
  })

  it('face selection flushes to its vertices and edges; switching modes converts', () => {
    const m = makeCube()
    const s = new MeshSelection(m)
    s.setMode('face')
    s.click(0)
    s.click(1, true) // opposite faces: no shared edges
    expect(s.vertices.size).toBe(8)
    expect(s.edges.size).toBe(8)
    s.setMode('vertex')
    // All 8 vertices -> every face and edge is now selected
    expect(s.faces.size).toBe(6)
    expect(s.edges.size).toBe(12)
    s.setMode('face')
    expect(s.faces.size).toBe(6)
  })

  it('edge mode: faces need all their edges', () => {
    const m = makeCube()
    const s = new MeshSelection(m)
    s.setMode('edge')
    const fe = m.faceHalfEdges(0).map((h) => edgeId(m, h))
    for (const e of fe.slice(0, 3)) s.click(e, true)
    expect(s.faces.size).toBe(0)
    s.click(fe[3], true)
    expect([...s.faces]).toEqual([0])
    expect(s.vertices.size).toBe(4)
  })

  it('select all / none per mode', () => {
    const s = new MeshSelection(makeCylinder(8))
    s.selectAll()
    expect(s.vertices.size).toBe(16)
    s.setMode('edge')
    s.selectAll()
    expect(s.edges.size).toBe(24)
    s.selectNone()
    expect(s.isEmpty).toBe(true)
  })

  it('box select (x-ray) with extend and subtract', () => {
    const g = makeGrid(3)
    const s = new MeshSelection(g)
    const project = (x: number, y: number): [number, number] => [x * 100, y * 100]
    s.box(project, { minX: -1, minY: -1, maxX: 101, maxY: 101 })
    expect([...s.vertices].sort((a, b) => a - b)).toEqual([0, 1, 4, 5])
    expect(s.faces.size).toBe(1)
    s.box(project, { minX: 199, minY: 199, maxX: 301, maxY: 301 }, { extend: true })
    expect(s.vertices.size).toBe(8)
    s.box(project, { minX: -1, minY: -1, maxX: 1, maxY: 1 }, { subtract: true })
    expect(s.vertices.size).toBe(7)
    s.setMode('face')
    s.box(project, { minX: -1, minY: -1, maxX: 201, maxY: 101 })
    expect(s.faces.size).toBe(2)
    // Vertices behind the camera are never inside
    s.setMode('vertex')
    s.box(() => null, { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 })
    expect(s.isEmpty).toBe(true)
  })

  it('select linked grows to the connected island only', () => {
    const cube = makeCube()
    const pos = Array.from(cube.positions.subarray(0, 24))
    const loops = cube.faceSlots ? Array.from({ length: 6 }, (_, f) => cube.faceVertices(f)) : []
    // Two disjoint cubes in one mesh
    const two = meshFromPolygons([...pos, ...pos.map((v, i) => (i % 3 === 0 ? v + 5 : v))], [...loops, ...loops.map((l) => l.map((v) => v + 8))])
    const s = new MeshSelection(two)
    s.click(9)
    s.selectLinked()
    expect([...s.vertices].sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12, 13, 14, 15])
    s.setMode('face')
    expect(s.faces.size).toBe(6)
  })

  it('prune drops elements removed by a topology change', () => {
    const m = makeCube()
    const s = new MeshSelection(m)
    s.setMode('face')
    s.selectAll()
    m.removeFace(2)
    s.prune()
    expect(s.faces.size).toBe(5)
  })

  it('toData / restore round trip', () => {
    const s = new MeshSelection(makeCube())
    s.setMode('edge')
    s.click(allEdges(s.mesh)[3])
    const data = s.toData()
    const t = new MeshSelection(s.mesh)
    t.restore(data)
    expect(t.toData()).toEqual(data)
  })
})

describe('edge loops and rings', () => {
  const n = 3
  const g = makeGrid(n)
  const he = (a: number, b: number) => g.findHalfEdge(a, b) >= 0 ? g.findHalfEdge(a, b) : g.findHalfEdge(b, a)
  const verts = (edges: number[]) => new Set(edges.flatMap((e) => edgeVertices(g, e)))

  it('interior loop runs straight across valence-4 vertices and stops at the boundary', () => {
    // Middle horizontal line y = 1, edge (1,1)-(2,1)
    const loop = edgeLoop(g, he(gridVertex(n, 1, 1), gridVertex(n, 2, 1)))
    expect(loop).toHaveLength(3)
    expect(verts(loop)).toEqual(new Set([0, 1, 2, 3].map((x) => gridVertex(n, x, 1))))
  })

  it('a boundary edge loop follows the whole boundary', () => {
    const loop = edgeLoop(g, he(gridVertex(n, 0, 0), gridVertex(n, 1, 0)))
    expect(loop).toHaveLength(12)
  })

  it('ring crosses opposite edges of consecutive quads', () => {
    const ring = edgeRing(g, he(gridVertex(n, 1, 1), gridVertex(n, 2, 1)))
    expect(ring).toHaveLength(4)
    for (const e of ring) {
      const [a, b] = edgeVertices(g, e)
      // All horizontal edges between x=1 and x=2
      expect(new Set([a % (n + 1), b % (n + 1)])).toEqual(new Set([1, 2]))
    }
  })

  it('cylinder: vertical side edges form a closed ring, the cap boundary stops loops (valence 3)', () => {
    const c = makeCylinder(8)
    const vertical = c.findHalfEdge(0, 8) >= 0 ? c.findHalfEdge(0, 8) : c.findHalfEdge(8, 0)
    expect(edgeRing(c, vertical)).toHaveLength(8)
    expect(edgeLoop(c, vertical)).toHaveLength(1)
  })

  it('selection API applies loops in each mode', () => {
    const s = new MeshSelection(g)
    s.setMode('edge')
    s.selectEdgeLoop(he(gridVertex(n, 1, 1), gridVertex(n, 2, 1)))
    expect(s.edges.size).toBe(3)
    s.setMode('face')
    s.selectNone()
    s.selectEdgeRing(he(gridVertex(n, 1, 1), gridVertex(n, 2, 1)))
    expect(s.faces.size).toBe(3)
  })
})
