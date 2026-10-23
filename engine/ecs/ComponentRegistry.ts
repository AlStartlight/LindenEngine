import { Component, Transform } from './Component'
import { MeshRenderer, Camera, Light, LightType } from '../renderer/Components'
import { Rigidbody, BoxCollider, SphereCollider, CapsuleCollider, MeshCollider, CharacterController } from '../physics/components'
import { TimerComponent } from '../time/Timer'
import { BlueprintComponent } from '../blueprints/BlueprintComponent'

export type PropertyKind =
  | 'number'
  | 'int'
  | 'boolean'
  | 'string'
  | 'color'
  | 'vector3'
  | 'enum'
  | 'entityRef'
  | 'assetRef'
  | 'layerMask'
  | 'event'
  | 'array'

export interface PropertySchema {
  name: string
  label?: string
  kind: PropertyKind
  default: unknown
  min?: number
  max?: number
  step?: number
  options?: string[]
  assetType?: string
  tooltip?: string
  hideInInspector?: boolean
}

export interface ComponentDefinition {
  type: string
  menuPath: string
  icon?: string
  properties: PropertySchema[]
  requires?: string[]
  disallowMultiple?: boolean
  create: () => Component
}

class RegistryManager {
  private definitions: Map<string, ComponentDefinition> = new Map()

  register(def: ComponentDefinition): void {
    this.definitions.set(def.type, def)
  }

  get(type: string): ComponentDefinition | undefined {
    return this.definitions.get(type)
  }

  getAll(): ComponentDefinition[] {
    return Array.from(this.definitions.values())
  }

  /**
   * Fuzzy / prefix search for Add Component dialog
   */
  search(query: string): ComponentDefinition[] {
    const q = query.toLowerCase().trim()
    if (!q) {
      return this.getAll().sort((a, b) => a.menuPath.localeCompare(b.menuPath))
    }

    const words = q.split(/\s+/).filter(Boolean)

    const matches = this.getAll().filter((def) => {
      const typeLower = def.type.toLowerCase()
      const menuLower = def.menuPath.toLowerCase()

      // Match all search words
      return words.every((word) => typeLower.includes(word) || menuLower.includes(word))
    })

    // Sort by relevance: startsWith gets higher priority
    return matches.sort((a, b) => {
      const aType = a.type.toLowerCase()
      const bType = b.type.toLowerCase()
      const aStarts = aType.startsWith(q)
      const bStarts = bType.startsWith(q)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1
      return aType.localeCompare(bType)
    })
  }
}

export const ComponentRegistry = new RegistryManager()

// Register default built-in components
ComponentRegistry.register({
  type: 'Transform',
  menuPath: 'Core/Transform',
  icon: 'Move',
  disallowMultiple: true,
  create: () => new Transform(),
  properties: [
    { name: 'position', label: 'Position', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'rotation', label: 'Rotation', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'scale', label: 'Scale', kind: 'vector3', default: { x: 1, y: 1, z: 1 } },
  ],
})

ComponentRegistry.register({
  type: 'MeshRenderer',
  menuPath: 'Rendering/Mesh Renderer',
  icon: 'Box',
  disallowMultiple: true,
  create: () => new MeshRenderer(),
  properties: [
    { name: 'primitive', label: 'Primitive', kind: 'enum', default: 'box', options: ['box', 'sphere', 'cylinder', 'capsule', 'plane', 'torus'] },
    { name: 'color', label: 'Color', kind: 'color', default: '#3b82f6' },
    { name: 'roughness', label: 'Roughness', kind: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
    { name: 'metalness', label: 'Metalness', kind: 'number', default: 0.1, min: 0, max: 1, step: 0.05 },
    { name: 'castShadow', label: 'Cast Shadows', kind: 'boolean', default: true },
    { name: 'receiveShadow', label: 'Receive Shadows', kind: 'boolean', default: true },
    { name: 'isVisible', label: 'Visible', kind: 'boolean', default: true },
  ],
})

ComponentRegistry.register({
  type: 'Camera',
  menuPath: 'Rendering/Camera',
  icon: 'Camera',
  disallowMultiple: true,
  create: () => new Camera(),
  properties: [
    { name: 'fov', label: 'Field of View', kind: 'number', default: 60, min: 10, max: 120, step: 1 },
    { name: 'near', label: 'Near Clip', kind: 'number', default: 0.1, min: 0.01, max: 10, step: 0.1 },
    { name: 'far', label: 'Far Clip', kind: 'number', default: 1000, min: 10, max: 10000, step: 10 },
    { name: 'isActive', label: 'Active', kind: 'boolean', default: true },
  ],
})

ComponentRegistry.register({
  type: 'Light',
  menuPath: 'Rendering/Light',
  icon: 'Sun',
  disallowMultiple: false,
  create: () => new Light(),
  properties: [
    { name: 'type', label: 'Type', kind: 'enum', default: LightType.DIRECTIONAL, options: [LightType.DIRECTIONAL, LightType.POINT, LightType.SPOT] },
    { name: 'color', label: 'Color', kind: 'color', default: '#ffffff' },
    { name: 'intensity', label: 'Intensity', kind: 'number', default: 1, min: 0, max: 10, step: 0.1 },
    { name: 'range', label: 'Range', kind: 'number', default: 10, min: 0.1, max: 100, step: 0.5 },
    { name: 'castShadow', label: 'Cast Shadows', kind: 'boolean', default: true },
  ],
})

ComponentRegistry.register({
  type: 'Rigidbody',
  menuPath: 'Physics/Rigidbody',
  icon: 'Shield',
  disallowMultiple: true,
  create: () => new Rigidbody(),
  properties: [
    { name: 'bodyType', label: 'Body Type', kind: 'enum', default: 'dynamic', options: ['dynamic', 'kinematic', 'static'] },
    { name: 'mass', label: 'Mass', kind: 'number', default: 1, min: 0.001, max: 10000, step: 0.1 },
    { name: 'drag', label: 'Drag', kind: 'number', default: 0, min: 0, max: 100, step: 0.05 },
    { name: 'angularDrag', label: 'Angular Drag', kind: 'number', default: 0.05, min: 0, max: 100, step: 0.05 },
    { name: 'useGravity', label: 'Use Gravity', kind: 'boolean', default: true },
    { name: 'freezePosition', label: 'Freeze Position', kind: 'vector3', default: { x: false, y: false, z: false } },
    { name: 'freezeRotation', label: 'Freeze Rotation', kind: 'vector3', default: { x: false, y: false, z: false } },
  ],
})

ComponentRegistry.register({
  type: 'BoxCollider',
  menuPath: 'Physics/Box Collider',
  icon: 'Box',
  create: () => new BoxCollider(),
  properties: [
    { name: 'center', label: 'Center', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'size', label: 'Size', kind: 'vector3', default: { x: 1, y: 1, z: 1 } },
    { name: 'isTrigger', label: 'Is Trigger', kind: 'boolean', default: false },
    { name: 'onTriggerEnter', label: 'On Trigger Enter', kind: 'event', default: [] },
    { name: 'onTriggerExit', label: 'On Trigger Exit', kind: 'event', default: [] },
    { name: 'onCollisionEnter', label: 'On Collision Enter', kind: 'event', default: [] },
    { name: 'onCollisionExit', label: 'On Collision Exit', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'SphereCollider',
  menuPath: 'Physics/Sphere Collider',
  icon: 'Circle',
  create: () => new SphereCollider(),
  properties: [
    { name: 'center', label: 'Center', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'radius', label: 'Radius', kind: 'number', default: 0.5, min: 0.01, max: 100, step: 0.05 },
    { name: 'isTrigger', label: 'Is Trigger', kind: 'boolean', default: false },
    { name: 'onTriggerEnter', label: 'On Trigger Enter', kind: 'event', default: [] },
    { name: 'onTriggerExit', label: 'On Trigger Exit', kind: 'event', default: [] },
    { name: 'onCollisionEnter', label: 'On Collision Enter', kind: 'event', default: [] },
    { name: 'onCollisionExit', label: 'On Collision Exit', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'CapsuleCollider',
  menuPath: 'Physics/Capsule Collider',
  icon: 'Pill',
  create: () => new CapsuleCollider(),
  properties: [
    { name: 'center', label: 'Center', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'radius', label: 'Radius', kind: 'number', default: 0.5, min: 0.01, max: 100, step: 0.05 },
    { name: 'height', label: 'Height', kind: 'number', default: 2, min: 0.01, max: 100, step: 0.1 },
    { name: 'isTrigger', label: 'Is Trigger', kind: 'boolean', default: false },
    { name: 'onTriggerEnter', label: 'On Trigger Enter', kind: 'event', default: [] },
    { name: 'onTriggerExit', label: 'On Trigger Exit', kind: 'event', default: [] },
    { name: 'onCollisionEnter', label: 'On Collision Enter', kind: 'event', default: [] },
    { name: 'onCollisionExit', label: 'On Collision Exit', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'MeshCollider',
  menuPath: 'Physics/Mesh Collider',
  icon: 'Box',
  create: () => new MeshCollider(),
  properties: [
    { name: 'convex', label: 'Convex', kind: 'boolean', default: false },
    { name: 'isTrigger', label: 'Is Trigger', kind: 'boolean', default: false },
  ],
})

ComponentRegistry.register({
  type: 'CharacterController',
  menuPath: 'Physics/Character Controller',
  icon: 'User',
  requires: ['CapsuleCollider'],
  disallowMultiple: true,
  create: () => new CharacterController(),
  properties: [
    { name: 'stepOffset', label: 'Step Offset', kind: 'number', default: 0.3, min: 0, max: 2, step: 0.05 },
    { name: 'slopeLimit', label: 'Slope Limit', kind: 'number', default: 45, min: 0, max: 90, step: 1 },
    { name: 'skinWidth', label: 'Skin Width', kind: 'number', default: 0.08, min: 0.001, max: 0.5, step: 0.01 },
  ],
})

ComponentRegistry.register({
  type: 'Timer',
  menuPath: 'Gameplay/Timer',
  icon: 'Clock',
  create: () => new TimerComponent(),
  properties: [
    { name: 'waitTime', label: 'Wait Time', kind: 'number', default: 1, min: 0.01, max: 3600, step: 0.1 },
    { name: 'oneShot', label: 'One Shot', kind: 'boolean', default: false },
    { name: 'autoStart', label: 'Auto Start', kind: 'boolean', default: true },
    { name: 'onTimeout', label: 'On Timeout', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'Blueprint',
  menuPath: 'Scripting/Blueprint',
  icon: 'FileCode',
  disallowMultiple: true,
  create: () => new BlueprintComponent(),
  properties: [
    { name: 'blueprintName', label: 'Blueprint', kind: 'string', default: 'New Blueprint' },
  ],
})
