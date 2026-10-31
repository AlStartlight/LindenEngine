import { isEmpty, validateLindenMesh, type LindenMesh } from '../core/LindenMesh'
import { err, fromException, ok, type GeomResult } from '../core/result'

type MeshoptModule = typeof import('meshoptimizer')

let loading: Promise<MeshoptModule> | null = null

/** meshoptimizer manages its own WASM memory per call (sbrk reset), so there is nothing to delete */
export async function loadMeshopt(): Promise<GeomResult<MeshoptModule>> {
  try {
    loading ??= import('meshoptimizer').then(async (m) => {
      await Promise.all([m.MeshoptSimplifier.ready, m.MeshoptEncoder.ready])
      return m
    })
    return ok(await loading)
  } catch (e) {
    loading = null
    return err('WASM_LOAD_FAILED', `could not load meshoptimizer: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export interface SimplifyResult {
  mesh: LindenMesh
  /**
   * meshoptimizer's error estimate, relative to the mesh extents (same unit as maxError). It is a
   * quadric (distance-to-plane) estimate, not a strict Hausdorff bound: measured surface deviation on a
   * sphere ran ~25% above it while staying well under maxError (see tests/mesh/simplify.test.ts).
   */
  error: number
  /** `error` in mesh units */
  absoluteError: number
}

/** Keeps only referenced vertices, in first-use order; returns the remapped mesh */
function compact(mesh: LindenMesh, indices: Uint32Array): LindenMesh {
  const nv = mesh.positions.length / 3
  const remap = new Int32Array(nv).fill(-1)
  let count = 0
  const outIdx = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    if (remap[v] < 0) remap[v] = count++
    outIdx[i] = remap[v]
  }
  const positions = new Float32Array(count * 3)
  const uvs = mesh.uvs ? new Float32Array(count * 2) : undefined
  const normals = mesh.normals ? new Float32Array(count * 3) : undefined
  for (let v = 0; v < nv; v++) {
    const o = remap[v]
    if (o < 0) continue
    positions.set(mesh.positions.subarray(v * 3, v * 3 + 3), o * 3)
    if (uvs && mesh.uvs) uvs.set(mesh.uvs.subarray(v * 2, v * 2 + 2), o * 2)
    if (normals && mesh.normals) normals.set(mesh.normals.subarray(v * 3, v * 3 + 3), o * 3)
  }
  const out: LindenMesh = { positions, indices: outIdx }
  if (uvs) out.uvs = uvs
  if (normals) out.normals = normals
  return out
}

/**
 * Reduces the triangle count to about `ratio` of the input while the deviation stays within `maxError`
 * (relative to the mesh extents, e.g. 0.01 = 1%). The error bound wins: the result may keep more
 * triangles than requested. uv/normal seams are respected. Polygons are dropped (output is triangles).
 */
export async function simplifyMesh(mesh: LindenMesh, ratio: number, maxError: number): Promise<GeomResult<SimplifyResult>> {
  const valid = validateLindenMesh(mesh)
  if (!valid.ok) return valid
  if (isEmpty(mesh)) return err('EMPTY_MESH', 'cannot simplify an empty mesh')
  if (!(ratio > 0 && ratio <= 1)) return err('INVALID_MESH', `ratio must be in (0, 1], got ${ratio}`)
  if (!(maxError >= 0)) return err('INVALID_MESH', `maxError must be >= 0, got ${maxError}`)

  const loaded = await loadMeshopt()
  if (!loaded.ok) return loaded
  const { MeshoptSimplifier } = loaded.value
  try {
    const target = Math.max(3, Math.floor((mesh.indices.length / 3) * ratio) * 3)
    const indices = mesh.indices.slice()
    let result: [Uint32Array, number]
    if (mesh.uvs || mesh.normals) {
      const stride = (mesh.uvs ? 2 : 0) + (mesh.normals ? 3 : 0)
      const nv = mesh.positions.length / 3
      const attrs = new Float32Array(nv * stride)
      const weights: number[] = []
      if (mesh.uvs) weights.push(1, 1)
      if (mesh.normals) weights.push(0.5, 0.5, 0.5)
      for (let i = 0; i < nv; i++) {
        let k = i * stride
        if (mesh.uvs) {
          attrs[k++] = mesh.uvs[i * 2]
          attrs[k++] = mesh.uvs[i * 2 + 1]
        }
        if (mesh.normals) for (let c = 0; c < 3; c++) attrs[k++] = mesh.normals[i * 3 + c]
      }
      result = MeshoptSimplifier.simplifyWithAttributes(indices, mesh.positions, 3, attrs, stride, weights, null, target, maxError)
    } else {
      result = MeshoptSimplifier.simplify(indices, mesh.positions, 3, target, maxError)
    }
    const [outIndices, error] = result
    const scale = MeshoptSimplifier.getScale(mesh.positions, 3)
    return ok({ mesh: compact(mesh, outIndices), error, absoluteError: error * scale })
  } catch (e) {
    return fromException(e)
  }
}

/** One simplified mesh per ratio; each LOD is derived from the full-detail mesh */
export async function generateLODs(mesh: LindenMesh, ratios: number[], maxError = 0.05): Promise<GeomResult<LindenMesh[]>> {
  const out: LindenMesh[] = []
  for (const r of ratios) {
    const s = await simplifyMesh(mesh, r, maxError)
    if (!s.ok) return s
    out.push(s.value.mesh)
  }
  return ok(out)
}

/** Reorders triangles for the GPU vertex cache and vertices for fetch locality (topology unchanged) */
export async function optimizeVertexCache(mesh: LindenMesh): Promise<GeomResult<LindenMesh>> {
  const valid = validateLindenMesh(mesh)
  if (!valid.ok) return valid
  if (isEmpty(mesh)) return ok({ positions: new Float32Array(0), indices: new Uint32Array(0) })
  const loaded = await loadMeshopt()
  if (!loaded.ok) return loaded
  try {
    const indices = mesh.indices.slice()
    // reorderMesh rewrites `indices` in place and returns old -> new vertex remap (0xffffffff = unused)
    const [remap, unique] = loaded.value.MeshoptEncoder.reorderMesh(indices, true, false)
    const nv = mesh.positions.length / 3
    const positions = new Float32Array(unique * 3)
    const uvs = mesh.uvs ? new Float32Array(unique * 2) : undefined
    const normals = mesh.normals ? new Float32Array(unique * 3) : undefined
    for (let v = 0; v < nv; v++) {
      const o = remap[v]
      if (o === 0xffffffff) continue
      positions.set(mesh.positions.subarray(v * 3, v * 3 + 3), o * 3)
      if (uvs && mesh.uvs) uvs.set(mesh.uvs.subarray(v * 2, v * 2 + 2), o * 2)
      if (normals && mesh.normals) normals.set(mesh.normals.subarray(v * 3, v * 3 + 3), o * 3)
    }
    const out: LindenMesh = { positions, indices }
    if (uvs) out.uvs = uvs
    if (normals) out.normals = normals
    return ok(out)
  } catch (e) {
    return fromException(e)
  }
}
