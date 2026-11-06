import * as THREE from 'three'
import type { PartShape } from './ModelSpec'
import { BuiltPart, partMaterial } from './buildModel'
import { materialPhysics, MaterialPhysics } from '../materials/physicalProperties'

/**
 * Mass properties of a part-based model: volume per part (exact for closed parts, a thin shell for
 * open surfaces), density from the part's material (or ModelPart.density), and the center of mass.
 * Used by the balance check and by compound colliders. Model space, meters, kg.
 */

/** Thickness given to open surfaces (planes, open cylinders, lathes without wall thickness) */
export const SHELL_THICKNESS = 0.003

export interface PartMass {
  id: string
  volume: number
  density: number
  mass: number
  /** Model-space center of mass */
  centroid: THREE.Vector3
  physics: MaterialPhysics
}

export interface ModelMass {
  parts: PartMass[]
  mass: number
  centerOfMass: THREE.Vector3
}

/** Whether the shape's geometry encloses a volume (the signed-volume formula applies) */
export function isClosedShape(shape: PartShape): boolean {
  switch (shape.type) {
    case 'plane':
      return false
    case 'cylinder':
      return !shape.openEnded
    case 'lathe': {
      if ((shape.thickness ?? 0) > 0) return true
      const first = shape.points[0][0]
      const last = shape.points[shape.points.length - 1][0]
      return (first <= 1e-6 || !!shape.capBottom) && last <= 1e-6
    }
    case 'tube':
      return false // computed analytically: TubeGeometry has open ends
    case 'torus':
      return false // computed analytically: a partial arc has open ends
    default:
      return true
  }
}

function forEachTri(g: THREE.BufferGeometry, fn: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void): void {
  const pos = g.attributes.position
  const idx = g.index
  const n = (idx ? idx.count : pos.count) / 3
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t < n; t++) {
    a.fromBufferAttribute(pos, idx ? idx.getX(t * 3) : t * 3)
    b.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + 1) : t * 3 + 1)
    c.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + 2) : t * 3 + 2)
    fn(a, b, c)
  }
}

/** Volume and centroid of a closed triangle mesh (divergence theorem, tetrahedra to a reference point) */
function closedVolume(g: THREE.BufferGeometry): { volume: number; centroid: THREE.Vector3 } {
  const o = g.boundingBox!.getCenter(new THREE.Vector3())
  const pa = new THREE.Vector3()
  const pb = new THREE.Vector3()
  const pc = new THREE.Vector3()
  const cross = new THREE.Vector3()
  const acc = new THREE.Vector3()
  let vol = 0
  forEachTri(g, (a, b, c) => {
    pa.subVectors(a, o)
    pb.subVectors(b, o)
    pc.subVectors(c, o)
    const v = pa.dot(cross.crossVectors(pb, pc)) / 6
    vol += v
    // Tetra centroid relative to o is (pa + pb + pc) / 4
    acc.addScaledVector(pa.add(pb).add(pc), v / 4)
  })
  if (Math.abs(vol) < 1e-15) return { volume: 0, centroid: o }
  return { volume: Math.abs(vol), centroid: acc.divideScalar(vol).add(o) }
}

/** Surface area and area-weighted centroid */
function surface(g: THREE.BufferGeometry): { area: number; centroid: THREE.Vector3 } {
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const acc = new THREE.Vector3()
  let area = 0
  forEachTri(g, (a, b, c) => {
    const s = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2
    area += s
    acc.addScaledVector(a, s / 3).addScaledVector(b, s / 3).addScaledVector(c, s / 3)
  })
  if (area < 1e-15) return { area: 0, centroid: g.boundingBox!.getCenter(new THREE.Vector3()) }
  return { area, centroid: acc.divideScalar(area) }
}

/** Mean of the part's scale factors (analytic volumes of tubes and tori) */
function volumeScale(bp: BuiltPart): number {
  const s = new THREE.Vector3()
  bp.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), s)
  return Math.abs(s.x * s.y * s.z)
}

export function partMass(bp: BuiltPart): PartMass {
  const shape = bp.part.shape
  const physics = materialPhysics(partMaterial(bp.part))
  const density = bp.part.density ?? physics.density
  let volume: number
  let centroid: THREE.Vector3
  if (shape.type === 'tube') {
    const curve = new THREE.CatmullRomCurve3(shape.path.map(([x, y, z]) => new THREE.Vector3(x, y, z)), shape.closed ?? false)
    const r = shape.radius
    volume = (Math.PI * r * r * curve.getLength() + (shape.capped && !shape.closed ? (4 / 3) * Math.PI * r ** 3 : 0)) * volumeScale(bp)
    centroid = surface(bp.geometry).centroid
  } else if (shape.type === 'torus') {
    const arc = shape.arc ?? Math.PI * 2
    volume = Math.PI * shape.tube ** 2 * shape.radius * arc * volumeScale(bp)
    centroid = surface(bp.geometry).centroid
  } else if (isClosedShape(shape)) {
    ;({ volume, centroid } = closedVolume(bp.geometry))
  } else {
    const s = surface(bp.geometry)
    volume = s.area * SHELL_THICKNESS
    centroid = s.centroid
  }
  return { id: bp.part.id, volume, density, mass: volume * density, centroid, physics }
}

export function modelMass(parts: BuiltPart[]): ModelMass {
  const list = parts.map(partMass)
  let mass = 0
  const com = new THREE.Vector3()
  for (const p of list) {
    mass += p.mass
    com.addScaledVector(p.centroid, p.mass)
  }
  if (mass > 0) com.divideScalar(mass)
  return { parts: list, mass, centerOfMass: com }
}
