#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Linden Engine Agent Bridge — stdio MCP proxy.
//
// Speaks the MCP stdio transport (newline-delimited JSON-RPC 2.0) on stdin/stdout
// and forwards every request to the Linden Engine MCP server, which listens on a
// loopback Streamable-HTTP endpoint that changes port and bearer token on every
// app start. It therefore re-reads the endpoint manifest when a call is refused.
//
// Two jobs beyond transport:
//   1. Discovery — find the live endpoint without manual copy/paste of URL + token.
//   2. Least privilege — for `--agent <id>` restrict tools/list and tools/call to
//      the scope declared in agents.json, so any MCP-capable agent (DeepSeek
//      Harness, Claude Code, Cursor, a custom SDK client) gets one role, not the
//      whole engine.
//
// Usage:
//   node bin/linden-agent-bridge.mjs --agent linden-game-architect [--project DIR]
//   node bin/linden-agent-bridge.mjs --agent linden-qa-physics-tester --print-config
//   node bin/linden-agent-bridge.mjs --probe
//
// Endpoint manifest resolution order:
//   --endpoint FILE
//   $LINDEN_MCP_ENDPOINT (file path)
//   <project>/.linden/agent-bridge.json
//   $PWD/.linden/agent-bridge.json
//   ~/.linden/agent-bridge/last.json
//
// stdout is reserved for JSON-RPC. Every diagnostic goes to stderr.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CATALOG_PATH = path.join(HERE, '..', 'agents.json')
const DEFAULT_TIMEOUT_MS = 120_000

const log = (...args) => process.stderr.write(`[linden-bridge] ${args.join(' ')}\n`)

function parseArgs(argv) {
  const out = { agent: null, project: null, endpoint: null, printConfig: false, probe: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--agent') out.agent = argv[++i] ?? null
    else if (arg === '--project') out.project = argv[++i] ?? null
    else if (arg === '--endpoint') out.endpoint = argv[++i] ?? null
    else if (arg === '--print-config') out.printConfig = true
    else if (arg === '--probe') out.probe = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else log(`mengabaikan argumen tidak dikenal: ${arg}`)
  }
  return out
}

function loadCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
  } catch (err) {
    log(`katalog agent tidak terbaca (${CATALOG_PATH}): ${err.message}`)
    return { agents: [] }
  }
}

function manifestCandidates(args) {
  const cwd = process.cwd()
  const project = args.project || process.env.LINDEN_PROJECT || cwd
  const list = []
  if (args.endpoint) list.push(path.resolve(args.endpoint))
  if (process.env.LINDEN_MCP_ENDPOINT) list.push(path.resolve(process.env.LINDEN_MCP_ENDPOINT))
  list.push(path.join(project, '.linden', 'agent-bridge.json'))
  list.push(path.join(cwd, '.linden', 'agent-bridge.json'))
  // Same override the engine uses, so tests and sandboxes stay off the real home
  const home = process.env.LINDEN_AGENT_BRIDGE_HOME || os.homedir()
  list.push(path.join(home, '.linden', 'agent-bridge', 'last.json'))
  return [...new Set(list)]
}

function readManifest(args) {
  for (const file of manifestCandidates(args)) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const data = JSON.parse(raw)
      if (!data || typeof data.endpoint !== 'string') continue
      return { file, data }
    } catch {
      // Missing or half-written file: try the next candidate
    }
  }
  return null
}

function tokenFor(manifest, agentId) {
  const tokens = manifest.tokens
  if (tokens && typeof tokens === 'object') {
    const direct = agentId ? tokens[agentId] : undefined
    if (direct) return direct
    if (tokens.master) return tokens.master
  }
  return typeof manifest.token === 'string' ? manifest.token : null
}

function scopeFor(agentId, manifest, catalog) {
  if (!agentId) return null // no scope: the whole server (custom agents that opt out)
  const fromManifest = manifest?.scopes?.[agentId]
  if (Array.isArray(fromManifest)) return fromManifest
  const role = catalog.agents?.find((a) => a.id === agentId)
  return role && Array.isArray(role.tools) ? role.tools : null
}

const bareName = (name) => String(name).replace(/^mcp__[A-Za-z0-9_-]{1,32}__/, '').replace(/^linden_/, '')

function filterToolList(result, scope) {
  if (!scope || !result || !Array.isArray(result.tools)) return result
  const allowed = new Set(scope.map(bareName))
  const tools = result.tools.filter((t) => allowed.has(bareName(t?.name)))
  // A filtered page would make the client chase cursors for tools it can never see
  return { ...result, tools }
}

async function postJson(url, token, payload, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await res.text()
    if (res.status === 202 || text.length === 0) return { status: res.status, json: null }
    const type = res.headers.get('content-type') || ''
    if (type.includes('text/event-stream')) {
      const frames = text
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean)
      const last = frames[frames.length - 1]
      return { status: res.status, json: last ? JSON.parse(last) : null }
    }
    return { status: res.status, json: JSON.parse(text) }
  } finally {
    clearTimeout(timer)
  }
}

class Endpoint {
  constructor(args, catalog) {
    this.args = args
    this.catalog = catalog
    this.manifest = null
    this.loaded = null
  }

  reload() {
    this.manifest = readManifest(this.args)
    this.loaded = this.manifest?.data ?? null
    // Keep the manifest path next to its contents for --print-config / --probe
    if (this.loaded) Object.defineProperty(this.loaded, '__file', { value: this.manifest.file, enumerable: false })
    return this.loaded
  }

  ensure() {
    if (this.loaded) return this.loaded
    const manifest = this.reload()
    if (!manifest) {
      const looked = manifestCandidates(this.args).join(', ')
      throw new Error(
        `Linden Engine MCP endpoint tidak ditemukan. Cari: ${looked}. ` +
          'Jalankan Linden Engine dengan Agent Bridge aktif, atau set LINDEN_MCP_ENDPOINT ke file manifest.'
      )
    }
    return manifest
  }

  token() {
    const manifest = this.ensure()
    return tokenFor(manifest, this.args.agent)
  }
}

async function forward(endpoint, message, scope) {
  const timeoutMs = Number(process.env.LINDEN_MCP_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  const attempt = async () => {
    const manifest = endpoint.ensure()
    const token = tokenFor(manifest, endpoint.args.agent)
    return postJson(manifest.endpoint, token, message, timeoutMs)
  }

  let out
  try {
    out = await attempt()
  } catch (err) {
    // The app restarted: port and token rotated. Re-read the manifest once.
    log(`koneksi gagal (${err.message}); memuat ulang manifest`)
    endpoint.reload()
    out = await attempt()
  }

  if (out.status === 401 || out.status === 403) {
    endpoint.reload()
    const manifest = endpoint.ensure()
    out = await postJson(manifest.endpoint, tokenFor(manifest, endpoint.args.agent), message, timeoutMs)
  }
  return out
}

function denied(id, tool, agentId) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [
        {
          type: 'text',
          text: `Tool "${tool}" tidak ada dalam scope agent "${agentId}". Panggil tools/list untuk daftar tool yang diizinkan.`,
        },
      ],
      isError: true,
    },
  }
}

async function handle(endpoint, message, scope) {
  const { id, method } = message
  const isRequest = id !== undefined && id !== null

  if (!isRequest) {
    // Notification: forward best-effort, never answer
    try {
      await forward(endpoint, message, scope)
    } catch (err) {
      log(`notifikasi ${method} gagal diteruskan: ${err.message}`)
    }
    return null
  }

  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }

  if (method === 'tools/call' && scope) {
    const name = bareName(message.params?.name)
    const allowed = new Set(scope.map(bareName))
    if (!allowed.has(name)) return denied(id, message.params?.name, endpoint.args.agent)
  }

  let out
  try {
    out = await forward(endpoint, message, scope)
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `Linden agent bridge: ${err.message}` },
    }
  }

  if (!out.json) return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Endpoint Linden tidak menjawab' } }
  if (out.json.error) return { jsonrpc: '2.0', id, error: out.json.error }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: filterToolList(out.json.result, scope) }
  }
  return { jsonrpc: '2.0', id, result: out.json.result }
}

async function probe(endpoint, scope) {
  const init = await forward(endpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'linden-agent-bridge', version: '0.1.0' },
    },
  })
  if (init.json?.error) throw new Error(`initialize gagal: ${init.json.error.message}`)
  const list = await forward(endpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  if (list.json?.error) throw new Error(`tools/list gagal: ${list.json.error.message}`)
  const tools = filterToolList(list.json?.result, scope)?.tools ?? []
  const manifest = endpoint.ensure()
  return {
    endpoint: manifest.endpoint,
    manifest: manifest.file ?? manifest.__file,
    server: init.json?.result?.serverInfo ?? null,
    protocolVersion: init.json?.result?.protocolVersion ?? null,
    agent: endpoint.args.agent,
    scope: scope ? scope.length : 'all',
    tools: tools.map((t) => t.name),
  }
}

function printConfig(endpoint, scope) {
  const manifest = endpoint.ensure()
  const token = tokenFor(manifest, endpoint.args.agent)
  const agentId = endpoint.args.agent || 'linden-agent'
  const cli = fileURLToPath(import.meta.url)
  const out = {
    endpoint: manifest.endpoint,
    agent: agentId,
    scope: scope ?? 'all',
    http: {
      transport: 'streamable-http',
      url: manifest.endpoint,
      headers: { Authorization: `Bearer ${token}` },
    },
    stdio: {
      command: 'node',
      args: [cli, '--agent', agentId, '--endpoint', manifest.__file || manifest.file || ''],
    },
    // Ready-to-paste rows
    dsh: [
      `- id: linden-mcp`,
      `  name: '@deepseek-ai/dsh-mcp-client'`,
      `  config:`,
      `    serverName: linden`,
      `    transport: stdio`,
      `    command: node`,
      `    args: ['${cli}', '--agent', '${agentId}']`,
      `    startupTimeoutMs: 15000`,
      `    toolCallTimeoutMs: 120000`,
      `    failOnStartupError: false`,
    ].join('\n'),
    mcpServers: {
      [agentId]: { command: 'node', args: [cli, '--agent', agentId], env: {} },
    },
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(
      'Linden Engine agent bridge (stdio MCP proxy)\n' +
        '  --agent <id>        role from integrations/dsh/agents.json (omit for full access)\n' +
        '  --project <dir>     project whose .linden/agent-bridge.json is read\n' +
        '  --endpoint <file>   explicit manifest path\n' +
        '  --print-config      print endpoint + ready-to-paste client config, then exit\n' +
        '  --probe             connect, list tools, print them as JSON, then exit\n'
    )
    return
  }

  const catalog = loadCatalog()
  const endpoint = new Endpoint(args, catalog)

  if (args.agent && !catalog.agents?.some((a) => a.id === args.agent)) {
    log(`agent "${args.agent}" tidak ada di katalog. Pilihan: ${(catalog.agents ?? []).map((a) => a.id).join(', ')}`)
    process.exit(1)
  }

  // Scope prefers the manifest (engine-issued) and falls back to the bundled catalog
  const getScope = () => scopeFor(args.agent, endpoint.loaded, catalog)

  if (args.printConfig) {
    printConfig(endpoint, getScope())
    return
  }
  if (args.probe) {
    const result = await probe(endpoint, getScope())
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  log(`agent=${args.agent ?? 'all-tools'} scope=${getScope() ? getScope().length : 'all'} project=${args.project ?? process.env.LINDEN_PROJECT ?? process.cwd()}`)

  let chain = Promise.resolve()
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    chain = chain.then(async () => {
      let message
      try {
        message = JSON.parse(trimmed)
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`)
        return
      }
      // JSON-RPC batch
      if (Array.isArray(message)) {
        const replies = []
        for (const item of message) {
          const reply = await handle(endpoint, item, getScope())
          if (reply) replies.push(reply)
        }
        if (replies.length > 0) process.stdout.write(`${JSON.stringify(replies)}\n`)
        return
      }
      const reply = await handle(endpoint, message, getScope())
      if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
    })
  })

  rl.on('close', () => {
    chain.finally(() => process.exit(0))
  })
}

main().catch((err) => {
  log(`fatal: ${err?.stack || err}`)
  process.exit(1)
})
