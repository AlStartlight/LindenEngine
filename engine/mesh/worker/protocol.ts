import type { BooleanOp, SubdivScheme, UvMethod } from '../core/GeometryOps'
import type { HalfEdgeMeshData } from '../core/HalfEdgeMesh'
import type { LindenMesh } from '../core/LindenMesh'
import type { GeomResult } from '../core/result'
import type { GlbExportOptions, GltfImportReport } from '../io/gltf'

/**
 * Typed request/response protocol between WorkerGeometryOps (main thread) and the geometry worker.
 * Half-edge meshes travel as HalfEdgeMeshData snapshots; all typed-array buffers are transferred.
 */
export interface OpSignatures {
  ping: { args: []; result: 'pong' }
  /** Round-trips a mesh untouched; used to test transfer and serialization */
  echo: { args: [LindenMesh]; result: LindenMesh }
  boolean: { args: [LindenMesh, LindenMesh, BooleanOp]; result: LindenMesh }
  subdivide: { args: [HalfEdgeMeshData, number, SubdivScheme]; result: HalfEdgeMeshData }
  unwrapUV: { args: [LindenMesh, UvMethod]; result: LindenMesh }
  remesh: { args: [LindenMesh, number]; result: LindenMesh }
  smooth: { args: [LindenMesh, number]; result: LindenMesh }
  repair: { args: [LindenMesh]; result: LindenMesh }
  simplify: { args: [LindenMesh, number, number]; result: LindenMesh }
  generateLODs: { args: [LindenMesh, number[]]; result: LindenMesh[] }
  // Not part of GeometryOps: mesh I/O and GPU optimisation
  optimizeVertexCache: { args: [LindenMesh]; result: LindenMesh }
  importGltf: { args: [Uint8Array]; result: { mesh: LindenMesh; report: GltfImportReport } }
  exportGlb: { args: [LindenMesh, GlbExportOptions]; result: Uint8Array }
}

export type OpName = keyof OpSignatures
export type OpArgs<K extends OpName> = OpSignatures[K]['args']
export type OpResult<K extends OpName> = OpSignatures[K]['result']

export type WorkerRequest = { [K in OpName]: { id: number; op: K; args: OpArgs<K> } }[OpName]

export interface WorkerResponse {
  id: number
  result: GeomResult<unknown>
}

/** Worker-side implementation of each op; missing ops answer NOT_IMPLEMENTED */
export type WorkerBackend = {
  [K in OpName]?: (...args: OpArgs<K>) => Promise<GeomResult<OpResult<K>>> | GeomResult<OpResult<K>>
}

/** Every ArrayBuffer behind a typed array anywhere in the value (deduplicated), for postMessage transfer lists */
export function collectTransferables(value: unknown): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>()
  const visit = (v: unknown, depth: number): void => {
    if (depth > 8 || typeof v !== 'object' || v === null) return
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer) set.add(v.buffer)
      return
    }
    for (const child of Array.isArray(v) ? v : Object.values(v)) visit(child, depth + 1)
  }
  visit(value, 0)
  return [...set]
}
