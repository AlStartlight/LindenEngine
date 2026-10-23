/**
 * Godot-like Signal System for Linden Engine
 * Provides typed, decoupled event dispatching and connection tracking.
 */

export type SignalCallback<T = any> = (...args: T[]) => void

export interface SignalConnection<T = any> {
  id: string
  callback: SignalCallback<T>
  target?: any
  method?: string
  flags?: number
}

export class Signal<T = any> {
  private connections: SignalConnection<T>[] = []
  private nextId: number = 1

  constructor(public readonly name: string, public readonly owner?: any) {}

  connect(callbackOrTarget: SignalCallback<T> | any, method?: string, flags?: number): SignalConnection<T> {
    let callback: SignalCallback<T>
    let target: any = undefined
    let methodName: string | undefined = undefined

    if (typeof callbackOrTarget === 'function') {
      callback = callbackOrTarget
    } else if (callbackOrTarget && typeof method === 'string' && typeof callbackOrTarget[method] === 'function') {
      target = callbackOrTarget
      methodName = method
      callback = (...args: any[]) => target[method](...args)
    } else {
      throw new Error(`[Signal] Invalid connection target or method for signal "${this.name}"`)
    }

    const conn: SignalConnection<T> = {
      id: `sig_conn_${this.nextId++}`,
      callback,
      target,
      method: methodName,
      flags,
    }
    this.connections.push(conn)
    return conn
  }

  disconnect(callbackOrTarget: SignalCallback<T> | any, method?: string): boolean {
    const idx = this.connections.findIndex((c) => {
      if (typeof callbackOrTarget === 'function') {
        return c.callback === callbackOrTarget
      }
      if (c.target === callbackOrTarget && (!method || c.method === method)) {
        return true
      }
      return false
    })

    if (idx !== -1) {
      this.connections.splice(idx, 1)
      return true
    }
    return false
  }

  isConnected(callbackOrTarget: SignalCallback<T> | any, method?: string): boolean {
    return this.connections.some((c) => {
      if (typeof callbackOrTarget === 'function') {
        return c.callback === callbackOrTarget
      }
      if (c.target === callbackOrTarget && (!method || c.method === method)) {
        return true
      }
      return false
    })
  }

  emit(...args: any[]): void {
    // Clone array to safely permit connections/disconnections during emission
    const snapshot = [...this.connections]
    for (const conn of snapshot) {
      try {
        conn.callback(...args)
      } catch (err) {
        console.error(`[Signal ${this.name}] Error during emit:`, err)
      }
    }
  }

  getConnections(): readonly SignalConnection<T>[] {
    return this.connections
  }

  clear(): void {
    this.connections = []
  }
}
