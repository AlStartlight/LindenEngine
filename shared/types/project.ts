export type ExportPlatform = 'windows' | 'macos' | 'linux' | 'web' | 'android' | 'ios'
export type ExportBackend = 'linden' | 'godot'
export type ExportMode = 'debug' | 'release'

export interface ExportPreset {
  id: string
  name: string
  platform: ExportPlatform
  backend: ExportBackend
  arch: string[]
  output: string
  mode: ExportMode
  appName?: string
  version?: string
  packageIdentifier?: string
  iconPath?: string
  scenes?: string[]
  webgpuRequired?: boolean
  canvasMode?: 'fixed' | 'responsive' | 'fullscreen'
  basePath?: string
  compress?: boolean
  includeSourceMap?: boolean
  loadingColor?: string
  loadingTitle?: string
  zipOutput?: boolean
  godotExecutable?: string
  customFlags?: string[]
}

export interface RecentProject {
  name: string
  path: string
  lastOpened: number
  exists?: boolean
}

export interface AgentProjectSettings {
  defaultModel?: string
  mode?: 'review' | 'auto'
  promptTemplates?: string[]
}

/** 'scene' runs .lscene + scripts in LindenPlayer; 'html' runs the project's own index.html */
export type ProjectRuntime = 'scene' | 'html'

export interface HtmlGameConfig {
  /** Project-relative entry page, e.g. 'web/index.html' */
  entry: string
  resolution?: { mode: 'responsive' | 'fixed'; width?: number; height?: number }
  /** Extra origins the game may fetch from (CSP connect-src) */
  allowNetwork?: string[]
  /** Inject the linden bridge (pause, console, stats, input). Default true */
  injectBridge?: boolean
}

export interface LindenProjectConfig {
  name: string
  version: string
  runtime?: ProjectRuntime
  /** 'webgpu' uses three's WebGPURenderer (falls back to WebGL2); default 'webgl' */
  renderer?: 'webgl' | 'webgpu'
  html?: HtmlGameConfig
  play?: { allowNetwork?: string[] }
  tags?: string[]
  layers?: string[]
  collisionMatrix?: boolean[][]
  input?: {
    /** InputActionDef[] (engine/input/InputActions.ts); older shapes are migrated on load */
    actions?: any[]
    /** TouchLayout: on-screen joystick and action buttons for mobile */
    touch?: any
  }
  services?: any[]
  scenesInBuild?: string[]
  exportPresets?: ExportPreset[]
  agent?: AgentProjectSettings
}
