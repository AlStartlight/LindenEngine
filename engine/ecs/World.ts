import { Component } from './Component'
import { Entity } from './Entity'

/**
 * System - Logika yang bekerja pada entities dengan specific components
 * Mirip dengan Subsystem di Unreal Engine
 */
export abstract class System {
  protected world: World | null = null
  protected isEnabled: boolean = true

  constructor(public readonly name: string) {}

  /**
   * Initialize system
   */
  abstract initialize(): void

  /**
   * Update system setiap frame
   */
  abstract update(deltaTime: number): void

  /**
   * Shutdown system
   */
  abstract shutdown(): void

  /**
   * Set reference ke world
   */
  setWorld(world: World): void {
    this.world = world
  }

  /**
   * Enable/disable system
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled
  }

  isSystemEnabled(): boolean {
    return this.isEnabled
  }

  /**
   * Get entities yang memiliki components tertentu
   */
  protected getEntitiesWithComponents(...componentNames: string[]): Entity[] {
    if (!this.world) return []
    return this.world.getEntitiesWithComponents(...componentNames)
  }

  /**
   * Get single entity dengan components tertentu
   */
  protected getEntityWithComponents(...componentNames: string[]): Entity | undefined {
    const entities = this.getEntitiesWithComponents(...componentNames)
    return entities.length > 0 ? entities[0] : undefined
  }
}

/**
 * Physics System Example
 */
export class PhysicsSystem extends System {
  private gravity = { x: 0, y: -9.81, z: 0 }
  private collisions: Map<string, Set<string>> = new Map()

  constructor() {
    super('PhysicsSystem')
  }

  initialize(): void {
    console.log('[PhysicsSystem] Initialized')
  }

  update(deltaTime: number): void {
    if (!this.isEnabled) return

    const entities = this.getEntitiesWithComponents('Transform', 'RigidBody')
    for (const entity of entities) {
      this.updateEntity(entity, deltaTime)
    }

    this.checkCollisions()
  }

  shutdown(): void {
    console.log('[PhysicsSystem] Shutdown')
    this.collisions.clear()
  }

  private updateEntity(entity: Entity, deltaTime: number): void {
    // Placeholder untuk physics calculations
    // Dalam implementasi real, ini akan handle gravity, velocity, dll
  }

  private checkCollisions(): void {
    // Placeholder untuk collision detection
  }
}

/**
 * Rendering System Example
 */
export class RenderSystem extends System {
  constructor() {
    super('RenderSystem')
  }

  initialize(): void {
    console.log('[RenderSystem] Initialized')
  }

  update(deltaTime: number): void {
    if (!this.isEnabled) return

    const entities = this.getEntitiesWithComponents('Transform', 'MeshRenderer')
    for (const entity of entities) {
      if (!entity.isActive) continue
      // Render entity
    }
  }

  shutdown(): void {
    console.log('[RenderSystem] Shutdown')
  }
}

/**
 * Script System - Manage entity scripts
 */
export class ScriptSystem extends System {
  constructor() {
    super('ScriptSystem')
  }

  initialize(): void {
    console.log('[ScriptSystem] Initialized')
  }

  update(deltaTime: number): void {
    if (!this.isEnabled) return

    const entities = this.getEntitiesWithComponents('Transform', 'ScriptComponent')
    for (const entity of entities) {
      if (!entity.isActive) continue
      // Update scripts
    }
  }

  shutdown(): void {
    console.log('[ScriptSystem] Shutdown')
  }
}

/**
 * World/Engine - Container untuk entities dan systems
 * Core dari ECS architecture
 */
export class World {
  private entities: Map<string, Entity> = new Map()
  private systems: Map<string, System> = new Map()
  private deltaTime: number = 0
  private isRunning: boolean = false
  private lastFrameTime: number = 0

  /**
   * Add entity ke world
   */
  addEntity(entity: Entity): Entity {
    this.entities.set(entity.id, entity)
    return entity
  }

  /**
   * Get entity by id
   */
  getEntity(id: string): Entity | undefined {
    return this.entities.get(id)
  }

  /**
   * Get semua entities
   */
  getEntities(): Entity[] {
    return Array.from(this.entities.values())
  }

  /**
   * Remove entity dari world
   */
  removeEntity(id: string): boolean {
    const entity = this.entities.get(id)
    if (!entity) return false

    // Call destroy pada semua components
    for (const component of entity.getComponents()) {
      component.onDestroy()
    }

    this.entities.delete(id)
    return true
  }

  /**
   * Get entities dengan specific components
   */
  getEntitiesWithComponents(...componentNames: string[]): Entity[] {
    return this.getEntities().filter((entity) =>
      componentNames.every((name) => entity.hasComponent(name)),
    )
  }

  /**
   * Add system ke world
   */
  addSystem(system: System): System {
    system.setWorld(this)
    system.initialize()
    this.systems.set(system.name, system)
    return system
  }

  /**
   * Get system dari world
   */
  getSystem(name: string): System | undefined {
    return this.systems.get(name)
  }

  /**
   * Remove system dari world
   */
  removeSystem(name: string): boolean {
    const system = this.systems.get(name)
    if (!system) return false

    system.shutdown()
    this.systems.delete(name)
    return true
  }

  /**
   * Initialize world
   */
  initialize(): void {
    console.log('[World] Initializing with', this.systems.size, 'systems')
  }

  /**
   * Update world
   */
  update(): void {
    if (!this.isRunning) return

    const currentTime = performance.now()
    this.deltaTime = (currentTime - this.lastFrameTime) / 1000
    this.lastFrameTime = currentTime

    // Update semua systems
    for (const system of this.systems.values()) {
      if (system.isSystemEnabled()) {
        system.update(this.deltaTime)
      }
    }

    // Update semua entity components
    for (const entity of this.entities.values()) {
      if (!entity.isActive) continue

      for (const component of entity.getComponents()) {
        if (component.getEnabled()) {
          component.onUpdate(this.deltaTime)
        }
      }
    }
  }

  /**
   * Start world simulation
   */
  start(): void {
    this.isRunning = true
    this.lastFrameTime = performance.now()
    console.log('[World] Started')
    this.gameLoop()
  }

  /**
   * Stop world simulation
   */
  stop(): void {
    this.isRunning = false
    console.log('[World] Stopped')
  }

  /**
   * Game loop
   */
  private gameLoop = (): void => {
    if (!this.isRunning) return

    this.update()
    requestAnimationFrame(this.gameLoop)
  }

  /**
   * Serialize world untuk save
   */
  serialize(): Record<string, any> {
    return {
      entities: Array.from(this.entities.values()).map((e) => e.serialize()),
      systems: Array.from(this.systems.keys()),
    }
  }

  /**
   * Clear world
   */
  clear(): void {
    for (const system of this.systems.values()) {
      system.shutdown()
    }
    this.entities.clear()
    this.systems.clear()
  }
}
