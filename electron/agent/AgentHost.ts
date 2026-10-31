import { spawn, ChildProcess } from 'node:child_process'
import { resolveOpencode, needsShell, type OpencodeResolution } from './opencodeBinary'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { OpenCode, type OpenCodeClient } from '@opencode/client'
import {
  AgentStatus,
  AgentProviderInfo,
  AgentSessionInfo,
  AgentDiffItem,
  AgentPermissionRequest,
  AgentEvent,
  AgentTurn,
} from '../../shared/agentTypes'
import { LindenMcpServer } from './LindenMcpServer'
import { TurnTracker, turnsFromMessages } from './TurnTracker'
import { resolveAppResource } from '../resourcePaths'
import { PROMPT_TEMPLATES } from './promptTemplates'
import { syncProjectAgentsMd } from './projectAgentFiles'

/** Oldest OpenCode CLI with the v2 HTTP API (/api/*) this host talks to. */
export const OPENCODE_MIN_VERSION = '2.0.0'
const INSTALL_HINT = 'Instal OpenCode terbaru: npm i -g @opencode/cli'
const SERVER_START_TIMEOUT_MS = 20000
const MESSAGE_PAGE_SIZE = 200

/** System temp folders the agent may never touch (macOS resolves /tmp to /private/tmp) */
const TEMP_DIRS = [
  ...new Set(
    ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders', os.tmpdir()].map((d) =>
      d.replace(/[\\/]+$/, '')
    )
  ),
]

/**
 * Deny rules for the temp folders: as a path (read, edit, glob, ...) and inside a shell
 * command ("cd /tmp", "> /tmp/x", "--out=/tmp/x", quoted paths).
 */
const TEMP_DENY_RULES = TEMP_DIRS.flatMap((dir) =>
  [dir, `${dir}/*`, `* ${dir}*`, `*=${dir}*`, `*>${dir}*`, `*"${dir}*`, `*'${dir}*`].map((resource) => ({
    action: '*',
    resource,
    effect: 'deny' as const,
  }))
)

/**
 * Permission rules for Linden sessions (last match wins). Linden tools and reads run
 * freely; shell commands, web access and raw file edits need the user's approval.
 * The agent works only inside the project folder: system temp folders (/tmp, ...) are
 * denied for every action, and OpenCode's external_directory check (reads, edits, globs,
 * shell workdir outside the session folder) is always denied.
 */
export const SESSION_PERMISSIONS = [
  { action: '*', resource: '*', effect: 'ask' as const },
  { action: 'read', resource: '*', effect: 'allow' as const },
  { action: 'glob', resource: '*', effect: 'allow' as const },
  { action: 'grep', resource: '*', effect: 'allow' as const },
  { action: 'list', resource: '*', effect: 'allow' as const },
  { action: 'read', resource: '*.env', effect: 'ask' as const },
  { action: 'read', resource: '*.env.*', effect: 'ask' as const },
  { action: 'question', resource: '*', effect: 'allow' as const },
  { action: 'mcp', resource: 'linden*', effect: 'allow' as const },
  { action: 'linden*', resource: '*', effect: 'allow' as const },
  ...TEMP_DENY_RULES,
  { action: 'external_directory', resource: '*', effect: 'deny' as const },
]

const samePath = (a: string, b: string) => path.resolve(a) === path.resolve(b)

/** Real path (symlinks resolved), or the plain resolved path when it does not exist */
const realPath = (p: string) => {
  try {
    return fs.realpathSync.native(p)
  } catch (_) {
    return path.resolve(p)
  }
}

/**
 * Reason the folder cannot host the agent, or null for a Linden project folder. With a
 * projects root ("Linden Projects"), the folder must also lie inside that root.
 */
export function projectFolderError(projectPath: string, projectsRoot?: string | null): string | null {
  if (!projectPath || !path.isAbsolute(projectPath)) return `Path proyek harus absolut: "${projectPath}"`
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) return `Folder proyek tidak ditemukan: ${projectPath}`
  if (projectsRoot && !realPath(projectPath).startsWith(realPath(projectsRoot) + path.sep)) {
    return `Agent hanya berjalan di proyek dalam folder "${projectsRoot}": ${projectPath}`
  }
  if (!fs.existsSync(path.join(projectPath, 'project.linden.json'))) {
    return `Bukan folder proyek Linden (project.linden.json tidak ada): ${projectPath}`
  }
  return null
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

export function parseOpencodeVersion(output: string): string | null {
  const m = output.match(/(\d+\.\d+\.\d+)/)
  return m ? m[1] : null
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Hosts a headless OpenCode v2 server (`opencode serve`) for the open project and
 * bridges it to the renderer: Linden tools via a local MCP server, session events via
 * the /api/event stream, and permission prompts via the editor's dialog.
 */
export class AgentHost {
  private static instance: AgentHost | null = null
  private projectPath: string | null = null
  private projectsRoot: string | null = null
  private opencodeProcess: ChildProcess | null = null
  private serverUrl: string | null = null
  private client: OpenCodeClient | null = null
  private mcp: LindenMcpServer | null = null
  private eventAbort: AbortController | null = null
  private version: string | null = null
  private lastError: string | null = null
  private activeSessionId: string | null = null
  private activeModel: string | null = null
  private activeProvider: string | null = null

  private pendingPermissions = new Map<string, AgentPermissionRequest>()
  private proposedDiffs = new Map<string, AgentDiffItem>()
  private tracker = new TurnTracker((ev) => this.emitEvent(ev))
  /** Sessions that already got this app version's Linden instructions */
  private instructedSessions = new Set<string>()
  private sendEventToRenderer?: (event: AgentEvent) => void

  private constructor() {}

  static getInstance(): AgentHost {
    if (!AgentHost.instance) {
      AgentHost.instance = new AgentHost()
    }
    return AgentHost.instance
  }

  /** Folder the agent's projects must live in ("Linden Projects"); null allows any project */
  setProjectsRoot(root: string | null): void {
    this.projectsRoot = root ? path.resolve(root) : null
  }

  setEventSender(sender: (event: AgentEvent) => void): void {
    this.sendEventToRenderer = sender
  }

  emitEvent(event: AgentEvent): void {
    this.sendEventToRenderer?.(event)
  }

  /** Resolved CLI + PATH for child processes (see opencodeBinary.ts) */
  private opencode: OpencodeResolution | null = null

  /**
   * Check that the opencode CLI can be found (also from a packaged app, whose PATH lacks
   * nvm/Homebrew/npm folders) and is new enough for the v2 API
   */
  async checkInstallation(): Promise<{ installed: boolean; version: string | null; error?: string }> {
    // A previous miss is looked up again: the user may have just installed it ("Coba lagi")
    const resolution = await resolveOpencode({ refresh: !this.opencode?.bin })
    this.opencode = resolution
    if (!resolution.bin) {
      const where =
        resolution.source === 'not-found' && process.env.OPENCODE_BIN
          ? `OPENCODE_BIN menunjuk ke file yang tidak ada (${process.env.OPENCODE_BIN})`
          : `dicari di ${resolution.searched.length} folder, termasuk PATH login shell, Homebrew, nvm, volta, bun dan npm global`
      return {
        installed: false,
        version: null,
        error: `OpenCode CLI tidak ditemukan (${where}). ${INSTALL_HINT}, lalu klik Coba lagi. Lokasi khusus: set OPENCODE_BIN=/path/ke/opencode.`,
      }
    }
    const bin = resolution.bin
    return new Promise((resolve) => {
      const child = spawn(bin, ['--version'], { env: this.childEnv(), shell: needsShell(bin) })
      let out = ''
      let err = ''

      child.stdout?.on('data', (d) => (out += d.toString()))
      child.stderr?.on('data', (d) => (err += d.toString()))

      child.on('close', (code) => {
        if (code !== 0) {
          resolve({ installed: false, version: null, error: err.trim() || `Exit code ${code}` })
          return
        }
        const version = parseOpencodeVersion(out)
        if (!version || compareVersions(version, OPENCODE_MIN_VERSION) < 0) {
          resolve({
            installed: false,
            version,
            error: `OpenCode ${version ?? out.trim()} terlalu lama (minimal ${OPENCODE_MIN_VERSION}). ${INSTALL_HINT}`,
          })
          return
        }
        resolve({ installed: true, version })
      })

      child.on('error', (e) => {
        resolve({ installed: false, version: null, error: `OpenCode CLI di ${bin} tidak bisa dijalankan (${e.message}). ${INSTALL_HINT}` })
      })
    })
  }

  /** Environment for opencode and the commands it runs: the full user PATH, not the GUI one */
  private childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { ...process.env, ...(this.opencode ? { PATH: this.opencode.envPath } : {}), ...extra }
  }

  /**
   * Start the OpenCode server for the project and connect the Linden MCP tools
   */
  async startServer(projectPath: string): Promise<AgentStatus> {
    if (this.client && this.projectPath === projectPath) {
      return this.getStatus()
    }

    await this.stopServer()
    // The agent only ever runs in the folder of an opened/created Linden project
    const folderError = projectFolderError(projectPath, this.projectsRoot)
    if (folderError) {
      this.projectPath = null
      this.lastError = folderError
      return this.getStatus()
    }
    projectPath = realPath(projectPath)
    this.projectPath = projectPath
    this.lastError = null
    this.initProjectAgentFiles(this.projectPath)

    const check = await this.checkInstallation()
    this.version = check.version
    if (!check.installed) {
      this.lastError = check.error || INSTALL_HINT
      return this.getStatus(false)
    }

    try {
      const port = await freePort()
      const password = crypto.randomBytes(24).toString('hex')
      const url = await this.spawnServer(projectPath, port, password)

      this.serverUrl = url
      this.client = OpenCode.make({
        baseUrl: url,
        headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
      })

      this.mcp = new LindenMcpServer({
        projectPath,
        onDiff: (diff) => {
          // MCP calls carry no session id; they come from the session that is running
          const sessionId = this.activeSessionId ?? undefined
          if (sessionId) {
            diff.toolPartId = this.tracker.runningToolPartId(sessionId)
            diff.turnId = this.tracker.currentTurnId(sessionId)
          }
          this.proposedDiffs.set(diff.id, diff)
          this.emitEvent({ type: 'diff_proposed', sessionId, data: diff })
        },
      })
      await this.mcp.start()
      await this.client.mcp.add({
        server: 'linden',
        location: { directory: projectPath },
        config: {
          type: 'remote',
          url: this.mcp.url,
          headers: { Authorization: `Bearer ${this.mcp.token}` },
          oauth: false,
        },
      })

      this.subscribeEvents()
      await this.loadDefaultModel()
    } catch (e: any) {
      this.lastError = e.message
      await this.stopServer()
      return this.getStatus(false)
    }

    const status = this.getStatus()
    this.emitEvent({ type: 'status_changed', data: status })
    return status
  }

  private spawnServer(projectPath: string, port: number, password: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Temp files of the server and its shell commands go into the project, not /tmp
      const tmpDir = path.join(projectPath, '.linden/agent/tmp')
      fs.mkdirSync(tmpDir, { recursive: true })
      const bin = this.opencode?.bin ?? 'opencode'
      const proc = spawn(bin, ['serve', '--hostname=127.0.0.1', `--port=${port}`], {
        cwd: projectPath,
        env: this.childEnv({ OPENCODE_SERVER_PASSWORD: password, TMPDIR: tmpDir, TMP: tmpDir, TEMP: tmpDir }),
        shell: needsShell(bin),
      })
      this.opencodeProcess = proc

      let output = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`Timeout menunggu server OpenCode (${SERVER_START_TIMEOUT_MS / 1000}s)`))
      }, SERVER_START_TIMEOUT_MS)

      proc.stdout?.on('data', (chunk) => {
        if (settled) return
        output += chunk.toString()
        const m = output.match(/listening on\s+(https?:\/\/\S+)/i)
        if (m) {
          settled = true
          clearTimeout(timer)
          resolve(m[1].replace(/\/$/, ''))
        }
      })
      proc.stderr?.on('data', (chunk) => {
        output += chunk.toString()
      })
      proc.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      })
      proc.on('exit', (code) => {
        if (this.opencodeProcess === proc) {
          this.opencodeProcess = null
          this.client = null
          this.serverUrl = null
          this.emitEvent({ type: 'status_changed', data: this.getStatus() })
        }
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`Server OpenCode berhenti (exit ${code}): ${output.trim().slice(-500)}`))
      })
    })
  }

  /**
   * Stop the OpenCode server and the MCP bridge
   */
  async stopServer(): Promise<void> {
    this.eventAbort?.abort()
    this.eventAbort = null
    if (this.client && this.activeSessionId) {
      await this.client.session.interrupt({ sessionID: this.activeSessionId }).catch(() => {})
    }
    this.mcp?.close()
    this.mcp = null
    this.tracker.dispose()
    this.tracker = new TurnTracker((ev) => this.emitEvent(ev))
    this.instructedSessions.clear()

    const proc = this.opencodeProcess
    this.opencodeProcess = null
    this.client = null
    this.serverUrl = null
    if (proc) {
      try {
        proc.kill('SIGTERM')
      } catch (_) {}
      this.emitEvent({ type: 'status_changed', data: this.getStatus() })
    }
  }

  getStatus(installed = true): AgentStatus {
    return {
      installed,
      version: this.version,
      running: Boolean(this.client),
      port: this.serverUrl ? Number(new URL(this.serverUrl).port) : null,
      serverUrl: this.serverUrl,
      activeSessionId: this.activeSessionId,
      activeModel: this.activeModel,
      activeProvider: this.activeProvider,
      error: this.lastError,
    }
  }

  private location() {
    return { directory: this.projectPath! }
  }

  private requireClient(): OpenCodeClient {
    if (!this.client || !this.projectPath) throw new Error('Server OpenCode belum berjalan')
    return this.client
  }

  private async loadDefaultModel(): Promise<void> {
    if (this.activeModel) return
    try {
      const res: any = await this.requireClient().model.default({ location: this.location() })
      const model = res?.data ?? res
      if (model?.id && model?.providerID) {
        this.activeModel = model.id
        this.activeProvider = model.providerID
      }
    } catch (_) {
      // No default model configured; the user picks one in the panel
    }
  }

  /**
   * Models OpenCode can use, grouped by provider. Provider settings (API keys) stay in main.
   */
  async getProviders(): Promise<AgentProviderInfo[]> {
    if (!this.client) return []
    try {
      const res: any = await this.client.model.list({ location: this.location() })
      const byProvider = new Map<string, AgentProviderInfo>()
      for (const m of res?.data ?? []) {
        let provider = byProvider.get(m.providerID)
        if (!provider) {
          provider = { id: m.providerID, name: m.providerID, configured: true, models: [] }
          byProvider.set(m.providerID, provider)
        }
        provider.models.push({ id: m.id, name: m.name || m.id, providerId: m.providerID })
      }
      // Put the active (default) provider first so the panel preselects it
      return [...byProvider.values()].sort((a, b) =>
        a.id === this.activeProvider ? -1 : b.id === this.activeProvider ? 1 : 0
      )
    } catch (e: any) {
      console.warn('[Agent] Gagal memuat model dari OpenCode:', e.message)
      return []
    }
  }

  setModel(providerId: string, modelId: string): void {
    this.activeProvider = providerId
    this.activeModel = modelId
    if (this.client && this.activeSessionId) {
      this.client.session
        .switchModel({ sessionID: this.activeSessionId, model: { id: modelId, providerID: providerId } })
        .catch((e) => console.warn('[Agent] Gagal mengganti model:', e.message))
    }
  }

  private sessionsFile(): string | null {
    return this.projectPath ? path.join(this.projectPath, '.linden/agent/sessions.json') : null
  }

  private readStoredSessions(): AgentSessionInfo[] {
    const file = this.sessionsFile()
    if (!file || !fs.existsSync(file)) return []
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf-8'))
      return Array.isArray(stored) ? stored : []
    } catch (_) {
      return []
    }
  }

  private writeStoredSessions(sessions: AgentSessionInfo[]): void {
    const file = this.sessionsFile()
    if (!file) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(sessions, null, 2), 'utf-8')
  }

  /**
   * Sessions created from this project (ids in .linden/agent/sessions.json; content lives in OpenCode)
   */
  async listSessions(): Promise<AgentSessionInfo[]> {
    return this.readStoredSessions()
  }

  async createSession(title = 'New Game Session'): Promise<AgentSessionInfo> {
    const client = this.requireClient()
    const info: any = await client.session.create({
      location: this.location(),
      title,
      agent: 'build',
      model: this.activeModel && this.activeProvider ? { id: this.activeModel, providerID: this.activeProvider } : undefined,
      permissions: SESSION_PERMISSIONS,
    })

    await this.ensureInstructions(info.id)

    const session: AgentSessionInfo = {
      id: info.id,
      title: info.title || title,
      createdAt: info.time?.created ?? Date.now(),
      updatedAt: info.time?.updated ?? Date.now(),
    }
    this.activeSessionId = session.id
    this.tracker.watch(session.id)
    this.writeStoredSessions([session, ...this.readStoredSessions().filter((s) => s.id !== session.id)])
    return session
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    if (this.activeSessionId === sessionId) this.activeSessionId = null
    await this.client?.session.remove({ sessionID: sessionId }).catch(() => {})
    const sessions = this.readStoredSessions()
    const remaining = sessions.filter((s) => s.id !== sessionId)
    this.writeStoredSessions(remaining)
    return remaining.length !== sessions.length
  }

  /** Report a stored session's events, measuring turn usage from its current totals */
  /**
   * Start reporting a stored session. It must belong to the open project folder; its
   * permission rules are refreshed so sessions made by older versions are confined too.
   * A session listed in this project's sessions.json whose folder differs comes from a
   * project that was moved on disk, so it is moved along; any other session is refused.
   */
  private async watchSession(sessionId: string): Promise<void> {
    const client = this.requireClient()
    const info: any = await client.session.get({ sessionID: sessionId })
    const dir = info?.location?.directory
    if (!dir || !samePath(dir, this.projectPath!)) {
      const ownSession = this.readStoredSessions().some((st) => st.id === sessionId)
      if (!ownSession) {
        throw new Error(`Sesi ${sessionId} berjalan di folder lain (${dir ?? 'tidak diketahui'}), bukan di proyek ${this.projectPath}`)
      }
      await client.session.move({ sessionID: sessionId, directory: this.projectPath! })
    }
    await client.session.update({ sessionID: sessionId, permissions: SESSION_PERMISSIONS })
    this.tracker.watch(sessionId, info?.tokens)
  }

  /**
   * Turns of a session for the panel: stored history plus the live turn, if one is running
   */
  async getSessionTurns(sessionId: string): Promise<AgentTurn[]> {
    const client = this.requireClient()
    this.activeSessionId = sessionId
    await this.watchSession(sessionId)
    const messages: any[] = []
    let cursor: string | undefined
    // The API caps a page at 200 messages; follow the cursor for longer sessions
    for (let page = 0; page < 20; page++) {
      const res: any = await client.message.list({ sessionID: sessionId, limit: MESSAGE_PAGE_SIZE, order: 'asc', cursor })
      const data = res?.data ?? []
      messages.push(...data)
      cursor = res?.cursor?.next
      if (data.length < MESSAGE_PAGE_SIZE || !cursor) break
    }
    const turns = turnsFromMessages(sessionId, messages)
    const live = this.tracker.snapshot(sessionId)
    if (!live) return turns
    // The live snapshot is more detailed (seq, phases) than stored messages; prefer it
    const i = turns.findIndex((t) => t.id === live.id)
    if (i >= 0) turns[i] = live
    else turns.push(live)
    return turns
  }

  getTurnSnapshot(sessionId: string): AgentTurn | null {
    return this.tracker.snapshot(sessionId)
  }

  /**
   * Send a prompt; the reply streams back through the event subscription
   */
  async submitPrompt(options: {
    sessionId?: string
    prompt: string
    mode?: 'plan' | 'build' | 'review'
    context?: any
  }): Promise<{ messageId: string }> {
    const client = this.requireClient()
    const sessionId = options.sessionId || this.activeSessionId || (await this.createSession()).id
    this.activeSessionId = sessionId
    if (!this.tracker.isWatched(sessionId)) await this.watchSession(sessionId)
    // A session made before an engine update still carries the old instructions
    await this.ensureInstructions(sessionId)

    await client.session
      .switchAgent({ sessionID: sessionId, agent: options.mode === 'plan' ? 'plan' : 'build' })
      .catch((e) => console.warn('[Agent] Gagal mengganti agent:', e.message))

    let text = options.prompt
    if (options.context && Object.keys(options.context).length > 0) {
      text += `\n\n<editor-context>\n${JSON.stringify(options.context, null, 2)}\n</editor-context>`
    }

    const res: any = await client.session.prompt({ sessionID: sessionId, text })
    return { messageId: res?.id ?? `msg_${Date.now()}` }
  }

  async abortPrompt(sessionId: string): Promise<boolean> {
    if (!this.client) return false
    try {
      await this.client.session.interrupt({ sessionID: sessionId })
      return true
    } catch (_) {
      return false
    }
  }

  /**
   * Linden tools write immediately; "apply" keeps the change
   */
  async applyDiff(diffId: string): Promise<boolean> {
    const diff = this.proposedDiffs.get(diffId)
    if (!diff) return false
    diff.status = 'applied'
    return true
  }

  /**
   * Revert a change made by a Linden tool to its previous content
   */
  async rejectDiff(diffId: string): Promise<boolean> {
    const diff = this.proposedDiffs.get(diffId)
    if (!diff || !this.projectPath) return false

    try {
      const full = path.resolve(this.projectPath, diff.file)
      if (!full.startsWith(path.resolve(this.projectPath) + path.sep)) return false
      if (diff.action === 'create' || !diff.before) {
        fs.rmSync(full, { force: true })
      } else {
        fs.writeFileSync(full, diff.before, 'utf-8')
      }
      diff.status = 'rejected'
      return true
    } catch (e) {
      return false
    }
  }

  async replyPermission(requestId: string, allow: boolean): Promise<void> {
    const req = this.pendingPermissions.get(requestId)
    this.resolvePermission(requestId, req?.sessionId)
    if (!req || !this.client) return
    await this.client.permission
      .reply({ sessionID: req.sessionId, requestID: requestId, decision: allow ? 'once' : 'reject' })
      // Rejecting one call rejects its whole batch, so later requests may already be gone
      .catch((e) => console.warn('[Agent] Balasan izin diabaikan:', e.message))
  }

  private resolvePermission(requestId: string, sessionId?: string): void {
    if (!this.pendingPermissions.delete(requestId)) return
    this.emitEvent({ type: 'permission_resolved', sessionId, data: { id: requestId } })
  }

  getTemplates() {
    return PROMPT_TEMPLATES
  }

  private subscribeEvents(): void {
    const client = this.requireClient()
    const abort = new AbortController()
    this.eventAbort = abort
    ;(async () => {
      try {
        for await (const ev of client.event.subscribe({ signal: abort.signal })) {
          this.handleEvent(ev as any)
        }
      } catch (e: any) {
        if (!abort.signal.aborted) {
          this.emitEvent({ type: 'error', data: { message: `Stream event OpenCode terputus: ${e.message}` } })
        }
      }
    })()
  }

  /**
   * Route one OpenCode event: turn progress goes through the TurnTracker, permission
   * prompts for watched sessions (and their sub-agents) go to the editor dialog
   */
  handleEvent(ev: { type: string; created?: number; data?: any }): void {
    this.tracker.handle(ev)
    const d = ev.data ?? {}
    if (!d.sessionID || !this.tracker.isWatched(d.sessionID)) return

    if (ev.type === 'permission.asked') {
      const files = Array.isArray(d.metadata?.files)
        ? d.metadata.files.map((f: any) => ({ file: String(f.file), status: f.status, additions: f.additions, deletions: f.deletions }))
        : undefined
      const req: AgentPermissionRequest = {
        id: d.id,
        sessionId: d.sessionID,
        action: String(d.action ?? 'unknown'),
        resources: Array.isArray(d.resources) ? d.resources.map(String) : [],
        files,
        message: d.message,
        timestamp: Date.now(),
      }
      this.pendingPermissions.set(req.id, req)
      this.emitEvent({ type: 'permission_requested', sessionId: d.sessionID, data: req })
    } else if (ev.type === 'permission.replied') {
      this.resolvePermission(d.requestID, d.sessionID)
    }
  }

  private lindenPrompt(): string {
    return fs.readFileSync(resolveAppResource('electron/agent/prompts/linden.md', 'agent/prompts/linden.md'), 'utf-8')
  }

  /** Put the current Linden instructions on a session (once per session per app run) */
  private async ensureInstructions(sessionId: string): Promise<void> {
    if (this.instructedSessions.has(sessionId)) return
    try {
      await this.requireClient().session.instructions.entry.put({ sessionID: sessionId, key: 'linden', value: this.lindenPrompt() })
      this.instructedSessions.add(sessionId)
    } catch (e: any) {
      console.warn('[Agent] Gagal memasang instruksi Linden:', e?.message ?? e)
    }
  }

  private initProjectAgentFiles(projectPath: string): void {
    try {
      const result = syncProjectAgentsMd(projectPath, this.lindenPrompt())
      if (result === 'updated') console.info('[Agent] AGENTS.md diperbarui ke instruksi Linden terbaru')
      else if (result === 'user-edited') console.info('[Agent] AGENTS.md sudah diedit pengguna; tidak diperbarui otomatis')
    } catch (e: any) {
      console.warn('[Agent] Gagal menyiapkan AGENTS.md:', e?.message ?? e)
    }

    const sessionDir = path.join(projectPath, '.linden/agent')
    fs.mkdirSync(sessionDir, { recursive: true })
  }
}
