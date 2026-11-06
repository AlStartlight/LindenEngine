import * as THREE from 'three'
import { ModelSpecSchema } from './ModelSpec'
import { buildPartGeometries, BuiltPart } from './buildModel'
import { modelMass, PartMass } from './massProperties'

/**
 * Collider shape for a Model with `collider: 'box' | 'convexHull'`, in the entity's local space with
 * its scale applied. Part models use their geometry (also headless); src models use the stored
 * `bounds` (written when the model is imported), so linden_play needs no glTF loader.
 */
type V3 = [number, number, number]
type Quat = [number, number, number, number]

/** One collider of a compound: position/rotation relative to the entity, sizes with its scale applied */
export type SubCollider = (
  | { kind: 'cuboid'; halfExtents: V3 }
  | { kind: 'ball'; radius: number }
  | { kind: 'capsule'; halfHeight: number; radius: number }
  | { kind: 'cylinder'; halfHeight: number; radius: number }
  | { kind: 'hull'; points: Float32Array }
) & {
  center: V3
  rotation: Quat
  /** Share of the model's mass (sums to 1 over the compound) */
  massFraction: number
  friction: number
  restitution: number
  part: string
}

export type ModelColliderShape =
  | { kind: 'box'; center: V3; halfExtents: V3; friction?: number; restitution?: number }
  | { kind: 'hull'; points: Float32Array; friction?: number; restitution?: number }
  | { kind: 'compound'; colliders: SubCollider[] }

const MAX_HULL_POINTS = 2048
const MAX_PART_HULL_POINTS = 256
/** Above this many colliders a compound falls back to one convex hull */
export const MAX_COMPOUND_COLLIDERS = 256

const isUniform = (v: THREE.Vector3, eps = 1e-4) => Math.abs(v.x - v.y) <= eps * Math.abs(v.x) && Math.abs(v.x - v.z) <= eps * Math.abs(v.x)

/** Hull points of a part (model space × entity scale), subsampled */
function partHullPoints(bp: BuiltPart, s: THREE.Vector3): Float32Array {
  const pos = bp.geometry.attributes.position
  const step = Math.max(1, Math.ceil(pos.count / MAX_PART_HULL_POINTS))
  const pts: number[] = []
  const v = new THREE.Vector3()
  for (let k = 0; k < pos.count; k += step) {
    v.fromBufferAttribute(pos, k).multiply(s)
    pts.push(v.x, v.y, v.z)
  }
  return new Float32Array(pts)
}

/**
 * Colliders of one part. Boxes, spheres, capsules and straight cylinders become exact primitives
 * when the part's transform has no shear and the entity scale is uniform; tubes and tori become a
 * chain of capsules along their curve (a hull would fill the bend or the hole); the rest a convex
 * hull of the part.
 */
function partColliders(bp: BuiltPart, pm: PartMass, s: THREE.Vector3, totalMass: number): SubCollider[] {
  const shape = bp.part.shape
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  bp.matrix.decompose(pos, quat, scl)
  // Shear (non-uniform parent scale under a rotation) makes the decomposition inexact
  const recomposed = new THREE.Matrix4().compose(pos, quat, scl).elements
  const exact = recomposed.every((e, i) => Math.abs(e - bp.matrix.elements[i]) < 1e-6)
  const uniformEntity = isUniform(s)
  const k = s.x
  const fraction = totalMass > 0 ? pm.mass / totalMass : 0
  const base = { friction: pm.physics.friction, restitution: pm.physics.restitution, part: bp.part.id }
  const center = pos.clone().multiply(s).toArray() as V3
  const rotation = quat.toArray() as Quat
  const primitive = exact && uniformEntity

  if (primitive && shape.type === 'roundedBox') {
    const [w, h, d] = shape.size
    return [{ kind: 'cuboid', halfExtents: [(w * Math.abs(scl.x) * k) / 2, (h * Math.abs(scl.y) * k) / 2, (d * Math.abs(scl.z) * k) / 2], center, rotation, massFraction: fraction, ...base }]
  }
  if (primitive && shape.type === 'plane' && !shape.displacement) {
    // A flat plane has no volume for a hull: a 1 cm slab just under its surface
    const [w, d] = shape.size
    const t = 0.005
    const below = new THREE.Vector3(0, -t * Math.abs(scl.y), 0).applyQuaternion(quat).multiplyScalar(k)
    return [{ kind: 'cuboid', halfExtents: [(w * Math.abs(scl.x) * k) / 2, t * Math.abs(scl.y) * k, (d * Math.abs(scl.z) * k) / 2], center: [center[0] + below.x, center[1] + below.y, center[2] + below.z], rotation, massFraction: fraction, ...base }]
  }
  if (primitive && isUniform(scl)) {
    const u = Math.abs(scl.x) * k
    if (shape.type === 'sphere') return [{ kind: 'ball', radius: shape.radius * u, center, rotation, massFraction: fraction, ...base }]
    if (shape.type === 'capsule') return [{ kind: 'capsule', halfHeight: (shape.length * u) / 2, radius: shape.radius * u, center, rotation, massFraction: fraction, ...base }]
    if (shape.type === 'cylinder' && !shape.openEnded && Math.abs(shape.radiusTop - shape.radiusBottom) < 1e-6) {
      return [{ kind: 'cylinder', halfHeight: (shape.height * u) / 2, radius: shape.radiusTop * u, center, rotation, massFraction: fraction, ...base }]
    }
  }

  // Curves → capsule chains in model space (the part matrix applied to the curve points)
  let curvePoints: THREE.Vector3[] | null = null
  let radius = 0
  if (shape.type === 'tube') {
    const curve = new THREE.CatmullRomCurve3(shape.path.map(([x, y, z]) => new THREE.Vector3(x, y, z)), shape.closed ?? false)
    const segs = Math.min(24, Math.max(2, shape.path.length * 3))
    curvePoints = curve.getSpacedPoints(segs)
    radius = shape.radius
  } else if (shape.type === 'torus') {
    const arc = shape.arc ?? Math.PI * 2
    const segs = Math.max(4, Math.min(24, Math.round((arc / (Math.PI * 2)) * 16)))
    curvePoints = Array.from({ length: segs + 1 }, (_, i) => {
      const a = (i / segs) * arc
      return new THREE.Vector3(Math.cos(a) * shape.radius, Math.sin(a) * shape.radius, 0)
    })
    radius = shape.tube
  }
  if (curvePoints && exact && uniformEntity && isUniform(scl)) {
    const u = Math.abs(scl.x) * k
    const pts = curvePoints.map((p) => p.applyMatrix4(bp.matrix).multiply(s))
    const out: SubCollider[] = []
    const up = new THREE.Vector3(0, 1, 0)
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const len = a.distanceTo(b)
      if (len < 1e-6) continue
      const dir = b.clone().sub(a).divideScalar(len)
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir)
      out.push({ kind: 'capsule', halfHeight: len / 2, radius: radius * u, center: a.clone().add(b).multiplyScalar(0.5).toArray() as V3, rotation: q.toArray() as Quat, massFraction: 0, ...base })
    }
    out.forEach((c) => (c.massFraction = fraction / out.length))
    if (out.length) return out
  }

  return [{ kind: 'hull', points: partHullPoints(bp, s), center: [0, 0, 0], rotation: [0, 0, 0, 1], massFraction: fraction, ...base }]
}

export function modelColliderShape(model: Record<string, any>, scale: { x: number; y: number; z: number }): ModelColliderShape | null {
  const mode = model.collider
  if (mode !== 'box' && mode !== 'convexHull' && mode !== 'compound') return null
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
    const mass = modelMass(parts)
    // Friction of the whole object when it has a single collider: mass-weighted over its parts
    const surface = { friction: 0, restitution: 0 }
    for (const pm of mass.parts) {
      const w = mass.mass > 0 ? pm.mass / mass.mass : 1 / mass.parts.length
      surface.friction += pm.physics.friction * w
      surface.restitution += pm.physics.restitution * w
    }
    if (mode === 'compound') {
      const colliders = parts.flatMap((bp, i) => partColliders(bp, mass.parts[i], s, mass.mass))
      if (colliders.length <= MAX_COMPOUND_COLLIDERS) return { kind: 'compound', colliders }
      // Too many pieces for the physics step: one hull of everything
    }
    if (mode === 'box') {
      const bounds = new THREE.Box3()
      for (const p of parts) bounds.union(p.geometry.boundingBox!)
      return { ...boxFrom(bounds.min, bounds.max), ...surface } as ModelColliderShape
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
    return { kind: 'hull', points: new Float32Array(pts), ...surface }
  } finally {
    for (const p of parts) p.geometry.dispose()
  }
}
