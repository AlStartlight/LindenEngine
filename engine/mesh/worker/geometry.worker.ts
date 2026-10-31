import dracoEncoderUrl from 'draco3d/draco_encoder.wasm?url'
import dracoDecoderUrl from 'draco3d/draco_decoder.wasm?url'
import { createGeometryHandler } from './handler'
import { createWasmBackend } from './wasmBackend'

/** Minimal dedicated-worker scope (the project's tsconfig uses the DOM lib, not WebWorker) */
interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope
const handle = createGeometryHandler(
  createWasmBackend({
    dracoWasm: async (kind) => {
      const res = await fetch(kind === 'encoder' ? dracoEncoderUrl : dracoDecoderUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status} while fetching the Draco ${kind}`)
      return res.arrayBuffer()
    },
  }),
)

scope.onmessage = (e) => {
  void handle(e.data).then(({ response, transfer }) => scope.postMessage(response, transfer))
}
