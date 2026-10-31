/** Typed results for every geometry operation: failures are values, never thrown strings */

export type GeomErrorCode =
  | 'EMPTY_MESH'
  | 'INVALID_MESH'
  | 'INVALID_TOPOLOGY'
  | 'NON_MANIFOLD_INPUT'
  | 'REPAIR_FAILED'
  | 'WASM_LOAD_FAILED'
  | 'NOT_IMPLEMENTED'
  | 'WORKER_ERROR'
  | 'INTERNAL'

export interface GeomError {
  ok: false
  code: GeomErrorCode
  message: string
}

export interface GeomOk<T> {
  ok: true
  value: T
}

export type GeomResult<T> = GeomOk<T> | GeomError

export function ok<T>(value: T): GeomOk<T> {
  return { ok: true, value }
}

export function err(code: GeomErrorCode, message: string): GeomError {
  return { ok: false, code, message }
}

/** Converts an unexpected exception (e.g. from a WASM library) into a typed error */
export function fromException(e: unknown, code: GeomErrorCode = 'INTERNAL'): GeomError {
  const message = e instanceof Error ? e.message : String(e)
  return err(code, message)
}
