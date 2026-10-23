/**
 * PackedScene and .lscn serializer for Linden Engine (GF-02)
 *
 * Implements Godot-like PackedScene with instancing, overrides, and INI text syntax (.lscn).
 */

import { Node, Node2D, Node3D, Control } from './Node'
import { TscnParser } from '../godot/tscn/TscnParser'
import { TscnWriter } from '../godot/tscn/TscnWriter'
import { parseVariant, formatVariant } from '../godot/tscn/Variant'

export interface PackedNodeData {
  name: string
  type: string
  parent?: string
  instancePath?: string
  properties: Record<string, any>
  groups: string[]
  signals: Array<{ signal: string; target: string; method: string }>
}

export class PackedScene {
  public resourcePath: string = ''
  private nodes: PackedNodeData[] = []

  pack(root: Node): void {
    this.nodes = []
    this.collectNode(root, undefined)
  }

  private collectNode(node: Node, parentPath?: string): void {
    let typeName = node.constructor.name
    if (typeName === 'Object') typeName = 'Node'

    const props: Record<string, any> = {}
    if (node instanceof Node2D) {
      props['position'] = { type: 'Vector2', x: node.position.x, y: node.position.y }
      props['rotation'] = node.rotation
      props['scale'] = { type: 'Vector2', x: node.scale.x, y: node.scale.y }
      props['z_index'] = node.zIndex
      props['modulate'] = node.modulate
    } else if (node instanceof Node3D) {
      props['position'] = { type: 'Vector3', x: node.position.x, y: node.position.y, z: node.position.z }
      props['rotation'] = { type: 'Vector3', x: node.rotation.x, y: node.rotation.y, z: node.rotation.z }
      props['scale'] = { type: 'Vector3', x: node.scale.x, y: node.scale.y, z: node.scale.z }
    } else if (node instanceof Control) {
      props['position'] = { type: 'Vector2', x: node.position.x, y: node.position.y }
      props['size'] = { type: 'Vector2', x: node.size.x, y: node.size.y }
    }

    // Custom metadata / properties
    for (const [k, v] of Object.entries(node.metadata)) {
      props[`metadata/${k}`] = v
    }

    // Collect signals
    const signals: Array<{ signal: string; target: string; method: string }> = []
    for (const [sigName, sig] of (node as any)._signals || []) {
      for (const conn of sig.getConnections()) {
        if (conn.target && conn.method) {
          signals.push({
            signal: sigName,
            target: conn.target.name || '.',
            method: conn.method,
          })
        }
      }
    }

    this.nodes.push({
      name: node.name,
      type: typeName,
      parent: parentPath,
      properties: props,
      groups: node.getGroups(),
      signals,
    })

    const myPath = parentPath === undefined ? '.' : (parentPath === '.' ? node.name : `${parentPath}/${node.name}`)
    for (const child of node.getChildren()) {
      this.collectNode(child, myPath)
    }
  }

  instantiate(): Node {
    if (this.nodes.length === 0) {
      return new Node('EmptyScene')
    }

    const createdNodes: Map<string, Node> = new Map()
    let rootNode: Node | null = null

    for (let i = 0; i < this.nodes.length; i++) {
      const data = this.nodes[i]
      const node = this.createNodeByType(data.type, data.name)

      // Apply groups
      for (const grp of data.groups) {
        node.addToGroup(grp)
      }

      // Apply properties
      this.applyProperties(node, data.properties)

      if (i === 0) {
        rootNode = node
        createdNodes.set('.', node)
        createdNodes.set(data.name, node)
      } else {
        const parentPath = data.parent || '.'
        const parent = createdNodes.get(parentPath) || rootNode
        if (parent) {
          parent.addChild(node)
        }
        const fullKey = parentPath === '.' ? data.name : `${parentPath}/${data.name}`
        createdNodes.set(fullKey, node)
        createdNodes.set(data.name, node)
      }

      // Connect signals
      for (const conn of data.signals) {
        const targetNode = createdNodes.get(conn.target) || rootNode
        if (targetNode) {
          node.connect(conn.signal, targetNode, conn.method)
        }
      }
    }

    return rootNode || new Node('Scene')
  }

  private createNodeByType(type: string, name: string): Node {
    switch (type) {
      case 'Node2D':
      case 'Sprite2D':
      case 'Camera2D':
      case 'CanvasItem':
        return new Node2D(name)
      case 'Node3D':
      case 'MeshInstance3D':
      case 'Camera3D':
      case 'DirectionalLight3D':
      case 'OmniLight3D':
        return new Node3D(name)
      case 'Control':
      case 'Button':
      case 'Label':
        return new Control(name)
      default:
        return new Node(name)
    }
  }

  private applyProperties(node: Node, props: Record<string, any>): void {
    if (node instanceof Node2D) {
      if (props['position']) {
        const p = props['position']
        node.position = { x: p.x ?? 0, y: p.y ?? 0 }
      }
      if (typeof props['rotation'] === 'number') {
        node.rotation = props['rotation']
      }
      if (props['scale']) {
        const s = props['scale']
        node.scale = { x: s.x ?? 1, y: s.y ?? 1 }
      }
      if (typeof props['z_index'] === 'number') {
        node.zIndex = props['z_index']
      }
      if (props['modulate']) {
        node.modulate = String(props['modulate'])
      }
    } else if (node instanceof Node3D) {
      if (props['position']) {
        const p = props['position']
        node.position = { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 }
      }
      if (props['rotation']) {
        const r = props['rotation']
        node.rotation = { x: r.x ?? 0, y: r.y ?? 0, z: r.z ?? 0 }
      }
      if (props['scale']) {
        const s = props['scale']
        node.scale = { x: s.x ?? 1, y: s.y ?? 1, z: s.z ?? 1 }
      }
    }

    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('metadata/')) {
        const metaKey = k.replace('metadata/', '')
        node.metadata[metaKey] = v
      }
    }
  }

  // ==================== SERIALIZATION (.lscn) ====================

  serialize(): string {
    const lines: string[] = ['[gd_scene format=3]', '']

    for (const node of this.nodes) {
      let header = `[node name="${node.name}" type="${node.type}"`
      if (node.parent) {
        header += ` parent="${node.parent}"`
      }
      if (node.groups.length > 0) {
        header += ` groups=[${node.groups.map((g) => `"${g}"`).join(', ')}]`
      }
      header += ']'
      lines.push(header)

      for (const [k, v] of Object.entries(node.properties)) {
        lines.push(`${k} = ${formatVariant(v)}`)
      }
      lines.push('')
    }

    // Write connections
    for (const node of this.nodes) {
      for (const conn of node.signals) {
        lines.push(
          `[connection signal="${conn.signal}" from="${node.name}" to="${conn.target}" method="${conn.method}"]`
        )
      }
    }

    return lines.join('\n')
  }

  static deserialize(content: string): PackedScene {
    const parser = new TscnParser()
    const doc = parser.parse(content)
    const packed = new PackedScene()

    const nodesData: PackedNodeData[] = []
    for (const n of doc.nodes) {
      const groups: string[] = []
      if (n.groups && Array.isArray(n.groups)) {
        groups.push(...n.groups)
      } else if (n.properties['groups'] && Array.isArray(n.properties['groups'])) {
        groups.push(...n.properties['groups'])
      }

      nodesData.push({
        name: n.name,
        type: n.type || 'Node',
        parent: n.parent,
        properties: { ...n.properties },
        groups,
        signals: [],
      })
    }

    // Map connections
    for (const conn of doc.connections) {
      const targetNode = nodesData.find((n) => n.name === conn.from)
      if (targetNode) {
        targetNode.signals.push({
          signal: conn.signal,
          target: conn.to,
          method: conn.method,
        })
      }
    }

    packed.nodes = nodesData
    return packed
  }
}
