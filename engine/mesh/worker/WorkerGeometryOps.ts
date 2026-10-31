import type { BooleanOp, GeometryOps, SubdivScheme, UvMethod } from '../core/GeometryOps'
import { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import type { LindenMesh } from '../core/LindenMesh'
import { err, type GeomResult } from '../core/result'
import type { GlbExportOptions } from '../io/gltf'
import { collectTransferables, type OpArgs, type OpName, type OpResult, type WorkerResponse } from './protocol'

/** The subset of Worker the client uses (lets tests plug in an in-process fake) */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
  addEventListener(type: 'error', listener: (e: { message?: string }) => void): void
  terminate(): void
}

export interface WorkerGeometryOpsOptions {
  /**
   * 'copy' (default): inputs are cloned and the clones transferred, so caller arrays stay usable.
   * 'transfer': caller buffers are transferred directly and become detached (zero-copy).
   */
  inputOwnership?: 'copy' | 'transfer'
}

interface Pending {
  resolve(result: GeomResult<unknown>): void
}

/** Deep copy in which every typed array owns a tight buffer, so it can be transferred safely */
function cloneArg(arg: unknown): unknown {
  if (ArrayBuffer.isView(arg)) return (arg as Uint8Array).slice()
  if (Array.isArray(arg)) return arg.map(cloneArg)
  if (typeof arg === 'object' && arg !== null) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(arg)) out[k] = cloneArg(v)
    return out
  }
  return arg
}

/**
 * GeometryOps backed by the geometry Web Worker. The worker is created on the first call
 * (so WASM never loads while the editor merely opens) and every request resolves to a typed result.
 */
export class WorkerGeometryOps implements GeometryOps {
  private worker: WorkerLike | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private readonly ownership: 'copy' | 'transfer'

  constructor(private readonly createWorker: () => WorkerLike, options: WorkerGeometryOpsOptions = {}) {
    this.ownership = options.inputOwnership ?? 'copy'
  }

  get started(): boolean {
    return this.worker !== null
  }

  call<K extends OpName>(op: K, ...args: OpArgs<K>): Promise<GeomResult<OpResult<K>>> {
    return this.send(op, args, this.ownership === 'copy')
  }

  private send<K extends OpName>(op: K, args: OpArgs<K>, cloneInputs: boolean): Promise<GeomResult<OpResult<K>>> {
    let worker: WorkerLike
    try {
      worker = this.ensureWorker()
    } catch (e) {
      return Promise.resolve(err('WORKER_ERROR', `could not start geometry worker: ${e instanceof Error ? e.message : String(e)}`))
    }
    const id = this.nextId++
    const sent = cloneInputs ? args.map(cloneArg) : args
    return new Promise((resolve) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'] })
      try {
        worker.postMessage({ id, op, args: sent }, collectTransferables(sent))
      } catch (e) {
        this.pending.delete(id)
        resolve(err('WORKER_ERROR', `could not send '${op}': ${e instanceof Error ? e.message : String(e)}`))
      }
    })
  }

  dispose(): void {
    this.failAll('geometry worker was disposed')
    this.worker?.terminate()
    this.worker = null
  }

  boolean(a: LindenMesh, b: LindenMesh, op: BooleanOp): Promise<GeomResult<LindenMesh>> {
    return this.call('boolean', a, b, op)
  }

  async subdivide(mesh: HalfEdgeMesh, levels: number, scheme: SubdivScheme): Promise<GeomResult<HalfEdgeMesh>> {
    // toData() already copies, so the snapshot can always be transferred
    const r = await this.send('subdivide', [mesh.toData(), levels, scheme], false)
    return r.ok ? { ok: true, value: HalfEdgeMesh.fromData(r.value) } : r
  }

  unwrapUV(mesh: LindenMesh, method: UvMethod): Promise<GeomResult<LindenMesh>> {
    return this.call('unwrapUV', mesh, method)
  }

  remesh(mesh: LindenMesh, targetVertexCount: number): Promise<GeomResult<LindenMesh>> {
    return this.call('remesh', mesh, targetVertexCount)
  }

  smooth(mesh: LindenMesh, iterations: number): Promise<GeomResult<LindenMesh>> {
    return this.call('smooth', mesh, iterations)
  }

  repair(mesh: LindenMesh): Promise<GeomResult<LindenMesh>> {
    return this.call('repair', mesh)
  }

  simplify(mesh: LindenMesh, ratio: number, maxError: number): Promise<GeomResult<LindenMesh>> {
    return this.call('simplify', mesh, ratio, maxError)
  }

  generateLODs(mesh: LindenMesh, ratios: number[]): Promise<GeomResult<LindenMesh[]>> {
    return this.call('generateLODs', mesh, ratios)
  }

  optimizeVertexCache(mesh: LindenMesh): Promise<GeomResult<LindenMesh>> {
    return this.call('optimizeVertexCache', mesh)
  }

  importGltf(bytes: Uint8Array): Promise<GeomResult<OpResult<'importGltf'>>> {
    return this.call('importGltf', bytes)
  }

  exportGlb(mesh: LindenMesh, options: GlbExportOptions = {}): Promise<GeomResult<Uint8Array>> {
    return this.call('exportGlb', mesh, options)
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker
    const w = this.createWorker()
    w.addEventListener('message', (e) => this.onMessage(e.data))
    w.addEventListener('error', (e) => {
      this.failAll(`geometry worker crashed: ${e.message ?? 'unknown error'}`)
      w.terminate()
      if (this.worker === w) this.worker = null
    })
    this.worker = w
    return w
  }

  private onMessage(data: unknown): void {
    const msg = data as WorkerResponse
    const p = this.pending.get(msg?.id)
    if (!p) return
    this.pending.delete(msg.id)
    p.resolve(msg.result)
  }

  private failAll(message: string): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const p of pending) p.resolve(err('WORKER_ERROR', message))
  }
}
