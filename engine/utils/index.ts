/**
 * Utility untuk generate unique ID
 */
export function nanoid(size: number = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < size; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Generate UUID v4
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Utility untuk vector math
 */
export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Quaternion {
  x: number
  y: number
  z: number
  w: number
}

export interface Matrix4 {
  elements: number[]
}

export const Vector3Utils = {
  zero: (): Vector3 => ({ x: 0, y: 0, z: 0 }),
  one: (): Vector3 => ({ x: 1, y: 1, z: 1 }),
  forward: (): Vector3 => ({ x: 0, y: 0, z: 1 }),
  right: (): Vector3 => ({ x: 1, y: 0, z: 0 }),
  up: (): Vector3 => ({ x: 0, y: 1, z: 0 }),

  add: (a: Vector3, b: Vector3): Vector3 => ({
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  }),

  subtract: (a: Vector3, b: Vector3): Vector3 => ({
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  }),

  multiply: (v: Vector3, scalar: number): Vector3 => ({
    x: v.x * scalar,
    y: v.y * scalar,
    z: v.z * scalar,
  }),

  magnitude: (v: Vector3): number => {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  },

  normalize: (v: Vector3): Vector3 => {
    const mag = Vector3Utils.magnitude(v)
    if (mag === 0) return Vector3Utils.zero()
    return {
      x: v.x / mag,
      y: v.y / mag,
      z: v.z / mag,
    }
  },

  distance: (a: Vector3, b: Vector3): number => {
    return Vector3Utils.magnitude(Vector3Utils.subtract(b, a))
  },

  dot: (a: Vector3, b: Vector3): number => {
    return a.x * b.x + a.y * b.y + a.z * b.z
  },

  cross: (a: Vector3, b: Vector3): Vector3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
}

/**
 * Performance monitoring utility
 */
export class PerformanceMonitor {
  private startTime: number = 0
  private frames: number = 0
  private fps: number = 0
  private lastTime: number = 0
  private frameTimings: Map<string, number[]> = new Map()

  start(): void {
    this.startTime = performance.now()
    this.lastTime = this.startTime
  }

  markFrame(): void {
    const now = performance.now()
    this.frames++

    if (now - this.lastTime >= 1000) {
      this.fps = this.frames
      this.frames = 0
      this.lastTime = now
    }
  }

  getFPS(): number {
    return this.fps
  }

  getElapsedTime(): number {
    return performance.now() - this.startTime
  }

  startMeasure(label: string): void {
    ;(performance as any).__markStart = { [label]: performance.now() }
  }

  endMeasure(label: string): number {
    const elapsed = performance.now() - (performance as any).__markStart?.[label]
    if (!this.frameTimings.has(label)) {
      this.frameTimings.set(label, [])
    }
    this.frameTimings.get(label)?.push(elapsed)
    return elapsed
  }

  getAverageTime(label: string): number {
    const timings = this.frameTimings.get(label) || []
    if (timings.length === 0) return 0
    return timings.reduce((a, b) => a + b, 0) / timings.length
  }

  printStats(): void {
    console.log(`=== Performance Stats ===`)
    console.log(`FPS: ${this.fps}`)
    console.log(`Elapsed: ${(this.getElapsedTime() / 1000).toFixed(2)}s`)

    for (const [label, timings] of this.frameTimings.entries()) {
      const avg = timings.reduce((a, b) => a + b, 0) / timings.length
      const min = Math.min(...timings)
      const max = Math.max(...timings)
      console.log(`${label}: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms`)
    }
  }

  reset(): void {
    this.frameTimings.clear()
    this.frames = 0
    this.fps = 0
  }
}

/**
 * Logger utility
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static level: LogLevel = LogLevel.INFO
  private static history: Array<{ level: LogLevel; message: string; timestamp: number }> = []

  static setLevel(level: LogLevel): void {
    this.level = level
  }

  static debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`[DEBUG] ${message}`, ...args)
      this.addToHistory(LogLevel.DEBUG, message)
    }
  }

  static info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`[INFO] ${message}`, ...args)
      this.addToHistory(LogLevel.INFO, message)
    }
  }

  static warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args)
      this.addToHistory(LogLevel.WARN, message)
    }
  }

  static error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, ...args)
      this.addToHistory(LogLevel.ERROR, message)
    }
  }

  private static addToHistory(level: LogLevel, message: string): void {
    this.history.push({
      level,
      message,
      timestamp: Date.now(),
    })

    if (this.history.length > 1000) {
      this.history.shift()
    }
  }

  static getHistory(limit: number = 100): Array<{ level: LogLevel; message: string; timestamp: number }> {
    return this.history.slice(-limit)
  }

  static clear(): void {
    this.history = []
  }
}
