import type { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import { ok, type GeomResult } from '../core/result'

/** A face as its corners: vertex loop plus the per-corner attributes to keep */
export interface CornerLoop {
  vertices: number[]
  uvs?: number[] // 2 per corner
  normals?: number[] // 3 per corner
}

/** Undirected edge id: the smaller of a half-edge and its twin (stable while the topology does not change) */
export function edgeId(mesh: HalfEdgeMesh, h: number): number {
  const t = mesh.heTwin[h]
  return t >= 0 && t < h ? t : h
}

export function edgeVertices(mesh: HalfEdgeMesh, e: number): [number, number] {
  return [mesh.heVertex[e], mesh.heTarget(e)]
}

/** Every undirected edge id of alive faces */
export function allEdges(mesh: HalfEdgeMesh): number[] {
  const out: number[] = []
  for (let h = 0; h < mesh.halfEdgeSlots; h++) {
    if (mesh.heFace[h] >= 0 && edgeId(mesh, h) === h) out.push(h)
  }
  return out
}

export function aliveFaces(mesh: HalfEdgeMesh): number[] {
  const out: number[] = []
  for (let f = 0; f < mesh.faceSlots; f++) if (mesh.faceHalfEdge[f] >= 0) out.push(f)
  return out
}

export function aliveVertices(mesh: HalfEdgeMesh): number[] {
  const out: number[] = []
  for (let v = 0; v < mesh.vertexSlots; v++) if (mesh.vertexAlive[v]) out.push(v)
  return out
}

export function faceCorners(mesh: HalfEdgeMesh, f: number): CornerLoop {
  const hs = mesh.faceHalfEdges(f)
  const loop: CornerLoop = { vertices: hs.map((h) => mesh.heVertex[h]) }
  if (mesh.cornerUvs) loop.uvs = hs.flatMap((h) => [mesh.cornerUvs![h * 2], mesh.cornerUvs![h * 2 + 1]])
  if (mesh.cornerNormals) {
    loop.normals = hs.flatMap((h) => [mesh.cornerNormals![h * 3], mesh.cornerNormals![h * 3 + 1], mesh.cornerNormals![h * 3 + 2]])
  }
  return loop
}

export function position(mesh: HalfEdgeMesh, v: number): [number, number, number] {
  return [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]
}

export function unitFaceNormal(mesh: HalfEdgeMesh, f: number): [number, number, number] {
  const n = mesh.faceNormal(f)
  const len = Math.hypot(n[0], n[1], n[2]) || 1
  return [n[0] / len, n[1] / len, n[2] / len]
}

export function faceCenter(mesh: HalfEdgeMesh, f: number): [number, number, number] {
  const vs = mesh.faceVertices(f)
  const c: [number, number, number] = [0, 0, 0]
  for (const v of vs) for (let k = 0; k < 3; k++) c[k] += mesh.positions[v * 3 + k] / vs.length
  return c
}

/**
 * Runs an edit as a transaction: when `fn` returns an error, every change it made (new vertices included)
 * is rolled back from a snapshot. Costs one O(mesh) copy per operation.
 */
export function transaction<T>(mesh: HalfEdgeMesh, fn: () => GeomResult<T>): GeomResult<T> {
  const snapshot = mesh.toData()
  let r: GeomResult<T>
  try {
    r = fn()
  } catch (e) {
    mesh.restore(snapshot)
    throw e
  }
  if (!r.ok) mesh.restore(snapshot)
  return r
}

/**
 * Removes `removed` faces and adds `added` loops. Stops at the first rejected face (repeated vertex, edge
 * already used in that direction) and returns its error: call it inside `transaction()` so that rolls back.
 * Vertices left without faces in `cleanup` are deleted. Returns the new face ids, in `added` order.
 */
export function rebuildFaces(
  mesh: HalfEdgeMesh, removed: Iterable<number>, added: CornerLoop[], cleanup: Iterable<number> = [],
): GeomResult<number[]> {
  const touched = new Set<number>(cleanup)
  for (const f of removed) {
    if (!mesh.isFaceAlive(f)) continue
    for (const v of mesh.faceVertices(f)) touched.add(v)
    mesh.removeFace(f)
  }
  const created: number[] = []
  for (const loop of added) {
    const r = mesh.addFace(loop.vertices)
    if (!r.ok) return r
    created.push(r.value)
    const hs = mesh.faceHalfEdges(r.value)
    if (loop.uvs) {
      mesh.enableCornerUvs()
      hs.forEach((h, k) => {
        mesh.cornerUvs![h * 2] = loop.uvs![k * 2]
        mesh.cornerUvs![h * 2 + 1] = loop.uvs![k * 2 + 1]
      })
    }
    if (loop.normals) {
      mesh.enableCornerNormals()
      hs.forEach((h, k) => {
        for (let c = 0; c < 3; c++) mesh.cornerNormals![h * 3 + c] = loop.normals![k * 3 + c]
      })
    }
  }
  mesh.repairVertexHalfEdges(touched)
  for (const v of touched) if (mesh.isVertexAlive(v) && mesh.vertexHalfEdge[v] < 0) mesh.removeVertex(v)
  return ok(created)
}

/** Corner attributes of `src` corner k, used when a new face reuses an old corner */
export function cornerAttrs(src: CornerLoop, k: number): { uv?: [number, number]; normal?: [number, number, number] } {
  return {
    uv: src.uvs ? [src.uvs[k * 2], src.uvs[k * 2 + 1]] : undefined,
    normal: src.normals ? [src.normals[k * 3], src.normals[k * 3 + 1], src.normals[k * 3 + 2]] : undefined,
  }
}

/** Builds a CornerLoop from vertices plus per-corner attributes taken from source corners */
export function loopFrom(vertices: number[], attrs: { uv?: [number, number]; normal?: [number, number, number] }[]): CornerLoop {
  const loop: CornerLoop = { vertices }
  if (attrs.length && attrs.every((a) => a.uv)) loop.uvs = attrs.flatMap((a) => a.uv!)
  if (attrs.length && attrs.every((a) => a.normal)) loop.normals = attrs.flatMap((a) => a.normal!)
  return loop
}
