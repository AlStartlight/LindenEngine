import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { AgentBridgeService } from '../../electron/agent/AgentBridgeService'
import { LINDEN_AGENT_ROLES } from '../../electron/agent/lindenRoles'

/**
 * End-to-end: engine bridge → published manifest → stdio bridge → MCP server.
 * This is the path DeepSeek Harness and custom agents take, without Electron.
 */

const REPO = path.resolve(__dirname, '../..')
const BRIDGE_SCRIPT = path.join(REPO, 'integrations/dsh/bin/linden-agent-bridge.mjs')
const bridge = AgentBridgeService.getInstance()

let root = ''
let project = ''
let child: ChildProcessWithoutNullStreams

class Client {
  private buffer = ''
  private pending = new Map<number, (msg: any) => void>()
  private nextId = 1
  stderr = ''

  constructor(process: ChildProcessWithoutNullStreams) {
    child = process
    child.stderr.on('data', (c) => (this.stderr += String(c)))
    child.stdout.on('data', (chunk) => {
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
      const timer = setTimeout(() => reject(new Error(`timeout ${method}: ${this.stderr}`)), 10_000)
      this.pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return promise
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-bridge-e2e-'))
  process.env.LINDEN_AGENT_BRIDGE_HOME = path.join(root, 'home')
  project = path.join(root, 'game')
  fs.mkdirSync(path.join(project, 'scenes'), { recursive: true })
  fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'E2E Game', version: '1.0.0' }))
  fs.writeFileSync(
    path.join(project, 'scenes/Main.lscene'),
    JSON.stringify({
      format: 'linden-scene',
      version: 2,
      name: 'Main',
      settings: {},
      entities: [{ id: 'ground', name: 'Ground', parentId: null, components: [{ type: 'Transform', data: { position: [0, -1, 0] } }] }],
    })
  )
  await bridge.start(project)
})

afterAll(() => {
  child?.kill()
  bridge.stop()
  delete process.env.LINDEN_AGENT_BRIDGE_HOME
  fs.rmSync(root, { recursive: true, force: true })
})

describe('engine → stdio bridge → MCP server', () => {
  it('lists exactly the role scope and runs a scoped tool', async () => {
    const qa = LINDEN_AGENT_ROLES.find((r) => r.id === 'linden-qa-physics-tester')!
    child = spawn(process.execPath, [BRIDGE_SCRIPT, '--agent', qa.id, '--project', project], {
      cwd: REPO,
      env: { ...process.env, LINDEN_MCP_TIMEOUT_MS: '10000' },
    })
    const client = new Client(child)

    const init = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '0.1.0' },
    })
    expect(init.result.serverInfo.name).toBe('linden')

    const list = await client.request('tools/list')
    const names = list.result.tools.map((t: any) => t.name).sort()
    expect(names).toEqual([...qa.tools].sort())

    const validate = await client.request('tools/call', {
      name: 'scene_validate',
      arguments: { scenePath: 'scenes/Main.lscene' },
    })
    expect(validate.result.isError).toBe(false)
    const report = JSON.parse(validate.result.content[0].text)
    expect(report.ok).toBe(true)
    expect(report.entityCount).toBe(1)

    const denied = await client.request('tools/call', {
      name: 'script_write',
      arguments: { scriptPath: 'scripts/x.ts', code: '' },
    })
    expect(denied.result.isError).toBe(true)
    expect(fs.existsSync(path.join(project, 'scripts/x.ts'))).toBe(false)
  })

  it('attaches to the same manifest after the engine rotated its endpoint', async () => {
    await bridge.restart()
    const client = new Client(
      spawn(process.execPath, [BRIDGE_SCRIPT, '--agent', 'linden-game-architect', '--project', project], {
        cwd: REPO,
        env: { ...process.env, LINDEN_MCP_TIMEOUT_MS: '10000' },
      })
    )
    const list = await client.request('tools/list')
    expect(list.result.tools.map((t: any) => t.name)).toContain('scene_apply')
  })
})
