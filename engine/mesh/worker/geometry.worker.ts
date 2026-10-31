import { createGeometryHandler } from './handler'

/** Minimal dedicated-worker scope (the project's tsconfig uses the DOM lib, not WebWorker) */
interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope
const handle = createGeometryHandler()

scope.onmessage = (e) => {
  void handle(e.data).then(({ response, transfer }) => scope.postMessage(response, transfer))
}
