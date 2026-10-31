import { ok, type GeomResult } from '../core/result'

/**
 * An undoable mesh edit. `execute` may be async (WASM work in the geometry worker); when it fails it must
 * leave the mesh unchanged, and nothing is recorded. undo/redo are synchronous state swaps.
 */
export interface MeshCommand {
  readonly label: string
  execute(): Promise<GeomResult<void>> | GeomResult<void>
  undo(): void
  redo(): void
}

/**
 * Undo/redo history for edit mode. Every request (execute, undo, redo) is queued, so an undo issued while
 * an async command is still running waits for it instead of interleaving with it.
 */
export class MeshCommandStack {
  private done: MeshCommand[] = []
  private undone: MeshCommand[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private pending = 0

  constructor(private readonly maxDepth = 100, private readonly onChange?: () => void) {}

  get canUndo(): boolean {
    return this.done.length > 0
  }

  get canRedo(): boolean {
    return this.undone.length > 0
  }

  /** True while a queued request has not finished */
  get busy(): boolean {
    return this.pending > 0
  }

  get labels(): { undo: string[]; redo: string[] } {
    return { undo: this.done.map((c) => c.label), redo: this.undone.map((c) => c.label).reverse() }
  }

  execute(command: MeshCommand): Promise<GeomResult<void>> {
    return this.enqueue(async () => {
      const r = await command.execute()
      if (!r.ok) return r
      this.done.push(command)
      if (this.done.length > this.maxDepth) this.done.shift()
      this.undone = []
      this.onChange?.()
      return ok(undefined)
    })
  }

  /** Records a command whose change is already applied (e.g. an interactive drag), without executing it */
  push(command: MeshCommand): Promise<GeomResult<void>> {
    return this.execute({ label: command.label, execute: () => ok(undefined), undo: () => command.undo(), redo: () => command.redo() })
  }

  undo(): Promise<boolean> {
    return this.enqueue(async () => {
      const c = this.done.pop()
      if (!c) return false
      c.undo()
      this.undone.push(c)
      this.onChange?.()
      return true
    })
  }

  redo(): Promise<boolean> {
    return this.enqueue(async () => {
      const c = this.undone.pop()
      if (!c) return false
      c.redo()
      this.done.push(c)
      this.onChange?.()
      return true
    })
  }

  clear(): void {
    this.done = []
    this.undone = []
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    this.pending++
    const run = this.queue.then(fn).finally(() => {
      this.pending--
    })
    this.queue = run.catch(() => undefined)
    return run
  }
}
