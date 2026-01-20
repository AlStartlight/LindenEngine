import { Component } from '../ecs/Component'
import { Entity } from '../ecs/Entity'

/**
 * Script Interface - Setiap script harus implement ini
 * Mirip dengan behaviour script di Unity atau Character di Unreal
 */
export interface IGameScript {
  /**
   * Called saat script di-instantiate
   */
  onInit?(context: ScriptContext): void | Promise<void>

  /**
   * Called setiap frame
   */
  onUpdate?(deltaTime: number): void

  /**
   * Called setiap frame untuk physics updates
   */
  onFixedUpdate?(deltaTime: number): void

  /**
   * Called ketika entity/script dihapus
   */
  onDestroy?(): void

  /**
   * Called ketika script di-reload (hot reload)
   */
  onReload?(context: ScriptContext): void | Promise<void>

  /**
   * Handle events
   */
  onEvent?(eventName: string, data: any): void

  /**
   * Expose methods untuk editor
   */
  [key: string]: any
}

/**
 * Script context - Access ke engine dan game world
 */
export interface ScriptContext {
  entity: Entity
  deltaTime: number
  input: InputManager
  world: any
  time: TimeManager
}

/**
 * Input manager
 */
export interface InputManager {
  isKeyDown(key: string): boolean
  isKeyPressed(key: string): boolean
  isKeyReleased(key: string): boolean
  getMousePosition(): { x: number; y: number }
  isMouseDown(button: number): boolean
}

/**
 * Time manager
 */
export interface TimeManager {
  deltaTime: number
  time: number
  frameCount: number
  timeScale: number
}

/**
 * Script component - Wrapper untuk user scripts
 */
export class ScriptComponent extends Component {
  private script: IGameScript | null = null
  private scriptPath: string
  private lastModified: number = 0

  constructor(scriptPath: string) {
    super('ScriptComponent')
    this.scriptPath = scriptPath
  }

  async loadScript(context: ScriptContext): Promise<void> {
    try {
      // Dalam browser, kita perlu dynamic import
      // Dalam production, scripts akan di-bundle
      const module = await import(this.scriptPath)
      this.script = new module.default()

      if (this.script?.onInit) {
        await this.script.onInit(context)
      }
    } catch (error) {
      console.error(`Failed to load script: ${this.scriptPath}`, error)
    }
  }

  onUpdate(deltaTime: number): void {
    if (this.script?.onUpdate && this.isEnabled) {
      this.script.onUpdate(deltaTime)
    }
  }

  onDestroy(): void {
    if (this.script?.onDestroy) {
      this.script.onDestroy()
    }
  }

  /**
   * Hot reload script
   */
  async reloadScript(context: ScriptContext): Promise<void> {
    // Destroy old script
    if (this.script?.onDestroy) {
      this.script.onDestroy()
    }

    // Reload script dengan cache busting
    const timestamp = Date.now()
    const path = `${this.scriptPath}?t=${timestamp}`

    try {
      const module = await import(path)
      this.script = new module.default()

      if (this.script?.onReload) {
        await this.script.onReload(context)
      } else if (this.script?.onInit) {
        await this.script.onInit(context)
      }

      console.log(`Script reloaded: ${this.scriptPath}`)
    } catch (error) {
      console.error(`Failed to reload script: ${this.scriptPath}`, error)
    }
  }

  /**
   * Call method dari script
   */
  callMethod(methodName: string, ...args: any[]): any {
    if (this.script && typeof this.script[methodName] === 'function') {
      return this.script[methodName](...args)
    }
  }

  /**
   * Get script property
   */
  getProperty(propertyName: string): any {
    return this.script?.[propertyName]
  }

  /**
   * Set script property
   */
  setProperty(propertyName: string, value: any): void {
    if (this.script) {
      this.script[propertyName] = value
    }
  }

  /**
   * Get eksposed methods
   */
  getExposedMethods(): string[] {
    if (!this.script) return []
    const script = this.script
    return Object.getOwnPropertyNames(Object.getPrototypeOf(script)).filter(
      (name) => typeof script[name] === 'function' && name !== 'constructor',
    )
  }

  clone(): ScriptComponent {
    return new ScriptComponent(this.scriptPath)
  }
}

/**
 * Script manager - Manage semua scripts dalam world
 */
export class ScriptManager {
  private scripts: Map<string, ScriptComponent> = new Map()
  private context: ScriptContext | null = null
  private hotReloadEnabled: boolean = true

  setContext(context: ScriptContext): void {
    this.context = context
  }

  registerScript(entityId: string, script: ScriptComponent): void {
    this.scripts.set(entityId, script)
  }

  unregisterScript(entityId: string): void {
    this.scripts.delete(entityId)
  }

  /**
   * Enable/disable hot reload
   */
  setHotReloadEnabled(enabled: boolean): void {
    this.hotReloadEnabled = enabled
  }

  /**
   * Watch untuk file changes dan reload scripts
   */
  watchScripts(): void {
    if (!this.hotReloadEnabled) return

    // Dalam real implementation, ini akan menggunakan file watcher
    // atau WebSocket untuk mendeteksi changes
    console.log('[ScriptManager] Watching scripts for changes...')
  }

  /**
   * Reload semua scripts
   */
  async reloadAllScripts(): Promise<void> {
    if (!this.context) return

    for (const script of this.scripts.values()) {
      await script.reloadScript(this.context)
    }
  }

  /**
   * Reload specific script
   */
  async reloadScript(entityId: string): Promise<void> {
    if (!this.context) return

    const script = this.scripts.get(entityId)
    if (script) {
      await script.reloadScript(this.context)
    }
  }
}

/**
 * Example game script
 */
export class ExampleGameScript implements IGameScript {
  private position = { x: 0, y: 0, z: 0 }
  private velocity = { x: 0, y: 0, z: 0 }
  private speed: number = 5

  async onInit(context: ScriptContext): Promise<void> {
    console.log(`[ExampleGameScript] Initialized on entity: ${context.entity.name}`)
    this.position = context.entity.getTransform().position
  }

  onUpdate(deltaTime: number): void {
    // Example movement logic
    this.position.x += this.velocity.x * this.speed * deltaTime
    this.position.y += this.velocity.y * this.speed * deltaTime
    this.position.z += this.velocity.z * this.speed * deltaTime
  }

  onDestroy(): void {
    console.log('[ExampleGameScript] Destroyed')
  }

  onReload(context: ScriptContext): void {
    console.log('[ExampleGameScript] Reloaded')
  }

  // Custom methods yang bisa di-call dari editor
  move(direction: { x: number; y: number; z: number }): void {
    this.velocity = direction
  }

  setSpeed(speed: number): void {
    this.speed = speed
  }

  getPosition() {
    return { ...this.position }
  }
}
