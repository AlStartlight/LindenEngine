import type { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import { err, ok, type GeomResult } from '../core/result'
import type { SelectMode } from './selection'
import {
  cornerAttrs, edgeId, faceCorners, loopFrom, position, rebuildFaces, transaction, unitFaceNormal, type CornerLoop,
} from './topology'

/*
 * Pure-TS edit operations. Each mutates the mesh in place (topology changes go through rebuildFaces, which
 * rolls back on failure) and returns the selection the editor should show afterwards.
 */

export interface OpResult {
  selection: { mode: SelectMode; elements: number[] }
}

type Vec3 = [number, number, number]

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2])
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

// ------------------------------------------------------------------ transform

export type Pivot = 'median' | 'individual'

export interface TransformSpec {
  translate?: Vec3
  /** Axis-angle rotation (radians) about the pivot */
  rotate?: { axis: Vec3; angle: number }
  /** Uniform or per-axis scale about the pivot */
  scale?: number | Vec3
}

export interface TransformDelta {
  vertices: number[]
  before: Float32Array
  after: Float32Array
}

/** Groups vertices into islands connected by the given edges (union-find) */
export function islands(mesh: HalfEdgeMesh, vertices: Iterable<number>, edges: Iterable<number>): number[][] {
  const parent = new Map<number, number>()
  for (const v of vertices) parent.set(v, v)
  const find = (v: number): number => {
    let r = v
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = v
    while (parent.get(c) !== r) {
      const n = parent.get(c)!
      parent.set(c, r)
      c = n
    }
    return r
  }
  for (const e of edges) {
    const a = mesh.heVertex[e]
    const b = mesh.heTarget(e)
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b))
  }
  const groups = new Map<number, number[]>()
  for (const v of parent.keys()) {
    const r = find(v)
    groups.set(r, [...(groups.get(r) ?? []), v])
  }
  return [...groups.values()]
}

/**
 * Moves/rotates/scales vertices. 'median' uses one pivot (centroid of all), 'individual' one pivot per
 * island (islands come from `edges`, normally the flushed selection edges). Order: scale, rotate, translate.
 */
export function transformVertices(
  mesh: HalfEdgeMesh, vertices: number[], spec: TransformSpec, pivot: Pivot = 'median', edges: Iterable<number> = [],
): TransformDelta {
  const groups = pivot === 'individual' ? islands(mesh, vertices, edges) : [vertices]
  const before = new Float32Array(vertices.length * 3)
  vertices.forEach((v, i) => before.set(mesh.positions.subarray(v * 3, v * 3 + 3), i * 3))

  const s: Vec3 = typeof spec.scale === 'number' ? [spec.scale, spec.scale, spec.scale] : spec.scale ?? [1, 1, 1]
  // Rodrigues rotation matrix
  let R: number[] | null = null
  if (spec.rotate && spec.rotate.angle !== 0) {
    const [x, y, z] = normalize(spec.rotate.axis)
    const c = Math.cos(spec.rotate.angle)
    const sn = Math.sin(spec.rotate.angle)
    const t = 1 - c
    R = [t * x * x + c, t * x * y - sn * z, t * x * z + sn * y,
      t * x * y + sn * z, t * y * y + c, t * y * z - sn * x,
      t * x * z - sn * y, t * y * z + sn * x, t * z * z + c]
  }
  const tr = spec.translate ?? [0, 0, 0]
  for (const group of groups) {
    const c: Vec3 = [0, 0, 0]
    for (const v of group) for (let k = 0; k < 3; k++) c[k] += mesh.positions[v * 3 + k] / group.length
    for (const v of group) {
      let p = sub(position(mesh, v), c)
      p = [p[0] * s[0], p[1] * s[1], p[2] * s[2]]
      if (R) p = [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]]
      p = add(add(p, c), tr)
      mesh.setPosition(v, p[0], p[1], p[2])
    }
  }
  const after = new Float32Array(vertices.length * 3)
  vertices.forEach((v, i) => after.set(mesh.positions.subarray(v * 3, v * 3 + 3), i * 3))
  return { vertices: [...vertices], before, after }
}

export function applyPositions(mesh: HalfEdgeMesh, vertices: number[], positions: Float32Array): void {
  vertices.forEach((v, i) => mesh.setPosition(v, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))
}

// ------------------------------------------------------------------ extrude

/**
 * Region extrude: the selected faces get new vertices and are joined to the rest by side quads along the
 * region boundary (including open mesh boundaries). New vertices move `distance` along the averaged
 * normal of their region faces. The new region faces become the selection.
 */
function extrudeFacesImpl(mesh: HalfEdgeMesh, faces: Iterable<number>, distance = 0): GeomResult<OpResult> {
  const region = new Set([...faces].filter((f) => mesh.isFaceAlive(f)))
  if (region.size === 0) return err('INVALID_TOPOLOGY', 'select at least one face to extrude')

  const copies = new Map<number, number>()
  const normals = new Map<number, Vec3>()
  for (const f of region) {
    const n = unitFaceNormal(mesh, f)
    for (const v of mesh.faceVertices(f)) {
      if (!copies.has(v)) {
        const p = position(mesh, v)
        copies.set(v, mesh.addVertex(p[0], p[1], p[2]))
      }
      normals.set(v, add(normals.get(v) ?? [0, 0, 0], n))
    }
  }

  const added: CornerLoop[] = []
  const sides: CornerLoop[] = []
  for (const f of region) {
    const src = faceCorners(mesh, f)
    added.push({ ...src, vertices: src.vertices.map((v) => copies.get(v)!) })
    const hs = mesh.faceHalfEdges(f)
    hs.forEach((h, k) => {
      const t = mesh.heTwin[h]
      if (t >= 0 && region.has(mesh.heFace[t])) return // interior edge of the region
      const a = mesh.heVertex[h]
      const b = mesh.heTarget(h)
      const ka = cornerAttrs(src, k)
      const kb = cornerAttrs(src, (k + 1) % hs.length)
      sides.push(loopFrom([a, b, copies.get(b)!, copies.get(a)!], [ka, kb, kb, ka]))
    })
  }
  const r = rebuildFaces(mesh, region, [...added, ...sides])
  if (!r.ok) return r
  if (distance !== 0) {
    for (const [v, c] of copies) {
      const n = normalize(normals.get(v)!)
      const p = add(position(mesh, c), scale(n, distance))
      mesh.setPosition(c, p[0], p[1], p[2])
    }
  }
  return ok({ selection: { mode: 'face', elements: r.value.slice(0, added.length) } })
}

/**
 * Extrudes boundary edges into quads (a new edge per selected edge, sharing new vertices at joints),
 * offset by `offset`. Interior edges cannot be extruded: they would need a third face on one edge.
 */
function extrudeEdgesImpl(mesh: HalfEdgeMesh, edges: Iterable<number>, offset: Vec3 = [0, 0, 0]): GeomResult<OpResult> {
  const boundary = [...edges].filter((e) => mesh.isHalfEdgeAlive(e))
  if (boundary.length === 0) return err('INVALID_TOPOLOGY', 'select at least one edge to extrude')
  for (const e of boundary) {
    if (mesh.heTwin[e] >= 0) return err('INVALID_TOPOLOGY', `edge ${e} has faces on both sides; only boundary edges can be extruded`)
  }
  const copies = new Map<number, number>()
  const copyOf = (v: number): number => {
    let c = copies.get(v)
    if (c === undefined) {
      const p = add(position(mesh, v), offset)
      c = mesh.addVertex(p[0], p[1], p[2])
      copies.set(v, c)
    }
    return c
  }
  const loops: CornerLoop[] = []
  for (const h of boundary) {
    const a = mesh.heVertex[h]
    const b = mesh.heTarget(h)
    const src = faceCorners(mesh, mesh.heFace[h])
    const k = src.vertices.indexOf(a)
    const ka = cornerAttrs(src, k)
    const kb = cornerAttrs(src, (k + 1) % src.vertices.length)
    // Reverse direction (b -> a) so the quad twins the boundary half-edge a -> b
    loops.push(loopFrom([b, a, copyOf(a), copyOf(b)], [kb, ka, ka, kb]))
  }
  const r = rebuildFaces(mesh, [], loops)
  if (!r.ok) return r
  const newEdges = r.value.map((f) => {
    const hs = mesh.faceHalfEdges(f)
    return edgeId(mesh, hs[2]) // a' -> b'
  })
  return ok({ selection: { mode: 'edge', elements: newEdges } })
}

/** Vertex extrude creates loose (wire) edges, which this face-based half-edge mesh does not store */
export function extrudeVertices(): GeomResult<OpResult> {
  return err(
    'NOT_IMPLEMENTED',
    'vertex extrude creates loose edges without faces, which the half-edge mesh does not support yet',
  )
}

// ------------------------------------------------------------------ inset

/**
 * Individual inset: each selected face gets an inner copy `thickness` in from every edge (in its plane),
 * joined by a ring of quads, optionally raised by `depth` along the normal. Fails (mesh unchanged) when the
 * thickness would turn the inner face inside out.
 */
function insetFacesImpl(mesh: HalfEdgeMesh, faces: Iterable<number>, thickness: number, depth = 0): GeomResult<OpResult> {
  const list = [...faces].filter((f) => mesh.isFaceAlive(f))
  if (list.length === 0) return err('INVALID_TOPOLOGY', 'select at least one face to inset')
  if (!(thickness > 0)) return err('INVALID_MESH', `inset thickness must be > 0, got ${thickness}`)

  const plans: { f: number; src: CornerLoop; inner: Vec3[] }[] = []
  for (const f of list) {
    const src = faceCorners(mesh, f)
    const n = unitFaceNormal(mesh, f)
    const pts = src.vertices.map((v) => position(mesh, v))
    const count = pts.length
    const inner: Vec3[] = []
    for (let i = 0; i < count; i++) {
      const prev = pts[(i + count - 1) % count]
      const next = pts[(i + 1) % count]
      const inPrev = normalize(cross(n, normalize(sub(pts[i], prev))))
      const inNext = normalize(cross(n, normalize(sub(next, pts[i]))))
      const bis = normalize(add(inPrev, inNext))
      const d = dot(bis, inNext)
      if (d < 1e-4) return err('INVALID_TOPOLOGY', `face ${f} has a degenerate corner and cannot be inset`)
      inner.push(add(add(pts[i], scale(bis, thickness / d)), scale(n, depth)))
    }
    // Inner edges must keep the direction of the outer ones, otherwise the inset is too thick
    for (let i = 0; i < count; i++) {
      const outer = sub(pts[(i + 1) % count], pts[i])
      const inEdge = sub(inner[(i + 1) % count], inner[i])
      if (dot(outer, inEdge) <= 0) return err('INVALID_TOPOLOGY', `inset thickness ${thickness} is too large for face ${f}`)
    }
    plans.push({ f, src, inner })
  }

  const added: CornerLoop[] = []
  const rings: CornerLoop[] = []
  for (const { src, inner } of plans) {
    const iv = inner.map((p) => mesh.addVertex(p[0], p[1], p[2]))
    added.push({ ...src, vertices: iv })
    const count = iv.length
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count
      const ki = cornerAttrs(src, i)
      const kj = cornerAttrs(src, j)
      rings.push(loopFrom([src.vertices[i], src.vertices[j], iv[j], iv[i]], [ki, kj, kj, ki]))
    }
  }
  const r = rebuildFaces(mesh, list, [...added, ...rings])
  if (!r.ok) return r
  return ok({ selection: { mode: 'face', elements: r.value.slice(0, added.length) } })
}

// ------------------------------------------------------------------ delete

export type DeleteMode = 'vertices' | 'edges' | 'faces'

/**
 * Blender-style delete: vertices (and every face using them), edges (faces using them; their now-unused
 * vertices go too) or faces (and vertices left without faces). Other vertices are kept even if loose.
 */
function deleteElementsImpl(mesh: HalfEdgeMesh, mode: DeleteMode, elements: Iterable<number>): GeomResult<OpResult> {
  const faces = new Set<number>()
  const cleanup = new Set<number>()
  if (mode === 'vertices') {
    const vs = new Set(elements)
    for (let f = 0; f < mesh.faceSlots; f++) {
      if (mesh.isFaceAlive(f) && mesh.faceVertices(f).some((v) => vs.has(v))) faces.add(f)
    }
    for (const v of vs) cleanup.add(v)
  } else if (mode === 'edges') {
    for (const e of elements) {
      if (!mesh.isHalfEdgeAlive(e)) continue
      faces.add(mesh.heFace[e])
      const t = mesh.heTwin[e]
      if (t >= 0) faces.add(mesh.heFace[t])
      cleanup.add(mesh.heVertex[e])
      cleanup.add(mesh.heTarget(e))
    }
  } else {
    for (const f of elements) {
      if (!mesh.isFaceAlive(f)) continue
      faces.add(f)
      for (const v of mesh.faceVertices(f)) cleanup.add(v)
    }
  }
  const r = rebuildFaces(mesh, faces, [], cleanup)
  if (!r.ok) return r
  // Selected vertices are deleted even if they had no faces
  if (mode === 'vertices') for (const v of cleanup) mesh.removeVertex(v)
  return ok({ selection: { mode: mode === 'vertices' ? 'vertex' : mode === 'edges' ? 'edge' : 'face', elements: [] } })
}

// ------------------------------------------------------------------ merge

/**
 * Replaces vertices by their targets in every face: consecutive duplicates collapse, faces with fewer than
 * three corners disappear, and the merged-away vertices are deleted. Rolls back (mesh unchanged) when a face
 * would pinch (same vertex twice, not adjacent) or duplicate an existing face.
 */
function mergeMap(mesh: HalfEdgeMesh, target: Map<number, number>): GeomResult<void> {
  const touched = new Set<number>()
  for (const v of target.keys()) {
    for (const h of mesh.vertexOutgoing(v)) touched.add(mesh.heFace[h])
  }
  // vertexOutgoing only sees one fan of a non-manifold vertex: scan faces when needed
  for (let f = 0; f < mesh.faceSlots; f++) {
    if (!touched.has(f) && mesh.isFaceAlive(f) && mesh.faceVertices(f).some((v) => target.has(v))) touched.add(f)
  }
  const loops: CornerLoop[] = []
  for (const f of touched) {
    const src = faceCorners(mesh, f)
    const vs: number[] = []
    const attrs: ReturnType<typeof cornerAttrs>[] = []
    src.vertices.forEach((v, k) => {
      const m = target.get(v) ?? v
      if (vs.length && vs[vs.length - 1] === m) return
      vs.push(m)
      attrs.push(cornerAttrs(src, k))
    })
    while (vs.length > 1 && vs[0] === vs[vs.length - 1]) {
      vs.pop()
      attrs.pop()
    }
    if (vs.length < 3) continue // collapsed
    if (new Set(vs).size !== vs.length) {
      return err('INVALID_TOPOLOGY', `merging would pinch face ${f} (it would use a vertex twice)`)
    }
    loops.push(loopFrom(vs, attrs))
  }
  const r = rebuildFaces(mesh, touched, loops, target.keys())
  if (!r.ok) return err(r.code, `merge failed: ${r.message}`)
  for (const v of target.keys()) mesh.removeVertex(v)
  return ok(undefined)
}

/** Merges all given vertices into one at their centroid */
export function mergeAtCenter(mesh: HalfEdgeMesh, vertices: Iterable<number>): GeomResult<OpResult> {
  const vs = [...new Set(vertices)].filter((v) => mesh.isVertexAlive(v)).sort((a, b) => a - b)
  if (vs.length < 2) return err('INVALID_TOPOLOGY', 'select at least two vertices to merge')
  const c: Vec3 = [0, 0, 0]
  for (const v of vs) for (let k = 0; k < 3; k++) c[k] += mesh.positions[v * 3 + k] / vs.length
  const keep = vs[0]
  return transaction(mesh, () => {
    mesh.setPosition(keep, c[0], c[1], c[2])
    const r = mergeMap(mesh, new Map(vs.slice(1).map((v) => [v, keep])))
    return r.ok ? ok<OpResult>({ selection: { mode: 'vertex', elements: [keep] } }) : r
  })
}

/**
 * Merges given vertices closer than `threshold` (greedy clusters; the lowest index of a cluster stays, at
 * its own position). Returns the surviving vertices and how many were removed.
 */
export function mergeByDistance(
  mesh: HalfEdgeMesh, vertices: Iterable<number>, threshold: number,
): GeomResult<OpResult & { removed: number }> {
  if (!(threshold >= 0)) return err('INVALID_MESH', `merge distance must be >= 0, got ${threshold}`)
  const vs = [...new Set(vertices)].filter((v) => mesh.isVertexAlive(v)).sort((a, b) => a - b)
  const cell = threshold > 0 ? threshold : 1e-12
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
  const grid = new Map<string, number[]>()
  const target = new Map<number, number>()
  const keepers: number[] = []
  for (const v of vs) {
    const [x, y, z] = position(mesh, v)
    let found = -1
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell)
    search: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const k of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
        const p = position(mesh, k)
        if (Math.hypot(p[0] - x, p[1] - y, p[2] - z) <= threshold) {
          found = k
          break search
        }
      }
    }
    if (found >= 0) {
      target.set(v, found)
    } else {
      keepers.push(v)
      const k = key(x, y, z)
      grid.set(k, [...(grid.get(k) ?? []), v])
    }
  }
  if (target.size === 0) return ok({ selection: { mode: 'vertex', elements: keepers }, removed: 0 })
  return transaction(mesh, () => {
    const r = mergeMap(mesh, target)
    return r.ok ? ok({ selection: { mode: 'vertex' as const, elements: keepers }, removed: target.size }) : r
  })
}

// ------------------------------------------------------------------ transactional entry points

export function extrudeFaces(mesh: HalfEdgeMesh, faces: Iterable<number>, distance = 0): GeomResult<OpResult> {
  return transaction(mesh, () => extrudeFacesImpl(mesh, faces, distance))
}

export function extrudeEdges(mesh: HalfEdgeMesh, edges: Iterable<number>, offset: Vec3 = [0, 0, 0]): GeomResult<OpResult> {
  return transaction(mesh, () => extrudeEdgesImpl(mesh, edges, offset))
}

export function insetFaces(mesh: HalfEdgeMesh, faces: Iterable<number>, thickness: number, depth = 0): GeomResult<OpResult> {
  return transaction(mesh, () => insetFacesImpl(mesh, faces, thickness, depth))
}

export function deleteElements(mesh: HalfEdgeMesh, mode: DeleteMode, elements: Iterable<number>): GeomResult<OpResult> {
  return transaction(mesh, () => deleteElementsImpl(mesh, mode, elements))
}
