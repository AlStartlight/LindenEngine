/**
 * Godot-like Node hierarchy for Linden Engine (GF-01)
 *
 * Node is the primary hierarchical model in Linden Engine, backed by ECS
 * entity integration so all systems remain fast and interoperable.
 */

import { nanoid } from '../utils/index'
import { Signal, SignalCallback } from './Signal'
import { Entity } from '../ecs/Entity'

export interface Transform2DData {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

export interface Transform3DData {
  x: number
  y: number
  z: number
  rotX: number
  rotY: number
  rotZ: number
  scaleX: number
  scaleY: number
  scaleZ: number
}

export class Node {
  public readonly id: string
  public name: string
  public owner: Node | null = null
  protected _parent: Node | null = null
  protected _children: Node[] = []
  protected _groups: Set<string> = new Set()
  protected _signals: Map<string, Signal> = new Map()
  public sceneTree: any = null
  public isInsideTree: boolean = false
  public isQueuedForDeletion: boolean = false

  // Integrated ECS Entity
  public entity?: Entity
  public metadata: Record<string, any> = {}

  constructor(name: string = 'Node', id: string = nanoid()) {
    this.id = id
    this.name = name
  }

  // ==================== HIERARCHY ====================

  getParent(): Node | null {
    return this._parent
  }

  getChildren(): readonly Node[] {
    return [...this._children]
  }

  getChildCount(): number {
    return this._children.length
  }

  getChild(index: number): Node | null {
    return this._children[index] ?? null
  }

  addChild(child: Node, index?: number): void {
    if (child === this) {
      throw new Error(`[Node] Cannot add node "${this.name}" to itself`)
    }
    if (child._parent) {
      child._parent.removeChild(child)
    }

    child._parent = this
    if (index !== undefined && index >= 0 && index <= this._children.length) {
      this._children.splice(index, 0, child)
    } else {
      this._children.push(child)
    }

    if (this.isInsideTree) {
      child._propagateEnterTree(this.sceneTree)
    }
  }

  removeChild(child: Node): boolean {
    const idx = this._children.indexOf(child)
    if (idx === -1) return false

    if (child.isInsideTree) {
      child._propagateExitTree()
    }
    child._parent = null
    this._children.splice(idx, 1)
    return true
  }

  moveChild(child: Node, toIndex: number): boolean {
    const idx = this._children.indexOf(child)
    if (idx === -1) return false
    this._children.splice(idx, 1)
    const targetIdx = Math.max(0, Math.min(toIndex, this._children.length))
    this._children.splice(targetIdx, 0, child)
    this._notifyTransformDirty()
    return true
  }

  getNode(path: string): Node | null {
    if (!path || path === '.') return this
    if (path === '..') return this._parent

    const parts = path.split('/').filter(Boolean)
    let current: Node | null = path.startsWith('/') ? this.getRoot() : this

    for (const part of parts) {
      if (!current) return null
      if (part === '.') continue
      if (part === '..') {
        current = current.getParent()
      } else {
        const found: Node | undefined = current.getChildren().find((c: Node) => c.name === part)
        current = found || null
      }
    }
    return current
  }

  get_node(path: string): Node | null {
    return this.getNode(path)
  }

  getRoot(): Node {
    let curr: Node = this
    while (curr.getParent()) {
      curr = curr.getParent()!
    }
    return curr
  }

  getPath(): string {
    const segments: string[] = []
    let curr: Node | null = this
    while (curr && curr.getParent()) {
      segments.unshift(curr.name)
      curr = curr.getParent()
    }
    return segments.length === 0 ? '/' : '/' + segments.join('/')
  }

  // ==================== GROUPS ====================

  addToGroup(group: string): void {
    const trimmed = group.trim()
    if (!trimmed) return
    this._groups.add(trimmed)
    if (this.sceneTree && typeof this.sceneTree._registerGroupNode === 'function') {
      this.sceneTree._registerGroupNode(trimmed, this)
    }
  }

  add_to_group(group: string): void {
    this.addToGroup(group)
  }

  removeFromGroup(group: string): void {
    this._groups.delete(group)
    if (this.sceneTree && typeof this.sceneTree._unregisterGroupNode === 'function') {
      this.sceneTree._unregisterGroupNode(group, this)
    }
  }

  remove_from_group(group: string): void {
    this.removeFromGroup(group)
  }

  isInGroup(group: string): boolean {
    return this._groups.has(group)
  }

  is_in_group(group: string): boolean {
    return this.isInGroup(group)
  }

  getGroups(): string[] {
    return Array.from(this._groups)
  }

  // ==================== SIGNALS ====================

  registerSignal(signalName: string): Signal {
    let sig = this._signals.get(signalName)
    if (!sig) {
      sig = new Signal(signalName, this)
      this._signals.set(signalName, sig)
    }
    return sig
  }

  getSignal(signalName: string): Signal | undefined {
    return this._signals.get(signalName)
  }

  hasSignal(signalName: string): boolean {
    return this._signals.has(signalName)
  }

  connect(signalName: string, targetOrFn: SignalCallback | any, method?: string, flags?: number) {
    let sig = this._signals.get(signalName)
    if (!sig) {
      sig = this.registerSignal(signalName)
    }
    return sig.connect(targetOrFn, method, flags)
  }

  disconnect(signalName: string, targetOrFn: SignalCallback | any, method?: string): boolean {
    const sig = this._signals.get(signalName)
    if (!sig) return false
    return sig.disconnect(targetOrFn, method)
  }

  emitSignal(signalName: string, ...args: any[]): void {
    const sig = this._signals.get(signalName)
    if (sig) {
      sig.emit(...args)
    }
  }

  emit_signal(signalName: string, ...args: any[]): void {
    this.emitSignal(signalName, ...args)
  }

  // ==================== LIFECYCLE ====================

  _enterTree(): void {}
  _ready(): void {}
  _process(_delta: number): void {}
  _physicsProcess(_delta: number): void {}
  _exitTree(): void {}

  _propagateEnterTree(tree: any): void {
    this.sceneTree = tree
    this.isInsideTree = true

    for (const group of this._groups) {
      if (tree && typeof tree._registerGroupNode === 'function') {
        tree._registerGroupNode(group, this)
      }
    }

    this._enterTree()
    this._ready()

    for (const child of this._children) {
      child._propagateEnterTree(tree)
    }
  }

  _propagateExitTree(): void {
    for (const child of this._children) {
      child._propagateExitTree()
    }

    for (const group of this._groups) {
      if (this.sceneTree && typeof this.sceneTree._unregisterGroupNode === 'function') {
        this.sceneTree._unregisterGroupNode(group, this)
      }
    }

    this._exitTree()
    this.isInsideTree = false
    this.sceneTree = null
  }

  _propagateProcess(delta: number): void {
    if (this.isQueuedForDeletion) return
    this._process(delta)
    for (const child of [...this._children]) {
      child._propagateProcess(delta)
    }
  }

  _propagatePhysicsProcess(delta: number): void {
    if (this.isQueuedForDeletion) return
    this._physicsProcess(delta)
    for (const child of [...this._children]) {
      child._propagatePhysicsProcess(delta)
    }
  }

  protected _notifyTransformDirty(): void {}

  queueFree(): void {
    this.isQueuedForDeletion = true
    if (this._parent) {
      this._parent.removeChild(this)
    }
  }

  queue_free(): void {
    this.queueFree()
  }
}

// ==================== NODE 2D ====================

export class Node2D extends Node {
  public position = { x: 0, y: 0 }
  public rotation: number = 0 // radians
  public scale = { x: 1, y: 1 }
  public zIndex: number = 0
  public visible: boolean = true
  public modulate: string = '#ffffff'

  constructor(name: string = 'Node2D', id?: string) {
    super(name, id)
  }

  getGlobalPosition(): { x: number; y: number } {
    let curr: Node | null = this
    let x = 0
    let y = 0
    while (curr) {
      if (curr instanceof Node2D) {
        x += curr.position.x
        y += curr.position.y
      }
      curr = curr.getParent()
    }
    return { x, y }
  }

  setGlobalPosition(pos: { x: number; y: number }): void {
    const parent = this.getParent()
    if (parent instanceof Node2D) {
      const parentGlobal = parent.getGlobalPosition()
      this.position.x = pos.x - parentGlobal.x
      this.position.y = pos.y - parentGlobal.y
    } else {
      this.position.x = pos.x
      this.position.y = pos.y
    }
  }
}

// ==================== NODE 3D ====================

export class Node3D extends Node {
  public position = { x: 0, y: 0, z: 0 }
  public rotation = { x: 0, y: 0, z: 0 } // degrees
  public scale = { x: 1, y: 1, z: 1 }
  public visible: boolean = true

  constructor(name: string = 'Node3D', id?: string) {
    super(name, id)
  }

  getGlobalPosition(): { x: number; y: number; z: number } {
    let curr: Node | null = this
    let x = 0
    let y = 0
    let z = 0
    while (curr) {
      if (curr instanceof Node3D) {
        x += curr.position.x
        y += curr.position.y
        z += curr.position.z
      }
      curr = curr.getParent()
    }
    return { x, y, z }
  }

  setGlobalPosition(pos: { x: number; y: number; z: number }): void {
    const parent = this.getParent()
    if (parent instanceof Node3D) {
      const parentGlobal = parent.getGlobalPosition()
      this.position.x = pos.x - parentGlobal.x
      this.position.y = pos.y - parentGlobal.y
      this.position.z = pos.z - parentGlobal.z
    } else {
      this.position.x = pos.x
      this.position.y = pos.y
      this.position.z = pos.z
    }
  }
}

// ==================== CONTROL (UI) ====================

export class Control extends Node {
  public position = { x: 0, y: 0 }
  public size = { x: 100, y: 40 }
  public minSize = { x: 0, y: 0 }
  public anchor = { left: 0, top: 0, right: 0, bottom: 0 }
  public visible: boolean = true

  constructor(name: string = 'Control', id?: string) {
    super(name, id)
  }
}
