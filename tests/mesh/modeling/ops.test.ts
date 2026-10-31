import { describe, expect, it } from 'vitest'
import { booleanMeshes } from '../../../engine/mesh/boolean/manifoldAdapter'
import { fromLindenMesh, toLindenMesh } from '../../../engine/mesh/core/convert'
import type { GeometryOps } from '../../../engine/mesh/core/GeometryOps'
import { makeCube, makeCylinder, makeLShape, makeNgon, makeUvSphere } from '../../../engine/mesh/core/primitives'
import { err, ok } from '../../../engine/mesh/core/result'
import { MeshEditor } from '../../../engine/mesh/modeling/MeshEditor'
import { edgeId } from '../../../engine/mesh/modeling/topology'
import { isClosedManifold, signedVolume } from '../helpers'
import { checkUndoRedo, expectValid, gridVertex, makeGrid } from './harness'

const volume = (e: MeshEditor) => signedVolume(toLindenMesh(e.mesh, { polygons: false }))
const closed = (e: MeshEditor) => isClosedManifold(toLindenMesh(e.mesh, { polygons: false }))
const euler = (e: MeshEditor) => e.mesh.vertexCount - e.mesh.edgeCount + e.mesh.faceCount

/** Face of the cube whose normal points along +axis */
function cubeFace(e: MeshEditor, axis: 0 | 1 | 2, sign = 1): number {
  for (let f = 0; f < e.mesh.faceSlots; f++) {
    if (!e.mesh.isFaceAlive(f)) continue
    const n = e.mesh.faceNormal(f)
    if (n[axis] * sign > 0.5) return f
  }
  throw new Error('no such face')
}

describe('extrude', () => {
  it('one cube face: 10 faces, 12 vertices, closed, volume grows by the extrusion', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(cubeFace(e, 1))
    await checkUndoRedo(e, () => e.extrude(1))
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([12, 10])
    expect(closed(e)).toBe(true)
    expect(euler(e)).toBe(2)
    expect(volume(e)).toBeCloseTo(2, 6)
    // The new top face is selected and sits at y = 1.5
    const [top] = [...e.selection.faces]
    for (const v of e.mesh.faceVertices(top)) expect(e.mesh.positions[v * 3 + 1]).toBeCloseTo(1.5)
  })

  it('a region of two adjacent faces gets 6 side quads (shared edge stays interior)', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(cubeFace(e, 1))
    e.selection.click(cubeFace(e, 0), true)
    await checkUndoRedo(e, () => e.extrude(0.5))
    expect(e.mesh.faceCount).toBe(6 - 2 + 2 + 6)
    expect(closed(e)).toBe(true)
  })

  it('extruding every face of a closed mesh just offsets it (no sides, old vertices removed)', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.selectAll()
    await checkUndoRedo(e, () => e.extrude(0.5))
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([8, 6])
    expect(closed(e)).toBe(true)
  })

  it('on an open grid, side quads also follow the mesh boundary', async () => {
    const e = new MeshEditor(makeGrid(2))
    e.selection.setMode('face')
    e.selection.click(0) // corner quad: two edges on the boundary, two interior
    await checkUndoRedo(e, () => e.extrude(1))
    expect(e.mesh.faceCount).toBe(4 - 1 + 1 + 4)
  })

  it('n-gon faces extrude (cylinder cap)', async () => {
    const e = new MeshEditor(makeCylinder(12))
    e.selection.setMode('face')
    e.selection.click(13) // top cap
    await checkUndoRedo(e, () => e.extrude(0.3))
    expect(closed(e)).toBe(true)
    expect(e.mesh.faceSize([...e.selection.faces][0])).toBe(12)
  })

  it('boundary edges extrude into quads sharing new vertices', async () => {
    const n = 2
    const e = new MeshEditor(makeGrid(n))
    e.selection.setMode('edge')
    const g = e.mesh
    const bottom = [0, 1].map((x) => edgeId(g, g.findHalfEdge(gridVertex(n, x, 0), gridVertex(n, x + 1, 0))))
    for (const b of bottom) e.selection.click(b, true)
    await checkUndoRedo(e, () => e.extrude())
    await checkUndoRedo(e, () => e.transform({ translate: [0, -1, 0] }))
    expect(e.mesh.faceCount).toBe(6)
    expect(e.mesh.vertexCount).toBe(9 + 3)
    expect(e.selection.edges.size).toBe(2)
  })

  it('interior edge extrude fails with a typed error and leaves no trace', async () => {
    const n = 2
    const e = new MeshEditor(makeGrid(n))
    const before = e.mesh.toData()
    e.selection.setMode('edge')
    e.selection.click(edgeId(e.mesh, e.mesh.findHalfEdge(gridVertex(n, 1, 0), gridVertex(n, 1, 1))))
    const r = await e.extrude()
    expect(r.ok || r.code).toBe('INVALID_TOPOLOGY')
    expect(e.mesh.toData()).toEqual(before)
    expect(e.history.canUndo).toBe(false)
  })

  it('vertex extrude reports NOT_IMPLEMENTED (needs loose edges)', async () => {
    const e = new MeshEditor(makeCube())
    e.selection.click(0)
    const r = await e.extrude()
    expect(r.ok || r.code).toBe('NOT_IMPLEMENTED')
  })

  it('nothing selected is an error, not a no-op command', async () => {
    const e = new MeshEditor(makeCube())
    e.selection.setMode('face')
    const r = await e.extrude()
    expect(r.ok).toBe(false)
    expect(e.history.canUndo).toBe(false)
  })
})

describe('inset', () => {
  it('cube face: inner face shrinks by 2*thickness, ring of 4 quads, stays closed', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(cubeFace(e, 2))
    await checkUndoRedo(e, () => e.inset(0.1))
    expect(e.mesh.faceCount).toBe(10)
    expect(closed(e)).toBe(true)
    const [inner] = [...e.selection.faces]
    const n = e.mesh.faceNormal(inner)
    expect(Math.hypot(...n) / 2).toBeCloseTo(0.8 * 0.8, 6) // area
    expect(volume(e)).toBeCloseTo(1, 6)
  })

  it('depth raises the inner face', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(cubeFace(e, 2))
    await checkUndoRedo(e, () => e.inset(0.1, 0.2))
    expect(volume(e)).toBeGreaterThan(1)
  })

  it('works on n-gons and non-convex faces', async () => {
    for (const [mesh, sides] of [[makeNgon(9), 9], [makeLShape(), 6]] as const) {
      const e = new MeshEditor(mesh)
      e.selection.setMode('face')
      e.selection.selectAll()
      await checkUndoRedo(e, () => e.inset(0.05))
      expect(e.mesh.faceCount).toBe(1 + sides) // inner face + ring of quads
      const [inner] = [...e.selection.faces]
      expect(e.mesh.faceSize(inner)).toBe(sides)
      expect(e.mesh.faceNormal(inner)[2]).toBeGreaterThan(0) // not flipped
    }
  })

  it('too thick: typed error, mesh unchanged', async () => {
    const e = new MeshEditor(makeCube(1))
    const before = e.mesh.toData()
    e.selection.setMode('face')
    e.selection.click(0)
    for (const t of [0.6, 0, -1]) {
      const r = await e.inset(t)
      expect(r.ok).toBe(false)
      expect(e.mesh.toData()).toEqual(before)
    }
  })
})

describe('delete', () => {
  it('a vertex removes its faces; neighbours stay', async () => {
    const e = new MeshEditor(makeCube())
    e.selection.click(0)
    await checkUndoRedo(e, () => e.delete())
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([7, 3])
  })

  it('an edge removes both adjacent faces', async () => {
    const e = new MeshEditor(makeCube())
    e.selection.setMode('edge')
    e.selection.click(edgeId(e.mesh, e.mesh.findHalfEdge(0, 2)))
    await checkUndoRedo(e, () => e.delete())
    expect(e.mesh.faceCount).toBe(4)
    expect(e.mesh.vertexCount).toBe(8)
  })

  it('faces: vertices left without faces are removed', async () => {
    const e = new MeshEditor(makeGrid(2))
    e.selection.setMode('face')
    e.selection.click(0)
    await checkUndoRedo(e, () => e.delete())
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([8, 3])
  })

  it('everything: empty but valid mesh', async () => {
    const e = new MeshEditor(makeCube())
    e.selection.setMode('face')
    e.selection.selectAll()
    await checkUndoRedo(e, () => e.delete())
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([0, 0])
  })

  it('a bow-tie vertex keeps a valid half-edge after one fan is deleted', async () => {
    // Two quads sharing only the centre vertex of the grid
    const e = new MeshEditor(makeGrid(2))
    e.selection.setMode('face')
    e.selection.click(1)
    e.selection.click(2, true)
    await checkUndoRedo(e, () => e.delete())
    e.selection.selectNone()
    e.selection.click(0)
    await checkUndoRedo(e, () => e.delete())
    expect(e.mesh.faceCount).toBe(1)
  })
})

describe('merge', () => {
  it('at center: a cube top collapses into a pyramid apex', async () => {
    const e = new MeshEditor(makeCube(1))
    const top = cubeFace(e, 1)
    for (const v of e.mesh.faceVertices(top)) e.selection.click(v, true)
    await checkUndoRedo(e, () => e.mergeAtCenter())
    expect([e.mesh.vertexCount, e.mesh.faceCount]).toEqual([5, 5])
    expect(closed(e)).toBe(true)
    expect(volume(e)).toBeCloseTo(1 / 3, 6)
    const [apex] = [...e.selection.vertices]
    expect(Array.from(e.mesh.positions.subarray(apex * 3, apex * 3 + 3))).toEqual([0, 0.5, 0])
  })

  it('by distance welds seam duplicates back into a closed cube', async () => {
    // Flat-shaded cube converted without welding: 24 vertices, 6 separate quads
    const flat = toLindenMesh(makeCube())
    const soup = fromLindenMesh({
      positions: new Float32Array(Array.from(flat.polygons!.indices).flatMap((v) => Array.from(flat.positions.subarray(v * 3, v * 3 + 3)))),
      indices: new Uint32Array(0),
      polygons: { sizes: flat.polygons!.sizes, indices: Uint32Array.from({ length: 24 }, (_, i) => i) },
    })
    if (!soup.ok) throw new Error(soup.message)
    const e = new MeshEditor(soup.value.mesh)
    expect(e.mesh.vertexCount).toBe(24)
    e.selection.selectAll()
    await checkUndoRedo(e, () => e.mergeByDistance(1e-5))
    expect(e.mesh.vertexCount).toBe(8)
    expect(closed(e)).toBe(true)
  })

  it('by distance with nothing close is a no-op success', async () => {
    const e = new MeshEditor(makeCube())
    e.selection.selectAll()
    await checkUndoRedo(e, () => e.mergeByDistance(0.01))
    expect(e.mesh.vertexCount).toBe(8)
  })

  it('a merge that would pinch a face fails and leaves the mesh unchanged', async () => {
    // Opposite corners of one grid quad: the quad would use the merged vertex twice
    const n = 2
    const e = new MeshEditor(makeGrid(n))
    const before = e.mesh.toData()
    e.selection.click(gridVertex(n, 0, 0))
    e.selection.click(gridVertex(n, 1, 1), true)
    const r = await e.mergeAtCenter()
    expect(r.ok || r.code).toBe('INVALID_TOPOLOGY')
    expect(e.mesh.toData()).toEqual(before)
  })

  it('needs two vertices', async () => {
    const e = new MeshEditor(makeCube())
    e.selection.click(0)
    expect((await e.mergeAtCenter()).ok).toBe(false)
  })
})

describe('transform', () => {
  it('move / rotate / scale about the median', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(cubeFace(e, 1))
    await checkUndoRedo(e, () => e.transform({ translate: [0, 1, 0] }))
    expect(volume(e)).toBeCloseTo(2, 6)
    await checkUndoRedo(e, () => e.transform({ scale: 2 }))
    await checkUndoRedo(e, () => e.transform({ rotate: { axis: [0, 1, 0], angle: Math.PI / 4 } }))
    const [top] = [...e.selection.faces]
    for (const v of e.mesh.faceVertices(top)) {
      expect(Math.hypot(e.mesh.positions[v * 3], e.mesh.positions[v * 3 + 2])).toBeCloseTo(Math.SQRT2, 5)
    }
  })

  it('individual pivots scale each island about its own center', async () => {
    const e = new MeshEditor(makeCube(1))
    e.selection.setMode('face')
    e.selection.click(cubeFace(e, 1))
    e.selection.click(cubeFace(e, 1, -1), true)
    await checkUndoRedo(e, () => e.transform({ scale: 0.5 }, 'individual'))
    // Top face shrank towards (0, 0.5, 0), not towards the cube centre
    const [a] = [...e.selection.faces].filter((f) => e.mesh.faceNormal(f)[1] > 0)
    for (const v of e.mesh.faceVertices(a)) expect(e.mesh.positions[v * 3 + 1]).toBeCloseTo(0.5)
  })

  it('interactive drag: update re-applies from the start, commit is one undo step, cancel restores', async () => {
    const e = new MeshEditor(makeCube(1))
    const start = e.mesh.toData()
    e.selection.click(0)
    e.beginTransform()
    e.updateTransform({ translate: [1, 0, 0] })
    e.updateTransform({ translate: [2, 0, 0] })
    expect(e.mesh.positions[0]).toBeCloseTo(1.5)
    await e.commitTransform()
    expect(e.history.labels.undo).toEqual(['Transform'])
    await e.undo()
    expect(e.mesh.toData()).toEqual(start)
    await e.redo()
    expect(e.mesh.positions[0]).toBeCloseTo(1.5)
    e.beginTransform()
    e.updateTransform({ translate: [5, 0, 0] })
    e.cancelTransform()
    expect(e.mesh.positions[0]).toBeCloseTo(1.5)
  })
})

describe('history', () => {
  it('a random sequence of 60 edits stays valid; undo all restores the original exactly', async () => {
    let seed = 12345
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const e = new MeshEditor(makeUvSphere(1, 8, 6), { historyDepth: 1000 })
    const original = e.mesh.toData()
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
    let applied = 0
    for (let i = 0; i < 60; i++) {
      const faces = [...Array(e.mesh.faceSlots).keys()].filter((f) => e.mesh.isFaceAlive(f))
      if (faces.length === 0) break
      e.selection.setMode('face')
      e.selection.selectNone()
      e.selection.click(pick(faces))
      if (rand() < 0.3) e.selection.click(pick(faces), true)
      const op = pick(['extrude', 'inset', 'move', 'delete', 'merge', 'scale'])
      const r = op === 'extrude' ? await e.extrude(rand())
        : op === 'inset' ? await e.inset(0.01 + rand() * 0.05)
        : op === 'move' ? await e.transform({ translate: [rand(), rand(), rand()] })
        : op === 'scale' ? await e.transform({ scale: 0.5 + rand() }, 'individual')
        : op === 'delete' && faces.length > 4 ? await e.delete()
        : (e.selection.setMode('vertex'), await e.mergeAtCenter())
      if (r.ok) applied++
      expectValid(e.mesh)
    }
    expect(applied).toBeGreaterThan(30)
    const final = e.mesh.toData()
    while (e.history.canUndo) {
      await e.undo()
      expectValid(e.mesh)
    }
    expect(e.mesh.toData()).toEqual(original)
    while (e.history.canRedo) await e.redo()
    expect(e.mesh.toData()).toEqual(final)
  })

  it('history depth is bounded', async () => {
    const e = new MeshEditor(makeCube(), { historyDepth: 3 })
    e.selection.click(0)
    for (let i = 0; i < 5; i++) await e.transform({ translate: [1, 0, 0] })
    expect(e.history.labels.undo).toHaveLength(3)
  })

  it('a new edit clears the redo stack', async () => {
    const e = new MeshEditor(makeCube())
    e.selection.click(0)
    await e.transform({ translate: [1, 0, 0] })
    await e.undo()
    expect(e.history.canRedo).toBe(true)
    await e.transform({ translate: [0, 1, 0] })
    expect(e.history.canRedo).toBe(false)
  })

  it('version and listeners fire on every change, including undo/redo', async () => {
    const e = new MeshEditor(makeCube())
    let calls = 0
    const off = e.onChange(() => calls++)
    e.selection.click(0)
    await e.transform({ translate: [1, 0, 0] })
    await e.undo()
    await e.redo()
    expect(calls).toBe(3)
    expect(e.version).toBe(3)
    off()
  })
})

describe('async WASM commands', () => {
  /** GeometryOps backed directly by the adapters (the worker transport is covered elsewhere) */
  const geometry = (delayMs = 0): GeometryOps => ({
    boolean: async (a, b, op) => {
      await new Promise((r) => setTimeout(r, delayMs))
      return booleanMeshes(a, b, op)
    },
    subdivide: async () => err('NOT_IMPLEMENTED', 'Phase 4'),
    unwrapUV: async () => err('NOT_IMPLEMENTED', ''),
    remesh: async () => err('NOT_IMPLEMENTED', ''),
    smooth: async () => err('NOT_IMPLEMENTED', ''),
    repair: async () => err('NOT_IMPLEMENTED', ''),
    simplify: async () => err('NOT_IMPLEMENTED', ''),
    generateLODs: async () => err('NOT_IMPLEMENTED', ''),
  })

  it('boolean is an undoable command', async () => {
    const e = new MeshEditor(makeCube(1), { geometry: geometry() })
    const sphere = toLindenMesh(makeUvSphere(0.6), { polygons: false })
    await checkUndoRedo(e, () => e.booleanWith(sphere, 'subtract'))
    expect(closed(e)).toBe(true)
    expect(volume(e)).toBeLessThan(0.5)
  })

  it('undo issued while the boolean is running waits for it (queued, not interleaved)', async () => {
    const e = new MeshEditor(makeCube(1), { geometry: geometry(30) })
    const original = e.mesh.toData()
    e.selection.click(0)
    await e.transform({ translate: [0.1, 0, 0] })
    const moved = e.mesh.toData()
    const running = e.booleanWith(toLindenMesh(makeUvSphere(0.6), { polygons: false }), 'subtract')
    expect(e.history.busy).toBe(true)
    const undo = e.undo() // must undo the boolean, not the transform
    expect((await running).ok).toBe(true)
    await undo
    expect(e.mesh.toData()).toEqual(moved)
    await e.undo()
    expect(e.mesh.toData()).toEqual(original)
    expect(e.history.busy).toBe(false)
  })

  it('a failed async op records nothing and changes nothing', async () => {
    const e = new MeshEditor(makeCube(1), { geometry: geometry() })
    const before = e.mesh.toData()
    const r = await e.subdivide(2)
    expect(r.ok || r.code).toBe('NOT_IMPLEMENTED')
    const open = toLindenMesh(makeCube(1), { polygons: false })
    const bad = await e.booleanWith({ positions: open.positions, indices: open.indices.slice(6) }, 'union')
    expect(bad.ok || bad.code).toBe('NON_MANIFOLD_INPUT')
    expect(e.mesh.toData()).toEqual(before)
    expect(e.history.canUndo).toBe(false)
  })

  it('without GeometryOps the WASM commands say so', async () => {
    const e = new MeshEditor(makeCube())
    expect((await e.subdivide(1)).ok).toBe(false)
    expect((await e.booleanWith(toLindenMesh(makeCube()), 'union')).ok).toBe(false)
    expect(ok(1).ok).toBe(true)
  })
})

describe('safety net', () => {
  it('an operation that produces NaN positions is rolled back with a typed error', async () => {
    const e = new MeshEditor(makeCube(1))
    const before = e.mesh.toData()
    // An infinite inset depth puts Infinity into the new vertices
    e.selection.setMode('face')
    e.selection.click(0)
    const r = await e.inset(0.1, Number.POSITIVE_INFINITY)
    expect(r.ok || r.code).toBe('INTERNAL')
    expect(e.mesh.toData()).toEqual(before)
    expect(e.history.canUndo).toBe(false)
  })
})
