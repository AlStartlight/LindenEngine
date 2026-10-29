import http from 'node:http'
import crypto from 'node:crypto'
import { AgentDiffItem } from '../../shared/agentTypes'
import { LINDEN_TOOLS, ToolResult } from './lindenTools'

export interface LindenMcpServerOptions {
  projectPath: string
  onDiff?: (diff: AgentDiffItem) => void
  onToolCall?: (name: string, args: unknown, result: ToolResult) => void
}

const MAX_BODY_BYTES = 10 * 1024 * 1024

/**
 * Minimal MCP server (Streamable HTTP transport, JSON responses only) that exposes
 * LINDEN_TOOLS to OpenCode. Registered as remote MCP server "linden", so OpenCode
 * names the tools linden_<name>. Bound to 127.0.0.1 and guarded by a random bearer token.
 */
export class LindenMcpServer {
  readonly token = crypto.randomBytes(24).toString('hex')
  private server: http.Server | null = null
  private port = 0

  constructor(private options: LindenMcpServerOptions) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`
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
    this.server?.close()
    this.server = null
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const auth = req.headers.authorization || ''
    const expected = `Bearer ${this.token}`
    if (auth.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
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

    // Notifications (no id) only need an acknowledgement
    if (msg.id === undefined || msg.id === null) {
      res.writeHead(202)
      res.end()
      return
    }

    const result = await this.dispatch(msg.method, msg.params || {})
    if ('error' in result) {
      this.send(res, { jsonrpc: '2.0', id: msg.id, error: result.error })
    } else {
      this.send(res, { jsonrpc: '2.0', id: msg.id, result: result.result })
    }
  }

  private async dispatch(
    method: string,
    params: any
  ): Promise<{ result: any } | { error: { code: number; message: string } }> {
    switch (method) {
      case 'initialize':
        return {
          result: {
            protocolVersion: params.protocolVersion || '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'linden', version: '0.2.0' },
            instructions:
              'Tools for editing the open Linden Engine project. Always use these instead of writing .lscene or project.linden.json by hand.',
          },
        }
      case 'ping':
        return { result: {} }
      case 'tools/list':
        return {
          result: {
            tools: Object.values(LINDEN_TOOLS).map((t) => ({
              name: t.name.replace(/^linden_/, ''),
              description: t.description,
              inputSchema: t.parameters,
            })),
          },
        }
      case 'tools/call': {
        const tool = LINDEN_TOOLS[`linden_${params.name}`]
        if (!tool) return { error: { code: -32602, message: `Unknown tool: ${params.name}` } }
        const args = params.arguments || {}
        const out = await tool.execute(this.options.projectPath, args, { onDiff: this.options.onDiff })
        this.options.onToolCall?.(tool.name, args, out)
        const text = out.success ? JSON.stringify(out.data ?? { ok: true }, null, 2) : `Error: ${out.error}`
        const content: any[] = [{ type: 'text', text }]
        for (const img of out.images ?? []) {
          if (img.label) content.push({ type: 'text', text: `[${img.label}]` })
          content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
        }
        return { result: { content, isError: !out.success } }
      }
      default:
        return { error: { code: -32601, message: `Method not found: ${method}` } }
    }
  }

  private send(res: http.ServerResponse, payload: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
}
