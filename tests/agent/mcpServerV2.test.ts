import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LindenMcpServer } from '../../electron/agent/LindenMcpServer'
import { LINDEN_AGENT_ROLES } from '../../electron/agent/lindenRoles'

/**
 * MCP v2 contract (SPEC-DSH-MCP-Agent-Integration P1): version negotiation,
 * per-token tool scope, and the scene write lease / stale-base guard.
 */

const MASTER = 'm'.repeat(48)
const QA_TOKEN = 'q'.repeat(48)
const QA = LINDEN_AGENT_ROLES.find((r) => r.id === 'linden-qa-physics-tester')!

let server: LindenMcpServer
let tmp = ''

async function post(token: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

const rpc = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id, method, params })

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-mcp-v2-'))
  fs.mkdirSync(path.join(tmp, 'scenes'), { recursive: true })
  fs.writeFileSync(
    path.join(tmp, 'project.linden.json'),
    JSON.stringify({ name: 'Bridge Test', version: '1.0.0', input: { actions: [] } })
  )
  fs.writeFileSync(
    path.join(tmp, 'scenes/Main.lscene'),
    JSON.stringify({ format: 'linden-scene', version: 2, name: 'Main', settings: {}, entities: [] })
  )

  server = new LindenMcpServer({
    projectPath: tmp,
    masterToken: MASTER,
    clients: [
      { id: 'opencode', role: 'director', token: MASTER, scope: null },
      { id: QA.id, role: QA.id, token: QA_TOKEN, scope: QA.tools },
    ],
  })
  await server.start()
})

afterAll(() => {
  server?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('MCP v2 server', () => {
  it('rejects an unknown bearer token with 401', async () => {
    const out = await post('nope', rpc(1, 'ping'))
    expect(out.status).toBe(401)
  })

  it('negotiates a supported protocol version instead of echoing the client', async () => {
    const out = await post(MASTER, rpc(1, 'initialize', { protocolVersion: '2026-07-28', capabilities: {} }))
    expect(out.json.result.protocolVersion).toBe('2025-06-18')
    expect(out.json.result.capabilities.tools).toBeTruthy()
  })

  it('filters tools/list by the token scope', async () => {
    const out = await post(QA_TOKEN, rpc(2, 'tools/list'))
    const names = out.json.result.tools.map((t: any) => t.name).sort()
    expect(names).toEqual([...QA.tools].sort())
    expect(names).not.toContain('script_write')
  })

  it('refuses an out-of-scope tool with LINDEN_E_SCOPE and does not run it', async () => {
    const out = await post(
      QA_TOKEN,
      rpc(3, 'tools/call', { name: 'script_write', arguments: { scriptPath: 'scripts/x.ts', code: '' } })
    )
    expect(out.status).toBe(200)
    expect(out.json.error.code).toBe(-32003)
    expect(out.json.error.message).toContain('LINDEN_E_SCOPE')
    expect(fs.existsSync(path.join(tmp, 'scripts/x.ts'))).toBe(false)
  })

  it('runs an in-scope tool for the full-access token', async () => {
    const out = await post(MASTER, rpc(4, 'tools/call', { name: 'project_info', arguments: {} }))
    expect(out.json.result.isError).toBe(false)
    const data = JSON.parse(out.json.result.content[0].text)
    expect(data.name).toBe('Bridge Test')
  })

  it('rejects a write whose base hash is stale', async () => {
    const out = await post(
      MASTER,
      rpc(5, 'tools/call', {
        name: 'scene_apply',
        arguments: { scenePath: 'scenes/Main.lscene', entities: [] },
        _meta: { linden: { baseHash: 'deadbeef' } },
      })
    )
    expect(out.json.error.code).toBe(-32009)
    expect(out.json.error.message).toContain('stale-base')
  })

  it('accepts a write whose base hash matches, and releases the lease', async () => {
    const current = fs.readFileSync(path.join(tmp, 'scenes/Main.lscene'), 'utf-8')
    const hash = (await import('node:crypto')).createHash('sha256').update(current).digest('hex')
    const out = await post(
      MASTER,
      rpc(6, 'tools/call', {
        name: 'scene_apply',
        arguments: { scenePath: 'scenes/Main.lscene', settings: { ambientIntensity: 0.5 } },
        _meta: { linden: { baseHash: hash, sessionId: 'dsh-1', turnId: 't1' } },
      })
    )
    expect(out.json.result.isError).toBe(false)
    expect(server.getStatus().locks).toHaveLength(0)
  })

  it('exposes the connected roles through agent status without tokens', async () => {
    const out = await post(MASTER, rpc(7, 'tools/call', { name: 'agent_status', arguments: {} }))
    const data = JSON.parse(out.json.result.content[0].text)
    expect(data.running).toBe(true)
    expect(data.clients.map((c: any) => c.id)).toContain(QA.id)
    expect(JSON.stringify(data)).not.toContain(QA_TOKEN)
  })
})
