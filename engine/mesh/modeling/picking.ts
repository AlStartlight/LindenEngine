import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import { triangulatePolygon } from '../core/triangulate'
import type { SelectMode } from './selection'
import { edgeId } from './topology'

export interface PickHit {
  face: number
  /** Vertex of the hit face closest to the hit point */
  vertex: number
  /** Edge (edgeId) of the hit face closest to the hit point */
  edge: number
  point: [number, number, number]
  distance: number
}

/**
 * Ray picking for edit mode, backed by a three-mesh-bvh BVH over the triangulated faces. A ray hit on a
 * triangle maps back to its n-gon face, then snaps to that face's nearest vertex or edge. Call `refit()`
 * after moving vertices and `rebuild()` after topology changes (MeshEditor.version tells which is needed).
 */
export class MeshPicker {
  private geometry = new BufferGeometry()
  private bvh: MeshBVH | null = null
  private triFace = new Int32Array(0)

  constructor(private readonly mesh: HalfEdgeMesh) {
    this.rebuild()
  }

  rebuild(): void {
    const m = this.mesh
    const indices: number[] = []
    const faces: number[] = []
    const scratch: number[] = []
    for (let f = 0; f < m.faceSlots; f++) {
      if (m.faceHalfEdge[f] < 0) continue
      const vs = m.faceVertices(f)
      const pts: number[] = []
      for (const v of vs) pts.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
      scratch.length = 0
      triangulatePolygon(pts, scratch)
      for (let i = 0; i < scratch.length; i += 3) {
        indices.push(vs[scratch[i]], vs[scratch[i + 1]], vs[scratch[i + 2]])
        faces.push(f)
      }
    }
    this.triFace = Int32Array.from(faces)
    this.geometry.dispose()
    this.geometry = new BufferGeometry()
    // Indexed by vertex slot, so moved vertices only need a refit
    this.geometry.setAttribute('position', new BufferAttribute(m.positions.slice(0, m.vertexSlots * 3), 3))
    this.geometry.setIndex(indices)
    // indirect: by default MeshBVH reorders the index buffer, which would break the triangle -> face map
    this.bvh = indices.length ? new MeshBVH(this.geometry, { indirect: true }) : null
  }

  /** Updates bounds after vertices moved (same topology) */
  refit(): void {
    if (!this.bvh) return
    const attr = this.geometry.getAttribute('position') as BufferAttribute
    ;(attr.array as Float32Array).set(this.mesh.positions.subarray(0, attr.array.length))
    attr.needsUpdate = true
    this.bvh.refit()
  }

  raycast(ray: Ray): PickHit | null {
    if (!this.bvh) return null
    const hit = this.bvh.raycastFirst(ray, DoubleSide)
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null
    const m = this.mesh
    const face = this.triFace[hit.faceIndex]
    const p = hit.point
    let vertex = -1
    let best = Infinity
    let edge = -1
    let bestEdge = Infinity
    const a = new Vector3()
    const b = new Vector3()
    const closest = new Vector3()
    for (const h of m.faceHalfEdges(face)) {
      const v = m.heVertex[h]
      a.fromArray(m.positions, v * 3)
      const dv = a.distanceTo(p)
      if (dv < best) {
        best = dv
        vertex = v
      }
      b.fromArray(m.positions, m.heTarget(h) * 3)
      new Ray(a, b.clone().sub(a).normalize()).closestPointToPoint(p, closest)
      // Clamp to the segment
      const len = a.distanceTo(b)
      const t = closest.distanceTo(a)
      if (t > len) closest.copy(b)
      const de = closest.distanceTo(p)
      if (de < bestEdge) {
        bestEdge = de
        edge = edgeId(m, h)
      }
    }
    return { face, vertex, edge, point: [p.x, p.y, p.z], distance: hit.distance }
  }

  /** The element of `mode` under the ray, or null */
  pick(ray: Ray, mode: SelectMode): number | null {
    const hit = this.raycast(ray)
    if (!hit) return null
    return mode === 'vertex' ? hit.vertex : mode === 'edge' ? hit.edge : hit.face
  }

  dispose(): void {
    this.geometry.dispose()
    this.bvh = null
  }
}
