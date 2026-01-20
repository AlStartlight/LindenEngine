import { World, System } from '../ecs/World'
import { Entity } from '../ecs/Entity'
import { Renderer } from '../renderer/Renderer'
import { PerformanceMonitor, Logger, LogLevel } from '../utils/index'
import { ScriptManager } from '../scripting/ScriptSystem'

/**
 * Engine Configuration
 */
export interface EngineConfig {
  canvas: HTMLCanvasElement
  width?: number
  height?: number
  pixelRatio?: number
  useWebGPU?: boolean
  enableVSync?: boolean
  targetFPS?: number
}

/**
 * Engine States
 */
export enum EngineState {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ERROR = 'error',
}

/**
 * Linden Engine - Core game engine
 */
export class LindenEngine {
  private static instance: LindenEngine | null = null
  private state: EngineState = EngineState.IDLE

  private canvas: HTMLCanvasElement
  private renderer: Renderer | null = null
  private world: World | null = null
  private scriptManager: ScriptManager | null = null

  private performanceMonitor: PerformanceMonitor
  private isRunning: boolean = false
  private animationFrameId: number = 0

  // Configuration
  private width: number
  private height: number
  private pixelRatio: number
  private useWebGPU: boolean
  private targetFPS: number = 60
  private enableVSync: boolean = true

  // Event listeners
  private eventListeners: Map<string, Function[]> = new Map()

  constructor(config: EngineConfig) {
    if (LindenEngine.instance) {
      return LindenEngine.instance
    }

    this.canvas = config.canvas
    this.width = config.width || this.canvas.clientWidth
    this.height = config.height || this.canvas.clientHeight
    this.pixelRatio = config.pixelRatio || window.devicePixelRatio
    this.useWebGPU = config.useWebGPU !== false
    this.enableVSync = config.enableVSync !== false

    this.performanceMonitor = new PerformanceMonitor()

    // Setup logging
    Logger.setLevel(LogLevel.DEBUG)

    LindenEngine.instance = this
  }

  /**
   * Get singleton instance
   */
  static getInstance(): LindenEngine | null {
    return this.instance
  }

  /**
   * Initialize engine
   */
  async initialize(): Promise<boolean> {
    try {
      this.setState(EngineState.INITIALIZING)

      Logger.info('[LindenEngine] Initializing...')

      // Initialize renderer
      this.renderer = new Renderer(this.canvas, {
        width: this.width,
        height: this.height,
        pixelRatio: this.pixelRatio,
        useWebGPU: this.useWebGPU,
      })

      const rendererReady = await this.renderer.initialize()
      if (!rendererReady) {
        throw new Error('Renderer initialization failed')
      }

      // Initialize world
      this.world = new World()
      this.world.initialize()

      // Initialize script manager
      this.scriptManager = new ScriptManager()

      // Add default systems
      this.addDefaultSystems()

      this.performanceMonitor.start()

      Logger.info('[LindenEngine] Initialized successfully')
      this.setState(EngineState.IDLE)
      return true
    } catch (error) {
      Logger.error('[LindenEngine] Initialization failed:', error)
      this.setState(EngineState.ERROR)
      return false
    }
  }

  /**
   * Add default systems
   */
  private addDefaultSystems(): void {
    if (!this.world) return

    // Dalam implementation lengkap, tambahkan systems berikut:
    // - PhysicsSystem
    // - RenderSystem
    // - AnimationSystem
    // - AudioSystem
  }

  /**
   * Start engine
   */
  start(): void {
    if (this.isRunning) {
      Logger.warn('[LindenEngine] Engine already running')
      return
    }

    if (!this.world) {
      Logger.error('[LindenEngine] World not initialized')
      return
    }

    Logger.info('[LindenEngine] Starting engine')
    this.setState(EngineState.RUNNING)
    this.isRunning = true
    this.world.start()

    this.gameLoop()
  }

  /**
   * Pause engine
   */
  pause(): void {
    if (!this.isRunning) return

    Logger.info('[LindenEngine] Engine paused')
    this.setState(EngineState.PAUSED)
    this.isRunning = false
  }

  /**
   * Resume engine
   */
  resume(): void {
    if (this.isRunning) return

    Logger.info('[LindenEngine] Engine resumed')
    this.setState(EngineState.RUNNING)
    this.isRunning = true
    this.gameLoop()
  }

  /**
   * Stop engine
   */
  stop(): void {
    if (!this.isRunning) return

    Logger.info('[LindenEngine] Engine stopped')
    this.setState(EngineState.STOPPED)
    this.isRunning = false

    if (this.world) {
      this.world.stop()
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
    }
  }

  /**
   * Main game loop
   */
  private gameLoop = (): void => {
    if (!this.isRunning) return

    this.update()
    this.render()
    this.performanceMonitor.markFrame()

    const deltaTime = 1 / this.targetFPS
    if (this.enableVSync) {
      this.animationFrameId = requestAnimationFrame(this.gameLoop)
    } else {
      setTimeout(this.gameLoop, deltaTime * 1000)
    }
  }

  /**
   * Update engine
   */
  private update(): void {
    if (!this.world) return
    this.world.update()
  }

  /**
   * Render engine
   */
  private render(): void {
    if (!this.renderer) return
    this.renderer.render()
  }

  /**
   * Handle window resize
   */
  onWindowResize(width: number, height: number): void {
    this.width = width
    this.height = height

    if (this.renderer) {
      this.renderer.resize(width, height)
    }

    this.emit('resize', { width, height })
  }

  /**
   * Set engine state
   */
  private setState(state: EngineState): void {
    this.state = state
    this.emit('stateChanged', { state })
  }

  /**
   * Get engine state
   */
  getState(): EngineState {
    return this.state
  }

  /**
   * Get world
   */
  getWorld(): World | null {
    return this.world
  }

  /**
   * Get renderer
   */
  getRenderer(): Renderer | null {
    return this.renderer
  }

  /**
   * Get performance monitor
   */
  getPerformanceMonitor(): PerformanceMonitor {
    return this.performanceMonitor
  }

  /**
   * Event system
   */
  on(eventName: string, callback: Function): void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, [])
    }
    this.eventListeners.get(eventName)?.push(callback)
  }

  off(eventName: string, callback: Function): void {
    const listeners = this.eventListeners.get(eventName)
    if (listeners) {
      const index = listeners.indexOf(callback)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }

  emit(eventName: string, data?: any): void {
    const listeners = this.eventListeners.get(eventName)
    if (listeners) {
      listeners.forEach((callback) => callback(data))
    }
  }

  /**
   * Cleanup engine
   */
  dispose(): void {
    Logger.info('[LindenEngine] Disposing engine')

    this.stop()
    this.world?.clear()
    this.renderer?.dispose()
    this.eventListeners.clear()

    LindenEngine.instance = null
  }
}
