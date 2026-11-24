import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AgentDiffItem } from '../../shared/agentTypes'
import { LINDEN_TOOLS, ToolResult, ToolDefinition, ToolPermissionRequest } from './lindenTools'
import type { LindenBridgeStatus, LindenCallContext, LindenClientView } from './lindenBridgeTypes'

/** A bridge client: one bearer token, one role, one optional tool scope. */
export interface LindenMcpClient {
  /** Stable client id, e.g. "opencode" or a role id */
  id: string
  role: string
  token: string
  /** Bare tool names (no linden_ prefix); null = every available tool */
  scope: string[] | null
}

export interface LindenMcpServerOptions {
  projectPath: string
  /** Clients and their tokens. Omitted: a single all-tools client using `server.token`. */
  clients?: LindenMcpClient[]
  /** Explicit master token (the bridge keeps it to register a full-access client) */
  masterToken?: string
  onDiff?: (diff: AgentDiffItem, ctx: LindenCallContext) => void
  onToolCall?: (name: string, args: unknown, result: ToolResult, ctx: LindenCallContext) => void
  /** Ask the user before a tool runs something (linden_blender_script) */
  requestPermission?: (req: ToolPermissionRequest, ctx: LindenCallContext) => Promise<boolean>
}

/** MCP revisions this server actually implements, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

const MAX_BODY_BYTES = 10 * 1024 * 1024
const LOCK_TTL_MS = 120_000

const isAvailable = (t: ToolDefinition) => !t.available || t.available()
const bareName = (name: string) => name.replace(/^linden_/, '')

/** Mutating tools and the resource they serialize on (SPEC §12) */
function lockKeyFor(tool: string, args: any): string | null {
  const scene = typeof args?.scenePath === 'string' ? args.scenePath : typeof args?.attachTo?.scene === 'string' ? args.attachTo.scene : null
  switch (tool) {
    case 'scene_apply':
      return `scene:${scene || 'scenes/Main.lscene'}`
    case 'model_build':
    case 'model_bake_glb':
      return scene ? `scene:${scene}` : null
    case 'script_write':
    case 'ui_write':
      return scene ? `scene:${scene}` : null
    case 'input_actions':
    case 'touch_button':
      return 'config:project.linden.json'
    default:
      return null
  }
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

/**
 * Minimal MCP server (Streamable HTTP transport, JSON responses only) that exposes
 * LINDEN_TOOLS to agent runtimes — OpenCode today, DeepSeek Harness and custom
 * agents through the Agent Bridge.
 *
 * v2 (SPEC-DSH-MCP-Agent-Integration):
 *  - protocol version negotiation instead of echoing the client's version;
 *  - one bearer token per client, each with a role and a tool scope;
 *  - per-call attribution (`_meta.linden.sessionId/turnId`) into diffs and prompts;
 *  - request cancellation and scene-write leases;
 *  - structured errors (`code` + `message`) instead of free text.
 */
export class LindenMcpServer {
  private readonly masterToken: string
  private readonly clients: LindenMcpClient[]
  private server: http.Server | null = null
  private port = 0
  private projectPath: string
  private inflight = new Map<string, AbortController>()
  private locks = new Map<string, { clientId: string; role: string; expiresAt: number; key: string }>()

  constructor(private options: LindenMcpServerOptions) {
    this.masterToken = options.masterToken ?? crypto.randomBytes(24).toString('hex')
    this.projectPath = options.projectPath
    this.clients =
      options.clients && options.clients.length > 0
        ? options.clients
        : [{ id: 'default', role: 'director', token: this.masterToken, scope: null }]
  }

  /** Master token (full access). Kept for AgentHost and existing callers. */
  get token(): string {
    return this.masterToken
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`
  }

  get projectPathInUse(): string {
    return this.projectPath
  }

  /** Move the server to another project without rotating the endpoint or tokens. */
  setProjectPath(projectPath: string): void {
    this.projectPath = projectPath
  }

  getStatus(): LindenBridgeStatus {
    const now = Date.now()
    return {
      running: this.server !== null,
      projectPath: this.projectPath,
      endpoint: this.server ? this.url : null,
      manifestPath: null,
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0],
      clients: this.clients.map<LindenClientView>((c) => ({ id: c.id, role: c.role, scope: c.scope })),
      locks: [...this.locks.values()]
        .filter((l) => l.expiresAt > now)
        .map((l) => ({ key: l.key, clientId: l.clientId, role: l.role, expiresAt: l.expiresAt })),
    }
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(String(err?.message || err))
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = this.server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : 0
  }

  close(): void {
    for (const controller of this.inflight.values()) controller.abort()
    this.inflight.clear()
    this.locks.clear()
    this.server?.close()
    this.server = null
  }

  private clientFor(req: http.IncomingMessage): LindenMcpClient | null {
    const header = req.headers.authorization || ''
    if (!header.startsWith('Bearer ')) return null
    const provided = header.slice('Bearer '.length)
    for (const client of this.clients) {
      if (safeEqual(provided, client.token)) return client
    }
    return null
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const client = this.clientFor(req)
    if (!client) {
      res.writeHead(401)
      res.end()
      return
    }
    // No server-initiated SSE stream; clients fall back to plain POST request/response
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' })
      res.end()
      return
    }

    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        res.writeHead(413)
        res.end()
        return
      }
    }

    let msg: any
    try {
      msg = JSON.parse(body)
    } catch {
      this.send(res, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }

    // Notifications (no id) only need an acknowledgement, except cancellation
    if (msg.id === undefined || msg.id === null) {
      if (msg.method === 'notifications/cancelled') this.cancelRequest(client, msg.params?.requestId, msg.params?.reason)
      res.writeHead(202)
      res.end()
      return
    }

    const result = await this.dispatch(msg.method, msg.params || {}, client, msg.id)
    if ('error' in result) {
      this.send(res, { jsonrpc: '2.0', id: msg.id, error: result.error })
    } else {
      this.send(res, { jsonrpc: '2.0', id: msg.id, result: result.result })
    }
  }

  private cancelRequest(client: LindenMcpClient, requestId: unknown, reason?: unknown): void {
    const key = `${client.id}:${String(requestId)}`
    const controller = this.inflight.get(key)
    if (!controller) return
    controller.abort(reason ? String(reason) : 'cancelled')
    console.warn(`[MCP] Permintaan ${key} dibatalkan`)
  }

  private contextFor(client: LindenMcpClient, requestId: string | number, params: any): LindenCallContext {
    const meta = params?._meta?.linden ?? {}
    return {
      clientId: client.id,
      role: client.role,
      sessionId: typeof meta.sessionId === 'string' && meta.sessionId ? meta.sessionId : undefined,
      turnId: typeof meta.turnId === 'string' && meta.turnId ? meta.turnId : undefined,
      requestId,
    }
  }

  private async dispatch(
    method: string,
    params: any,
    client: LindenMcpClient,
    requestId: string | number
  ): Promise<{ result: any } | { error: { code: number; message: string; data?: unknown } }> {
    switch (method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        const negotiated = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0]
        const scopeNote =
          client.scope === null
            ? 'This token may use every tool.'
            : `This token is limited to ${client.scope.length} tools (role ${client.role}); tools/list reflects that scope.`
        return {
          result: {
            protocolVersion: negotiated,
            capabilities: { tools: {} },
            serverInfo: { name: 'linden', version: '0.3.0' },
            instructions:
              'Tools for editing the open Linden Engine project. Always use these instead of writing .lscene or project.linden.json by hand. ' +
              scopeNote,
          },
        }
      }
      case 'ping':
        return { result: {} }
      case 'tools/list': {
        const allowed = client.scope === null ? null : new Set(client.scope.map(bareName))
        const tools = Object.values(LINDEN_TOOLS)
          .filter((t) => isAvailable(t))
          .map((t) => ({ game: bareName(t.name), tool: t }))
          .filter(({ game }) => !allowed || allowed.has(game))
          .map(({ game, tool }) => ({
            name: game,
            description: tool.description,
            inputSchema: tool.parameters,
          }))
        return { result: { tools } }
      }
      case 'tools/call': {
        const requested = typeof params.name === 'string' ? params.name : ''
        const game = bareName(requested)
        const allowed = client.scope === null ? null : new Set(client.scope.map(bareName))
        if (allowed && !allowed.has(game)) {
          return {
            error: {
              code: -32003,
              message: `LINDEN_E_SCOPE: tool "${game}" tidak ada dalam scope agent ${client.role} (${client.id}). Panggil tools/list untuk daftar tool yang diizinkan.`,
            },
          }
        }
        const tool = LINDEN_TOOLS[`linden_${game}`]
        if (!tool || !isAvailable(tool)) {
          return {
            result: {
              content: [{ type: 'text', text: `Error: LINDEN_E_UNKNOWN_TOOL: tool "${game}" tidak tersedia` }],
              isError: true,
            },
          }
        }

        const args = params.arguments || {}
        const ctx = this.contextFor(client, requestId, params)
        const lockKey = lockKeyFor(game, args)
        const controller = new AbortController()
        const inflightKey = `${client.id}:${String(requestId)}`
        this.inflight.set(inflightKey, controller)

        let heldLock: string | null = null
        try {
          if (lockKey) {
            const acquired = this.acquireLock(lockKey, client)
            if ('error' in acquired) return { error: acquired.error }
            heldLock = lockKey

            // Opt-in stale-write protection: a client may send the hash of the scene it read
            const baseHash = params?._meta?.linden?.baseHash
            if (typeof baseHash === 'string' && lockKey.startsWith('scene:')) {
              const rel = lockKey.slice('scene:'.length)
              const full = this.resolveInsideProject(rel)
              if (full && fs.existsSync(full)) {
                const current = sha256(fs.readFileSync(full, 'utf-8'))
                if (current !== baseHash) {
                  return {
                    error: {
                      code: -32009,
                      message: `LINDEN_E_LOCKED: scene ${rel} berubah sejak dibaca (stale-base). Baca ulang scene lalu ulangi.`,
                    },
                  }
                }
              }
            }
          }

          if (controller.signal.aborted) {
            return { error: { code: -32800, message: 'LINDEN_E_CANCELLED: permintaan dibatalkan sebelum dijalankan' } }
          }

          const out = await tool.execute(this.projectPath, args, {
            onDiff: (diff) => this.options.onDiff?.(diff, ctx),
            requestPermission: (req) => (this.options.requestPermission ? this.options.requestPermission(req, ctx) : Promise.resolve(false)),
            signal: controller.signal,
            status: () => this.getStatus(),
            agent: { clientId: ctx.clientId, role: ctx.role, sessionId: ctx.sessionId },
          })
          this.options.onToolCall?.(tool.name, args, out, ctx)

          if (controller.signal.aborted) {
            return { error: { code: -32800, message: 'LINDEN_E_CANCELLED: permintaan dibatalkan' } }
          }

          const text = out.success ? JSON.stringify(out.data ?? { ok: true }, null, 2) : `Error: ${out.error}`
          const content: any[] = [{ type: 'text', text }]
          for (const img of out.images ?? []) {
            if (img.label) content.push({ type: 'text', text: `[${img.label}]` })
            content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
          }
          return { result: { content, isError: !out.success } }
        } catch (err: any) {
          return { error: { code: -32603, message: `LINDEN_E_INTERNAL: ${err?.message || String(err)}` } }
        } finally {
          this.inflight.delete(inflightKey)
          if (heldLock) this.releaseLock(heldLock, client)
        }
      }
      default:
        return { error: { code: -32601, message: `Method not found: ${method}` } }
    }
  }

  private resolveInsideProject(rel: string): string | null {
    const base = path.resolve(this.projectPath)
    const full = path.resolve(this.projectPath, rel)
    if (full !== base && !full.startsWith(base + path.sep)) return null
    return full
  }

  private acquireLock(key: string, client: LindenMcpClient): { ok: true } | { error: { code: number; message: string } } {
    const now = Date.now()
    const existing = this.locks.get(key)
    if (existing && existing.expiresAt > now && existing.clientId !== client.id) {
      return {
        error: {
          code: -32009,
          message: `LINDEN_E_LOCKED: ${key} sedang ditulis oleh ${existing.clientId} (${existing.role}); coba lagi setelah ${Math.ceil((existing.expiresAt - now) / 1000)} dtk atau baca ulang lalu ulangi.`,
        },
      }
    }
    this.locks.set(key, { key, clientId: client.id, role: client.role, expiresAt: now + LOCK_TTL_MS })
    return { ok: true }
  }

  private releaseLock(key: string, client: LindenMcpClient): void {
    const existing = this.locks.get(key)
    if (existing && existing.clientId === client.id) this.locks.delete(key)
  }

  private send(res: http.ServerResponse, payload: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
}
