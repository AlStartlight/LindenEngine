import { WorkerGeometryOps, type WorkerGeometryOpsOptions, type WorkerLike } from './WorkerGeometryOps'

/** Browser/Electron entry point: GeometryOps backed by a module worker that Vite bundles separately */
export function createGeometryOps(options?: WorkerGeometryOpsOptions): WorkerGeometryOps {
  return new WorkerGeometryOps(
    () => new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' }) as WorkerLike,
    options,
  )
}
