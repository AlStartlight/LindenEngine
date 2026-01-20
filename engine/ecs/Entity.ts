import { Component, Transform } from './Component'
import { nanoid } from '../utils/index'

/**
 * Entity - Wadah untuk components
 * Mirip GameObject di Unity atau Actor di Unreal Engine
 */
export class Entity {
  public id: string
  public name: string
  public isActive: boolean = true
  private components: Map<string, Component> = new Map()
  private transform: Transform

  constructor(name: string = 'Entity', id: string = nanoid()) {
    this.id = id
    this.name = name
    this.transform = new Transform()
    this.addComponent(this.transform)
  }

  /**
   * Add component ke entity
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
   * Get component dari entity
   */
  getComponent<T extends Component>(name: string): T | undefined {
    return this.components.get(name) as T | undefined
  }

  /**
   * Check apakah entity memiliki component
   */
  hasComponent(name: string): boolean {
    return this.components.has(name)
  }

  /**
   * Remove component dari entity
   */
  removeComponent(name: string): boolean {
    const component = this.components.get(name)
    if (!component) return false

    component.onDetach()
    this.components.delete(name)
    return true
  }

  /**
   * Get semua components
   */
  getComponents(): Component[] {
    return Array.from(this.components.values())
  }

  /**
   * Get transform component
   */
  getTransform(): Transform {
    return this.transform
  }

  /**
   * Duplicate entity
   */
  clone(): Entity {
    const cloned = new Entity(this.name + ' (Clone)')

    for (const component of this.components.values()) {
      if (component !== this.transform) {
        cloned.addComponent(component.clone())
      }
    }

    return cloned
  }

  /**
   * Serialize entity untuk save/export
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      isActive: this.isActive,
      components: Array.from(this.components.entries()).map(([name, component]) => ({
        name,
        data: (component as any).serialize?.() || {},
      })),
    }
  }

  /**
   * Deserialize entity dari data
   */
  static deserialize(data: Record<string, any>): Entity {
    const entity = new Entity(data.name, data.id)
    entity.isActive = data.isActive
    return entity
  }
}
