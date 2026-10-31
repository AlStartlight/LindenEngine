import { err, fromException, ok, type GeomResult } from '../core/result'
import { collectTransferables, type OpName, type WorkerBackend, type WorkerRequest, type WorkerResponse } from './protocol'

export interface HandledMessage {
  response: WorkerResponse
  transfer: ArrayBuffer[]
}

/** Default backend: only the protocol ops; geometry ops are added by later phases */
export const baseBackend: WorkerBackend = {
  ping: () => ok('pong' as const),
  echo: (mesh) => ok(mesh),
}

const OPS: ReadonlySet<string> = new Set<OpName>([
  'ping', 'echo', 'boolean', 'subdivide', 'unwrapUV', 'remesh', 'smooth', 'repair', 'simplify', 'generateLODs',
  'optimizeVertexCache', 'importGltf', 'exportGlb',
])

/** Message dispatch independent of the Worker global, so it can be unit tested in Node */
export function createGeometryHandler(backend: WorkerBackend = baseBackend) {
  return async function handle(message: unknown): Promise<HandledMessage> {
    const req = message as Partial<WorkerRequest>
    const id = typeof req?.id === 'number' ? req.id : -1
    let result: GeomResult<unknown>
    if (id < 0 || typeof req.op !== 'string' || !OPS.has(req.op) || !Array.isArray(req.args)) {
      result = err('WORKER_ERROR', `malformed request: ${JSON.stringify(req?.op)}`)
    } else {
      // The request is a discriminated union, but indexing the backend by a union key loses the pairing
      const fn = backend[req.op] as ((...args: unknown[]) => Promise<GeomResult<unknown>> | GeomResult<unknown>) | undefined
      if (!fn) {
        result = err('NOT_IMPLEMENTED', `operation '${req.op}' is not available yet`)
      } else {
        try {
          result = await fn(...(req.args as unknown[]))
        } catch (e) {
          result = fromException(e)
        }
      }
    }
    const transfer = result.ok ? collectTransferables(result.value) : []
    return { response: { id, result }, transfer }
  }
}
