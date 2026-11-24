import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * Contract tests for integrations/dsh/bin/linden-agent-bridge.mjs — the stdio MCP
 * proxy that lets DeepSeek Harness (or any custom agent) talk to the Linden MCP
 * server while enforcing the role scope from integrations/dsh/agents.json.
 */

const REPO = path.resolve(__dirname, '../..')
const BRIDGE = path.join(REPO, 'integrations/dsh/bin/linden-agent-bridge.mjs')
const TOKEN = 'test-token-123'

interface Call {
  name: string
  args: unknown
}

let server: http.Server
let port = 0
let tmpDir = ''
let manifestPath = ''
let previousHome: string | undefined
const calls: Call[] = []

function startMockServer(): Promise<void> {
  server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401)
      res.end()
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const msg = JSON.parse(body)
      const reply = (result: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
      }
      if (msg.method === 'initialize') {
        reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'linden', version: '0.2.0' } })
      } else if (msg.method === 'tools/list') {
        reply({
          tools: [
            { name: 'project_info', description: 'project' },
            { name: 'scene_read', description: 'read' },
            { name: 'scene_apply', description: 'write scene' },
            { name: 'component_list', description: 'components' },
            { name: 'dimensions', description: 'sizes' },
            { name: 'play', description: 'simulate' },
            { name: 'script_write', description: 'not for the architect' },
          ],
        })
      } else if (msg.method === 'tools/call') {
        calls.push({ name: msg.params.name, args: msg.params.arguments })
        reply({ content: [{ type: 'text', text: 'ok' }], isError: false })
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not found' } }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      port = typeof addr === 'object' && addr ? addr.port : 0
      resolve()
    })
  })
}

class Bridge {
  child: ChildProcessWithoutNullStreams
  private buffer = ''
  private pending = new Map<number, (msg: any) => void>()
  private nextId = 1
  stderr = ''

  constructor(args: string[]) {
    this.child = spawn(process.execPath, [BRIDGE, ...args], { cwd: REPO, env: { ...process.env, LINDEN_MCP_TIMEOUT_MS: '5000' } })
    this.child.stderr.on('data', (c) => (this.stderr += String(c)))
    this.child.stdout.on('data', (chunk) => {
      this.buffer += String(chunk)
      let index: number
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).trim()
        this.buffer = this.buffer.slice(index + 1)
        if (!line) continue
        const msg = JSON.parse(line)
        const resolve = this.pending.get(msg.id)
        if (resolve) {
          this.pending.delete(msg.id)
          resolve(msg)
        }
      }
    })
  }

  request(method: string, params: unknown = {}): Promise<any> {
    const id = this.nextId++
    const promise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}; stderr=${this.stderr}`)), 8000)
      this.pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
    })
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return promise
  }

  notify(method: string, params: unknown = {}): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  kill(): void {
    this.child.kill()
  }
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-bridge-'))
  // Never pick up the developer's real ~/.linden/agent-bridge/last.json
  previousHome = process.env.LINDEN_AGENT_BRIDGE_HOME
  process.env.LINDEN_AGENT_BRIDGE_HOME = path.join(tmpDir, 'home')
  await startMockServer()
  manifestPath = path.join(tmpDir, 'agent-bridge.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      format: 'linden-agent-bridge',
      version: 1,
      endpoint: `http://127.0.0.1:${port}/mcp`,
      transport: 'streamable-http',
      tokens: { master: TOKEN, 'linden-game-architect': TOKEN, 'linden-qa-physics-tester': TOKEN },
    })
  )
})

afterAll(() => {
  server?.close()
  if (previousHome === undefined) delete process.env.LINDEN_AGENT_BRIDGE_HOME
  else process.env.LINDEN_AGENT_BRIDGE_HOME = previousHome
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('linden agent bridge', () => {
  it('filters tools/list to the role scope', async () => {
    const bridge = new Bridge(['--agent', 'linden-game-architect', '--endpoint', manifestPath])
    try {
      const init = await bridge.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
      expect(init.result.serverInfo.name).toBe('linden')

      const list = await bridge.request('tools/list')
      const names = list.result.tools.map((t: any) => t.name).sort()
      expect(names).toEqual(['component_list', 'dimensions', 'play', 'project_info', 'scene_apply', 'scene_read'])
      expect(names).not.toContain('script_write')
    } finally {
      bridge.kill()
    }
  })

  it('rejects a call outside the role scope without touching the server', async () => {
    calls.length = 0
    const bridge = new Bridge(['--agent', 'linden-qa-physics-tester', '--endpoint', manifestPath])
    try {
      const reply = await bridge.request('tools/call', { name: 'script_write', arguments: { scriptPath: 'scripts/x.ts' } })
      expect(reply.result.isError).toBe(true)
      expect(String(reply.result.content[0].text)).toContain('scope')
      expect(calls).toHaveLength(0)
    } finally {
      bridge.kill()
    }
  })

  it('forwards an in-scope call and answers ping locally', async () => {
    calls.length = 0
    const bridge = new Bridge(['--agent', 'linden-game-architect', '--endpoint', manifestPath])
    try {
      const ping = await bridge.request('ping')
      expect(ping.result).toEqual({})

      const reply = await bridge.request('tools/call', { name: 'scene_read', arguments: { scenePath: 'scenes/Main.lscene' } })
      expect(reply.result.isError).toBe(false)
      expect(calls).toEqual([{ name: 'scene_read', args: { scenePath: 'scenes/Main.lscene' } }])
    } finally {
      bridge.kill()
    }
  })

  it('refuses with an actionable error when no endpoint manifest exists', async () => {
    const bridge = new Bridge([
      '--agent',
      'linden-game-architect',
      '--endpoint',
      path.join(tmpDir, 'missing.json'),
      '--project',
      tmpDir,
    ])
    try {
      const reply = await bridge.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
      expect(reply.error.code).toBe(-32603)
      expect(String(reply.error.message)).toContain('agent-bridge.json')
    } finally {
      bridge.kill()
    }
  })

  it('prints a client config for custom agents', async () => {
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [BRIDGE, '--agent', 'linden-technical-artist', '--endpoint', manifestPath, '--print-config'])
      let stdout = ''
      child.stdout.on('data', (c) => (stdout += c))
      child.on('error', reject)
      child.on('close', () => resolve(stdout))
    })
    const config = JSON.parse(out)
    expect(config.endpoint).toBe(`http://127.0.0.1:${port}/mcp`)
    expect(config.http.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(config.mcpServers['linden-technical-artist'].args).toContain('linden-technical-artist')
    expect(config.dsh).toContain("serverName: linden")
  })
})
