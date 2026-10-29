import * as THREE from 'three'
import { ModelSpecSchema } from './ModelSpec'
import { buildPartGeometries } from './buildModel'

/**
 * Collider shape for a Model with `collider: 'box' | 'convexHull'`, in the entity's local space with
 * its scale applied. Part models use their geometry (also headless); src models use the stored
 * `bounds` (written when the model is imported), so linden_play needs no glTF loader.
 */
export type ModelColliderShape =
  | { kind: 'box'; center: [number, number, number]; halfExtents: [number, number, number] }
  | { kind: 'hull'; points: Float32Array }

const MAX_HULL_POINTS = 2048

export function modelColliderShape(model: Record<string, any>, scale: { x: number; y: number; z: number }): ModelColliderShape | null {
  const mode = model.collider
  if (mode !== 'box' && mode !== 'convexHull') return null
  const s = new THREE.Vector3(scale.x, scale.y, scale.z)

  const boxFrom = (min: THREE.Vector3, max: THREE.Vector3): ModelColliderShape => {
    const c = min.clone().add(max).multiplyScalar(0.5).multiply(s)
    const h = max.clone().sub(min).multiplyScalar(0.5).multiply(s)
    return { kind: 'box', center: [c.x, c.y, c.z], halfExtents: [Math.max(Math.abs(h.x), 0.001), Math.max(Math.abs(h.y), 0.001), Math.max(Math.abs(h.z), 0.001)] }
  }

  if (model.src) {
    const b = model.bounds
    if (!Array.isArray(b) || b.length !== 2) return null
    return boxFrom(new THREE.Vector3(...b[0]), new THREE.Vector3(...b[1]))
  }

  const parsed = ModelSpecSchema.safeParse({ parts: model.parts })
  if (!parsed.success || parsed.data.parts.length === 0) return null
  const parts = buildPartGeometries(parsed.data)
  try {
    if (mode === 'box') {
      const bounds = new THREE.Box3()
      for (const p of parts) bounds.union(p.geometry.boundingBox!)
      return boxFrom(bounds.min, bounds.max)
    }
    let total = 0
    for (const p of parts) total += p.geometry.attributes.position.count
    const step = Math.max(1, Math.ceil(total / MAX_HULL_POINTS))
    const pts: number[] = []
    let i = 0
    const v = new THREE.Vector3()
    for (const p of parts) {
      const pos = p.geometry.attributes.position
      for (let k = 0; k < pos.count; k++, i++) {
        if (i % step !== 0) continue
        v.fromBufferAttribute(pos, k).multiply(s)
        pts.push(v.x, v.y, v.z)
      }
    }
    return { kind: 'hull', points: new Float32Array(pts) }
  } finally {
    for (const p of parts) p.geometry.dispose()
  }
}
