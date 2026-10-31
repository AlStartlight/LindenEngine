import type { HalfEdgeMesh } from './HalfEdgeMesh'
import type { LindenMesh } from './LindenMesh'
import type { GeomResult } from './result'

export type BooleanOp = 'union' | 'subtract' | 'intersect'
export type SubdivScheme = 'catmull-clark' | 'loop'
export type UvMethod = 'lscm' | 'abf'

/**
 * The only geometry API the editor and renderer see. Implementations wrap the WASM libraries
 * (inside the worker) or forward to the worker (WorkerGeometryOps). Failures resolve to a typed
 * error result; the promise itself never rejects.
 */
export interface GeometryOps {
  boolean(a: LindenMesh, b: LindenMesh, op: BooleanOp): Promise<GeomResult<LindenMesh>>
  subdivide(mesh: HalfEdgeMesh, levels: number, scheme: SubdivScheme): Promise<GeomResult<HalfEdgeMesh>>
  unwrapUV(mesh: LindenMesh, method: UvMethod): Promise<GeomResult<LindenMesh>>
  remesh(mesh: LindenMesh, targetVertexCount: number): Promise<GeomResult<LindenMesh>>
  smooth(mesh: LindenMesh, iterations: number): Promise<GeomResult<LindenMesh>>
  repair(mesh: LindenMesh): Promise<GeomResult<LindenMesh>>
  simplify(mesh: LindenMesh, ratio: number, maxError: number): Promise<GeomResult<LindenMesh>>
  generateLODs(mesh: LindenMesh, ratios: number[]): Promise<GeomResult<LindenMesh[]>>
}
