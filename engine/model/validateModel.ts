import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { ModelSpec } from './ModelSpec'
import { buildPartGeometries, BuiltPart } from './buildModel'
import { modelMass } from './massProperties'
import { findRealWorldDimension } from '../assets/realWorldDimensions'

/**
 * Checks a part-based model for the mistakes that make generated objects look wrong:
 * floating/disconnected parts, parts sunk into each other, an object that does not stand on the
 * ground, a scale far from the real object, and inside-out geometry. Runs headless (agent tool).
 */

export type ModelIssueCode =
  | 'DISCONNECTED_PART'
  | 'ATTACH_GAP'
  | 'EXCESSIVE_OVERLAP'
  | 'NOT_ON_GROUND'
  | 'BELOW_GROUND'
  | 'SCALE_MISMATCH'
  | 'INVERTED_NORMALS'
  | 'DEGENERATE_PART'
  | 'UNKNOWN_CATEGORY'
  | 'UNSTABLE_BALANCE'

export interface ModelIssue {
  code: ModelIssueCode
  severity: 'error' | 'warning'
  parts: string[]
  message: string
}

export interface ModelReport {
  ok: boolean
  issues: ModelIssue[]
  /** Overall size [x, y, z] in meters and the model-space bounds */
  size: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
  triangles: number
  /** The real-world reference used for the scale check */
  reference?: { key: string; size: [number, number, number]; details?: Record<string, number> }
  /** Total mass in kg from part volumes and material densities */
  mass: number
  /** Model-space center of mass */
  centerOfMass: [number, number, number]
  /**
   * Horizontal distance (m) from the center of mass to the edge of the ground support area:
   * positive = inside (stable), negative = outside (tips over). Null when not resting on the floor.
   */
  supportMargin: number | null
}

/** Gap below which two parts count as touching: 3 mm or 1% of the smaller part */
function touchTolerance(a: THREE.Box3, b: THREE.Box3): number {
  const sa = a.getSize(new THREE.Vector3())
  const sb = b.getSize(new THREE.Vector3())
  const smaller = Math.min(Math.max(sa.x, sa.y, sa.z), Math.max(sb.x, sb.y, sb.z))
  return Math.max(0.003, smaller * 0.01)
}

function boxGap(a: THREE.Box3, b: THREE.Box3): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x)
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y)
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z)
  return Math.hypot(dx, dy, dz)
}

function triangleCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3
}

function forEachTriangle(g: THREE.BufferGeometry, fn: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ia: number, ib: number, ic: number) => void): void {
  const pos = g.attributes.position
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const idx = g.index
  const n = triangleCount(g)
  for (let t = 0; t < n; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3
    const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
    const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
    a.fromBufferAttribute(pos, ia)
    b.fromBufferAttribute(pos, ib)
    c.fromBufferAttribute(pos, ic)
    fn(a, b, c, ia, ib, ic)
  }
}

/**
 * Orientation checks: winding (signed volume < 0 means the surface faces inward) and vertex
 * normals that disagree with the winding (lit from the wrong side).
 */
function orientation(g: THREE.BufferGeometry): { signedVolume: number; normalDisagree: number } {
  const normal = g.attributes.normal
  const centroid = new THREE.Vector3()
  g.boundingBox!.getCenter(centroid)
  let vol = 0
  let disagree = 0
  let total = 0
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const face = new THREE.Vector3()
  const vn = new THREE.Vector3()
  const pa = new THREE.Vector3()
  const pb = new THREE.Vector3()
  const pc = new THREE.Vector3()
  forEachTriangle(g, (a, b, c, ia, ib, ic) => {
    pa.subVectors(a, centroid)
    pb.subVectors(b, centroid)
    pc.subVectors(c, centroid)
    vol += pa.dot(pb.clone().cross(pc)) / 6
    face.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
    if (face.lengthSq() < 1e-14 || !normal) return
    vn.fromBufferAttribute(normal, ia).add(new THREE.Vector3().fromBufferAttribute(normal, ib)).add(new THREE.Vector3().fromBufferAttribute(normal, ic))
    total++
    if (vn.dot(face) < 0) disagree++
  })
  return { signedVolume: vol, normalDisagree: total ? disagree / total : 0 }
}

/** Parts get an index (BVH needs one) and a BVH; the BVH reorders triangles, which no check depends on */
function buildBVH(g: THREE.BufferGeometry): MeshBVH {
  if (!g.index) {
    const n = g.attributes.position.count
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n)
    for (let i = 0; i < n; i++) idx[i] = i
    g.setIndex(new THREE.BufferAttribute(idx, 1))
  }
  const bvh = new MeshBVH(g)
  ;(g as any).boundsTree = bvh
  return bvh
}

// Irrational-looking direction: an axis-aligned or 45° ray runs along the edges of generated meshes
const PARITY_DIR = new THREE.Vector3(0.5377, 0.6233, 0.5677).normalize()

/**
 * Depth of point p inside a closed part: the distance to the first surface along a fixed ray when
 * the ray crosses the surface an odd number of times, otherwise -1 (outside)
 */
function insideDepth(p: THREE.Vector3, bvh: MeshBVH, ray: THREE.Ray): number {
  ray.origin.copy(p)
  ray.direction.copy(PARITY_DIR)
  // A ray through a shared edge hits both triangles: count each crossing once
  const dists = bvh
    .raycast(ray, THREE.DoubleSide)
    .map((h) => h.distance)
    .filter((d) => d > 1e-4)
    .sort((a, b) => a - b)
    .filter((d, i, arr) => i === 0 || d - arr[i - 1] > 1e-7)
  if (dists.length % 2 === 0) return -1
  return dists[0]
}

/** Fraction of a's sampled vertices strictly inside b's closed volume (ray parity) */
function insideFraction(a: BuiltPart, b: BuiltPart, bvh: MeshBVH, ray: THREE.Ray): number {
  const pos = a.geometry.attributes.position
  const step = Math.max(1, Math.floor(pos.count / 60))
  const box = b.geometry.boundingBox!
  const v = new THREE.Vector3()
  let inside = 0
  let samples = 0
  for (let i = 0; i < pos.count; i += step) {
    v.fromBufferAttribute(pos, i)
    samples++
    if (!box.containsPoint(v)) continue
    // Hits closer than 2 mm are surface contact, not depth
    if (insideDepth(v, bvh, ray) > 0.002) inside++
  }
  return samples ? inside / samples : 0
}

/** 2D convex hull (monotone chain), counter-clockwise */
function convexHull2D(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Signed distance from p to the edge of a CCW convex polygon: positive inside, negative outside */
export function supportMarginOf(hull: [number, number][], p: [number, number]): number {
  if (hull.length === 0) return -Infinity
  if (hull.length === 1) return -Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1])
  let edge = Infinity
  let inside = hull.length >= 3
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    if (hull.length === 2 && i === 1) break
    edge = Math.min(edge, segmentDistance(p, a, b))
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) inside = false
  }
  return inside ? edge : -edge
}

export function validateModel(spec: ModelSpec): ModelReport {
  const issues: ModelIssue[] = []
  const parts = buildPartGeometries(spec)
  const bounds = new THREE.Box3()
  let triangles = 0
  for (const p of parts) {
    bounds.union(p.geometry.boundingBox!)
    triangles += triangleCount(p.geometry)
  }
  const size = bounds.isEmpty() ? new THREE.Vector3() : bounds.getSize(new THREE.Vector3())
  const label = (p: BuiltPart) => p.part.name ? `${p.part.id} (${p.part.name})` : p.part.id

  // Degenerate parts (zero size in some axis is fine only for planes)
  for (const p of parts) {
    const s = p.geometry.boundingBox!.getSize(new THREE.Vector3())
    const flatAllowed = p.part.shape.type === 'plane'
    if (!flatAllowed && Math.min(s.x, s.y, s.z) < 1e-4) {
      issues.push({ code: 'DEGENERATE_PART', severity: 'error', parts: [p.part.id], message: `Part ${label(p)} pipih/nol di satu sumbu (${s.toArray().map((n) => n.toFixed(4)).join(' x ')} m)` })
    }
  }

  // Connectivity: parts are connected when their surfaces come within the touch tolerance (BVH
  // closest points, so a rotated brace does not count as touching everything in its bounding box),
  // or when one part sits entirely inside the other (a bulb in a shade).
  const n = parts.length
  const bvhs = parts.map((p) => buildBVH(p.geometry))
  const ray = new THREE.Ray()
  const identity = new THREE.Matrix4()
  const hitA = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
  const hitB = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
  const firstVertex = (k: number) => new THREE.Vector3().fromBufferAttribute(parts[k].geometry.attributes.position, 0)
  /** Whether any triangle of part k reaches into `box` (a sound "no contact" filter when false) */
  const surfaceReaches = (k: number, box: THREE.Box3) =>
    bvhs[k].shapecast({
      intersectsBounds: (b: THREE.Box3) => b.intersectsBox(box),
      intersectsTriangle: (tri: THREE.Triangle) => tri.intersectsBox(box),
    })
  const touching = (i: number, j: number) => {
    const a = parts[i].geometry.boundingBox!
    const b = parts[j].geometry.boundingBox!
    const tol = touchTolerance(a, b)
    if (boxGap(a, b) > tol) return false
    // Intersecting surfaces (the common case) answer fastest
    if (bvhs[i].intersectsGeometry(parts[j].geometry, identity)) return true
    // Surfaces within tol of each other means each surface reaches into the other's grown box
    const inside = () => insideDepth(firstVertex(j), bvhs[i], ray) >= 0 || insideDepth(firstVertex(i), bvhs[j], ray) >= 0
    if (!surfaceReaches(i, b.clone().expandByScalar(tol)) || !surfaceReaches(j, a.clone().expandByScalar(tol))) return inside()
    const hit = bvhs[i].closestPointToGeometry(parts[j].geometry, identity, hitA as any, hitB as any, tol, tol)
    if (hit && hit.distance <= tol) return true
    return insideDepth(firstVertex(j), bvhs[i], ray) >= 0 || insideDepth(firstVertex(i), bvhs[j], ray) >= 0
  }
  const adj: number[][] = parts.map(() => [])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (touching(i, j)) {
        adj[i].push(j)
        adj[j].push(i)
      }
    }
  }

  /** Closest distance between two part surfaces */
  const surfaceGap = (i: number, j: number) => bvhs[i].closestPointToGeometry(parts[j].geometry, identity, hitA as any, hitB as any)?.distance ?? Infinity

  // Explicit attachments
  const indexOf = new Map(parts.map((p, i) => [p.part.id, i]))
  for (let i = 0; i < n; i++) {
    const target = parts[i].part.attachTo
    if (!target) continue
    const j = indexOf.get(target)
    if (j === undefined) continue
    if (!adj[i].includes(j)) {
      const gap = surfaceGap(i, j)
      issues.push({
        code: 'ATTACH_GAP',
        severity: 'error',
        parts: [parts[i].part.id, target],
        message: `Part ${label(parts[i])} harus menempel ke "${target}" tapi berjarak ${(gap * 100).toFixed(1)} cm`,
      })
    }
  }

  if (n > 1) {
    // Components; the main one is the one touching the ground (or the largest)
    const comp = new Array<number>(n).fill(-1)
    const comps: number[][] = []
    for (let i = 0; i < n; i++) {
      if (comp[i] !== -1) continue
      const stack = [i]
      const members: number[] = []
      comp[i] = comps.length
      while (stack.length) {
        const k = stack.pop()!
        members.push(k)
        for (const m of adj[k]) if (comp[m] === -1) { comp[m] = comps.length; stack.push(m) }
      }
      comps.push(members)
    }
    if (comps.length > 1) {
      const minY = bounds.min.y
      const score = (c: number[]) => (c.some((k) => parts[k].geometry.boundingBox!.min.y <= minY + 0.005) ? 1e6 : 0) + c.length
      const main = comps.reduce((best, c) => (score(c) > score(best) ? c : best), comps[0])
      for (const c of comps) {
        if (c === main) continue
        let nearest = Infinity
        let nearestId = ''
        for (const k of c) {
          for (const m of main) {
            if (boxGap(parts[k].geometry.boundingBox!, parts[m].geometry.boundingBox!) >= nearest) continue
            const g = surfaceGap(k, m)
            if (g < nearest) { nearest = g; nearestId = parts[m].part.id }
          }
        }
        issues.push({
          code: 'DISCONNECTED_PART',
          severity: 'error',
          parts: c.map((k) => parts[k].part.id),
          message: `Part ${c.map((k) => label(parts[k])).join(', ')} melayang/terputus dari bagian utama (celah ${(nearest * 100).toFixed(1)} cm ke "${nearestId}")`,
        })
      }
    }
  }

  // Excessive interpenetration: most of a part buried inside another closed part
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || parts[i].part.allowOverlap || parts[j].part.allowOverlap) continue
      const a = parts[i].geometry.boundingBox!
      const b = parts[j].geometry.boundingBox!
      if (!a.intersectsBox(b)) continue
      const f = insideFraction(parts[i], parts[j], bvhs[j], ray)
      if (f > 0.5) {
        issues.push({
          code: 'EXCESSIVE_OVERLAP',
          severity: 'warning',
          parts: [parts[i].part.id, parts[j].part.id],
          message: `${Math.round(f * 100)}% part ${label(parts[i])} terbenam di dalam "${parts[j].part.id}" (set allowOverlap bila disengaja, mis. air di gelas)`,
        })
      }
    }
  }

  // Ground contact
  if (spec.placement === 'floor' && !bounds.isEmpty()) {
    if (bounds.min.y > 0.005) {
      issues.push({ code: 'NOT_ON_GROUND', severity: 'error', parts: [], message: `Objek melayang ${(bounds.min.y * 100).toFixed(1)} cm di atas tanah; titik terendah harus y = 0` })
    } else if (bounds.min.y < -0.005) {
      issues.push({ code: 'BELOW_GROUND', severity: 'error', parts: [], message: `Objek tenggelam ${(-bounds.min.y * 100).toFixed(1)} cm di bawah tanah; titik terendah harus y = 0` })
    }
  }

  // Balance: the center of mass must lie over the area the object stands on, or it tips over
  const massInfo = modelMass(parts)
  let supportMargin: number | null = null
  if (spec.placement === 'floor' && !bounds.isEmpty() && massInfo.mass > 0) {
    const groundY = bounds.min.y + 0.005
    const contact: [number, number][] = []
    const v = new THREE.Vector3()
    for (const p of parts) {
      if (p.geometry.boundingBox!.min.y > groundY) continue
      const pos = p.geometry.attributes.position
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k)
        if (v.y <= groundY) contact.push([v.x, v.z])
      }
    }
    const com = massInfo.centerOfMass
    supportMargin = supportMarginOf(convexHull2D(contact), [com.x, com.z])
    const allowed = Math.max(0.003, 0.01 * Math.max(size.x, size.z))
    if (supportMargin < -allowed) {
      issues.push({
        code: 'UNSTABLE_BALANCE',
        severity: 'error',
        parts: [],
        message: `Titik berat (x ${com.x.toFixed(2)}, z ${com.z.toFixed(2)} m, total ${massInfo.mass.toFixed(1)} kg) berada ${(-supportMargin * 100).toFixed(1)} cm di luar area tumpuan: objek akan terguling. Lebarkan/geser kaki atau alas, pindahkan bagian berat ke atas tumpuan, atau isi density part yang sebenarnya berongga`,
      })
    }
  }

  // Scale against the real-world table
  let reference: ModelReport['reference']
  if (spec.category) {
    const found = findRealWorldDimension(spec.category)
    if (!found) {
      issues.push({ code: 'UNKNOWN_CATEGORY', severity: 'warning', parts: [], message: `Kategori "${spec.category}" tidak ada di tabel ukuran nyata; skala tidak dicek` })
    } else {
      const ref = found.entry.size
      reference = { key: found.key, size: ref, details: found.entry.details }
      const hRatio = size.y / ref[1]
      // Horizontal extents compared regardless of which way the model faces
      const horiz = [size.x, size.z].sort((a, b) => b - a)
      const refHoriz = [ref[0], ref[2]].sort((a, b) => b - a)
      const wRatio = horiz[0] / refHoriz[0]
      const bad = (r: number) => r < 0.6 || r > 1.6
      if (bad(hRatio) || bad(wRatio)) {
        issues.push({
          code: 'SCALE_MISMATCH',
          severity: 'error',
          parts: [],
          message: `Ukuran ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m jauh dari ukuran nyata ${found.key} (${ref.join(' x ')} m): tinggi ${Math.round(hRatio * 100)}%, panjang ${Math.round(wRatio * 100)}%`,
        })
      }
    }
  }

  // Inside-out geometry
  for (const p of parts) {
    if (p.part.shape.type === 'plane') continue
    const o = orientation(p.geometry)
    if (o.signedVolume < -1e-9) {
      issues.push({
        code: 'INVERTED_NORMALS',
        severity: 'error',
        parts: [p.part.id],
        message: p.part.shape.type === 'lathe'
          ? `Permukaan part ${label(p)} menghadap ke dalam: urutkan titik profil lathe dari bawah ke atas`
          : `Permukaan part ${label(p)} menghadap ke dalam (skala negatif?)`,
      })
    } else if (o.normalDisagree > 0.5) {
      issues.push({ code: 'INVERTED_NORMALS', severity: 'error', parts: [p.part.id], message: `Normal part ${label(p)} terbalik terhadap arah permukaan` })
    }
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    size: size.toArray() as [number, number, number],
    min: bounds.isEmpty() ? [0, 0, 0] : (bounds.min.toArray() as [number, number, number]),
    max: bounds.isEmpty() ? [0, 0, 0] : (bounds.max.toArray() as [number, number, number]),
    triangles: Math.round(triangles),
    reference,
    mass: Math.round(massInfo.mass * 100) / 100,
    centerOfMass: massInfo.centerOfMass.toArray().map((x) => Math.round(x * 1000) / 1000) as [number, number, number],
    supportMargin: supportMargin === null ? null : Math.round(supportMargin * 1000) / 1000,
  }
}
