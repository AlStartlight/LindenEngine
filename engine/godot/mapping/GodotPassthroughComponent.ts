/**
 * Godot Passthrough Component
 * Preserves Godot-specific nodes and properties when imported into Linden World
 * so that they can be exported back without data loss (Round-Trip Guarantee).
 */

import { Component } from '../../ecs/Component'
import { ComponentRegistry } from '../../ecs/ComponentRegistry'

export class GodotPassthroughComponent extends Component {
  public rawType: string = ''
  public rawProperties: Record<string, any> = {}
  public rawMetadata: Record<string, any> = {}

  constructor(rawType: string = '', rawProperties: Record<string, any> = {}) {
    super('GodotPassthrough')
    this.rawType = rawType
    this.rawProperties = { ...rawProperties }
  }

  clone(): GodotPassthroughComponent {
    const cloned = new GodotPassthroughComponent(this.rawType, JSON.parse(JSON.stringify(this.rawProperties)))
    cloned.rawMetadata = JSON.parse(JSON.stringify(this.rawMetadata))
    return cloned
  }
}

// Register in ComponentRegistry if not already registered
if (!ComponentRegistry.get('GodotPassthrough')) {
  ComponentRegistry.register({
    type: 'GodotPassthrough',
    menuPath: 'Godot/Passthrough',
    icon: 'Package',
    create: () => new GodotPassthroughComponent(),
    properties: [
      { name: 'rawType', label: 'Godot Type', kind: 'string', default: '' },
    ],
  })
}
