/**
 * GodotBridge - Main Entry Point for Linden-to-Godot Synchronization
 */

function getNodeModule<T = any>(moduleName: string): T | null {
  if (typeof window !== 'undefined') {
    return null
  }
  try {
    if (typeof process !== 'undefined' && typeof (process as any)?.getBuiltinModule === 'function') {
      return (process as any).getBuiltinModule(moduleName)
    }
  } catch {
    // Ignore error
  }
  try {
    const req = (globalThis as any).require || (typeof module !== 'undefined' ? (module as any).require : undefined)
    if (typeof req === 'function') {
      return req(moduleName)
    }
  } catch {
    // Ignore error
  }
  return null
}

const nodeFs = getNodeModule<any>('node:fs')
const nodePath = getNodeModule<any>('node:path')

function joinPath(...parts: string[]): string {
  if (nodePath?.join) {
    return nodePath.join(...parts)
  }
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}

function dirName(p: string): string {
  if (nodePath?.dirname) {
    return nodePath.dirname(p)
  }
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx > 0 ? p.slice(0, idx) : '.'
}

function baseName(p: string): string {
  if (nodePath?.basename) {
    return nodePath.basename(p)
  }
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(idx + 1) : p
}

import { World } from '../ecs/World'
import { TscnParser } from './tscn/TscnParser'
import { TscnWriter } from './tscn/TscnWriter'
import { ComponentMap } from './mapping/ComponentMap'
import { SyncServer } from './sync/SyncServer'
import { ConflictResolver, ConflictStrategy } from './sync/ConflictResolver'
import { DiffEngine, EntitySnapshot, SyncMessage } from './sync/DiffEngine'
import { GodotBuildRunner, BuildResult } from './build/GodotBuildRunner'
import { CompatReport } from './report/CompatReport'

export interface GodotBridgeConfig {
  godotProjectPath: string
  godotExecutable?: string
  syncPort?: number
  onConflict?: ConflictStrategy
}

export class GodotBridge {
  private config: GodotBridgeConfig
  private parser: TscnParser = new TscnParser()
  private writer: TscnWriter = new TscnWriter()
  private syncServer: SyncServer | null = null
  private conflictResolver: ConflictResolver
  private diffEngine: DiffEngine = new DiffEngine()
  private currentWorld: World | null = null

  constructor(public engine: any = null, config: Partial<GodotBridgeConfig> = {}) {
    this.config = {
      godotProjectPath: config.godotProjectPath || (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : ''),
      godotExecutable: config.godotExecutable,
      syncPort: config.syncPort ?? 6007,
      onConflict: config.onConflict ?? 'ask',
    }
    this.conflictResolver = new ConflictResolver(this.config.onConflict)
  }

  getConfig(): GodotBridgeConfig {
    return { ...this.config }
  }

  setConfig(newConfig: Partial<GodotBridgeConfig>): void {
    this.config = { ...this.config, ...newConfig }
    if (newConfig.onConflict) {
      this.conflictResolver.strategy = newConfig.onConflict
    }
  }

  /**
   * Export Linden World to .tscn and generate project.godot if missing
   */
  async exportScene(world: World, outPath: string): Promise<CompatReport> {
    const report = new CompatReport()
    this.currentWorld = world

    // 1. Ensure project.godot exists in target Godot project directory
    this.ensureProjectGodot()

    // 2. Backup existing file if present (NFR-01)
    if (nodeFs?.existsSync?.(outPath)) {
      this.backupFile(outPath)
    }

    // 3. Export World to TscnDocument
    const doc = ComponentMap.exportWorld(world, report)

    // 4. Serialize to deterministic text
    const text = this.writer.write(doc)

    // 5. Ensure directory exists and write
    if (nodeFs) {
      const dir = dirName(outPath)
      if (!nodeFs.existsSync(dir)) {
        nodeFs.mkdirSync(dir, { recursive: true })
      }
      nodeFs.writeFileSync(outPath, text, 'utf-8')
    } else if (typeof window !== 'undefined' && (window as any).electronAPI?.saveFile) {
      await (window as any).electronAPI.saveFile({ path: outPath, content: text })
    }

    return report
  }

  /**
   * Import Godot .tscn file into Linden World
   */
  async importScene(tscnPath: string): Promise<{ world: World; report: CompatReport }> {
    const report = new CompatReport()

    let text = ''
    if (nodeFs) {
      if (!nodeFs.existsSync(tscnPath)) {
        throw new Error(`Scene file not found: ${tscnPath}`)
      }
      text = nodeFs.readFileSync(tscnPath, 'utf-8')
    } else if (typeof window !== 'undefined' && (window as any).electronAPI?.loadFile) {
      const res = await (window as any).electronAPI.loadFile(tscnPath)
      text = res?.data || ''
    } else {
      throw new Error(`Filesystem access is not available in browser mode`)
    }

    const doc = this.parser.parse(text)
    const world = ComponentMap.importWorld(doc, report)
    this.currentWorld = world

    return { world, report }
  }

  /**
   * Start Live Sync WebSocket Server
   */
  async startLiveSync(world?: World): Promise<void> {
    if (world) this.currentWorld = world

    if (this.syncServer && this.syncServer.isRunning) {
      return
    }

    this.syncServer = new SyncServer({
      port: this.config.syncPort,
      resolver: this.conflictResolver,
    })

    this.syncServer.onMessageReceived = (msg: SyncMessage) => {
      this.handleRemoteMessage(msg)
    }

    await this.syncServer.start()
  }

  /**
   * Stop Live Sync Server
   */
  stopLiveSync(): void {
    if (this.syncServer) {
      this.syncServer.stop()
      this.syncServer = null
    }
  }

  get isLiveSyncActive(): boolean {
    return this.syncServer?.isRunning ?? false
  }

  get syncToken(): string | undefined {
    return this.syncServer?.token
  }

  /**
   * Run Godot headless build export
   */
  async build(
    preset: string,
    outPath: string,
    onLog?: (line: string) => void
  ): Promise<BuildResult> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.buildGodot) {
      return (window as any).electronAPI.buildGodot({
        preset,
        projectPath: this.config.godotProjectPath,
        outputPath: outPath,
        customExecutable: this.config.godotExecutable,
      })
    }
    const runner = new GodotBuildRunner(this.config.godotProjectPath, this.config.godotExecutable)
    return runner.build(preset, outPath, onLog)
  }

  /**
   * Handle incoming change from Godot editor
   */
  private handleRemoteMessage(msg: SyncMessage): void {
    if (!this.currentWorld || !msg.linden_id) return

    const entity = this.currentWorld.getEntity(msg.linden_id)
    if (!entity) return

    if (msg.type === 'property_changed' && msg.path && msg.value !== undefined) {
      if (msg.path.startsWith('transform.')) {
        const t = entity.getTransform()
        const prop = msg.path.split('.')[1]
        if (prop === 'position') t.setPosition(msg.value.x, msg.value.y, msg.value.z)
        else if (prop === 'rotation') t.setRotation(msg.value.x, msg.value.y, msg.value.z)
        else if (prop === 'scale') t.setScale(msg.value.x, msg.value.y, msg.value.z)
      }
    }
  }

  private ensureProjectGodot(): void {
    if (!nodeFs) return
    const projFile = joinPath(this.config.godotProjectPath, 'project.godot')
    if (!nodeFs.existsSync(projFile)) {
      const projDir = this.config.godotProjectPath
      if (!nodeFs.existsSync(projDir)) {
        nodeFs.mkdirSync(projDir, { recursive: true })
      }
      const content = `; Engine configuration file.
; It's best edited using the editor UI and not directly,
; since the parameters that go here are not all obvious.
;
; Format:
;   [section] ; section goes between []
;   param=value ; assign values to parameters

config_version=5

[application]

config/name="LindenProject"
config/features=PackedStringArray("4.3", "Forward Plus")
`
      nodeFs.writeFileSync(projFile, content, 'utf-8')
    }
  }

  private backupFile(filePath: string): void {
    if (!nodeFs) return
    try {
      const backupDir = joinPath(this.config.godotProjectPath, '.linden', 'backup')
      if (!nodeFs.existsSync(backupDir)) {
        nodeFs.mkdirSync(backupDir, { recursive: true })
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const base = baseName(filePath)
      const backupPath = joinPath(backupDir, `${base}.${timestamp}.bak`)
      nodeFs.copyFileSync(filePath, backupPath)
    } catch (e) {
      console.warn('Failed to create backup:', e)
    }
  }
}
