import { describe, expect, it } from 'vitest'
import { toLindenMesh } from '../../../engine/mesh/core/convert'
import { editablePrimitive } from '../../../engine/mesh/core/editablePrimitives'
import { makeCube, makeCylinder, meshFromPolygons } from '../../../engine/mesh/core/primitives'
import { MeshEditor } from '../../../engine/mesh/modeling/MeshEditor'
import { splitEdge } from '../../../engine/mesh/modeling/advancedOps'
import { allEdges, edgeId, faceCenter } from '../../../engine/mesh/modeling/topology'
import { isClosedManifold, signedVolume } from '../helpers'
import { checkUndoRedo, expectValid, gridVertex, makeGrid } from './harness'

const volume = (e: MeshEditor) => signedVolume(toLindenMesh(e.mesh, { polygons: false }))
const closed = (e: MeshEditor) => isClosedManifold(toLindenMesh(e.mesh, { polygons: false }))
const edgeBetween = (e: MeshEditor, a: number, b: number) => {
  const h = e.mesh.findHalfEdge(a, b) >= 0 ? e.mesh.findHalfEdge(a, b) : e.mesh.findHalfEdge(b, a)
  return edgeId(e.mesh, h)
}
/** Cube vertex index from corner signs (makeCube: bit0 = +x, bit1 = +y, bit2 = +z) */
const V = (x: number, y: number, z: number) => (x > 0 ? 1 : 0) | (y > 0 ? 2 : 0) | (z > 0 ? 4 : 0)
const cubeTopFace = (e: MeshEditor) => [...Array(e.mesh.faceSlots).keys()].find((f) => e.mesh.isFaceAlive(f) && e.mesh.faceNormal(f)[1] > 0.5)!

describe('bevel', () => {
  const w = 0.1

  it('one cube edge, 1 segment: a chamfer face, volume 1 - w^2/2', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('edge')
    e.selection.click(edgeBetween(e, V(1, 1, 1), V(-1, 1, 1))) // top-front edge
    await checkUndoRedo(e, () => e.bevel(w))
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([10, 7])
    expect(closed(e)).toBe(true)
    expect(volume(e)).toBeCloseTo(1 - (w * w) / 2, 6)
  })

  it('one cube edge, 3 segments: rounded profile, corner patches, volume between chamfer and cube', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('edge')
    e.selection.click(edgeBetween(e, V(1, 1, 1), V(-1, 1, 1)))
    await checkUndoRedo(e, () => e.bevel(w, 3))
    expect(e.mesh.faceCount).toBe(6 + 3 + 2)
    expect(closed(e)).toBe(true)
    expect(volume(e)).toBeGreaterThan(1 - (w * w) / 2)
    expect(volume(e)).toBeLessThan(1)
  })

  it('the four edges around the top face (corners where two bevelled edges meet)', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(cubeTopFace(e))
    e.selection.setMode('edge') // the top face's 4 edges stay selected
    expect(e.selection.edges.size).toBe(4)
    await checkUndoRedo(e, () => e.bevel(w))
    expect(e.mesh.faceCount).toBe(6 + 4)
    expect(closed(e)).toBe(true)
    // Four w*w/2 prisms, minus the w^3/3 where two perpendicular chamfers overlap at each corner
    expect(volume(e)).toBeCloseTo(1 - 2 * w * w + (4 / 3) * w ** 3, 6)
  })

  it('all 12 cube edges: strips plus a triangle at each corner', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('edge')
    e.selection.selectAll()
    await checkUndoRedo(e, () => e.bevel(w))
    expect(e.mesh.faceCount).toBe(6 + 12 + 8)
    expect(closed(e)).toBe(true)
  })

  it('one cube vertex: corner cut, volume 1 - w^3/6', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.click(V(1, 1, 1))
    await checkUndoRedo(e, () => e.bevel(0.3))
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([10, 7])
    expect(closed(e)).toBe(true)
    expect(volume(e)).toBeCloseTo(1 - 0.3 ** 3 / 6, 6)
  })

  it('n-gon caps and uv corners survive', async () => {
    const e = new MeshEditor(editablePrimitive('cylinder'))
    e.selection.setMode('edge')
    const rim = allEdges(e.mesh).find((x) => {
      const t = e.mesh.heTwin[x]
      return t >= 0 && (e.mesh.faceSize(e.mesh.heFace[x]) === 24 || e.mesh.faceSize(e.mesh.heFace[t]) === 24)
    })!
    e.selection.click(rim)
    await checkUndoRedo(e, () => e.bevel(0.02, 2))
    expect(closed(e)).toBe(true)
    for (let i = 0; i < e.mesh.halfEdgeSlots * 2; i++) if (e.mesh.heFace[i >> 1] >= 0) expect(Number.isFinite(e.mesh.cornerUvs![i])).toBe(true)
  })

  it('zero-length edges (extrude without moving) are refused instead of producing NaN', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(cubeTopFace(e))
    await e.extrude(0)
    const before = e.mesh.toData()
    e.selection.setMode('edge')
    e.selection.selectAll()
    const r = await e.bevel(0.05)
    expect(r.ok || r.message).toMatch(/zero length; merge by distance/)
    expect(e.mesh.toData()).toEqual(before)
    // After merging the doubles the same bevel works
    e.selection.setMode('vertex')
    e.selection.selectAll()
    await e.mergeByDistance(1e-6)
    e.selection.setMode('edge')
    e.selection.selectAll()
    await checkUndoRedo(e, () => e.bevel(0.05))
    expect(Array.from(e.mesh.positions.subarray(0, e.mesh.vertexSlots * 3)).every(Number.isFinite)).toBe(true)
    expect(closed(e)).toBe(true)
  })

  it('typed errors leave the mesh unchanged: width too large, boundary edge, nothing selected', async () => {
    const e = new MeshEditor(makeCube(1))
    const before = e.mesh.toData()
    e.selection.setMode('edge')
    e.selection.click(edgeBetween(e, V(1, 1, 1), V(-1, 1, 1)))
    expect((await e.bevel(1.2)).ok).toBe(false)
    expect((await e.bevel(0)).ok).toBe(false)
    expect(e.mesh.toData()).toEqual(before)
    const g = new MeshEditor(makeGrid(2))
    g.selection.setMode('edge')
    g.selection.click(edgeBetween(g, gridVertex(2, 0, 0), gridVertex(2, 1, 0)))
    const r = await g.bevel(0.1)
    expect(r.ok || r.code).toBe('INVALID_TOPOLOGY')
    expect(e.history.canUndo || g.history.canUndo).toBe(false)
  })
})

describe('loop cut', () => {
  it('cylinder side: one cut adds a horizontal loop of 12 vertices', async () => {
    const e = new MeshEditor(makeCylinder(12))
    const vertical = edgeBetween(e, 0, 12)
    await checkUndoRedo(e, () => e.loopCut(vertical, 1))
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([36, 26])
    expect(e.selection.edges.size).toBe(12)
    expect(closed(e)).toBe(true)
    expect(volume(e)).toBeCloseTo(signedVolume(toLindenMesh(makeCylinder(12), { polygons: false })), 6)
  })

  it('cube: two cuts around four faces', async () => {
    const e = new MeshEditor(makeCube(1))
    await checkUndoRedo(e, () => e.loopCut(edgeBetween(e, V(1, 1, 1), V(-1, 1, 1)), 2))
    expect(e.mesh.faceCount).toBe(6 + 4 * 2)
    expect(closed(e)).toBe(true)
  })

  it('a ring that ends in n-gons inserts the new vertices into them', async () => {
    const e = new MeshEditor(makeCylinder(12))
    // Top rim edge: its ring is just the side quad between the two caps
    await checkUndoRedo(e, () => e.loopCut(edgeBetween(e, 12, 13), 1))
    expect(e.mesh.faceCount).toBe(15)
    const caps = [...Array(e.mesh.faceSlots).keys()].filter((f) => e.mesh.isFaceAlive(f) && e.mesh.faceSize(f) > 4)
    expect(caps.map((f) => e.mesh.faceSize(f)).sort()).toEqual([13, 13])
    expect(closed(e)).toBe(true)
  })

  it('interpolates uvs and rejects bad cut counts', async () => {
    const e = new MeshEditor(editablePrimitive('box'))
    await checkUndoRedo(e, () => e.loopCut(edgeBetween(e, 0, 1), 3))
    for (let h = 0; h < e.mesh.halfEdgeSlots; h++) {
      if (e.mesh.heFace[h] < 0) continue
      expect(e.mesh.cornerUvs![h * 2]).toBeGreaterThanOrEqual(0)
      expect(e.mesh.cornerUvs![h * 2]).toBeLessThanOrEqual(1)
    }
    expect((await e.loopCut(edgeBetween(e, 0, 1), 0)).ok).toBe(false)
  })
})

describe('knife and connect', () => {
  it('connect two opposite corners of a cube face', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.click(V(-1, 1, -1))
    e.selection.click(V(1, 1, 1), true)
    await checkUndoRedo(e, () => e.connect())
    expect(e.mesh.faceCount).toBe(7)
    expect(closed(e)).toBe(true)
  })

  it('knife between midpoints of two opposite top edges: the neighbours become pentagons', async () => {
    const e = new MeshEditor(makeCube(1))
    const a = e.mesh.findHalfEdge(V(-1, 1, 1), V(1, 1, 1)) >= 0 ? e.mesh.findHalfEdge(V(-1, 1, 1), V(1, 1, 1)) : e.mesh.findHalfEdge(V(1, 1, 1), V(-1, 1, 1))
    const b = e.mesh.findHalfEdge(V(-1, 1, -1), V(1, 1, -1)) >= 0 ? e.mesh.findHalfEdge(V(-1, 1, -1), V(1, 1, -1)) : e.mesh.findHalfEdge(V(1, 1, -1), V(-1, 1, -1))
    await checkUndoRedo(e, () => e.knife([{ edge: a, t: 0.5 }, { edge: b, t: 0.5 }]))
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([10, 7])
    expect([...Array(e.mesh.faceSlots).keys()].filter((f) => e.mesh.isFaceAlive(f) && e.mesh.faceSize(f) === 5)).toHaveLength(2)
    expect(closed(e)).toBe(true)
  })

  it('a knife path across two faces through a shared edge', async () => {
    const n = 2
    const e = new MeshEditor(makeGrid(n))
    const edge = (x0: number, y0: number, x1: number, y1: number) => e.mesh.findHalfEdge(gridVertex(n, x0, y0), gridVertex(n, x1, y1)) >= 0
      ? e.mesh.findHalfEdge(gridVertex(n, x0, y0), gridVertex(n, x1, y1)) : e.mesh.findHalfEdge(gridVertex(n, x1, y1), gridVertex(n, x0, y0))
    await checkUndoRedo(e, () => e.knife([
      { edge: edge(0, 0, 0, 1), t: 0.5 }, { edge: edge(1, 0, 1, 1), t: 0.5 }, { edge: edge(2, 0, 2, 1), t: 0.5 },
    ]))
    expect(e.mesh.faceCount).toBe(6)
    expect(e.selection.edges.size).toBe(2)
  })

  it('errors: vertices without a shared face, already connected, splitEdge parameter', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.click(V(-1, -1, -1))
    e.selection.click(V(1, 1, 1), true)
    expect((await e.connect()).ok).toBe(false)
    e.selection.click(V(-1, -1, -1))
    e.selection.click(V(1, -1, -1), true)
    expect((await e.connect()).ok).toBe(false)
    expect(splitEdge(e.mesh, 0, 1).ok).toBe(false)
  })
})

describe('dissolve', () => {
  it('an edge between two grid quads merges them', async () => {
    const e = new MeshEditor(makeGrid(2))
    e.selection.setMode('edge')
    e.selection.click(edgeBetween(e, gridVertex(2, 1, 0), gridVertex(2, 1, 1)))
    await checkUndoRedo(e, () => e.dissolve())
    expect(e.mesh.faceCount).toBe(3)
  })

  it('all four grid faces become one octagon; the inner vertex goes', async () => {
    const e = new MeshEditor(makeGrid(2))
    e.selection.setMode('face')
    e.selection.selectAll()
    await checkUndoRedo(e, () => e.dissolve())
    expect([e.mesh.faceCount, e.mesh.vertexCount]).toEqual([1, 8])
    expect(e.mesh.faceSize([...e.selection.faces][0])).toBe(8)
  })

  it('an interior vertex merges its fan; a mid-edge vertex just disappears', async () => {
    const e = new MeshEditor(makeGrid(2))
    e.selection.click(gridVertex(2, 1, 1))
    await checkUndoRedo(e, () => e.dissolve())
    expect([e.mesh.faceCount, e.mesh.vertexCount]).toEqual([1, 8])

    const c = new MeshEditor(makeCube(1))
    const original = c.mesh.toData()
    const r = splitEdge(c.mesh, edgeBetween(c, 0, 1), 0.5)
    if (!r.ok) throw new Error(r.message)
    c.selection.click(r.value)
    await checkUndoRedo(c, () => c.dissolve())
    expect([c.mesh.vertexCount, c.mesh.faceCount]).toEqual([8, 6])
    expect(closed(c)).toBe(true)
    expect(original).toBeDefined()
  })

  it('refuses to leave a hole or to swallow a closed surface', async () => {
    const ring = new MeshEditor(makeGrid(3))
    ring.selection.setMode('face')
    ring.selection.selectAll()
    const centre = [...ring.selection.faces].find((f) => {
      const c = faceCenter(ring.mesh, f)
      return Math.abs(c[0] - 1.5) < 0.01 && Math.abs(c[1] - 1.5) < 0.01
    })!
    ring.selection.click(centre, true) // deselect the centre: 8 faces around a hole
    expect((await ring.dissolve()).ok).toBe(false)
    const cube = new MeshEditor(makeCube(1))
    cube.selection.setMode('face')
    cube.selection.selectAll()
    expect((await cube.dissolve()).ok).toBe(false)
    expectValid(cube.mesh)
  })
})

describe('normals', () => {
  it('flip turns the whole island inside out; recalculate fixes it', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(0)
    await checkUndoRedo(e, () => e.flipNormals())
    expect(volume(e)).toBeCloseTo(-1, 6)
    e.selection.selectNone()
    await checkUndoRedo(e, () => e.recalculateNormals())
    expect(volume(e)).toBeCloseTo(1, 6)
  })

  it('recalculate only flips the islands that face inward', async () => {
    const pos = Array.from(makeCube(1).positions.subarray(0, 24))
    const loops = Array.from({ length: 6 }, (_, f) => makeCube(1).faceVertices(f))
    // Second cube shifted by 3 and wound inside out
    const two = meshFromPolygons([...pos, ...pos.map((v, i) => (i % 3 === 0 ? v + 3 : v))], [...loops, ...loops.map((l) => [...l].reverse().map((v) => v + 8))])
    const e = new MeshEditor(two)
    expect(volume(e)).toBeCloseTo(0, 6)
    await checkUndoRedo(e, () => e.recalculateNormals())
    expect(volume(e)).toBeCloseTo(2, 6)
  })
})

describe('fill and bridge', () => {
  it('fill the hole left by deleting the top face', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(cubeTopFace(e))
    await e.delete()
    // The four edges around the hole
    e.selection.set('edge', allEdges(e.mesh).filter((x) => e.mesh.heTwin[x] < 0))
    expect(e.selection.edges.size).toBe(4)
    await checkUndoRedo(e, () => e.fillOrBridge())
    expect(closed(e)).toBe(true)
    expect(volume(e)).toBeCloseTo(1, 6)
  })

  it('bridge the two cap rims of a cylinder whose sides were deleted', async () => {
    const original = signedVolume(toLindenMesh(makeCylinder(12), { polygons: false }))
    const e = new MeshEditor(makeCylinder(12))
    e.selection.setMode('face')
    e.selection.set('face', [...Array(12).keys()])
    await e.delete('faces')
    expect(e.mesh.faceCount).toBe(2)
    e.selection.setMode('edge')
    e.selection.selectAll()
    await checkUndoRedo(e, () => e.fillOrBridge())
    expect(e.mesh.faceCount).toBe(14)
    expect(closed(e)).toBe(true)
    expect(volume(e)).toBeCloseTo(original, 6)
  })

  it('errors: interior edges, loops with different sizes', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('edge')
    e.selection.selectAll()
    expect((await e.fillOrBridge()).ok).toBe(false)
    const mixed = meshFromPolygons([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 6, 1, 0, 5, 1, 0], [[0, 1, 2], [3, 4, 5, 6]])
    const m = new MeshEditor(mixed)
    m.selection.setMode('edge')
    m.selection.selectAll()
    const r = await m.fillOrBridge()
    expect(r.ok || r.message).toMatch(/same number of edges/)
  })
})

describe('fuzz: mixed Phase 3 + Phase 5 operations', () => {
  it('80 random edits stay valid after every step and undo back to the start exactly', async () => {
    for (const seed0 of [7, 42, 1234]) {
      let seed = seed0
      const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
      const e = new MeshEditor(editablePrimitive('cylinder'), { historyDepth: 1000 })
      const original = e.mesh.toData()
      const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
      const counts: Record<string, number> = {}
      for (let i = 0; i < 80; i++) {
        const faces = [...Array(e.mesh.faceSlots).keys()].filter((f) => e.mesh.isFaceAlive(f))
        const edges = allEdges(e.mesh)
        if (faces.length === 0) break
        const op = pick(['bevelEdge', 'bevelVertex', 'loopCut', 'dissolveEdge', 'dissolveVertex', 'connect', 'flip', 'inset', 'extrude', 'recalc'])
        let r
        if (op === 'bevelEdge') {
          e.selection.set('edge', [pick(edges)])
          r = await e.bevel(0.005 + rand() * 0.02, 1 + Math.floor(rand() * 3))
        } else if (op === 'bevelVertex') {
          e.selection.set('vertex', [e.mesh.heVertex[pick(edges)]])
          r = await e.bevel(0.005 + rand() * 0.01)
        } else if (op === 'loopCut') {
          r = await e.loopCut(pick(edges), 1 + Math.floor(rand() * 2))
        } else if (op === 'dissolveEdge') {
          e.selection.set('edge', [pick(edges)])
          r = await e.dissolve()
        } else if (op === 'dissolveVertex') {
          e.selection.set('vertex', [e.mesh.heVertex[pick(edges)]])
          r = await e.dissolve()
        } else if (op === 'connect') {
          const f = pick(faces)
          const vs = e.mesh.faceVertices(f)
          e.selection.set('vertex', [vs[0], vs[Math.min(2, vs.length - 1)]])
          r = await e.connect()
        } else if (op === 'flip') {
          e.selection.set('face', [pick(faces)])
          r = await e.flipNormals()
        } else if (op === 'inset') {
          e.selection.set('face', [pick(faces)])
          r = await e.inset(0.005 + rand() * 0.01)
        } else if (op === 'extrude') {
          e.selection.set('face', [pick(faces)])
          r = await e.extrude(rand() * 0.1)
        } else {
          e.selection.selectNone()
          r = await e.recalculateNormals()
        }
        if (r.ok) counts[op] = (counts[op] ?? 0) + 1
        expectValid(e.mesh)
      }
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(40)
      expect(Object.keys(counts).length).toBeGreaterThanOrEqual(8)
      while (e.history.canUndo) {
        await e.undo()
        expectValid(e.mesh)
      }
      expect(e.mesh.toData()).toEqual(original)
    }
  }, 120_000)
})
