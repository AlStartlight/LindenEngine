/**
 * Blueprint Component
 * 
 * Component untuk menjalankan Blueprint visual scripting pada Entity/GameObject.
 * Mirip dengan Actor Blueprint di Unreal Engine atau MonoBehaviour di Unity.
 */

import { Component } from '../ecs/Component'
import { BlueprintGraph, createHelloWorldBlueprint, createSimpleMovementBlueprint } from './BlueprintGraph'

/**
 * Blueprint Component - Menghubungkan Blueprint ke Entity
 */
export class BlueprintComponent extends Component {
  private blueprint: BlueprintGraph
  private isInitialized: boolean = false
  private world: any = null

  constructor(blueprint?: BlueprintGraph) {
    super('Blueprint')
    this.blueprint = blueprint || new BlueprintGraph('New Blueprint')
  }

  /**
   * Set blueprint graph
   */
  setBlueprint(blueprint: BlueprintGraph): void {
    this.blueprint = blueprint
    this.isInitialized = false
  }

  /**
   * Get blueprint graph
   */
  getBlueprint(): BlueprintGraph {
    return this.blueprint
  }

  /**
   * Dipanggil ketika game dimulai (Play mode)
   */
  onBeginPlay(world: any): void {
    this.world = world
    
    // Initialize execution context
    this.blueprint.initializeContext(this, world)
    
    // Execute BeginPlay event
    this.blueprint.executeBeginPlay()
    
    this.isInitialized = true
    console.log(`[Blueprint] ${this.blueprint.name} - BeginPlay executed`)
  }

  /**
   * Dipanggil setiap frame
   */
  onUpdate(deltaTime: number): void {
    if (!this.isInitialized || !this.isEnabled) return
    
    // Execute Tick event
    this.blueprint.executeTick(deltaTime)
  }

  /**
   * Dipanggil ketika component dihapus atau game berhenti
   */
  onEndPlay(): void {
    this.isInitialized = false
    console.log(`[Blueprint] ${this.blueprint.name} - EndPlay`)
  }

  onDetach(): void {
    this.onEndPlay()
  }

  onDestroy(): void {
    this.onEndPlay()
  }

  /**
   * Clone component
   */
  clone(): BlueprintComponent {
    // Serialize and deserialize to create a deep copy
    const serialized = this.blueprint.serialize()
    const clonedBlueprint = BlueprintGraph.deserialize(serialized)
    return new BlueprintComponent(clonedBlueprint)
  }

  /**
   * Serialize untuk save
   */
  serialize(): Record<string, any> {
    return {
      name: this.name,
      isEnabled: this.isEnabled,
      blueprint: this.blueprint.serialize()
    }
  }

  /**
   * Create dari serialized data
   */
  static deserialize(data: Record<string, any>): BlueprintComponent {
    const blueprint = BlueprintGraph.deserialize(data.blueprint)
    const component = new BlueprintComponent(blueprint)
    component.setEnabled(data.isEnabled)
    return component
  }
}

// ==================== PRESET BLUEPRINT COMPONENTS ====================

/**
 * Create Hello World Blueprint Component
 * Blueprint yang print "Hello World" saat game dimulai
 */
export function createHelloWorldComponent(): BlueprintComponent {
  return new BlueprintComponent(createHelloWorldBlueprint())
}

/**
 * Create Simple Movement Blueprint Component
 * Blueprint dengan movement input dasar
 */
export function createSimpleMovementComponent(): BlueprintComponent {
  return new BlueprintComponent(createSimpleMovementBlueprint())
}

// ==================== BLUEPRINT COMPONENT REGISTRY ====================

/**
 * Registry untuk menyimpan Blueprint templates yang bisa di-reuse
 */
export class BlueprintRegistry {
  private static templates: Map<string, BlueprintGraph> = new Map()

  /**
   * Register blueprint template
   */
  static register(name: string, blueprint: BlueprintGraph): void {
    this.templates.set(name, blueprint)
  }

  /**
   * Get blueprint template by name
   */
  static get(name: string): BlueprintGraph | undefined {
    return this.templates.get(name)
  }

  /**
   * Create component from registered template
   */
  static createComponent(templateName: string): BlueprintComponent | null {
    const template = this.templates.get(templateName)
    if (!template) {
      console.warn(`Blueprint template "${templateName}" not found`)
      return null
    }
    
    // Create deep copy
    const copy = BlueprintGraph.deserialize(template.serialize())
    return new BlueprintComponent(copy)
  }

  /**
   * Get all registered template names
   */
  static getTemplateNames(): string[] {
    return Array.from(this.templates.keys())
  }

  /**
   * Initialize with built-in templates
   */
  static initialize(): void {
    this.register('HelloWorld', createHelloWorldBlueprint())
    this.register('SimpleMovement', createSimpleMovementBlueprint())
  }
}

// Initialize built-in templates
BlueprintRegistry.initialize()
