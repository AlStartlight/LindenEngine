import { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import { ok } from '../core/result'
import type { DracoWasmSource } from '../io/draco'
import { baseBackend } from './handler'
import type { WorkerBackend } from './protocol'

export interface WasmBackendOptions {
  /** Where the Draco .wasm bytes come from inside a bundled worker (Node finds them itself) */
  dracoWasm?: DracoWasmSource
}

/**
 * Worker backend for the WASM libraries. Every adapter is a dynamic import, so a library (and its .wasm)
 * is only fetched the first time one of its operations runs.
 */
export function createWasmBackend(options: WasmBackendOptions = {}): WorkerBackend {
  let dracoConfigured = false
  const draco = async () => {
    const mod = await import('../io/draco')
    if (!dracoConfigured && options.dracoWasm) mod.setDracoWasmSource(options.dracoWasm)
    dracoConfigured = true
    return import('../io/gltf')
  }
  return {
    ...baseBackend,
    // A non-manifold input gets one Geogram repair attempt before the boolean gives up
    boolean: async (a, b, op) => (await import('../boolean/manifoldAdapter')).booleanMeshes(a, b, op, {
      repair: async (mesh) => (await import('../uv/geogramAdapter')).repair(mesh),
    }),
    subdivide: async (data, levels, scheme) => {
      const r = await (await import('../subdiv/opensubdivAdapter')).subdivideMesh(HalfEdgeMesh.fromData(data), levels, scheme)
      return r.ok ? ok(r.value.toData()) : r
    },
    unwrapUV: async (mesh, method) => (await import('../uv/geogramAdapter')).unwrapUV(mesh, method),
    remesh: async (mesh, target) => (await import('../uv/geogramAdapter')).remesh(mesh, target),
    smooth: async (mesh, iterations) => (await import('../uv/geogramAdapter')).smooth(mesh, iterations),
    repair: async (mesh) => (await import('../uv/geogramAdapter')).repair(mesh),
    simplify: async (mesh, ratio, maxError) => {
      const r = await (await import('../optimize/meshoptAdapter')).simplifyMesh(mesh, ratio, maxError)
      return r.ok ? ok(r.value.mesh) : r
    },
    generateLODs: async (mesh, ratios) => (await import('../optimize/meshoptAdapter')).generateLODs(mesh, ratios),
    optimizeVertexCache: async (mesh) => (await import('../optimize/meshoptAdapter')).optimizeVertexCache(mesh),
    importGltf: async (bytes) => (await draco()).importGltf(bytes),
    exportGlb: async (mesh, opts) => (await draco()).exportGlb(mesh, opts),
  }
}
