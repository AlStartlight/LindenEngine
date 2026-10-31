import { fromLindenMesh, toLindenMesh } from '../core/convert'
import type { BooleanOp, GeometryOps, SubdivScheme } from '../core/GeometryOps'
import type { HalfEdgeMesh, HalfEdgeMeshData } from '../core/HalfEdgeMesh'
import type { LindenMesh } from '../core/LindenMesh'
import { err, ok, type GeomResult } from '../core/result'
import { MeshCommandStack, type MeshCommand } from './MeshCommandStack'
import {
  applyPositions, deleteElements, extrudeEdges, extrudeFaces, extrudeVertices, insetFaces, mergeAtCenter,
  mergeByDistance, transformVertices, type DeleteMode, type OpResult, type Pivot, type TransformSpec,
} from './ops'
import { MeshSelection, type SelectionData } from './selection'
import {
  connectVertices, dissolveEdges, dissolveFaces, dissolveVertices, fillOrBridge, flipNormals, knifeCut, loopCut,
  recalculateNormals, type KnifePoint,
} from './advancedOps'
import { bevel } from './bevel'

export interface MeshEditorOptions {
  /** WASM-backed operations (normally WorkerGeometryOps); needed for boolean/subdivide */
  geometry?: GeometryOps
  historyDepth?: number
}

interface Snapshot {
  mesh: HalfEdgeMeshData
  selection: SelectionData
}

/**
 * Edit-mode facade over one HalfEdgeMesh: selection, operations and undo/redo. Every operation goes
 * through the command stack; topology edits store full snapshots, transforms store only moved positions.
 * `version` increments on every change (including undo/redo) so pickers and modifier caches can refresh.
 */
export class MeshEditor {
  readonly selection: MeshSelection
  readonly history: MeshCommandStack
  version = 0
  private listeners = new Set<() => void>()
  private drag: { vertices: number[]; start: Float32Array; spec: TransformSpec; pivot: Pivot } | null = null

  constructor(readonly mesh: HalfEdgeMesh, private readonly options: MeshEditorOptions = {}) {
    this.selection = new MeshSelection(mesh)
    this.history = new MeshCommandStack(options.historyDepth ?? 100, () => this.changed())
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    this.version++
    for (const l of this.listeners) l()
  }

  private snapshot(): Snapshot {
    return { mesh: this.mesh.toData(), selection: this.selection.toData() }
  }

  private restore(s: Snapshot): void {
    this.mesh.restore(s.mesh)
    this.selection.restore(s.selection)
  }

  /** Wraps a synchronous op (which rolls itself back on failure) in a snapshot command */
  private topology(label: string, op: () => GeomResult<OpResult>): Promise<GeomResult<void>> {
    let before: Snapshot | null = null
    let after: Snapshot | null = null
    const command: MeshCommand = {
      label,
      execute: () => {
        before = this.snapshot()
        const r = op()
        if (!r.ok) return r
        // Last line of defence: never let NaN/Infinity into the mesh (it would be saved and break rendering)
        const p = this.mesh.positions
        for (let v = 0; v < this.mesh.vertexSlots; v++) {
          if (this.mesh.vertexAlive[v] && !(Number.isFinite(p[v * 3]) && Number.isFinite(p[v * 3 + 1]) && Number.isFinite(p[v * 3 + 2]))) {
            this.restore(before)
            return err('INTERNAL', `${label} produced an invalid position (vertex ${v}); the edit was undone`)
          }
        }
        this.selection.set(r.value.selection.mode, r.value.selection.elements)
        after = this.snapshot()
        return ok(undefined)
      },
      undo: () => this.restore(before!),
      redo: () => this.restore(after!),
    }
    return this.history.execute(command)
  }

  /** Wraps an async op that produces a replacement mesh (WASM in the worker) in a snapshot command */
  private async replaceAsync(label: string, compute: () => Promise<GeomResult<HalfEdgeMesh>>): Promise<GeomResult<void>> {
    let before: Snapshot | null = null
    let after: Snapshot | null = null
    return this.history.execute({
      label,
      execute: async () => {
        const r = await compute()
        if (!r.ok) return r
        before = this.snapshot()
        this.mesh.restore(r.value.toData())
        this.selection.set(this.selection.mode, [])
        after = this.snapshot()
        return ok(undefined)
      },
      undo: () => this.restore(before!),
      redo: () => this.restore(after!),
    })
  }

  // ---------------------------------------------------------------- operations

  transform(spec: TransformSpec, pivot: Pivot = 'median'): Promise<GeomResult<void>> {
    const vertices = [...this.selection.vertices]
    if (vertices.length === 0) return Promise.resolve(err('INVALID_TOPOLOGY', 'nothing selected to transform'))
    let delta: ReturnType<typeof transformVertices> | null = null
    return this.history.execute({
      label: 'Transform',
      execute: () => {
        delta = transformVertices(this.mesh, vertices, spec, pivot, this.selection.edges)
        return ok(undefined)
      },
      undo: () => applyPositions(this.mesh, delta!.vertices, delta!.before),
      redo: () => applyPositions(this.mesh, delta!.vertices, delta!.after),
    })
  }

  /** Interactive transform (gizmo drag): update() re-applies from the start positions; commit() records one undo step */
  beginTransform(pivot: Pivot = 'median'): void {
    const vertices = [...this.selection.vertices]
    const start = new Float32Array(vertices.length * 3)
    vertices.forEach((v, i) => start.set(this.mesh.positions.subarray(v * 3, v * 3 + 3), i * 3))
    this.drag = { vertices, start, spec: {}, pivot }
  }

  updateTransform(spec: TransformSpec): void {
    if (!this.drag) return
    applyPositions(this.mesh, this.drag.vertices, this.drag.start)
    transformVertices(this.mesh, this.drag.vertices, spec, this.drag.pivot, this.selection.edges)
    this.drag.spec = spec
    this.changed()
  }

  cancelTransform(): void {
    if (!this.drag) return
    applyPositions(this.mesh, this.drag.vertices, this.drag.start)
    this.drag = null
    this.changed()
  }

  commitTransform(): Promise<GeomResult<void>> {
    const drag = this.drag
    this.drag = null
    if (!drag) return Promise.resolve(err('INVALID_TOPOLOGY', 'no transform in progress'))
    const after = new Float32Array(drag.vertices.length * 3)
    drag.vertices.forEach((v, i) => after.set(this.mesh.positions.subarray(v * 3, v * 3 + 3), i * 3))
    return this.history.push({
      label: 'Transform',
      execute: () => ok(undefined),
      undo: () => applyPositions(this.mesh, drag.vertices, drag.start),
      redo: () => applyPositions(this.mesh, drag.vertices, after),
    })
  }

  /** Extrudes the selection of the current mode (faces as a region, boundary edges, vertices unsupported) */
  extrude(distance = 0): Promise<GeomResult<void>> {
    const mode = this.selection.mode
    if (mode === 'face') return this.topology('Extrude Faces', () => extrudeFaces(this.mesh, this.selection.faces, distance))
    if (mode === 'edge') return this.topology('Extrude Edges', () => extrudeEdges(this.mesh, this.selection.edges))
    return Promise.resolve(extrudeVertices() as GeomResult<never>)
  }

  inset(thickness: number, depth = 0): Promise<GeomResult<void>> {
    return this.topology('Inset Faces', () => insetFaces(this.mesh, this.selection.faces, thickness, depth))
  }

  /** Deletes elements of `mode` (defaults to the selection mode) */
  delete(mode?: DeleteMode): Promise<GeomResult<void>> {
    const m: DeleteMode = mode ?? (this.selection.mode === 'vertex' ? 'vertices' : this.selection.mode === 'edge' ? 'edges' : 'faces')
    const elements = m === 'vertices' ? this.selection.vertices : m === 'edges' ? this.selection.edges : this.selection.faces
    if (elements.size === 0) return Promise.resolve(err('INVALID_TOPOLOGY', 'nothing selected to delete'))
    return this.topology(`Delete ${m}`, () => deleteElements(this.mesh, m, [...elements]))
  }

  mergeAtCenter(): Promise<GeomResult<void>> {
    return this.topology('Merge at Center', () => mergeAtCenter(this.mesh, this.selection.vertices))
  }

  mergeByDistance(threshold: number): Promise<GeomResult<void>> {
    return this.topology('Merge by Distance', () => mergeByDistance(this.mesh, this.selection.vertices, threshold))
  }

  /** Bevel selected edges (edge/face modes) or vertices (vertex mode) */
  bevel(width: number, segments = 1): Promise<GeomResult<void>> {
    const sel = this.selection
    const vertexMode = sel.mode === 'vertex'
    return this.topology(vertexMode ? 'Bevel Vertices' : 'Bevel Edges', () => bevel(this.mesh, vertexMode
      ? { vertices: sel.vertices, width, segments }
      : { edges: sel.edges, width, segments }))
  }

  /** Loop cut across the quad ring of an edge (the first selected edge when omitted) */
  loopCut(edge?: number, cuts = 1): Promise<GeomResult<void>> {
    const e = edge ?? [...this.selection.edges][0]
    if (e === undefined) return Promise.resolve(err('INVALID_TOPOLOGY', 'select an edge to loop cut'))
    return this.topology('Loop Cut', () => loopCut(this.mesh, e, cuts))
  }

  /** Connect two selected vertices across their shared face */
  connect(): Promise<GeomResult<void>> {
    const vs = [...this.selection.vertices]
    if (vs.length !== 2) return Promise.resolve(err('INVALID_TOPOLOGY', 'select exactly two vertices to connect'))
    return this.topology('Connect Vertices', () => connectVertices(this.mesh, vs[0], vs[1]))
  }

  knife(path: KnifePoint[]): Promise<GeomResult<void>> {
    return this.topology('Knife', () => knifeCut(this.mesh, path))
  }

  /** Dissolve the selected elements of the current mode */
  dissolve(): Promise<GeomResult<void>> {
    const sel = this.selection
    if (sel.mode === 'vertex') return this.topology('Dissolve Vertices', () => dissolveVertices(this.mesh, sel.vertices))
    if (sel.mode === 'edge') return this.topology('Dissolve Edges', () => dissolveEdges(this.mesh, sel.edges))
    return this.topology('Dissolve Faces', () => dissolveFaces(this.mesh, sel.faces))
  }

  /** One selected boundary loop: fill; two: bridge */
  fillOrBridge(): Promise<GeomResult<void>> {
    return this.topology('Fill / Bridge', () => fillOrBridge(this.mesh, this.selection.edges))
  }

  flipNormals(): Promise<GeomResult<void>> {
    return this.topology('Flip Normals', () => flipNormals(this.mesh, this.selection.faces))
  }

  recalculateNormals(inside = false): Promise<GeomResult<void>> {
    const faces = this.selection.faces.size ? this.selection.faces : undefined
    return this.topology('Recalculate Normals', () => {
      const r = recalculateNormals(this.mesh, faces, inside)
      return r.ok ? ok<OpResult>({ selection: { mode: this.selection.mode, elements: [] } }) : r
    })
  }

  /** Async WASM boolean of the whole edited mesh with another mesh (undoable like any other edit) */
  booleanWith(other: LindenMesh, op: BooleanOp): Promise<GeomResult<void>> {
    const geometry = this.options.geometry
    if (!geometry) return Promise.resolve(err('NOT_IMPLEMENTED', 'no GeometryOps configured for boolean'))
    return this.replaceAsync(`Boolean ${op}`, async () => {
      const r = await geometry.boolean(toLindenMesh(this.mesh, { polygons: false }), other, op)
      if (!r.ok) return r
      const he = fromLindenMesh(r.value, { weld: true })
      return he.ok ? ok(he.value.mesh) : he
    })
  }

  /** Async WASM subdivision (OpenSubdiv, Phase 4) */
  subdivide(levels: number, scheme: SubdivScheme = 'catmull-clark'): Promise<GeomResult<void>> {
    const geometry = this.options.geometry
    if (!geometry) return Promise.resolve(err('NOT_IMPLEMENTED', 'no GeometryOps configured for subdivide'))
    return this.replaceAsync(`Subdivide ${levels}`, () => geometry.subdivide(this.mesh.clone(), levels, scheme))
  }

  undo(): Promise<boolean> {
    return this.history.undo()
  }

  redo(): Promise<boolean> {
    return this.history.redo()
  }
}
