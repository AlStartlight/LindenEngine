/**
 * API Mapping Dictionary between Godot, Linden, and Unity
 */

export interface ApiMethodMapping {
  godot: string
  unity: string
  linden: string
}

export const LIFECYCLE_MAPPINGS: ApiMethodMapping[] = [
  { godot: '_ready', unity: 'Start', linden: 'onInit' },
  { godot: '_process', unity: 'Update', linden: 'onUpdate' },
  { godot: '_physics_process', unity: 'FixedUpdate', linden: 'onFixedUpdate' },
  { godot: '_enter_tree', unity: 'OnEnable', linden: 'onEnable' },
  { godot: '_exit_tree', unity: 'OnDisable', linden: 'onDisable' },
]

export const NODE_ACCESS_MAPPINGS: ApiMethodMapping[] = [
  { godot: 'get_node', unity: 'transform.Find', linden: 'getNode' },
  { godot: 'get_parent', unity: 'transform.parent', linden: 'getParent' },
  { godot: 'add_child', unity: 'SetParent', linden: 'addChild' },
  { godot: 'queue_free', unity: 'Destroy', linden: 'queueFree' },
  { godot: 'emit_signal', unity: 'Invoke', linden: 'emitSignal' },
]

export const COMPONENT_ACCESS_MAPPINGS = [
  { godot: 'get_node', unity: 'GetComponent', linden: 'getComponent' },
]
