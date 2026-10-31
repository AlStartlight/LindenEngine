import type { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import { err, ok, type GeomResult } from '../core/result'
import type { OpResult } from './ops'
import { edgeRing } from './selection'
import {
  aliveFaces, cornerAttrs, edgeId, faceCorners, loopFrom, position, rebuildFaces, transaction, type CornerLoop,
} from './topology'

/*
 * Phase 5 edit operations (pure TS): dissolve, flip / recalculate normals, loop cut, knife, fill / bridge.
 * Like ops.ts, each one runs as a transaction and returns the selection to show afterwards.
 */

type Vec3 = [number, number, number]
type Attrs = ReturnType<typeof cornerAttrs>

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function lerpAttrs(a: Attrs, b: Attrs, t: number): Attrs {
  const out: Attrs = {}
  if (a.uv && b.uv) out.uv = [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t]
  if (a.normal && b.normal) out.normal = lerp3(a.normal, b.normal, t)
  return out
}

/** Corner attributes of vertex v inside face f (empty if the face has no attributes) */
function attrsAt(mesh: HalfEdgeMesh, f: number, v: number): Attrs {
  const src = faceCorners(mesh, f)
  const k = src.vertices.indexOf(v)
  return k >= 0 ? cornerAttrs(src, k) : {}
}

// ------------------------------------------------------------------ regions

/**
 * Next boundary half-edge of a face region, leaving the target of boundary half-edge h: rotate around
 * that vertex through region faces until an edge leads outside the region (or off the mesh).
 */
function nextRegionBoundary(mesh: HalfEdgeMesh, region: Set<number>, h: number): number {
  let g = mesh.heNext[h]
  for (let guard = 0; guard <= mesh.halfEdgeSlots; guard++) {
    const t = mesh.heTwin[g]
    if (t < 0 || !region.has(mesh.heFace[t])) return g
    g = mesh.heNext[t]
  }
  return -1
}

/** Boundary loops of a face region, as half-edge lists in face orientation */
function regionLoops(mesh: HalfEdgeMesh, region: Set<number>): number[][] {
  const boundary = new Set<number>()
  for (const f of region) {
    for (const h of mesh.faceHalfEdges(f)) {
      const t = mesh.heTwin[h]
      if (t < 0 || !region.has(mesh.heFace[t])) boundary.add(h)
    }
  }
  const loops: number[][] = []
  while (boundary.size) {
    const start = boundary.values().next().value as number
    const loop: number[] = []
    let h = start
    do {
      loop.push(h)
      boundary.delete(h)
      h = nextRegionBoundary(mesh, region, h)
    } while (h >= 0 && h !== start && loop.length <= mesh.halfEdgeSlots)
    loops.push(loop)
  }
  return loops
}

/** Connected groups of faces, connected through edges (optionally only through `via` edges) */
function faceIslands(mesh: HalfEdgeMesh, faces: Iterable<number>, via?: Set<number>): number[][] {
  const pool = new Set(faces)
  const out: number[][] = []
  while (pool.size) {
    const start = pool.values().next().value as number
    pool.delete(start)
    const island = [start]
    for (let i = 0; i < island.length; i++) {
      for (const h of mesh.faceHalfEdges(island[i])) {
        if (via && !via.has(edgeId(mesh, h))) continue
        const t = mesh.heTwin[h]
        if (t < 0) continue
        const g = mesh.heFace[t]
        if (pool.has(g)) {
          pool.delete(g)
          island.push(g)
        }
      }
    }
    out.push(island)
  }
  return out
}

/** Replaces a face region by one polygon (its single boundary loop); inner vertices are deleted */
function mergeRegion(mesh: HalfEdgeMesh, region: Set<number>, drop: Set<number> = new Set()): GeomResult<number> {
  const loops = regionLoops(mesh, region)
  if (loops.length !== 1) {
    return err('INVALID_TOPOLOGY', loops.length === 0
      ? 'the faces enclose a closed surface; dissolving them would leave nothing'
      : 'dissolving would create a face with a hole')
  }
  const hs = loops[0].filter((h) => !drop.has(mesh.heVertex[h]))
  const verts = hs.map((h) => mesh.heVertex[h])
  if (new Set(verts).size !== verts.length) return err('INVALID_TOPOLOGY', 'dissolving would pinch the new face')
  if (verts.length < 3) return err('INVALID_TOPOLOGY', 'dissolving would leave a face with fewer than 3 corners')
  const attrs = hs.map((h) => attrsAt(mesh, mesh.heFace[h], mesh.heVertex[h]))
  const cleanup = new Set<number>()
  for (const f of region) for (const v of mesh.faceVertices(f)) cleanup.add(v)
  const r = rebuildFaces(mesh, region, [loopFrom(verts, attrs)], cleanup)
  if (!r.ok) return r
  for (const v of drop) if (mesh.isVertexAlive(v) && mesh.vertexHalfEdge[v] < 0) mesh.removeVertex(v)
  return ok(r.value[0])
}

// ------------------------------------------------------------------ dissolve

/** Merges each connected group of selected faces into one n-gon */
export function dissolveFaces(mesh: HalfEdgeMesh, faces: Iterable<number>): GeomResult<OpResult> {
  return transaction(mesh, () => {
    const list = [...faces].filter((f) => mesh.isFaceAlive(f))
    if (list.length < 2) return err('INVALID_TOPOLOGY', 'select at least two adjacent faces to dissolve')
    const created: number[] = []
    for (const island of faceIslands(mesh, list)) {
      if (island.length < 2) continue
      const r = mergeRegion(mesh, new Set(island))
      if (!r.ok) return r
      created.push(r.value)
    }
    return ok({ selection: { mode: 'face', elements: created } })
  })
}

/** Removes edges by merging the faces on both sides (faces joined through several edges become one) */
export function dissolveEdges(mesh: HalfEdgeMesh, edges: Iterable<number>): GeomResult<OpResult> {
  return transaction(mesh, () => {
    const sel = new Set<number>()
    const faces = new Set<number>()
    for (const e of edges) {
      if (!mesh.isHalfEdgeAlive(e)) continue
      const t = mesh.heTwin[e]
      if (t < 0) return err('INVALID_TOPOLOGY', `edge ${e} is on the boundary; boundary edges cannot be dissolved`)
      if (mesh.heFace[t] === mesh.heFace[e]) continue
      sel.add(edgeId(mesh, e))
      faces.add(mesh.heFace[e])
      faces.add(mesh.heFace[t])
    }
    if (sel.size === 0) return err('INVALID_TOPOLOGY', 'select at least one interior edge to dissolve')
    const created: number[] = []
    for (const island of faceIslands(mesh, faces, sel)) {
      const r = mergeRegion(mesh, new Set(island))
      if (!r.ok) return r
      created.push(r.value)
    }
    return ok({ selection: { mode: 'face', elements: created } })
  })
}

/**
 * Removes vertices: a vertex between exactly two edges is taken out of its faces (the two edges become
 * one); any other vertex merges the faces around it into one n-gon.
 */
export function dissolveVertices(mesh: HalfEdgeMesh, vertices: Iterable<number>): GeomResult<OpResult> {
  return transaction(mesh, () => {
    const list = [...new Set(vertices)].filter((v) => mesh.isVertexAlive(v) && mesh.vertexHalfEdge[v] >= 0)
    if (list.length === 0) return err('INVALID_TOPOLOGY', 'select at least one vertex to dissolve')
    for (const v of list) {
      if (!mesh.isVertexAlive(v)) continue
      const out = mesh.vertexOutgoing(v)
      const faces = new Set(out.map((h) => mesh.heFace[h]))
      const neighbours = new Set(out.map((h) => mesh.heTarget(h)))
      for (const h of out) neighbours.add(mesh.heVertex[mesh.hePrev[h]])
      if (neighbours.size === 2) {
        // Vertex in the middle of an edge: drop it from each face
        const loops: CornerLoop[] = []
        for (const f of faces) {
          const src = faceCorners(mesh, f)
          const keep = src.vertices.map((_, k) => k).filter((k) => src.vertices[k] !== v)
          if (keep.length < 3) return err('INVALID_TOPOLOGY', `dissolving vertex ${v} would collapse face ${f}`)
          loops.push(loopFrom(keep.map((k) => src.vertices[k]), keep.map((k) => cornerAttrs(src, k))))
        }
        const r = rebuildFaces(mesh, faces, loops, [v])
        if (!r.ok) return r
      } else {
        const r = mergeRegion(mesh, faces, new Set([v]))
        if (!r.ok) return r
      }
    }
    return ok({ selection: { mode: 'vertex', elements: [] } })
  })
}

// ------------------------------------------------------------------ normals

function reversedLoop(src: CornerLoop): CornerLoop {
  const n = src.vertices.length
  const order = src.vertices.map((_, k) => n - 1 - k)
  return loopFrom(order.map((k) => src.vertices[k]), order.map((k) => cornerAttrs(src, k)))
}

/** Reverses whole connected islands (a half-edge mesh cannot hold one flipped face inside a consistent island) */
function flipIslands(mesh: HalfEdgeMesh, islands: number[][]): GeomResult<number[]> {
  const all: number[] = []
  for (const island of islands) {
    const loops = island.map((f) => reversedLoop(faceCorners(mesh, f)))
    const r = rebuildFaces(mesh, island, loops)
    if (!r.ok) return r
    all.push(...r.value)
  }
  return ok(all)
}

/** Flips the faces of every island that has a selected face */
export function flipNormals(mesh: HalfEdgeMesh, faces: Iterable<number>): GeomResult<OpResult & { islands: number }> {
  return transaction(mesh, () => {
    const selected = new Set([...faces].filter((f) => mesh.isFaceAlive(f)))
    if (selected.size === 0) return err('INVALID_TOPOLOGY', 'select faces to flip')
    const islands = faceIslands(mesh, aliveFaces(mesh)).filter((i) => i.some((f) => selected.has(f)))
    const r = flipIslands(mesh, islands)
    if (!r.ok) return r
    return ok({ selection: { mode: 'face' as const, elements: r.value }, islands: islands.length })
  })
}

/**
 * Makes every island (of the given faces, or all) face outward: closed islands by the sign of their
 * volume, open ones by whether face normals point away from the island's centroid on average.
 */
export function recalculateNormals(mesh: HalfEdgeMesh, faces?: Iterable<number>, inside = false): GeomResult<OpResult & { flipped: number }> {
  return transaction(mesh, () => {
    const pool = faces ? new Set([...faces].filter((f) => mesh.isFaceAlive(f))) : new Set(aliveFaces(mesh))
    const islands = faceIslands(mesh, aliveFaces(mesh)).filter((i) => i.some((f) => pool.has(f)))
    const wrong: number[][] = []
    for (const island of islands) {
      const c: Vec3 = [0, 0, 0]
      let n = 0
      for (const f of island) for (const v of mesh.faceVertices(f)) {
        const p = position(mesh, v)
        c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; n++
      }
      c[0] /= n; c[1] /= n; c[2] /= n
      // Sum over faces of (area-weighted normal) . (face center - island center): volume-like for closed islands
      let score = 0
      for (const f of island) {
        const nrm = mesh.faceNormal(f)
        const vs = mesh.faceVertices(f)
        const fc: Vec3 = [0, 0, 0]
        for (const v of vs) {
          const p = position(mesh, v)
          fc[0] += p[0] / vs.length; fc[1] += p[1] / vs.length; fc[2] += p[2] / vs.length
        }
        score += nrm[0] * (fc[0] - c[0]) + nrm[1] * (fc[1] - c[1]) + nrm[2] * (fc[2] - c[2])
      }
      if (inside ? score > 0 : score < 0) wrong.push(island)
    }
    const r = flipIslands(mesh, wrong)
    if (!r.ok) return r
    return ok({ selection: { mode: 'face' as const, elements: [] }, flipped: wrong.length })
  })
}

// ------------------------------------------------------------------ loop cut

/**
 * Cuts `cuts` evenly spaced edge loops across the quad ring of edge `edge` (as Blender's Ctrl+R).
 * Faces at the ends of an open ring that are not quads get the new vertices inserted into their sides.
 * The new edges become the selection.
 */
export function loopCut(mesh: HalfEdgeMesh, edge: number, cuts = 1): GeomResult<OpResult> {
  return transaction(mesh, () => {
    if (!mesh.isHalfEdgeAlive(edge)) return err('INVALID_TOPOLOGY', 'select an edge to loop cut')
    if (!Number.isInteger(cuts) || cuts < 1 || cuts > 64) return err('INVALID_MESH', `cuts must be an integer from 1 to 64, got ${cuts}`)
    const ring = new Set(edgeRing(mesh, edge))
    if (ring.size < 2 && mesh.heTwin[edge] >= 0 && mesh.faceSize(mesh.heFace[edge]) !== 4) {
      return err('INVALID_TOPOLOGY', 'loop cut needs quads across the selected edge')
    }

    // New vertices on each ring edge, ordered from its lower-index endpoint
    const points = new Map<number, number[]>()
    for (const e of ring) {
      const [a, b] = [mesh.heVertex[e], mesh.heTarget(e)]
      const [lo, hi] = a < b ? [a, b] : [b, a]
      const pts: number[] = []
      for (let k = 1; k <= cuts; k++) {
        const p = lerp3(position(mesh, lo), position(mesh, hi), k / (cuts + 1))
        pts.push(mesh.addVertex(p[0], p[1], p[2]))
      }
      points.set(e, pts)
    }
    /** Points of ring edge e listed starting from vertex `from` */
    const pts = (e: number, from: number): number[] => {
      const p = points.get(e)!
      const lo = Math.min(mesh.heVertex[e], mesh.heTarget(e))
      return from === lo ? p : [...p].reverse()
    }

    const touched = new Set<number>()
    for (const e of ring) {
      touched.add(mesh.heFace[e])
      const t = mesh.heTwin[e]
      if (t >= 0) touched.add(mesh.heFace[t])
    }
    const loops: CornerLoop[] = []
    const cutPairs: [number, number][] = []
    for (const f of touched) {
      const src = faceCorners(mesh, f)
      const hs = mesh.faceHalfEdges(f)
      const n = hs.length
      const quadSplit = n === 4 ? [0, 1].find((i) => ring.has(edgeId(mesh, hs[i])) && ring.has(edgeId(mesh, hs[i + 2]))) : undefined
      if (quadSplit !== undefined) {
        const i = quadSplit
        const [a, b, c, d] = [0, 1, 2, 3].map((k) => src.vertices[(i + k) % 4])
        const [ka, kb, kc, kd] = [0, 1, 2, 3].map((k) => cornerAttrs(src, (i + k) % 4))
        const P = pts(edgeId(mesh, hs[i]), a) // along a -> b
        const Q = pts(edgeId(mesh, hs[(i + 2) % 4]), d) // along d -> c
        const side = [a, ...P, b]
        const other = [d, ...Q, c]
        const sideAttrs = side.map((_, k) => lerpAttrs(ka, kb, k / (cuts + 1)))
        const otherAttrs = other.map((_, k) => lerpAttrs(kd, kc, k / (cuts + 1)))
        for (let k = 0; k <= cuts; k++) {
          loops.push(loopFrom([side[k], side[k + 1], other[k + 1], other[k]], [sideAttrs[k], sideAttrs[k + 1], otherAttrs[k + 1], otherAttrs[k]]))
        }
        for (let k = 0; k < cuts; k++) cutPairs.push([P[k], Q[k]])
      } else {
        // Not part of the ring: just insert the new vertices along its ring edges
        const verts: number[] = []
        const attrs: Attrs[] = []
        hs.forEach((h, k) => {
          verts.push(src.vertices[k])
          attrs.push(cornerAttrs(src, k))
          const e = edgeId(mesh, h)
          if (!ring.has(e)) return
          const next = (k + 1) % n
          const extra = pts(e, src.vertices[k])
          extra.forEach((p, j) => {
            verts.push(p)
            attrs.push(lerpAttrs(cornerAttrs(src, k), cornerAttrs(src, next), (j + 1) / (cuts + 1)))
          })
        })
        loops.push(loopFrom(verts, attrs))
      }
    }
    const r = rebuildFaces(mesh, touched, loops)
    if (!r.ok) return r
    const newEdges = cutPairs.map(([p, q]) => {
      const h = mesh.findHalfEdge(p, q) >= 0 ? mesh.findHalfEdge(p, q) : mesh.findHalfEdge(q, p)
      return edgeId(mesh, h)
    })
    return ok({ selection: { mode: 'edge', elements: newEdges } })
  })
}

// ------------------------------------------------------------------ knife

/** Inserts a vertex on edge e at parameter t (from its half-edge's origin), into both adjacent faces */
export function splitEdge(mesh: HalfEdgeMesh, e: number, t: number): GeomResult<number> {
  if (!mesh.isHalfEdgeAlive(e)) return err('INVALID_TOPOLOGY', `edge ${e} does not exist`)
  if (!(t > 0 && t < 1)) return err('INVALID_MESH', `split parameter must be in (0, 1), got ${t}`)
  const a = mesh.heVertex[e]
  const b = mesh.heTarget(e)
  const p = lerp3(position(mesh, a), position(mesh, b), t)
  const v = mesh.addVertex(p[0], p[1], p[2])
  const faces = [mesh.heFace[e]]
  if (mesh.heTwin[e] >= 0) faces.push(mesh.heFace[mesh.heTwin[e]])
  const loops = faces.map((f) => {
    const src = faceCorners(mesh, f)
    const verts: number[] = []
    const attrs: Attrs[] = []
    src.vertices.forEach((u, k) => {
      verts.push(u)
      attrs.push(cornerAttrs(src, k))
      const w = src.vertices[(k + 1) % src.vertices.length]
      if ((u === a && w === b) || (u === b && w === a)) {
        verts.push(v)
        attrs.push(lerpAttrs(cornerAttrs(src, k), cornerAttrs(src, (k + 1) % src.vertices.length), u === a ? t : 1 - t))
      }
    })
    return loopFrom(verts, attrs)
  })
  const r = rebuildFaces(mesh, faces, loops)
  return r.ok ? ok(v) : r
}

/** Splits a face along a new edge between two of its non-adjacent vertices (Blender's J / connect) */
function connect(mesh: HalfEdgeMesh, a: number, b: number): GeomResult<[number, number]> {
  if (mesh.findHalfEdge(a, b) >= 0 || mesh.findHalfEdge(b, a) >= 0) return err('INVALID_TOPOLOGY', 'the vertices are already connected')
  const faces = new Set(mesh.vertexOutgoing(a).map((h) => mesh.heFace[h]))
  for (let f = 0; f < mesh.faceSlots && faces.size === 0; f++) if (mesh.isFaceAlive(f) && mesh.faceVertices(f).includes(a)) faces.add(f)
  const f = [...faces].find((x) => mesh.faceVertices(x).includes(b))
  if (f === undefined) return err('INVALID_TOPOLOGY', `vertices ${a} and ${b} do not share a face`)
  const src = faceCorners(mesh, f)
  const n = src.vertices.length
  const ia = src.vertices.indexOf(a)
  const ib = src.vertices.indexOf(b)
  const span = (from: number, to: number): number[] => {
    const out = [from]
    for (let k = from; k !== to; ) {
      k = (k + 1) % n
      out.push(k)
    }
    return out
  }
  const l1 = span(ia, ib)
  const l2 = span(ib, ia)
  const r = rebuildFaces(mesh, [f], [
    loopFrom(l1.map((k) => src.vertices[k]), l1.map((k) => cornerAttrs(src, k))),
    loopFrom(l2.map((k) => src.vertices[k]), l2.map((k) => cornerAttrs(src, k))),
  ])
  return r.ok ? ok([r.value[0], r.value[1]]) : r
}

/** Connects two vertices that share a face with a new edge */
export function connectVertices(mesh: HalfEdgeMesh, a: number, b: number): GeomResult<OpResult> {
  return transaction(mesh, () => {
    const r = connect(mesh, a, b)
    if (!r.ok) return r
    const h = mesh.findHalfEdge(a, b)
    return ok({ selection: { mode: 'edge', elements: [edgeId(mesh, h)] } })
  })
}

export type KnifePoint = { vertex: number } | { edge: number; t: number }

/**
 * Simple knife: a path of points on existing vertices or on edges (edge + parameter). Edge points become
 * vertices, then consecutive points are connected across the face they share. The cut edges are selected.
 */
export function knifeCut(mesh: HalfEdgeMesh, path: KnifePoint[]): GeomResult<OpResult> {
  return transaction(mesh, () => {
    if (path.length < 2) return err('INVALID_TOPOLOGY', 'a knife cut needs at least two points')
    // Resolve edge points into vertices; edge ids may change as faces are rebuilt, so look edges up by endpoints
    const ends = path.map((p) => ('edge' in p ? [mesh.heVertex[p.edge], mesh.heTarget(p.edge)] : null))
    const verts: number[] = []
    for (let i = 0; i < path.length; i++) {
      const p = path[i]
      if ('vertex' in p) {
        if (!mesh.isVertexAlive(p.vertex)) return err('INVALID_TOPOLOGY', `vertex ${p.vertex} does not exist`)
        verts.push(p.vertex)
        continue
      }
      const [a, b] = ends[i]!
      const h = mesh.findHalfEdge(a, b)
      if (h < 0) return err('INVALID_TOPOLOGY', `edge ${a}-${b} no longer exists (two knife points on one edge?)`)
      const v = splitEdge(mesh, h, p.t)
      if (!v.ok) return v
      verts.push(v.value)
    }
    const cut: number[] = []
    for (let i = 0; i + 1 < verts.length; i++) {
      const [a, b] = [verts[i], verts[i + 1]]
      const existing = mesh.findHalfEdge(a, b) >= 0 ? mesh.findHalfEdge(a, b) : mesh.findHalfEdge(b, a)
      if (existing >= 0) {
        cut.push(edgeId(mesh, existing))
        continue
      }
      const r = connect(mesh, a, b)
      if (!r.ok) return r
      cut.push(edgeId(mesh, mesh.findHalfEdge(a, b)))
    }
    return ok({ selection: { mode: 'edge', elements: cut } })
  })
}

// ------------------------------------------------------------------ fill and bridge

/** Groups selected boundary half-edges into closed loops (in boundary order) */
function boundaryLoops(mesh: HalfEdgeMesh, edges: Iterable<number>): GeomResult<number[][]> {
  const sel = new Set<number>()
  for (const e of edges) {
    if (!mesh.isHalfEdgeAlive(e)) continue
    if (mesh.heTwin[e] >= 0) return err('INVALID_TOPOLOGY', `edge ${e} is not on a boundary`)
    sel.add(e)
  }
  if (sel.size === 0) return err('INVALID_TOPOLOGY', 'select boundary edges')
  const nextOnBoundary = (h: number): number => {
    let g = mesh.heNext[h]
    for (let guard = 0; guard <= mesh.halfEdgeSlots && mesh.heTwin[g] >= 0; guard++) g = mesh.heNext[mesh.heTwin[g]]
    return g
  }
  const loops: number[][] = []
  const left = new Set(sel)
  while (left.size) {
    const start = left.values().next().value as number
    const loop: number[] = []
    let h = start
    do {
      if (!sel.has(h)) return err('INVALID_TOPOLOGY', 'the selected boundary edges do not form closed loops')
      loop.push(h)
      left.delete(h)
      h = nextOnBoundary(h)
    } while (h !== start && loop.length <= mesh.halfEdgeSlots)
    loops.push(loop)
  }
  return ok(loops)
}

/**
 * One selected boundary loop: fill it with an n-gon. Two loops with the same number of edges: bridge them
 * with a ring of quads, matching vertices with the smallest total distance.
 */
export function fillOrBridge(mesh: HalfEdgeMesh, edges: Iterable<number>): GeomResult<OpResult> {
  return transaction(mesh, () => {
    const loops = boundaryLoops(mesh, edges)
    if (!loops.ok) return loops
    if (loops.value.length === 1) {
      const loop = loops.value[0]
      if (loop.length < 3) return err('INVALID_TOPOLOGY', 'a hole needs at least 3 edges to fill')
      const verts = loop.map((h) => mesh.heVertex[h]).reverse()
      const r = rebuildFaces(mesh, [], [{ vertices: verts }])
      return r.ok ? ok<OpResult>({ selection: { mode: 'face', elements: r.value } }) : r
    }
    if (loops.value.length !== 2) return err('INVALID_TOPOLOGY', `select one loop to fill or two to bridge, got ${loops.value.length}`)
    const [A, B] = loops.value.map((l) => l.map((h) => mesh.heVertex[h]))
    const n = A.length
    if (B.length !== n) return err('INVALID_TOPOLOGY', `bridge needs loops with the same number of edges (${n} vs ${B.length})`)
    // B is walked against its boundary direction: b'(m) = B[(s - m) mod n]; pick s with the shortest rungs
    const bAt = (s: number, m: number) => B[(((s - m) % n) + n) % n]
    let best = 0
    let bestCost = Infinity
    for (let s = 0; s < n; s++) {
      let cost = 0
      for (let m = 0; m < n; m++) {
        const p = position(mesh, A[m]), q = position(mesh, bAt(s, m))
        cost += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
      }
      if (cost < bestCost) {
        bestCost = cost
        best = s
      }
    }
    const quads: CornerLoop[] = []
    for (let m = 0; m < n; m++) {
      quads.push({ vertices: [A[(m + 1) % n], A[m], bAt(best, m), bAt(best, m + 1)] })
    }
    const r = rebuildFaces(mesh, [], quads)
    return r.ok ? ok<OpResult>({ selection: { mode: 'face', elements: r.value } }) : r
  })
}
