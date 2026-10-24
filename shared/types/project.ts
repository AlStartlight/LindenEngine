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
  godotExecutable?: string
  customFlags?: string[]
}

export interface RecentProject {
  name: string
  path: string
  lastOpened: number
  exists?: boolean
}

export interface LindenProjectConfig {
  name: string
  version: string
  tags?: string[]
  layers?: string[]
  collisionMatrix?: boolean[][]
  input?: {
    actions?: any[]
  }
  services?: any[]
  scenesInBuild?: string[]
  exportPresets?: ExportPreset[]
}
