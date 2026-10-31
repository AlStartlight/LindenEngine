import { err, ok, type GeomResult } from './result'

/**
 * Flat, renderer-neutral mesh used for data exchange (worker messages, import/export, rendering).
 * Triangles only in `indices`; the optional `polygons` keeps the original n-gon faces so a round trip
 * through HalfEdgeMesh restores quads and n-gons instead of their triangulation.
 */
export interface LindenMesh {
  positions: Float32Array
  indices: Uint32Array
  normals?: Float32Array
  uvs?: Float32Array
  polygons?: PolygonList
}

/** Polygon faces as vertex loops: face i uses `indices[offset .. offset + sizes[i])` */
export interface PolygonList {
  sizes: Uint32Array
  indices: Uint32Array
}

export function vertexCount(mesh: LindenMesh): number {
  return mesh.positions.length / 3
}

export function triangleCount(mesh: LindenMesh): number {
  return mesh.indices.length / 3
}

export function isEmpty(mesh: LindenMesh): boolean {
  return mesh.positions.length === 0 || mesh.indices.length === 0
}

/** Structural checks only (array lengths, index ranges, finite numbers); topology is checked on HalfEdgeMesh */
export function validateLindenMesh(mesh: LindenMesh): GeomResult<void> {
  const { positions, indices, normals, uvs, polygons } = mesh
  if (positions.length % 3 !== 0) return err('INVALID_MESH', `positions length ${positions.length} is not a multiple of 3`)
  if (indices.length % 3 !== 0) return err('INVALID_MESH', `indices length ${indices.length} is not a multiple of 3`)
  const nv = positions.length / 3
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) return err('INVALID_MESH', `position component ${i} is not finite`)
  }
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= nv) return err('INVALID_MESH', `index ${indices[i]} at ${i} is out of range (${nv} vertices)`)
  }
  if (normals && normals.length !== nv * 3) return err('INVALID_MESH', `normals length ${normals.length} != ${nv * 3}`)
  if (uvs && uvs.length !== nv * 2) return err('INVALID_MESH', `uvs length ${uvs.length} != ${nv * 2}`)
  if (polygons) {
    let total = 0
    for (let i = 0; i < polygons.sizes.length; i++) {
      if (polygons.sizes[i] < 3) return err('INVALID_MESH', `polygon ${i} has ${polygons.sizes[i]} vertices`)
      total += polygons.sizes[i]
    }
    if (total !== polygons.indices.length) {
      return err('INVALID_MESH', `polygon sizes sum to ${total} but there are ${polygons.indices.length} polygon indices`)
    }
    for (let i = 0; i < polygons.indices.length; i++) {
      if (polygons.indices[i] >= nv) return err('INVALID_MESH', `polygon index ${polygons.indices[i]} is out of range`)
    }
  }
  return ok(undefined)
}

/** Every ArrayBuffer referenced by the mesh, deduplicated, for postMessage transfer lists */
export function meshBuffers(mesh: LindenMesh): ArrayBuffer[] {
  const arrays: (ArrayBufferView | undefined)[] = [
    mesh.positions, mesh.indices, mesh.normals, mesh.uvs, mesh.polygons?.sizes, mesh.polygons?.indices,
  ]
  const set = new Set<ArrayBuffer>()
  for (const a of arrays) if (a && a.buffer instanceof ArrayBuffer) set.add(a.buffer)
  return [...set]
}

/** Deep copy whose arrays each own a tightly sized buffer (safe to transfer without detaching the source) */
export function cloneLindenMesh(mesh: LindenMesh): LindenMesh {
  const out: LindenMesh = { positions: mesh.positions.slice(), indices: mesh.indices.slice() }
  if (mesh.normals) out.normals = mesh.normals.slice()
  if (mesh.uvs) out.uvs = mesh.uvs.slice()
  if (mesh.polygons) out.polygons = { sizes: mesh.polygons.sizes.slice(), indices: mesh.polygons.indices.slice() }
  return out
}
