/**
 * Linden Interchange Format (LIF) - Engine-neutral intermediate representation
 */

export type EngineId = 'linden' | 'godot' | 'unity'

export interface LIFEngineInfo {
  engine: EngineId
  version: string
}

export interface LIFInputAction {
  name: string
  bindings: Array<{
    type: 'key' | 'mouse' | 'gamepad'
    code: string | number
  }>
}

export interface LIFSettings {
  mainScene?: string
  windowWidth?: number
  windowHeight?: number
  gravity?: [number, number, number]
  inputActions?: LIFInputAction[]
  custom?: Record<string, any>
}

export interface LIFAsset {
  id: string
  path: string // relative to project root
  type: 'texture' | 'model' | 'audio' | 'script' | 'scene' | 'material' | 'other'
  hash?: string
  metadata?: Record<string, any>
}

export interface LIFResource {
  id: string
  path: string
  type: string
  properties: Record<string, any>
}

export interface LIFComponent {
  type: string
  properties: Record<string, any>
}

export interface LIFSignal {
  name: string
  targetNodeId: string
  method: string
  flags?: number
}

export interface LIFNode {
  id: string
  name: string
  type: string
  parent?: string | null
  children: LIFNode[]
  transform2D?: {
    position: [number, number]
    rotation: number
    scale: [number, number]
  }
  transform3D?: {
    position: [number, number, number]
    rotation: [number, number, number, number] // quaternion [x, y, z, w]
    scale: [number, number, number]
  }
  components: LIFComponent[]
  groups: string[]
  signals: LIFSignal[]
  scriptId?: string
  instanceSource?: string
  overrides?: Record<string, any>
  extras?: Record<string, any>
}

export interface LIFScene {
  id: string
  path: string
  name: string
  root: LIFNode
}

export interface LIFScript {
  id: string
  path: string
  className: string
  language: 'gdscript' | 'csharp' | 'typescript'
  sourceCode: string
  transpiledTs?: string
  transpiledTarget?: string
}

export interface LIFProject {
  lifVersion: string
  name: string
  sourceEngine: LIFEngineInfo
  settings: LIFSettings
  assets: LIFAsset[]
  resources: LIFResource[]
  scenes: LIFScene[]
  scripts: LIFScript[]
}
