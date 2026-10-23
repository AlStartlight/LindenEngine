import { Component, Transform } from './Component'
import { nanoid } from '../utils/index'
import type { PrefabLink } from '../scene/prefab'

/**
 * Entity - Container for components
 * Equivalent to GameObject in Unity or Node in Godot
 */
export class Entity {
  public readonly id: string
  public name: string
  public active: boolean = true
  public isStatic: boolean = false
  public tags: string[] = []
  public layer: number = 0 // 0..31
  public parentId: string | null = null
  public childIds: string[] = []
  public prefab?: PrefabLink

  private components: Map<string, Component> = new Map()
  private transform: Transform

  constructor(name: string = 'GameObject', id: string = nanoid()) {
    this.id = id
    this.name = name
    this.transform = new Transform()
    this.addComponent(this.transform)
  }

  // Backwards compatibility alias for isActive
  get isActive(): boolean {
    return this.active
  }

  set isActive(value: boolean) {
    this.active = value
  }

  /**
   * Check whether entity has specific tag
   */
  hasTag(tag: string): boolean {
    return this.tags.includes(tag)
  }

  /**
   * Add a tag if not already present
   */
  addTag(tag: string): boolean {
    const trimmed = tag.trim()
    if (!trimmed || this.tags.includes(trimmed)) return false
    this.tags.push(trimmed)
    return true
  }

  /**
   * Remove a tag
   */
  removeTag(tag: string): boolean {
    const idx = this.tags.indexOf(tag)
    if (idx === -1) return false
    this.tags.splice(idx, 1)
    return true
  }

  /**
   * Set tags array (ensuring uniqueness)
   */
  setTags(tags: string[]): void {
    const set = new Set<string>()
    for (const t of tags) {
      const trimmed = t.trim()
      if (trimmed) set.add(trimmed)
    }
    this.tags = Array.from(set)
  }

  /**
   * Add component to entity
   */
  addComponent<T extends Component>(component: T): T {
    const componentName = component.name
    if (this.components.has(componentName)) {
      console.warn(`Component ${componentName} already exists on entity ${this.name}`)
      return component
    }

    component.onAttach(this.id)
    this.components.set(componentName, component)
    return component
  }

  /**
   * Get component by name
   */
  getComponent<T extends Component>(name: string): T | undefined {
    return this.components.get(name) as T | undefined
  }

  /**
   * Check whether entity has component
   */
  hasComponent(name: string): boolean {
    return this.components.has(name)
  }

  /**
   * Remove component from entity
   */
  removeComponent(name: string): boolean {
    if (name === 'Transform') {
      console.warn('Cannot remove Transform component from Entity')
      return false
    }

    const component = this.components.get(name)
    if (!component) return false

    component.onDetach()
    this.components.delete(name)
    return true
  }

  /**
   * Get all components
   */
  getComponents(): Component[] {
    return Array.from(this.components.values())
  }

  /**
   * Get Transform component
   */
  getTransform(): Transform {
    return this.transform
  }

  /**
   * Clone entity (deep clone of components, excluding Transform which is newly created)
   */
  clone(newName?: string, newId: string = nanoid()): Entity {
    const cloned = new Entity(newName || `${this.name} (Clone)`, newId)
    cloned.active = this.active
    cloned.isStatic = this.isStatic
    cloned.tags = [...this.tags]
    cloned.layer = this.layer

    // Clone transform values
    const myTransform = this.getTransform()
    const clonedTransform = cloned.getTransform()
    clonedTransform.position = { ...myTransform.position }
    clonedTransform.rotation = { ...myTransform.rotation }
    clonedTransform.scale = { ...myTransform.scale }

    // Clone other components
    for (const component of this.components.values()) {
      if (component.name !== 'Transform') {
        cloned.addComponent(component.clone())
      }
    }

    if (this.prefab) {
      cloned.prefab = JSON.parse(JSON.stringify(this.prefab))
    }

    return cloned
  }

  /**
   * Serialize entity
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      active: this.active,
      static: this.isStatic,
      tags: [...this.tags],
      layer: this.layer,
      parentId: this.parentId,
      prefab: this.prefab ? JSON.parse(JSON.stringify(this.prefab)) : undefined,
      components: Array.from(this.components.entries()).map(([name, component]) => {
        const raw: Record<string, any> = { type: name }
        const data: Record<string, any> = {}
        for (const [key, val] of Object.entries(component)) {
          if (key === 'name' || key === 'entityId' || typeof val === 'function') continue
          data[key] = val
        }
        raw.data = data
        return raw
      }),
    }
  }
}
