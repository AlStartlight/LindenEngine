/**
 * Explicit lifetime management for objects allocated inside WASM heaps (embind/Manifold/Draco).
 * Every allocation goes through a scope; `withWasmScope` frees them all in `finally`, even on error.
 * Live counts per library let tests assert that nothing leaks.
 */

export interface Deletable {
  delete(): void
}

const live = new Map<string, number>()

export function liveWasmObjects(library?: string): number {
  if (library) return live.get(library) ?? 0
  let n = 0
  for (const v of live.values()) n += v
  return n
}

export class WasmScope {
  private items: Deletable[] = []

  constructor(readonly library: string) {}

  /** Registers an object for deletion when the scope ends and returns it */
  track<T extends Deletable>(obj: T): T {
    this.items.push(obj)
    live.set(this.library, (live.get(this.library) ?? 0) + 1)
    return obj
  }

  /** Deletes now (e.g. large intermediates inside a long scope) */
  release(obj: Deletable): void {
    const i = this.items.indexOf(obj)
    if (i < 0) return
    this.items.splice(i, 1)
    this.free(obj)
  }

  dispose(): void {
    for (let i = this.items.length - 1; i >= 0; i--) this.free(this.items[i])
    this.items = []
  }

  private free(obj: Deletable): void {
    try {
      obj.delete()
    } finally {
      live.set(this.library, (live.get(this.library) ?? 1) - 1)
    }
  }
}

export async function withWasmScope<T>(library: string, fn: (scope: WasmScope) => Promise<T> | T): Promise<T> {
  const scope = new WasmScope(library)
  try {
    return await fn(scope)
  } finally {
    scope.dispose()
  }
}
