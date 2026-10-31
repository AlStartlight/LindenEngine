import type { Manifold, ManifoldToplevel, Mesh } from 'manifold-3d'
import type { BooleanOp } from '../core/GeometryOps'
import { isEmpty, validateLindenMesh, type LindenMesh } from '../core/LindenMesh'
import { err, fromException, ok, type GeomResult } from '../core/result'
import { withWasmScope, type WasmScope } from '../wasm/WasmScope'

const LIB = 'manifold'

let loading: Promise<ManifoldToplevel> | null = null

/** Loads and initialises the Manifold WASM module once, on first use */
export async function loadManifold(): Promise<GeomResult<ManifoldToplevel>> {
  try {
    loading ??= import('manifold-3d').then(async (m) => {
      const wasm = await m.default()
      wasm.setup()
      return wasm
    })
    return ok(await loading)
  } catch (e) {
    loading = null
    return err('WASM_LOAD_FAILED', `could not load Manifold: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export type RepairFn = (mesh: LindenMesh) => Promise<GeomResult<LindenMesh>>

export interface BooleanOptions {
  /** Tried once on an input that is not a closed manifold (Geogram repair from Phase 4) */
  repair?: RepairFn
}

/** Vertex layout shared by both inputs: uv and normal channels are carried only if both meshes have them */
interface Layout {
  uv: boolean
  normal: boolean
  numProp: number
}

function layoutFor(a: LindenMesh, b: LindenMesh): Layout {
  const uv = !!a.uvs && !!b.uvs
  const normal = !!a.normals && !!b.normals
  return { uv, normal, numProp: 3 + (uv ? 2 : 0) + (normal ? 3 : 0) }
}

function toManifoldMesh(wasm: ManifoldToplevel, mesh: LindenMesh, layout: Layout): Mesh {
  const nv = mesh.positions.length / 3
  const props = new Float32Array(nv * layout.numProp)
  for (let i = 0; i < nv; i++) {
    const o = i * layout.numProp
    props[o] = mesh.positions[i * 3]
    props[o + 1] = mesh.positions[i * 3 + 1]
    props[o + 2] = mesh.positions[i * 3 + 2]
    let k = 3
    if (layout.uv && mesh.uvs) {
      props[o + k++] = mesh.uvs[i * 2]
      props[o + k++] = mesh.uvs[i * 2 + 1]
    }
    if (layout.normal && mesh.normals) {
      props[o + k++] = mesh.normals[i * 3]
      props[o + k++] = mesh.normals[i * 3 + 1]
      props[o + k++] = mesh.normals[i * 3 + 2]
    }
  }
  const m = new wasm.Mesh({ numProp: layout.numProp, vertProperties: props, triVerts: mesh.indices.slice() })
  // Seams (vertices split by uv/normal) must be welded by position for Manifold to see a closed surface
  m.merge()
  return m
}

function fromManifoldMesh(m: Mesh, layout: Layout): LindenMesh {
  const np = m.numProp
  const nv = m.vertProperties.length / np
  const positions = new Float32Array(nv * 3)
  const uvs = layout.uv ? new Float32Array(nv * 2) : undefined
  const normals = layout.normal ? new Float32Array(nv * 3) : undefined
  for (let i = 0; i < nv; i++) {
    const o = i * np
    positions[i * 3] = m.vertProperties[o]
    positions[i * 3 + 1] = m.vertProperties[o + 1]
    positions[i * 3 + 2] = m.vertProperties[o + 2]
    let k = 3
    if (uvs) {
      uvs[i * 2] = m.vertProperties[o + k++]
      uvs[i * 2 + 1] = m.vertProperties[o + k++]
    }
    if (normals) {
      // Interpolated normals are not unit length
      const x = m.vertProperties[o + k++]
      const y = m.vertProperties[o + k++]
      const z = m.vertProperties[o + k++]
      const len = Math.hypot(x, y, z) || 1
      normals[i * 3] = x / len
      normals[i * 3 + 1] = y / len
      normals[i * 3 + 2] = z / len
    }
  }
  const out: LindenMesh = { positions, indices: new Uint32Array(m.triVerts) }
  if (uvs) out.uvs = uvs
  if (normals) out.normals = normals
  return out
}

/** Builds a Manifold, or explains why the input is not a closed 2-manifold */
function buildManifold(wasm: ManifoldToplevel, scope: WasmScope, mesh: LindenMesh, layout: Layout): GeomResult<Manifold> {
  let manifold: Manifold
  try {
    manifold = scope.track(new wasm.Manifold(toManifoldMesh(wasm, mesh, layout)))
  } catch (e) {
    // The constructor throws (e.g. "Not manifold") instead of returning a status
    return err('NON_MANIFOLD_INPUT', e instanceof Error ? e.message : String(e))
  }
  const status = manifold.status()
  if (status !== 'NoError') return err('NON_MANIFOLD_INPUT', `Manifold rejected the mesh: ${status}`)
  return ok(manifold)
}

async function prepareInput(
  wasm: ManifoldToplevel, scope: WasmScope, mesh: LindenMesh, layout: Layout, name: string, repair?: RepairFn,
): Promise<GeomResult<Manifold>> {
  const valid = validateLindenMesh(mesh)
  if (!valid.ok) return err(valid.code, `${name}: ${valid.message}`)
  if (isEmpty(mesh)) return err('EMPTY_MESH', `${name} is empty`)
  const first = buildManifold(wasm, scope, mesh, layout)
  if (first.ok) return first
  if (!repair) {
    return err('NON_MANIFOLD_INPUT', `${name} is not a closed manifold mesh (${first.message}); repair is not available`)
  }
  const repaired = await repair(mesh)
  if (!repaired.ok) {
    return err('NON_MANIFOLD_INPUT', `${name} is not a closed manifold mesh and repair failed: ${repaired.message}`)
  }
  const second = buildManifold(wasm, scope, repaired.value, layout)
  if (second.ok) return second
  return err('NON_MANIFOLD_INPUT', `${name} is still not manifold after repair (${second.message})`)
}

/** Boolean of two closed meshes. Result is a triangle mesh (no polygons); attributes carried when both inputs have them. */
export async function booleanMeshes(
  a: LindenMesh, b: LindenMesh, op: BooleanOp, options: BooleanOptions = {},
): Promise<GeomResult<LindenMesh>> {
  const loaded = await loadManifold()
  if (!loaded.ok) return loaded
  const wasm = loaded.value
  const layout = layoutFor(a, b)
  try {
    return await withWasmScope(LIB, async (scope) => {
      const ma = await prepareInput(wasm, scope, a, layout, 'mesh A', options.repair)
      if (!ma.ok) return ma
      const mb = await prepareInput(wasm, scope, b, layout, 'mesh B', options.repair)
      if (!mb.ok) return mb
      const result = scope.track(
        op === 'union' ? ma.value.add(mb.value) : op === 'subtract' ? ma.value.subtract(mb.value) : ma.value.intersect(mb.value),
      )
      const status = result.status()
      if (status !== 'NoError') return err('INTERNAL', `boolean ${op} failed: ${status}`)
      return ok(fromManifoldMesh(result.getMesh(), layout))
    })
  } catch (e) {
    return fromException(e)
  }
}

/** Closed-manifold check through Manifold itself (used by tests and the editor to pre-validate) */
export async function isManifold(mesh: LindenMesh): Promise<GeomResult<boolean>> {
  const loaded = await loadManifold()
  if (!loaded.ok) return loaded
  if (isEmpty(mesh)) return ok(false)
  return withWasmScope(LIB, (scope) => {
    const r = buildManifold(loaded.value, scope, mesh, { uv: false, normal: false, numProp: 3 })
    return ok(r.ok)
  })
}

/** Volume and genus via Manifold, for tests and diagnostics */
export async function manifoldStats(mesh: LindenMesh): Promise<GeomResult<{ volume: number; genus: number }>> {
  const loaded = await loadManifold()
  if (!loaded.ok) return loaded
  return withWasmScope(LIB, (scope) => {
    const r = buildManifold(loaded.value, scope, mesh, { uv: false, normal: false, numProp: 3 })
    if (!r.ok) return r
    return ok({ volume: r.value.volume(), genus: r.value.genus() })
  })
}
