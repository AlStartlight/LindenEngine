import { Component, Transform } from './Component'
import { Entity } from './Entity'
import { ComponentRegistry } from './ComponentRegistry'
import { DEFAULT_SCENE_SETTINGS, SceneSettings } from '../scene/SceneSettings'

export type EventCallback = (...args: any[]) => void

export class EventEmitter {
  private listeners: Map<string, Set<EventCallback>> = new Map()

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
    return () => this.off(event, callback)
  }

  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback)
  }

  emit(event: string, ...args: any[]): void {
    const cbs = this.listeners.get(event)
    if (!cbs) return
    for (const cb of Array.from(cbs)) {
      try {
        cb(...args)
      } catch (err) {
        console.error(`[World EventEmitter] Error in listener for "${event}":`, err)
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }
}

export abstract class System {
  protected world: World | null = null
  protected isEnabled: boolean = true

  constructor(public readonly name: string) {}

  abstract initialize(): void
  abstract update(deltaTime: number): void
  fixedUpdate?(fixedDelta: number): void
  abstract shutdown(): void

  setWorld(world: World): void {
    this.world = world
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled
  }

  isSystemEnabled(): boolean {
    return this.isEnabled
  }

  protected getEntitiesWithComponents(...componentNames: string[]): Entity[] {
    if (!this.world) return []
    return this.world.getEntitiesWithComponents(...componentNames)
  }
}

/**
 * World - Central container for all entities, systems, and scene events
 * Equivalent to SceneTree in Godot and World/Scene in Unity
 */
export class World {
  private entities: Map<string, Entity> = new Map()
  private rootEntityIds: string[] = [] // Root entities in hierarchy order
  private systems: Map<string, System> = new Map()
  private tagIndex: Map<string, Set<string>> = new Map()

  public readonly events: EventEmitter = new EventEmitter()

  /** Render settings of the loaded scene (environment, tone mapping, fog, shadows, post-processing) */
  private sceneSettings: SceneSettings = structuredClone(DEFAULT_SCENE_SETTINGS)

  constructor() {}

  getSceneSettings(): SceneSettings {
    return this.sceneSettings
  }

  /** Replace (or merge, for a partial) the scene settings; renderers re-apply on 'sceneSettingsChanged' */
  setSceneSettings(settings: Partial<SceneSettings>, replace = false): void {
    this.sceneSettings = replace
      ? (structuredClone(settings) as SceneSettings)
      : ({ ...this.sceneSettings, ...structuredClone(settings) } as SceneSettings)
    this.events.emit('sceneSettingsChanged', this.sceneSettings)
  }

  /**
   * Create entity and optionally attach to parent
   */
  createEntity(name: string = 'GameObject', parentId: string | null = null, index?: number, id?: string): Entity {
    const entity = new Entity(name, id)
    this.entities.set(entity.id, entity)

    // Wire any EventFields on initial components (e.g. Transform)
    this.wireEntityEventFields(entity)

    if (parentId) {
      const parent = this.entities.get(parentId)
      if (parent) {
        entity.parentId = parentId
        if (index !== undefined && index >= 0 && index <= parent.childIds.length) {
          parent.childIds.splice(index, 0, entity.id)
        } else {
          parent.childIds.push(entity.id)
        }
      } else {
        entity.parentId = null
        this.addRootId(entity.id, index)
      }
    } else {
      entity.parentId = null
      this.addRootId(entity.id, index)
    }

    // Update tags
    for (const tag of entity.tags) {
      this.indexTag(entity.id, tag)
    }

    this.events.emit('entityAdded', entity)
    return entity
  }

  /**
   * Add entity directly to world
   */
  addEntity(entity: Entity): Entity {
    if (this.entities.has(entity.id)) return entity

    this.entities.set(entity.id, entity)
    this.wireEntityEventFields(entity)

    if (entity.parentId) {
      const parent = this.entities.get(entity.parentId)
      if (parent && !parent.childIds.includes(entity.id)) {
        parent.childIds.push(entity.id)
      }
    } else {
      if (!this.rootEntityIds.includes(entity.id)) {
        this.rootEntityIds.push(entity.id)
      }
    }

    for (const tag of entity.tags) {
      this.indexTag(entity.id, tag)
    }

    this.events.emit('entityAdded', entity)
    return entity
  }

  /**
   * Get entity by ID
   */
  getEntity(id: string): Entity | undefined {
    return this.entities.get(id)
  }

  /**
   * Get all entities
   */
  getEntities(): Entity[] {
    return Array.from(this.entities.values())
  }

  /**
   * Get root entities
   */
  getRootEntities(): Entity[] {
    return this.rootEntityIds.map((id) => this.entities.get(id)!).filter(Boolean)
  }

  /**
   * Get root entity IDs
   */
  getRootEntityIds(): string[] {
    return [...this.rootEntityIds]
  }

  /**
   * Get all entities in depth-first hierarchy order
   */
  getEntitiesInHierarchyOrder(): Entity[] {
    const result: Entity[] = []
    const visit = (entId: string) => {
      const ent = this.entities.get(entId)
      if (!ent) return
      result.push(ent)
      for (const childId of ent.childIds) {
        visit(childId)
      }
    }

    for (const rootId of this.rootEntityIds) {
      visit(rootId)
    }
    return result
  }

  /**
   * Set parent of an entity with cycle detection
   */
  setParent(id: string, parentId: string | null, indexOrKeepWorld?: number | boolean, keepWorldTransform: boolean = false): void {
    let index: number | undefined
    if (typeof indexOrKeepWorld === 'boolean') {
      keepWorldTransform = indexOrKeepWorld
      index = undefined
    } else {
      index = indexOrKeepWorld
    }

    const entity = this.entities.get(id)
    if (!entity) return

    if (parentId === id) {
      throw new Error('PARENT_CYCLE: Entity cannot be its own parent')
    }

    if (parentId !== null) {
      const newParent = this.entities.get(parentId)
      if (!newParent) {
        throw new Error(`Parent entity "${parentId}" not found`)
      }

      // Detect cycles: check if newParent is a descendant of entity or entity itself
      let cur: Entity | undefined = newParent
      while (cur) {
        if (cur.id === id) {
          throw new Error('PARENT_CYCLE: Target parent is a descendant of the entity')
        }
        cur = cur.parentId ? this.entities.get(cur.parentId) : undefined
      }
    }

    const oldParentId = entity.parentId

    // Remove from old parent or root list
    if (oldParentId) {
      const oldParent = this.entities.get(oldParentId)
      if (oldParent) {
        const idx = oldParent.childIds.indexOf(id)
        if (idx !== -1) oldParent.childIds.splice(idx, 1)
      }
    } else {
      const idx = this.rootEntityIds.indexOf(id)
      if (idx !== -1) this.rootEntityIds.splice(idx, 1)
    }

    // Attach to new parent or root
    entity.parentId = parentId
    if (parentId !== null) {
      const newParent = this.entities.get(parentId)!
      if (index !== undefined && index >= 0 && index <= newParent.childIds.length) {
        newParent.childIds.splice(index, 0, id)
      } else {
        newParent.childIds.push(id)
      }
    } else {
      this.addRootId(id, index)
    }

    this.events.emit('parentChanged', entity, oldParentId, parentId, keepWorldTransform)
  }

  /**
   * Destroy entity and recursively destroy all children
   */
  destroyEntity(id: string): void {
    const entity = this.entities.get(id)
    if (!entity) return

    // Recursively destroy children first
    const childrenToDestroy = [...entity.childIds]
    for (const childId of childrenToDestroy) {
      this.destroyEntity(childId)
    }

    // Remove from parent's child list
    if (entity.parentId) {
      const parent = this.entities.get(entity.parentId)
      if (parent) {
        const idx = parent.childIds.indexOf(id)
        if (idx !== -1) parent.childIds.splice(idx, 1)
      }
    } else {
      const idx = this.rootEntityIds.indexOf(id)
      if (idx !== -1) this.rootEntityIds.splice(idx, 1)
    }

    // Remove from tag index
    for (const tag of entity.tags) {
      this.unindexTag(entity.id, tag)
    }

    // Detach components
    for (const comp of entity.getComponents()) {
      try {
        comp.onDetach()
        comp.onDestroy()
      } catch (err) {
        console.error(`Error destroying component ${comp.name}:`, err)
      }
    }

    this.entities.delete(id)
    this.events.emit('entityRemoved', entity)
  }

  /**
   * Initialize world and its systems
   */
  initialize(): void {
    for (const system of this.systems.values()) {
      system.initialize()
    }
  }

  /**
   * Start world simulation
   */
  start(): void {
    // Play mode lifecycle hook
  }

  /**
   * Stop world simulation
   */
  stop(): void {
    // Stop lifecycle hook
  }

  /**
   * Add component to entity with validation and required components
   */
  addComponent<T extends Component = any>(id: string, type: string, data?: Record<string, any>): T {
    const entity = this.entities.get(id)
    if (!entity) {
      throw new Error(`Entity "${id}" not found`)
    }

    const def = ComponentRegistry.get(type)

    if (def?.disallowMultiple && entity.hasComponent(type)) {
      console.warn(`Component "${type}" cannot be added multiple times to entity "${entity.name}"`)
      return entity.getComponent(type) as unknown as T
    }

    // Automatically add required components (e.g. CharacterController -> CapsuleCollider)
    if (def?.requires) {
      for (const reqType of def.requires) {
        if (!entity.hasComponent(reqType)) {
          this.addComponent(id, reqType)
        }
      }
    }

    let comp: Component
    if (def) {
      comp = def.create()
    } else {
      // Fallback
      comp = new (class extends Component {
        clone() {
          return new (this.constructor as any)(this.name)
        }
      })(type)
    }

    if (data) {
      for (const [key, value] of Object.entries(data)) {
        const current = (comp as any)[key]
        // Serialized scenes store an EventField as its listener array; keep the field object
        // (scripts and physics subscribe to it) and restore only the listeners
        if (current && typeof current.on === 'function' && Array.isArray(current.listeners)) {
          if (Array.isArray(value)) current.listeners = value.map((l: any) => ({ ...l }))
          continue
        }
        ;(comp as any)[key] = value
      }
    }

    this.wireComponentEventFields(comp)
    entity.addComponent(comp)
    this.events.emit('componentAdded', entity, comp)
    return comp as unknown as T
  }

  /**
   * Remove component from entity
   */
  removeComponent(id: string, type: string): void {
    const entity = this.entities.get(id)
    if (!entity) return

    const comp = entity.getComponent(type)
    if (!comp) return

    if (entity.removeComponent(type)) {
      this.events.emit('componentRemoved', entity, comp)
    }
  }

  /**
   * Set property on entity or component
   */
  setProperty(id: string, type: string, path: string, value: unknown): void {
    const entity = this.entities.get(id)
    if (!entity) return

    let target: any
    if (type === 'Entity' || type === 'GameObject') {
      target = entity
    } else {
      target = entity.getComponent(type)
    }

    if (!target) return

    const parts = path.split('.')
    let current = target
    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]]
      if (!current) return
    }

    const lastProp = parts[parts.length - 1]
    const oldValue = current[lastProp]

    // Handle array assignment to vector objects or arrays
    if (Array.isArray(value) && value.length === 3 && current[lastProp] && typeof current[lastProp] === 'object') {
      if (Array.isArray(current[lastProp])) {
        current[lastProp] = [...value]
      } else {
        current[lastProp].x = value[0]
        current[lastProp].y = value[1]
        current[lastProp].z = value[2]
      }
    } else {
      current[lastProp] = value
    }

    this.events.emit('propertyChanged', entity, type, path, value, oldValue)
  }

  /**
   * Get property value
   */
  getProperty(id: string, type: string, path: string): unknown {
    const entity = this.entities.get(id)
    if (!entity) return undefined

    let target: any = type === 'Entity' || type === 'GameObject' ? entity : entity.getComponent(type)
    if (!target) return undefined

    const parts = path.split('.')
    let current = target
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = current[part]
    }
    return current
  }

  // ==================== TAG MANAGEMENT ====================

  addTag(id: string, tag: string): boolean {
    const entity = this.entities.get(id)
    if (!entity) return false
    const added = entity.addTag(tag)
    if (added) {
      this.indexTag(id, tag)
      this.events.emit('tagAdded', entity, tag)
    }
    return added
  }

  removeTag(id: string, tag: string): boolean {
    const entity = this.entities.get(id)
    if (!entity) return false
    const removed = entity.removeTag(tag)
    if (removed) {
      this.unindexTag(id, tag)
      this.events.emit('tagRemoved', entity, tag)
    }
    return removed
  }

  private indexTag(entityId: string, tag: string): void {
    if (!this.tagIndex.has(tag)) {
      this.tagIndex.set(tag, new Set())
    }
    this.tagIndex.get(tag)!.add(entityId)
  }

  private unindexTag(entityId: string, tag: string): void {
    this.tagIndex.get(tag)?.delete(entityId)
    if (this.tagIndex.get(tag)?.size === 0) {
      this.tagIndex.delete(tag)
    }
  }

  /**
   * Find entities by single tag in Hierarchy order (O(k) using index)
   */
  findByTag(tag: string): Entity[] {
    const ids = this.tagIndex.get(tag)
    if (!ids || ids.size === 0) return []
    return this.getEntitiesInHierarchyOrder().filter((e) => ids.has(e.id))
  }

  /**
   * Find entities matching ALL specified tags
   */
  findByAllTags(tags: string[]): Entity[] {
    if (tags.length === 0) return []
    return this.getEntitiesInHierarchyOrder().filter((e) => tags.every((t) => e.hasTag(t)))
  }

  /**
   * Find entities matching ANY of the specified tags
   */
  findByAnyTag(tags: string[]): Entity[] {
    if (tags.length === 0) return []
    return this.getEntitiesInHierarchyOrder().filter((e) => tags.some((t) => e.hasTag(t)))
  }

  /**
   * Call a method across all entities with a given tag
   */
  callTag(tag: string, methodName: string, ...args: unknown[]): void {
    const entities = this.findByTag(tag)
    for (const ent of entities) {
      for (const comp of ent.getComponents()) {
        const fn = (comp as any)[methodName]
        if (typeof fn === 'function') {
          try {
            fn.apply(comp, args)
          } catch (err) {
            console.error(`Error in callTag(${tag}, ${methodName}):`, err)
          }
        }
      }
    }
  }

  // ==================== SYSTEM & ECS MANAGEMENT ====================

  getEntitiesWithComponents(...componentNames: string[]): Entity[] {
    return this.getEntities().filter((entity) =>
      componentNames.every((name) => entity.hasComponent(name))
    )
  }

  addSystem(system: System): System {
    system.setWorld(this)
    system.initialize()
    this.systems.set(system.name, system)
    return system
  }

  getSystem(name: string): System | undefined {
    return this.systems.get(name)
  }

  removeSystem(name: string): boolean {
    const system = this.systems.get(name)
    if (!system) return false
    system.shutdown()
    this.systems.delete(name)
    return true
  }

  update(deltaTime: number = 1 / 60): void {
    for (const system of this.systems.values()) {
      if (system.isSystemEnabled()) {
        system.update(deltaTime)
      }
    }
  }

  fixedUpdate(fixedDelta: number): void {
    for (const system of this.systems.values()) {
      if (system.isSystemEnabled() && typeof system.fixedUpdate === 'function') {
        system.fixedUpdate(fixedDelta)
      }
    }
  }

  clear(): void {
    for (const sys of this.systems.values()) {
      try {
        sys.shutdown()
      } catch (_) {}
    }
    this.systems.clear()

    const allEntities = Array.from(this.entities.values())
    for (const ent of allEntities) {
      for (const comp of ent.getComponents()) {
        try {
          comp.onDetach()
          comp.onDestroy()
        } catch (_) {}
      }
      this.events.emit('entityRemoved', ent)
    }

    this.entities.clear()
    this.rootEntityIds = []
    this.tagIndex.clear()
  }

  private addRootId(id: string, index?: number): void {
    if (index !== undefined && index >= 0 && index <= this.rootEntityIds.length) {
      this.rootEntityIds.splice(index, 0, id)
    } else {
      this.rootEntityIds.push(id)
    }
  }

  private wireEntityEventFields(entity: Entity): void {
    for (const comp of entity.getComponents()) {
      this.wireComponentEventFields(comp)
    }
  }

  private wireComponentEventFields(comp: Component): void {
    for (const val of Object.values(comp)) {
      if (val && typeof (val as any).setWorldGetter === 'function') {
        ;(val as any).setWorldGetter(() => this)
      }
    }
  }
}
