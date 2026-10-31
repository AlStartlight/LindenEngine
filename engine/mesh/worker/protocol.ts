import type { BooleanOp, SubdivScheme, UvMethod } from '../core/GeometryOps'
import { halfEdgeDataBuffers, type HalfEdgeMeshData } from '../core/HalfEdgeMesh'
import { meshBuffers, type LindenMesh } from '../core/LindenMesh'
import type { GeomResult } from '../core/result'

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

function isLindenMesh(v: unknown): v is LindenMesh {
  return typeof v === 'object' && v !== null && 'positions' in v && 'indices' in v
}

function isHalfEdgeData(v: unknown): v is HalfEdgeMeshData {
  return typeof v === 'object' && v !== null && 'heNext' in v && 'faceHalfEdge' in v
}

/** Collects the buffers of every mesh found in a value (top level or inside an array) */
export function collectTransferables(value: unknown): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>()
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit)
    else if (isLindenMesh(v)) meshBuffers(v).forEach((b) => set.add(b))
    else if (isHalfEdgeData(v)) halfEdgeDataBuffers(v).forEach((b) => set.add(b))
  }
  visit(value)
  return [...set]
}
