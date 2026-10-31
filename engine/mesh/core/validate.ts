import { HalfEdgeMesh } from './HalfEdgeMesh'
import { err, ok, type GeomResult } from './result'

export type TopologyIssueCode =
  | 'BAD_NEXT'
  | 'BAD_PREV'
  | 'BAD_TWIN'
  | 'BAD_VERTEX_REF'
  | 'BAD_FACE_REF'
  | 'BROKEN_FACE_LOOP'
  | 'FACE_TOO_SMALL'
  | 'ORPHAN_HALF_EDGE'
  | 'EDGE_MAP_MISMATCH'
  | 'BAD_VERTEX_HALF_EDGE'
  | 'REPEATED_FACE_VERTEX'
  | 'ZERO_AREA_FACE'
  | 'NON_MANIFOLD_VERTEX'

export interface TopologyIssue {
  code: TopologyIssueCode
  /** Errors break half-edge invariants; warnings are valid topology that editing ops should know about */
  severity: 'error' | 'warning'
  element: 'vertex' | 'halfEdge' | 'face' | 'mesh'
  index: number
  message: string
}

const AREA_EPSILON = 1e-12

/** Full invariant check; O(V + H + F) */
export function validateTopology(mesh: HalfEdgeMesh): TopologyIssue[] {
  const issues: TopologyIssue[] = []
  const add = (
    code: TopologyIssueCode, severity: TopologyIssue['severity'], element: TopologyIssue['element'],
    index: number, message: string,
  ): void => {
    issues.push({ code, severity, element, index, message })
  }

  let aliveHalfEdges = 0
  const outgoing = new Int32Array(mesh.vertexSlots)
  for (let h = 0; h < mesh.halfEdgeSlots; h++) {
    if (mesh.heFace[h] < 0) continue
    aliveHalfEdges++
    const n = mesh.heNext[h]
    const p = mesh.hePrev[h]
    const v = mesh.heVertex[h]
    if (!mesh.isVertexAlive(v)) {
      add('BAD_VERTEX_REF', 'error', 'halfEdge', h, `half-edge ${h} starts at dead vertex ${v}`)
      continue
    }
    outgoing[v]++
    if (!mesh.isFaceAlive(mesh.heFace[h])) add('BAD_FACE_REF', 'error', 'halfEdge', h, `half-edge ${h} is in dead face`)
    if (!mesh.isHalfEdgeAlive(n) || mesh.hePrev[n] !== h || mesh.heFace[n] !== mesh.heFace[h]) {
      add('BAD_NEXT', 'error', 'halfEdge', h, `next of ${h} is inconsistent`)
      continue
    }
    if (!mesh.isHalfEdgeAlive(p) || mesh.heNext[p] !== h) add('BAD_PREV', 'error', 'halfEdge', h, `prev of ${h} is inconsistent`)
    const t = mesh.heTwin[h]
    if (t >= 0) {
      const target = mesh.heVertex[n]
      if (!mesh.isHalfEdgeAlive(t) || mesh.heTwin[t] !== h || mesh.heVertex[t] !== target
        || mesh.heVertex[mesh.heNext[t]] !== v) {
        add('BAD_TWIN', 'error', 'halfEdge', h, `twin of ${h} is inconsistent`)
      }
    } else if (mesh.findHalfEdge(mesh.heVertex[n], v) >= 0) {
      add('BAD_TWIN', 'error', 'halfEdge', h, `half-edge ${h} has an opposite edge but no twin`)
    }
    if (mesh.findHalfEdge(v, mesh.heVertex[n]) !== h) {
      add('EDGE_MAP_MISMATCH', 'error', 'halfEdge', h, `edge map does not point at half-edge ${h}`)
    }
  }
  if (aliveHalfEdges !== mesh.halfEdgeCount) {
    add('EDGE_MAP_MISMATCH', 'error', 'mesh', -1, `${aliveHalfEdges} half-edges but ${mesh.halfEdgeCount} edge map entries`)
  }

  let loopTotal = 0
  const normal: [number, number, number] = [0, 0, 0]
  for (let f = 0; f < mesh.faceSlots; f++) {
    const start = mesh.faceHalfEdge[f]
    if (start < 0) continue
    if (!mesh.isHalfEdgeAlive(start) || mesh.heFace[start] !== f) {
      add('BAD_FACE_REF', 'error', 'face', f, `face ${f} points at a half-edge of another face`)
      continue
    }
    let h = start
    let len = 0
    let closed = false
    const seen = new Set<number>()
    let repeated = false
    do {
      if (seen.has(mesh.heVertex[h])) repeated = true
      seen.add(mesh.heVertex[h])
      len++
      h = mesh.heNext[h]
      if (h === start) closed = true
    } while (!closed && len <= mesh.halfEdgeSlots && mesh.isHalfEdgeAlive(h))
    if (!closed) {
      add('BROKEN_FACE_LOOP', 'error', 'face', f, `face ${f} loop does not close`)
      continue
    }
    loopTotal += len
    if (len < 3) add('FACE_TOO_SMALL', 'error', 'face', f, `face ${f} has ${len} sides`)
    if (repeated) add('REPEATED_FACE_VERTEX', 'error', 'face', f, `face ${f} uses a vertex twice`)
    mesh.faceNormal(f, normal)
    if (Math.hypot(normal[0], normal[1], normal[2]) <= AREA_EPSILON) {
      add('ZERO_AREA_FACE', 'warning', 'face', f, `face ${f} has zero area`)
    }
  }
  if (loopTotal !== aliveHalfEdges) {
    add('ORPHAN_HALF_EDGE', 'error', 'mesh', -1, `${aliveHalfEdges - loopTotal} half-edges are not on any face loop`)
  }

  for (let v = 0; v < mesh.vertexSlots; v++) {
    if (!mesh.vertexAlive[v]) continue
    const h = mesh.vertexHalfEdge[v]
    if (h < 0) {
      if (outgoing[v] > 0) add('BAD_VERTEX_HALF_EDGE', 'error', 'vertex', v, `vertex ${v} is used by faces but has no half-edge`)
      continue
    }
    if (!mesh.isHalfEdgeAlive(h) || mesh.heVertex[h] !== v) {
      add('BAD_VERTEX_HALF_EDGE', 'error', 'vertex', v, `vertex ${v} points at a half-edge that does not leave it`)
      continue
    }
    const fan = mesh.vertexOutgoing(v).length
    if (fan !== outgoing[v]) {
      add('NON_MANIFOLD_VERTEX', 'warning', 'vertex', v, `vertex ${v} joins ${outgoing[v]} faces but its fan reaches ${fan}`)
    }
  }
  return issues
}

/** INVALID_TOPOLOGY if any error-level issue exists */
export function checkTopology(mesh: HalfEdgeMesh): GeomResult<void> {
  const errors = validateTopology(mesh).filter((i) => i.severity === 'error')
  if (errors.length === 0) return ok(undefined)
  const shown = errors.slice(0, 5).map((i) => i.message).join('; ')
  return err('INVALID_TOPOLOGY', `${errors.length} topology error(s): ${shown}`)
}
