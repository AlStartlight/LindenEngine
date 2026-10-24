/**
 * Shared types for Godot Bridge Project Import & Sync
 */

export interface GodotProjectInfo {
  dir: string
  name: string
  godotVersion: string
  configVersion: number
  mainScene: string | null
  autoloads: { name: string; path: string }[]
  viewport: { width: number; height: number }
  inputActions: string[]
  counts: { scenes: number; scripts: number; resources: number; assets: number }
  addons: string[]
}

export type GodotValue =
  | null
  | boolean
  | number
  | string
  | { $t: 'Vector2' | 'Vector3' | 'Color' | 'Quaternion'; v: number[] }
  | { $t: 'Transform3D'; basis: number[]; origin: number[] }
  | { $t: 'Transform2D'; v: number[] }
  | { $t: 'Resource'; path?: string; type: string; props?: Record<string, GodotValue> }
  | { $t: 'NodePath'; v: string }
  | GodotValue[]
  | { [k: string]: GodotValue }

export interface GodotNodeIR {
  path: string
  name: string
  type: string
  instance?: string
  script?: string
  groups: string[]
  props: Record<string, GodotValue>
}

export interface GodotConnectionIR {
  from: string
  signal: string
  to: string
  method: string
  flags: number
}

export interface GodotSceneIR {
  path: string
  inheritsFrom?: string | null
  nodes: GodotNodeIR[]
  connections: GodotConnectionIR[]
  source?: 'godot-headless' | 'ts-parser'
}

export interface ImportProjectOptions {
  jobId: string
  dir: string
  dest: string
  name: string
  transpileScripts?: boolean
  copyAddons?: boolean
}

export interface ImportProgressEvent {
  jobId: string
  stage: 'copy' | 'import' | 'extract' | 'mapping' | 'write' | 'done' | 'error'
  done: number
  total: number
  message: string
}

export interface ImportSummary {
  projectName: string
  godotVersion: string
  sourcePath: string
  destPath: string
  totalScenes: number
  okScenes: number
  failedScenes: { path: string; error: string }[]
  totalNodes: number
  nativeNodes: number
  passthroughNodes: number
  skippedNodes: number
  errorNodes: number
  nativeScore: number // native / total (0-100)
  preservedScore: number // (native + passthrough) / total (0-100)
  nodeTypeCounts: Record<string, { total: number; native: number; passthrough: number }>
  assetsCopied: number
  scriptsCopied: number
}

export interface GodotExecResolution {
  ok: boolean
  path?: string
  version?: string
  reason?: string
}
