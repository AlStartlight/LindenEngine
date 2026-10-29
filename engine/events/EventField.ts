export interface EventListener {
  targetId: string
  component: string // component name e.g. 'Door'
  method: string // method name on that component
  args?: unknown[]
  mode?: 'runtime' | 'editorAndRuntime' | 'off'
}

export class EventField<TArgs extends unknown[] = any[]> {
  public listeners: EventListener[] = []
  private codeListeners: Set<(...args: TArgs) => void> = new Set()
  private worldGetter: (() => any) | null = null

  constructor(listeners?: EventListener[]) {
    if (listeners && Array.isArray(listeners)) {
      this.listeners = listeners.map((l) => ({ ...l }))
    }
  }

  setWorldGetter(getter: () => any): void {
    this.worldGetter = getter
  }

  on(fn: (...args: TArgs) => void): () => void {
    this.codeListeners.add(fn)
    return () => {
      this.codeListeners.delete(fn)
    }
  }

  off(fn: (...args: TArgs) => void): void {
    this.codeListeners.delete(fn)
  }

  emit(...args: TArgs): void {
    // 1. Invoke code listeners
    for (const fn of Array.from(this.codeListeners)) {
      try {
        fn(...args)
      } catch (err) {
        console.error('Error in EventField code listener:', err)
      }
    }

    // 2. Invoke serialized listeners
    if (this.listeners.length === 0) return

    const world = this.worldGetter ? this.worldGetter() : null

    for (const listener of this.listeners) {
      if (listener.mode === 'off') continue

      if (!world) {
        continue
      }

      const targetEntity = world.getEntity(listener.targetId)
      if (!targetEntity) {
        console.warn(`[EventField] Target entity "${listener.targetId}" not found for event. Listener skipped.`)
        continue
      }

      try {
        const comp = targetEntity.getComponent(listener.component)
        if (!comp) {
          console.warn(`[EventField] Target entity "${targetEntity.name}" has no component "${listener.component}"`)
          continue
        }

        const targetObj = comp as any
        const fn = targetObj[listener.method]
        if (typeof fn === 'function') {
          const callArgs = listener.args && listener.args.length > 0 ? listener.args : args
          fn.apply(targetObj, callArgs)
        } else {
          console.warn(`[EventField] Method "${listener.method}" not found on component "${listener.component}"`)
        }
      } catch (err) {
        console.error(`[EventField] Error invoking listener on ${targetEntity.name} (${listener.method}):`, err)
      }
    }
  }

  clone(): EventField<TArgs> {
    const copy = new EventField<TArgs>(this.listeners)
    copy.worldGetter = this.worldGetter
    return copy
  }
}
