import type { UvMethod } from '../core/GeometryOps'
import { isEmpty, validateLindenMesh, type LindenMesh } from '../core/LindenMesh'
import { err, fromException, ok, type GeomResult } from '../core/result'
import type { MainModule } from './wasm/geogram'

let loading: Promise<MainModule> | null = null

/** Loads the Geogram WASM module (native/build.sh) on first use */
export async function loadGeogram(): Promise<GeomResult<MainModule>> {
  try {
    loading ??= import('./wasm/geogram.js').then((m) => m.default())
    return ok(await loading)
  } catch (e) {
    loading = null
    return err('WASM_LOAD_FAILED', `could not load Geogram: ${e instanceof Error ? e.message : String(e)}`)
  }
}

type GeogramOut = { ok: true; positions: Float32Array; indices: Uint32Array; cornerUvs?: Float32Array } | { ok: false; error: string }

async function run(
  mesh: LindenMesh, label: string, call: (g: MainModule) => GeogramOut,
): Promise<GeomResult<{ positions: Float32Array; indices: Uint32Array; cornerUvs?: Float32Array }>> {
  const valid = validateLindenMesh(mesh)
  if (!valid.ok) return valid
  if (isEmpty(mesh)) return err('EMPTY_MESH', `cannot ${label} an empty mesh`)
  const loaded = await loadGeogram()
  if (!loaded.ok) return loaded
  try {
    const r = call(loaded.value)
    if (!r.ok) return err(label === 'repair' ? 'REPAIR_FAILED' : 'INVALID_MESH', `Geogram ${label}: ${r.error}`)
    return ok(r)
  } catch (e) {
    return fromException(e)
  }
}

/** Splits vertices whose corners carry different uvs (seams), giving per-vertex uvs */
function splitCornerUvs(positions: Float32Array, indices: Uint32Array, cornerUvs: Float32Array): LindenMesh {
  const map = new Map<string, number>()
  const outPos: number[] = []
  const outUv: number[] = []
  const outIdx = new Uint32Array(indices.length)
  for (let c = 0; c < indices.length; c++) {
    const v = indices[c]
    const u = cornerUvs[c * 2]
    const w = cornerUvs[c * 2 + 1]
    const key = `${v}|${u}|${w}`
    let o = map.get(key)
    if (o === undefined) {
      o = outPos.length / 3
      map.set(key, o)
      outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
      outUv.push(u, w)
    }
    outIdx[c] = o
  }
  return { positions: new Float32Array(outPos), indices: outIdx, uvs: new Float32Array(outUv) }
}

/**
 * Charts + flattening (LSCM or ABF++) + xatlas packing into [0, 1]^2. Charts are cut at dihedral angles
 * above `hardAngle` degrees. The result is re-welded and re-split, so its vertices follow the new seams;
 * normals are dropped (recompute them).
 */
export async function unwrapUV(mesh: LindenMesh, method: UvMethod, hardAngle = 45): Promise<GeomResult<LindenMesh>> {
  const r = await run(mesh, 'unwrapUV', (g) => g.unwrapUV(mesh.positions, mesh.indices, method === 'abf' ? 1 : 0, hardAngle))
  if (!r.ok) return r
  if (!r.value.cornerUvs) return err('INTERNAL', 'Geogram returned no uvs')
  return ok(splitCornerUvs(r.value.positions, r.value.indices, r.value.cornerUvs))
}

/** Isotropic remesh (CVT, Lloyd iterations) to about `targetVertexCount` vertices; attributes are dropped */
export async function remesh(mesh: LindenMesh, targetVertexCount: number, lloydIterations = 5): Promise<GeomResult<LindenMesh>> {
  if (!Number.isInteger(targetVertexCount) || targetVertexCount < 4) {
    return err('INVALID_MESH', `targetVertexCount must be an integer >= 4, got ${targetVertexCount}`)
  }
  const r = await run(mesh, 'remesh', (g) => g.remesh(mesh.positions, mesh.indices, targetVertexCount, lloydIterations))
  return r.ok ? ok({ positions: r.value.positions, indices: r.value.indices }) : r
}

/**
 * Laplacian smoothing. Seam vertices (same position, different uv/normal) are welded for the solver and
 * all copies receive the smoothed position, so the surface does not crack and attributes are kept.
 */
export async function smooth(mesh: LindenMesh, iterations: number): Promise<GeomResult<LindenMesh>> {
  if (!Number.isInteger(iterations) || iterations < 0) return err('INVALID_MESH', `iterations must be an integer >= 0, got ${iterations}`)
  const nv = mesh.positions.length / 3
  const weld = new Uint32Array(nv)
  const seen = new Map<string, number>()
  const welded: number[] = []
  for (let v = 0; v < nv; v++) {
    const key = `${mesh.positions[v * 3]},${mesh.positions[v * 3 + 1]},${mesh.positions[v * 3 + 2]}`
    let w = seen.get(key)
    if (w === undefined) {
      w = welded.length / 3
      seen.set(key, w)
      welded.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
    }
    weld[v] = w
  }
  const indices = mesh.indices.map((i) => weld[i])
  const weldedMesh: LindenMesh = { positions: new Float32Array(welded), indices }
  if (iterations === 0) return ok({ ...mesh, positions: mesh.positions.slice() })
  const r = await run(weldedMesh, 'smooth', (g) => g.smooth(weldedMesh.positions, weldedMesh.indices, iterations))
  if (!r.ok) return r
  if (r.value.positions.length !== welded.length) return err('INTERNAL', 'Geogram smooth changed the vertex count')
  const positions = new Float32Array(nv * 3)
  for (let v = 0; v < nv; v++) positions.set(r.value.positions.subarray(weld[v] * 3, weld[v] * 3 + 3), v * 3)
  const out: LindenMesh = { positions, indices: mesh.indices.slice() }
  if (mesh.uvs) out.uvs = mesh.uvs.slice()
  // Normals no longer match the moved surface: callers recompute them
  return ok(out)
}

/**
 * Makes a mesh usable as a closed surface: merges vertices within `colocateEpsilon`, removes duplicate and
 * degenerate triangles, splits non-manifold vertices and fills holes. Attributes are dropped.
 */
export async function repair(mesh: LindenMesh, colocateEpsilon = 0, maxHoleEdges = 0): Promise<GeomResult<LindenMesh>> {
  const r = await run(mesh, 'repair', (g) => g.repair(mesh.positions, mesh.indices, colocateEpsilon, maxHoleEdges))
  if (!r.ok) return r
  if (r.value.indices.length === 0) return err('REPAIR_FAILED', 'nothing left after repair')
  return ok({ positions: r.value.positions, indices: r.value.indices })
}
