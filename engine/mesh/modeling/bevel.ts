import type { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import { err, ok, type GeomResult } from '../core/result'
import type { OpResult } from './ops'
import { cornerAttrs, edgeId, faceCorners, loopFrom, position, rebuildFaces, transaction, type CornerLoop } from './topology'

/*
 * Bevel of edges and/or vertices with `segments` and a rounded profile (quadratic Bezier through the old
 * corner). For every affected vertex a, walking its fan of faces F_i between edges E_i and E_(i+1):
 *  - an edge E_i that is not bevelled gets a point P_i at distance `width` from a;
 *  - a face whose two edges at a are both bevelled gets a corner point C_i inside it;
 *  - face F_i replaces a by its points S_i (P_i, C_i, P_(i+1) as applicable);
 *  - every bevelled edge becomes a strip of `segments` quads between its two side points at each end;
 *  - what is left open around a (three or more points) is closed with one polygon.
 * Only interior manifold vertices can be bevelled.
 */

type Vec3 = [number, number, number]
type Attrs = ReturnType<typeof cornerAttrs>

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])

function lerpAttrs(a: Attrs, b: Attrs, t: number): Attrs {
  const out: Attrs = {}
  if (a.uv && b.uv) out.uv = [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t]
  if (a.normal && b.normal) out.normal = [0, 1, 2].map((k) => a.normal![k] + (b.normal![k] - a.normal![k]) * t) as Vec3
  return out
}

interface Fan {
  /** Outgoing half-edges h_i in fan order; E_i is h_i's edge and F_i = face(h_i) lies between E_i and E_(i+1) */
  out: number[]
  /** Points replacing the vertex in face F_i, ordered from the E_i side to the E_(i+1) side */
  S: number[][]
}

export interface BevelOptions {
  edges?: Iterable<number>
  vertices?: Iterable<number>
  width: number
  segments?: number
}

export function bevel(mesh: HalfEdgeMesh, options: BevelOptions): GeomResult<OpResult> {
  return transaction(mesh, () => bevelImpl(mesh, options))
}

function bevelImpl(mesh: HalfEdgeMesh, options: BevelOptions): GeomResult<OpResult> {
  const width = options.width
  const segments = options.segments ?? 1
  if (!(width > 0)) return err('INVALID_MESH', `bevel width must be > 0, got ${width}`)
  if (!Number.isInteger(segments) || segments < 1 || segments > 32) return err('INVALID_MESH', `segments must be an integer from 1 to 32, got ${segments}`)

  const selEdges = new Set<number>()
  for (const e of options.edges ?? []) {
    if (!mesh.isHalfEdgeAlive(e)) continue
    if (mesh.heTwin[e] < 0) return err('INVALID_TOPOLOGY', `edge ${e} is on the boundary; only interior edges can be bevelled`)
    selEdges.add(edgeId(mesh, e))
  }
  const affected = new Set<number>()
  for (const e of selEdges) {
    affected.add(mesh.heVertex[e])
    affected.add(mesh.heTarget(e))
  }
  for (const v of options.vertices ?? []) if (mesh.isVertexAlive(v)) affected.add(v)
  if (affected.size === 0) return err('INVALID_TOPOLOGY', 'select edges or vertices to bevel')

  // Fans of the affected vertices (interior and manifold only)
  const outgoing = new Map<number, number>()
  for (let h = 0; h < mesh.halfEdgeSlots; h++) {
    if (mesh.heFace[h] >= 0) outgoing.set(mesh.heVertex[h], (outgoing.get(mesh.heVertex[h]) ?? 0) + 1)
  }
  const fans = new Map<number, Fan>()
  for (const a of affected) {
    const out = mesh.vertexOutgoing(a)
    if (out.length < 3 || out.some((h) => mesh.heTwin[h] < 0) || out.length !== outgoing.get(a)) {
      return err('INVALID_TOPOLOGY', `vertex ${a} is on a boundary or not manifold; it cannot be bevelled`)
    }
    fans.set(a, { out, S: [] })
  }
  const isSel = (h: number) => selEdges.has(edgeId(mesh, h))

  // Every edge around a bevelled vertex is used as a direction and gets offsets along it: it must have a
  // length, and the width must fit (twice when both of its ends move along it)
  for (const [a, fan] of fans) {
    for (const h of fan.out) {
      const b = mesh.heTarget(h)
      const l = len(sub(position(mesh, b), position(mesh, a)))
      if (l < 1e-9) {
        return err('INVALID_TOPOLOGY', `edge ${a}-${b} has zero length; merge by distance first`)
      }
      const ends = fans.has(b) ? 2 : 1
      if (width * ends >= l) return err('INVALID_TOPOLOGY', `bevel width ${width} does not fit edge ${a}-${b} (length ${l.toFixed(4)})`)
    }
  }

  // New point vertices with corner attributes per face
  const pointAt = new Map<string, number>() // P: "P:a:edgeId"  C: "C:a:face"
  const attrsOf = new Map<string, Attrs>() // `${point}:${face}` -> attrs in that face
  const unit = (a: number, h: number): Vec3 => {
    const d = sub(position(mesh, mesh.heTarget(h)), position(mesh, a))
    return scale(d, 1 / len(d))
  }
  for (const [a, fan] of fans) {
    const n = fan.out.length
    const pa = position(mesh, a)
    const P = (i: number): number => {
      const h = fan.out[i % n]
      const key = `P:${a}:${edgeId(mesh, h)}`
      let v = pointAt.get(key)
      if (v === undefined) {
        const p = add(pa, scale(unit(a, h), width))
        v = mesh.addVertex(p[0], p[1], p[2])
        pointAt.set(key, v)
      }
      return v
    }
    for (let i = 0; i < n; i++) {
      const hi = fan.out[i]
      const hn = fan.out[(i + 1) % n]
      const f = mesh.heFace[hi]
      const S: number[] = []
      const src = faceCorners(mesh, f)
      const k = src.vertices.indexOf(a)
      const kA = cornerAttrs(src, k)
      const kNext = cornerAttrs(src, (k + 1) % src.vertices.length) // along E_i (a -> target(h_i))
      const kPrev = cornerAttrs(src, (k + src.vertices.length - 1) % src.vertices.length) // along E_(i+1)
      const tw = (h: number) => width / len(sub(position(mesh, mesh.heTarget(h)), pa))
      if (!isSel(hi)) {
        const v = P(i)
        S.push(v)
        attrsOf.set(`${v}:${f}`, lerpAttrs(kA, kNext, tw(hi)))
      }
      if (isSel(hi) && isSel(hn)) {
        const key = `C:${a}:${f}`
        const c = add(add(pa, scale(unit(a, hi), width)), scale(unit(a, hn), width))
        const v = mesh.addVertex(c[0], c[1], c[2])
        pointAt.set(key, v)
        S.push(v)
        const ti = tw(hi), tn = tw(hn)
        const uv = kA.uv && kNext.uv && kPrev.uv
          ? [kA.uv[0] + (kNext.uv[0] - kA.uv[0]) * ti + (kPrev.uv[0] - kA.uv[0]) * tn, kA.uv[1] + (kNext.uv[1] - kA.uv[1]) * ti + (kPrev.uv[1] - kA.uv[1]) * tn] as [number, number]
          : undefined
        attrsOf.set(`${v}:${f}`, { uv, normal: kA.normal })
      }
      if (!isSel(hn)) {
        const v = P(i + 1)
        S.push(v)
        attrsOf.set(`${v}:${f}`, lerpAttrs(kA, kPrev, tw(hn)))
      }
      fan.S.push(S)
    }
  }

  // Profile between two side points at a bevelled edge end: quadratic Bezier with the old vertex as control
  const arcCache = new Map<string, number[]>()
  const arc = (from: number, to: number, corner: number): number[] => {
    if (segments === 1) return [from, to]
    const [lo, hi] = from < to ? [from, to] : [to, from]
    const key = `${lo}:${hi}:${corner}`
    let pts = arcCache.get(key)
    if (!pts) {
      const p0 = position(mesh, lo), p2 = position(mesh, hi), c = position(mesh, corner)
      pts = [lo]
      for (let k = 1; k < segments; k++) {
        const t = k / segments
        const p = add(add(scale(p0, (1 - t) * (1 - t)), scale(c, 2 * t * (1 - t))), scale(p2, t * t))
        pts.push(mesh.addVertex(p[0], p[1], p[2]))
      }
      pts.push(hi)
      arcCache.set(key, pts)
    }
    return from === lo ? pts : [...pts].reverse()
  }

  // 1. Faces around affected vertices: replace each affected vertex by its points (reversed: loop order)
  const touched = new Set<number>()
  for (const fan of fans.values()) for (const h of fan.out) touched.add(mesh.heFace[h])
  const sIndex = new Map<string, number>() // `${a}:${face}` -> i
  for (const [a, fan] of fans) fan.out.forEach((h, i) => sIndex.set(`${a}:${mesh.heFace[h]}`, i))
  const loops: CornerLoop[] = []
  for (const f of touched) {
    const src = faceCorners(mesh, f)
    const verts: number[] = []
    const attrs: Attrs[] = []
    src.vertices.forEach((v, k) => {
      const fan = fans.get(v)
      if (!fan) {
        verts.push(v)
        attrs.push(cornerAttrs(src, k))
        return
      }
      const S = fan.S[sIndex.get(`${v}:${f}`)!]
      for (const p of [...S].reverse()) {
        verts.push(p)
        attrs.push(attrsOf.get(`${p}:${f}`) ?? cornerAttrs(src, k))
      }
    })
    loops.push(loopFrom(verts, attrs))
  }

  // 2. Strips along bevelled edges
  const strips: CornerLoop[] = []
  const sideOf = (a: number, h: number): { L: number; R: number } => {
    // h leaves a: L side is face(h) = F_i (first point of S_i), R side is F_(i-1) (last point of S_(i-1))
    const fan = fans.get(a)!
    const i = fan.out.indexOf(h)
    const n = fan.out.length
    const Si = fan.S[i]
    const Sp = fan.S[(i + n - 1) % n]
    return { L: Si[0], R: Sp[Sp.length - 1] }
  }
  const stripFaces: number[] = []
  for (const e of selEdges) {
    const a = mesh.heVertex[e]
    const b = mesh.heTarget(e)
    const t = mesh.heTwin[e]
    const fl = mesh.heFace[e]
    const fr = mesh.heFace[t]
    const A = sideOf(a, e) // aL in fl, aR in fr
    const B = sideOf(b, t) // from b: L is face(t) = fr, R is fl
    const aArc = arc(A.L, A.R, a) // aL -> aR
    const bArc = arc(B.R, B.L, b) // bL (in fl) -> bR (in fr)
    const attrA = (k: number) => lerpAttrs(attrsOf.get(`${A.L}:${fl}`) ?? {}, attrsOf.get(`${A.R}:${fr}`) ?? {}, k / segments)
    const attrB = (k: number) => lerpAttrs(attrsOf.get(`${B.R}:${fl}`) ?? {}, attrsOf.get(`${B.L}:${fr}`) ?? {}, k / segments)
    for (let k = 0; k < segments; k++) {
      strips.push(loopFrom(
        [aArc[k], aArc[k + 1], bArc[k + 1], bArc[k]],
        [attrA(k), attrA(k + 1), attrB(k + 1), attrB(k)],
      ))
    }
  }

  // 3. Corner polygons: what remains open around each vertex, in fan order
  const holes: CornerLoop[] = []
  for (const [a, fan] of fans) {
    const n = fan.out.length
    const ring: number[] = []
    for (let i = 0; i < n; i++) {
      if (isSel(fan.out[i])) {
        const prev = fan.S[(i + n - 1) % n]
        const from = prev[prev.length - 1]
        const to = fan.S[i][0]
        // Arc runs aL(=to) -> aR(=from); the corner walks it from `from` to `to`
        const pts = arc(to, from, a)
        for (const p of [...pts].reverse().slice(1, -1)) ring.push(p)
      }
      for (const p of fan.S[i]) ring.push(p)
    }
    const cyc = ring.filter((p, i) => p !== ring[(i + ring.length - 1) % ring.length])
    if (cyc.length >= 3) holes.push({ vertices: cyc })
  }

  const r = rebuildFaces(mesh, touched, [...loops, ...strips, ...holes], fans.keys())
  if (!r.ok) return err(r.code, `bevel failed: ${r.message}`)
  for (const a of fans.keys()) if (mesh.isVertexAlive(a) && mesh.vertexHalfEdge[a] < 0) mesh.removeVertex(a)
  stripFaces.push(...r.value.slice(loops.length))
  return ok({ selection: { mode: 'face', elements: stripFaces } })
}
