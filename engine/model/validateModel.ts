import * as THREE from 'three'
import { ModelSpec } from './ModelSpec'
import { buildPartGeometries, BuiltPart } from './buildModel'
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

/** Fraction of a's sampled vertices strictly inside b's closed volume (ray parity) */
function insideFraction(a: BuiltPart, b: BuiltPart, mesh: THREE.Mesh, raycaster: THREE.Raycaster): number {
  const pos = a.geometry.attributes.position
  const step = Math.max(1, Math.floor(pos.count / 60))
  const box = b.geometry.boundingBox!
  const v = new THREE.Vector3()
  const dir = new THREE.Vector3(0.577, 0.577, 0.577)
  let inside = 0
  let samples = 0
  for (let i = 0; i < pos.count; i += step) {
    v.fromBufferAttribute(pos, i)
    samples++
    if (!box.containsPoint(v)) continue
    raycaster.set(v, dir)
    const hits = raycaster.intersectObject(mesh, false)
    // Hits closer than the touch tolerance are surface contact, not depth
    const real = hits.filter((h) => h.distance > 1e-4)
    if (real.length % 2 === 1 && real[0].distance > 0.002) inside++
  }
  return samples ? inside / samples : 0
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

  // Connectivity: parts are connected when their model-space boxes touch or overlap. Boxes rather
  // than vertices, because a long part passing through another (a leg through a seat) has no
  // vertex near the contact.
  const n = parts.length
  const touching = (i: number, j: number) => {
    const a = parts[i].geometry.boundingBox!
    const b = parts[j].geometry.boundingBox!
    return boxGap(a, b) <= touchTolerance(a, b)
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

  // Explicit attachments
  const indexOf = new Map(parts.map((p, i) => [p.part.id, i]))
  for (let i = 0; i < n; i++) {
    const target = parts[i].part.attachTo
    if (!target) continue
    const j = indexOf.get(target)
    if (j === undefined) continue
    if (!adj[i].includes(j)) {
      const gap = boxGap(parts[i].geometry.boundingBox!, parts[j].geometry.boundingBox!)
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
            const g = boxGap(parts[k].geometry.boundingBox!, parts[m].geometry.boundingBox!)
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
  const raycaster = new THREE.Raycaster()
  const meshes = parts.map((p) => new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || parts[i].part.allowOverlap || parts[j].part.allowOverlap) continue
      const a = parts[i].geometry.boundingBox!
      const b = parts[j].geometry.boundingBox!
      if (!a.intersectsBox(b)) continue
      const f = insideFraction(parts[i], parts[j], meshes[j], raycaster)
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
  meshes.forEach((m) => (m.material as THREE.Material).dispose())

  // Ground contact
  if (spec.placement === 'floor' && !bounds.isEmpty()) {
    if (bounds.min.y > 0.005) {
      issues.push({ code: 'NOT_ON_GROUND', severity: 'error', parts: [], message: `Objek melayang ${(bounds.min.y * 100).toFixed(1)} cm di atas tanah; titik terendah harus y = 0` })
    } else if (bounds.min.y < -0.005) {
      issues.push({ code: 'BELOW_GROUND', severity: 'error', parts: [], message: `Objek tenggelam ${(-bounds.min.y * 100).toFixed(1)} cm di bawah tanah; titik terendah harus y = 0` })
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
  }
}
