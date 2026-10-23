/**
 * SceneTree for Linden Engine (GF-01, GF-05, GF-06)
 *
 * Manages the node hierarchy execution, current scene lifecycle,
 * group queries and method calls, and global Autoload nodes.
 */

import { Node } from './Node'

export class SceneTree {
  public readonly root: Node
  public currentScene: Node | null = null
  private groupMap: Map<string, Set<Node>> = new Map()
  private autoloadMap: Map<string, Node> = new Map()

  constructor() {
    this.root = new Node('Root')
    this.root.sceneTree = this
    this.root.isInsideTree = true
  }

  // ==================== SCENE MANAGEMENT ====================

  setCurrentScene(scene: Node): void {
    if (this.currentScene) {
      this.root.removeChild(this.currentScene)
      this.currentScene = null
    }

    this.currentScene = scene
    this.root.addChild(scene)
  }

  changeSceneToPacked(packedScene: { instantiate: () => Node }): Node {
    const inst = packedScene.instantiate()
    this.setCurrentScene(inst)
    return inst
  }

  // ==================== GROUPS (GF-05) ====================

  _registerGroupNode(group: string, node: Node): void {
    if (!this.groupMap.has(group)) {
      this.groupMap.set(group, new Set())
    }
    this.groupMap.get(group)!.add(node)
  }

  _unregisterGroupNode(group: string, node: Node): void {
    const set = this.groupMap.get(group)
    if (set) {
      set.delete(node)
      if (set.size === 0) {
        this.groupMap.delete(group)
      }
    }
  }

  getNodesInGroup(group: string): Node[] {
    const set = this.groupMap.get(group)
    return set ? Array.from(set) : []
  }

  get_nodes_in_group(group: string): Node[] {
    return this.getNodesInGroup(group)
  }

  callGroup(group: string, method: string, ...args: any[]): void {
    const nodes = this.getNodesInGroup(group)
    for (const node of nodes) {
      if (typeof (node as any)[method] === 'function') {
        try {
          ;(node as any)[method](...args)
        } catch (err) {
          console.error(`[SceneTree.callGroup] Error calling "${method}" on node "${node.name}":`, err)
        }
      }
    }
  }

  call_group(group: string, method: string, ...args: any[]): void {
    this.callGroup(group, method, ...args)
  }

  // ==================== AUTOLOAD / SINGLETONS (GF-06) ====================

  registerAutoload(name: string, node: Node): void {
    if (this.autoloadMap.has(name)) {
      const existing = this.autoloadMap.get(name)!
      this.root.removeChild(existing)
    }
    this.autoloadMap.set(name, node)
    this.root.addChild(node)
  }

  getAutoload(name: string): Node | undefined {
    return this.autoloadMap.get(name)
  }

  hasAutoload(name: string): boolean {
    return this.autoloadMap.has(name)
  }

  // ==================== UPDATE CYCLES ====================

  process(delta: number): void {
    // Process autoloads & current scene via root propagation
    this.root._propagateProcess(delta)
  }

  physicsProcess(delta: number): void {
    this.root._propagatePhysicsProcess(delta)
  }
}
