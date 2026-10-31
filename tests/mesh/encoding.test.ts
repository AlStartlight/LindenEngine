import { describe, expect, it } from 'vitest'
import { toLindenMesh } from '../../engine/mesh/core/convert'
import { decodeHalfEdgeMesh, encodeHalfEdgeMesh } from '../../engine/mesh/core/encoding'
import { EDITABLE_PRIMITIVES, editablePrimitive, scaleMesh } from '../../engine/mesh/core/editablePrimitives'
import { makeCube, makeCylinder } from '../../engine/mesh/core/primitives'
import { validateTopology } from '../../engine/mesh/core/validate'
import { bbox, isClosedManifold, signedVolume } from './helpers'

describe('linden-mesh encoding', () => {
  it('round-trips topology, positions and corner uvs exactly (n-gons kept)', () => {
    for (const kind of EDITABLE_PRIMITIVES) {
      const m = editablePrimitive(kind)
      const enc = encodeHalfEdgeMesh(m)
      const back = decodeHalfEdgeMesh(JSON.parse(JSON.stringify(enc)))
      expect(back.ok).toBe(true)
      if (!back.ok) return
      expect(back.value.toData()).toEqual(m.compact().mesh.toData())
    }
  })

  it('compacts removed elements before encoding', () => {
    const m = makeCylinder(8)
    m.removeFace(3)
    const back = decodeHalfEdgeMesh(encodeHalfEdgeMesh(m))
    expect(back.ok && back.value.faceCount).toBe(9)
    expect(back.ok && back.value.faceSlots).toBe(9)
  })

  it('is much smaller than plain JSON number arrays', () => {
    // Same content both ways: positions, face loops and corner uvs (scene files are pretty-printed)
    const m = editablePrimitive('torus')
    const enc = JSON.stringify(encodeHalfEdgeMesh(m), null, 2)
    const plain = JSON.stringify({
      positions: Array.from(m.positions.subarray(0, m.vertexSlots * 3)),
      faces: Array.from({ length: m.faceSlots }, (_, f) => m.faceVertices(f)),
      uvs: Array.from(m.cornerUvs!.subarray(0, m.halfEdgeSlots * 2)),
    }, null, 2)
    expect(enc.length).toBeLessThan(plain.length / 2)
  })

  it('rejects malformed data with typed errors', () => {
    const good = encodeHalfEdgeMesh(makeCube())
    const bad: unknown[] = [
      null, {}, { ...good, format: 'x' }, { ...good, version: 2 }, { ...good, positions: '%%%' },
      { ...good, positions: 'AAA=' }, { ...good, faceSizes: encodeHalfEdgeMesh(makeCylinder(5)).faceSizes },
      { ...good, cornerUvs: good.positions },
      { ...good, faceVertices: encodeHalfEdgeMesh(makeCylinder(9)).faceVertices.slice(0, good.faceVertices.length) },
    ]
    for (const d of bad) {
      const r = decodeHalfEdgeMesh(d)
      expect(r.ok || r.code).toBe('INVALID_MESH')
    }
  })
})

describe('editable primitives', () => {
  const closedKinds = ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'torus'] as const
  const expectedVolume: Record<string, number> = {
    box: 1, sphere: (4 / 3) * Math.PI * 0.125, cylinder: Math.PI * 0.25, capsule: Math.PI * 0.25 + (4 / 3) * Math.PI * 0.125,
    cone: (Math.PI * 0.25) / 3, torus: 2 * Math.PI * Math.PI * 0.375 * 0.125 * 0.125,
  }

  for (const kind of closedKinds) {
    it(`${kind}: closed manifold, outward, volume close to the analytic shape, full uvs`, () => {
      const m = editablePrimitive(kind)
      expect(validateTopology(m)).toEqual([])
      const l = toLindenMesh(m, { polygons: false })
      expect(isClosedManifold(l)).toBe(true)
      const vol = signedVolume(l)
      expect(vol).toBeGreaterThan(0)
      expect(vol / expectedVolume[kind]).toBeGreaterThan(0.9)
      expect(vol / expectedVolume[kind]).toBeLessThanOrEqual(1.0001)
      expect(m.cornerUvs).not.toBeNull()
      for (let i = 0; i < m.halfEdgeSlots * 2; i++) expect(m.cornerUvs![i]).toBeGreaterThanOrEqual(0)
    })
  }

  it('sizes match the three.js primitives (bounding boxes)', () => {
    const size = (k: string) => {
      const m = editablePrimitive(k)
      const b = bbox(m.positions.subarray(0, m.vertexSlots * 3))
      return b.max.map((x, i) => +(x - b.min[i]).toFixed(6))
    }
    expect(size('box')).toEqual([1, 1, 1])
    expect(size('sphere')).toEqual([1, 1, 1])
    expect(size('cylinder')).toEqual([1, 1, 1])
    expect(size('capsule')).toEqual([1, 2, 1])
    expect(size('cone')).toEqual([1, 1, 1])
    expect(size('torus')).toEqual([1, 1, 0.25])
    expect(size('plane')).toEqual([1, 1, 0])
  })

  it('cylinder and cone have n-gon caps; box and cylinder sides are quads', () => {
    const faces = (k: string) => {
      const m = editablePrimitive(k)
      return Array.from({ length: m.faceSlots }, (_, f) => m.faceSize(f))
    }
    expect(faces('box').every((n) => n === 4)).toBe(true)
    expect(faces('cylinder').filter((n) => n === 24)).toHaveLength(2)
    expect(faces('cone').filter((n) => n === 24)).toHaveLength(1)
    expect(faces('plane')).toEqual([4])
    expect(editablePrimitive('plane').faceNormal(0)[2]).toBeGreaterThan(0)
    expect(editablePrimitive('unknown').faceCount).toBe(6)
  })

  it('scaleMesh bakes MeshRenderer.size; invalid sizes are ignored', () => {
    const m = editablePrimitive('box')
    const max = () => bbox(m.positions.subarray(0, m.vertexSlots * 3)).max
    scaleMesh(m, [2, 3, 4])
    expect(max()).toEqual([1, 1.5, 2])
    scaleMesh(m, 'nope')
    expect(max()).toEqual([1, 1.5, 2])
  })
})
