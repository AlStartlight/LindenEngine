import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LindenMcpServer, SUPPORTED_PROTOCOL_VERSIONS, type LindenMcpClient } from './LindenMcpServer'
import { LINDEN_AGENT_ROLES, LINDEN_MASTER_ROLE } from './lindenRoles'
import type { LindenBridgeStatus, LindenCallContext } from './lindenBridgeTypes'
import type { AgentDiffItem } from '../../shared/agentTypes'
import type { ToolPermissionRequest, ToolResult } from './lindenTools'

export interface AgentBridgeHandlers {
  onDiff?: (diff: AgentDiffItem, ctx: LindenCallContext) => void
  onToolCall?: (name: string, args: unknown, result: ToolResult, ctx: LindenCallContext) => void
  requestPermission?: (req: ToolPermissionRequest, ctx: LindenCallContext) => Promise<boolean>
}

export interface AgentBridgeManifestSummary {
  manifestPath: string
  endpoint: string
  projectPath: string
  roles: { id: string; name: string; tools: number }[]
}

const MANIFEST_NAME = 'agent-bridge.json'
const LAST_POINTER_DIR = '.linden/agent-bridge'

const bridgeHome = () => process.env.LINDEN_AGENT_BRIDGE_HOME || os.homedir()

/**
 * Owns the `linden` MCP server independently of any agent runtime and publishes the
 * endpoint manifest external agents discover.
 *
 * SPEC-DSH-MCP-Agent-Integration P0: the server used to live inside
 * `AgentHost.startServer()` (OpenCode-only, random token, no discovery). Now:
 *  - one server per app, started when a project opens, surviving the agent panel;
 *  - a master token for OpenCode plus one scoped token per agent role;
 *  - `<project>/.linden/agent-bridge.json` (0600) + `~/.linden/agent-bridge/last.json`;
 *  - endpoint and tokens stay stable across project switches, so a connected agent
 *    only has to re-read the manifest when the app restarts.
 */
export class AgentBridgeService {
  private static instance: AgentBridgeService | null = null
  private server: LindenMcpServer | null = null
  private projectPath: string | null = null
  private manifestPath: string | null = null
  private manifestIssuedAt: string | null = null
  private roleTokens = new Map<string, string>()
  private masterToken: string | null = null
  private handlers: AgentBridgeHandlers = {}

  static getInstance(): AgentBridgeService {
    if (!AgentBridgeService.instance) AgentBridgeService.instance = new AgentBridgeService()
    return AgentBridgeService.instance
  }

  /** MCP server for callers that register it themselves (AgentHost/OpenCode) */
  get mcpServer(): LindenMcpServer | null {
    return this.server
  }

  /** Full-access bearer token (OpenCode) */
  get token(): string | null {
    return this.masterToken
  }

  get endpoint(): string | null {
    return this.server?.url ?? null
  }

  get currentProject(): string | null {
    return this.projectPath
  }

  setHandlers(handlers: AgentBridgeHandlers): void {
    this.handlers = { ...this.handlers, ...handlers }
  }

  /**
   * Start (or move) the bridge for a project. Idempotent: a second open project only
   * rewrites the manifest and points the server at the new folder.
   */
  async start(projectPath: string): Promise<LindenBridgeStatus> {
    const resolved = path.resolve(projectPath)
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Folder proyek tidak ditemukan: ${resolved}`)
    }

    if (this.server) {
      if (this.projectPath !== resolved) {
        // Drop the previous project's manifest: its endpoint now serves another folder
        if (this.manifestPath) {
          try {
            fs.rmSync(this.manifestPath, { force: true })
          } catch {
            // Already gone
          }
        }
        this.server.setProjectPath(resolved)
        this.projectPath = resolved
      }
      this.writeManifest()
      return this.getStatus()!
    }

    this.masterToken = crypto.randomBytes(24).toString('hex')
    this.roleTokens = new Map(LINDEN_AGENT_ROLES.map((role) => [role.id, crypto.randomBytes(24).toString('hex')]))

    const clients: LindenMcpClient[] = [
      { id: 'opencode', role: LINDEN_MASTER_ROLE, token: this.masterToken, scope: null },
      ...LINDEN_AGENT_ROLES.map((role) => ({
        id: role.id,
        role: role.id,
        token: this.roleTokens.get(role.id)!,
        scope: role.tools,
      })),
    ]

    this.server = new LindenMcpServer({
      projectPath: resolved,
      clients,
      masterToken: this.masterToken,
      onDiff: (diff, ctx) => this.handlers.onDiff?.(diff, ctx),
      onToolCall: (name, args, result, ctx) => this.handlers.onToolCall?.(name, args, result, ctx),
      requestPermission: (req, ctx) => this.handlers.requestPermission?.(req, ctx) ?? Promise.resolve(false),
    })
    await this.server.start()
    this.projectPath = resolved
    this.manifestIssuedAt = new Date().toISOString()
    this.writeManifest()
    console.info(`[AgentBridge] MCP siap di ${this.server.url} (${LINDEN_AGENT_ROLES.length} role)`)
    return this.getStatus()!
  }

  /** Stop the server and invalidate the published endpoint */
  stop(): void {
    this.server?.close()
    this.server = null
    this.masterToken = null
    this.roleTokens.clear()
    this.handlers = {}
    this.removePublishedManifests()
    this.projectPath = null
    this.manifestPath = null
    this.manifestIssuedAt = null
  }

  /** Rotate port and tokens (used by the editor "restart bridge" control and tests) */
  async restart(): Promise<LindenBridgeStatus> {
    const project = this.projectPath
    if (!project) throw new Error('Agent bridge belum berjalan untuk proyek mana pun')
    this.stop()
    return this.start(project)
  }

  getStatus(): LindenBridgeStatus | null {
    if (!this.server) return null
    return { ...this.server.getStatus(), manifestPath: this.manifestPath }
  }

  getManifestSummary(): AgentBridgeManifestSummary | null {
    if (!this.server || !this.manifestPath || !this.projectPath) return null
    return {
      manifestPath: this.manifestPath,
      endpoint: this.server.url,
      projectPath: this.projectPath,
      roles: LINDEN_AGENT_ROLES.map((role) => ({ id: role.id, name: role.name, tools: role.tools.length })),
    }
  }

  /** Token for a role; exposed for tests and diagnostics, never for the renderer */
  roleToken(roleId: string): string | null {
    return this.roleTokens.get(roleId) ?? null
  }

  private projectName(): string | undefined {
    if (!this.projectPath) return undefined
    try {
      const config = JSON.parse(fs.readFileSync(path.join(this.projectPath, 'project.linden.json'), 'utf8'))
      return typeof config?.name === 'string' ? config.name : undefined
    } catch {
      return undefined
    }
  }

  private manifest(): Record<string, unknown> {
    const tokens: Record<string, string> = { master: this.masterToken ?? '' }
    for (const [role, token] of this.roleTokens) tokens[role] = token
    const scopes: Record<string, string[]> = {}
    for (const role of LINDEN_AGENT_ROLES) scopes[role.id] = [...role.tools]
    return {
      format: 'linden-agent-bridge',
      version: 1,
      projectPath: this.projectPath ?? undefined,
      projectName: this.projectName(),
      endpoint: this.server?.url ?? undefined,
      transport: 'streamable-http',
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0],
      server: { name: 'linden', version: '0.3.0' },
      issuedAt: this.manifestIssuedAt ?? new Date().toISOString(),
      expiresAt: null,
      tokens,
      scopes,
      limits: { maxBodyBytes: 10 * 1024 * 1024, toolTimeoutMs: 120_000, lockTtlMs: 120_000 },
    }
  }

  private writeManifest(): void {
    if (!this.server || !this.projectPath) return
    const content = `${JSON.stringify(this.manifest(), null, 2)}\n`
    const dir = path.join(this.projectPath, '.linden')
    const file = path.join(dir, MANIFEST_NAME)
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileAtomic(file, content)
      this.manifestPath = file
      // Global pointer for agents that do not know the project folder yet
      writeFileAtomic(path.join(bridgeHome(), LAST_POINTER_DIR, 'last.json'), content)
    } catch (err: any) {
      console.warn('[AgentBridge] Gagal menulis manifest:', err?.message ?? err)
    }
  }

  private removePublishedManifests(): void {
    const targets = [
      this.manifestPath,
      this.projectPath ? path.join(this.projectPath, '.linden', MANIFEST_NAME) : null,
      path.join(bridgeHome(), LAST_POINTER_DIR, 'last.json'),
    ].filter((f): f is string => !!f)
    for (const file of targets) {
      try {
        fs.rmSync(file, { force: true })
      } catch {
        // Nothing to clean up
      }
    }
  }
}

/** Write a 0600 file atomically (tmp + fsync-less rename), never leaving a partial manifest */
function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode: 0o600 })
  try {
    fs.chmodSync(tmp, 0o600)
  } catch {
    // Windows: chmod is a no-op; the user-profile ACL is the control there
  }
  fs.renameSync(tmp, file)
}
