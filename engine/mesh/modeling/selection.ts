import type { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import { aliveFaces, aliveVertices, allEdges, edgeId, edgeVertices } from './topology'

export type SelectMode = 'vertex' | 'edge' | 'face'

export interface SelectionData {
  mode: SelectMode
  vertices: number[]
  edges: number[]
  faces: number[]
}

export interface ScreenRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Screen position of a vertex, or null when it is behind the camera */
export type ProjectFn = (x: number, y: number, z: number) => [number, number] | null

/**
 * Edit-mode selection over a HalfEdgeMesh. The set of the active mode is the source of truth; the other
 * two are flushed from it after every change (as in Blender): a vertex-mode selection also lists the
 * edges/faces whose vertices are all selected, a face-mode selection lists its vertices and edges, etc.
 * Edges are identified by `edgeId` (smaller half-edge of the pair).
 */
export class MeshSelection {
  mode: SelectMode = 'vertex'
  readonly vertices = new Set<number>()
  readonly edges = new Set<number>()
  readonly faces = new Set<number>()

  constructor(readonly mesh: HalfEdgeMesh) {}

  private active(): Set<number> {
    return this.mode === 'vertex' ? this.vertices : this.mode === 'edge' ? this.edges : this.faces
  }

  get isEmpty(): boolean {
    return this.active().size === 0
  }

  /** All three sets are always flushed, so switching mode only re-derives from the new mode's set */
  setMode(mode: SelectMode): void {
    this.mode = mode
    this.flush()
  }

  clear(): void {
    this.vertices.clear()
    this.edges.clear()
    this.faces.clear()
  }

  /** Click (replace) or shift-click (toggle) on an element of the active mode */
  click(element: number, extend = false): void {
    const set = this.active()
    if (!extend) {
      this.clear()
      set.add(element)
    } else if (set.has(element)) {
      set.delete(element)
    } else {
      set.add(element)
    }
    this.flush()
  }

  selectAll(): void {
    const set = this.active()
    set.clear()
    const all = this.mode === 'vertex' ? aliveVertices(this.mesh) : this.mode === 'edge' ? allEdges(this.mesh) : aliveFaces(this.mesh)
    for (const x of all) set.add(x)
    this.flush()
  }

  selectNone(): void {
    this.clear()
  }

  /**
   * Box select in screen space (x-ray: occlusion is not considered). Vertex mode tests vertices; an edge
   * needs both ends inside, a face all of its corners. `extend` adds, `subtract` removes, else replaces.
   */
  box(project: ProjectFn, rect: ScreenRect, options: { extend?: boolean; subtract?: boolean } = {}): void {
    const m = this.mesh
    const inside = new Uint8Array(m.vertexSlots)
    for (const v of aliveVertices(m)) {
      const p = project(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
      if (p && p[0] >= rect.minX && p[0] <= rect.maxX && p[1] >= rect.minY && p[1] <= rect.maxY) inside[v] = 1
    }
    let hits: number[]
    if (this.mode === 'vertex') hits = aliveVertices(m).filter((v) => inside[v])
    else if (this.mode === 'edge') hits = allEdges(m).filter((e) => edgeVertices(m, e).every((v) => inside[v]))
    else hits = aliveFaces(m).filter((f) => m.faceVertices(f).every((v) => inside[v]))
    const set = this.active()
    if (!options.extend && !options.subtract) this.clear()
    for (const x of hits) {
      if (options.subtract) set.delete(x)
      else set.add(x)
    }
    this.flush()
  }

  /** Grows the selection to every element connected (through faces) to it */
  selectLinked(): void {
    const m = this.mesh
    const seen = new Uint8Array(m.vertexSlots)
    const stack = [...this.vertices]
    for (const v of stack) seen[v] = 1
    while (stack.length) {
      const v = stack.pop()!
      for (const h of m.vertexOutgoing(v)) {
        // Both faces of the fan edge, via the face loops (covers fans split by boundaries)
        for (const w of m.faceVertices(m.heFace[h])) {
          if (!seen[w]) {
            seen[w] = 1
            stack.push(w)
          }
        }
      }
    }
    const set = this.active()
    set.clear()
    if (this.mode === 'vertex') {
      for (let v = 0; v < m.vertexSlots; v++) if (seen[v] && m.vertexAlive[v]) set.add(v)
    } else if (this.mode === 'edge') {
      for (const e of allEdges(m)) if (edgeVertices(m, e).every((v) => seen[v])) set.add(e)
    } else {
      for (const f of aliveFaces(m)) if (m.faceVertices(f).every((v) => seen[v])) set.add(f)
    }
    this.flush()
  }

  /** Selects the edge loop through half-edge h (vertex/edge modes select its edges, face mode its faces' edges) */
  selectEdgeLoop(h: number, extend = false): void {
    this.applyEdges(edgeLoop(this.mesh, h), extend)
  }

  selectEdgeRing(h: number, extend = false): void {
    this.applyEdges(edgeRing(this.mesh, h), extend)
  }

  private applyEdges(edges: number[], extend: boolean): void {
    if (!extend) this.clear()
    const m = this.mesh
    if (this.mode === 'face') {
      // Face mode: faces between consecutive ring edges are what Blender selects; use faces fully bounded
      const es = new Set(edges)
      for (const e of edges) {
        for (const h of [e, m.heTwin[e]]) {
          if (h < 0) continue
          const f = m.heFace[h]
          const fe = m.faceHalfEdges(f).map((x) => edgeId(m, x))
          if (fe.filter((x) => es.has(x)).length >= 2) this.faces.add(f)
        }
      }
    } else if (this.mode === 'edge') {
      for (const e of edges) this.edges.add(e)
    } else {
      for (const e of edges) for (const v of edgeVertices(m, e)) this.vertices.add(v)
    }
    this.flush()
  }

  /** Drops elements that no longer exist (after undo or a topology change) */
  prune(): void {
    const m = this.mesh
    for (const v of [...this.vertices]) if (!m.isVertexAlive(v)) this.vertices.delete(v)
    for (const e of [...this.edges]) if (!m.isHalfEdgeAlive(e) || edgeId(m, e) !== e) this.edges.delete(e)
    for (const f of [...this.faces]) if (!m.isFaceAlive(f)) this.faces.delete(f)
    this.flush()
  }

  /** Re-derives the non-active sets from the active one */
  flush(): void {
    const m = this.mesh
    if (this.mode === 'vertex') {
      this.edges.clear()
      this.faces.clear()
      for (const e of allEdges(m)) if (edgeVertices(m, e).every((v) => this.vertices.has(v))) this.edges.add(e)
      for (const f of aliveFaces(m)) if (m.faceVertices(f).every((v) => this.vertices.has(v))) this.faces.add(f)
    } else if (this.mode === 'edge') {
      this.vertices.clear()
      this.faces.clear()
      for (const e of this.edges) for (const v of edgeVertices(m, e)) this.vertices.add(v)
      for (const f of aliveFaces(m)) {
        if (m.faceHalfEdges(f).every((h) => this.edges.has(edgeId(m, h)))) this.faces.add(f)
      }
    } else {
      this.vertices.clear()
      this.edges.clear()
      for (const f of this.faces) {
        for (const h of m.faceHalfEdges(f)) {
          this.vertices.add(m.heVertex[h])
          this.edges.add(edgeId(m, h))
        }
      }
    }
  }

  toData(): SelectionData {
    return { mode: this.mode, vertices: [...this.vertices], edges: [...this.edges], faces: [...this.faces] }
  }

  restore(data: SelectionData): void {
    this.clear()
    this.mode = data.mode
    for (const v of data.vertices) this.vertices.add(v)
    for (const e of data.edges) this.edges.add(e)
    for (const f of data.faces) this.faces.add(f)
    this.prune()
  }

  /** Replaces the selection with these elements of `mode` */
  set(mode: SelectMode, elements: Iterable<number>): void {
    this.clear()
    this.mode = mode
    const set = this.active()
    for (const x of elements) set.add(x)
    this.flush()
  }
}

function isInteriorValence4(mesh: HalfEdgeMesh, v: number): boolean {
  const out = mesh.vertexOutgoing(v)
  return out.length === 4 && out.every((h) => mesh.heTwin[h] >= 0)
}

/** Next half-edge along a boundary, leaving the target of boundary half-edge h */
function nextBoundary(mesh: HalfEdgeMesh, h: number): number {
  let g = mesh.heNext[h]
  let guard = 0
  while (mesh.heTwin[g] >= 0 && guard++ < mesh.halfEdgeSlots) g = mesh.heNext[mesh.heTwin[g]]
  return mesh.heTwin[g] < 0 ? g : -1
}

/**
 * Edge loop through half-edge h: across valence-4 interior vertices, continue on the opposite edge;
 * a boundary edge follows the boundary. Stops at poles, boundaries or when the loop closes.
 */
export function edgeLoop(mesh: HalfEdgeMesh, h: number): number[] {
  const ids = new Set<number>([edgeId(mesh, h)])
  const limit = mesh.halfEdgeSlots
  if (mesh.heTwin[h] < 0) {
    let g = nextBoundary(mesh, h)
    while (g >= 0 && g !== h && ids.size <= limit) {
      ids.add(edgeId(mesh, g))
      g = nextBoundary(mesh, g)
    }
    return [...ids]
  }
  const walk = (start: number): void => {
    let cur = start
    while (ids.size <= limit) {
      const b = mesh.heTarget(cur)
      if (!isInteriorValence4(mesh, b)) return
      const nx = mesh.heNext[mesh.heTwin[mesh.heNext[cur]]]
      const id = edgeId(mesh, nx)
      if (ids.has(id)) return // closed
      ids.add(id)
      cur = nx
    }
  }
  walk(h)
  walk(mesh.heTwin[h])
  return [...ids]
}

/** Edge ring through half-edge h: opposite edges across consecutive quads */
export function edgeRing(mesh: HalfEdgeMesh, h: number): number[] {
  const ids = new Set<number>([edgeId(mesh, h)])
  const walk = (start: number): void => {
    let cur = start
    while (cur >= 0 && ids.size <= mesh.halfEdgeSlots) {
      if (mesh.faceSize(mesh.heFace[cur]) !== 4) return
      const opposite = mesh.heNext[mesh.heNext[cur]]
      const id = edgeId(mesh, opposite)
      if (ids.has(id)) return
      ids.add(id)
      cur = mesh.heTwin[opposite]
    }
  }
  walk(h)
  if (mesh.heTwin[h] >= 0) walk(mesh.heTwin[h])
  return [...ids]
}
