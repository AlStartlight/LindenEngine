import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentBridgeService } from '../../electron/agent/AgentBridgeService'
import { LINDEN_AGENT_ROLES } from '../../electron/agent/lindenRoles'

/**
 * Agent Bridge P0: discovery manifests, per-role tokens, project switching and
 * token/port rotation. The bridge is the only thing external agents need to find.
 */

const bridge = AgentBridgeService.getInstance()
let root = ''
let projectA = ''
let projectB = ''
let manifestA = ''
let manifestB = ''
let lastPointer = ''

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'))

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-bridge-svc-'))
  process.env.LINDEN_AGENT_BRIDGE_HOME = path.join(root, 'home')
  projectA = path.join(root, 'game-a')
  projectB = path.join(root, 'game-b')
  for (const [dir, name] of [
    [projectA, 'Game A'],
    [projectB, 'Game B'],
  ] as const) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'project.linden.json'), JSON.stringify({ name, version: '1.0.0' }))
  }
  manifestA = path.join(projectA, '.linden', 'agent-bridge.json')
  manifestB = path.join(projectB, '.linden', 'agent-bridge.json')
  lastPointer = path.join(root, 'home', '.linden', 'agent-bridge', 'last.json')
  await bridge.start(projectA)
})

afterAll(() => {
  bridge.stop()
  delete process.env.LINDEN_AGENT_BRIDGE_HOME
  fs.rmSync(root, { recursive: true, force: true })
})

describe('AgentBridgeService', () => {
  it('publishes a discoverable manifest with one token per role', () => {
    expect(fs.existsSync(manifestA)).toBe(true)
    const manifest = readJson(manifestA)
    expect(manifest.format).toBe('linden-agent-bridge')
    expect(manifest.endpoint).toBe(bridge.endpoint)
    expect(manifest.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(manifest.projectName).toBe('Game A')
    expect(manifest.protocolVersion).toBe('2025-06-18')
    expect(Object.keys(manifest.tokens)).toHaveLength(LINDEN_AGENT_ROLES.length + 1)
    expect(Object.keys(manifest.scopes)).toHaveLength(LINDEN_AGENT_ROLES.length)
    expect(manifest.tokens.master).toBe(bridge.token)
    expect(manifest.tokens['linden-qa-physics-tester']).not.toBe(bridge.token)
    expect(manifest.scopes['linden-qa-physics-tester']).toContain('play')
  })

  it('keeps the manifest private (0600) and writes the last-opened pointer', () => {
    if (process.platform !== 'win32') {
      expect(fs.statSync(manifestA).mode & 0o777).toBe(0o600)
    }
    expect(fs.existsSync(lastPointer)).toBe(true)
    expect(readJson(lastPointer).projectPath).toBe(projectA)
  })

  it('moves to a new project without rotating the endpoint and drops the old manifest', async () => {
    const endpoint = bridge.endpoint
    const master = bridge.token
    await bridge.start(projectB)
    expect(bridge.endpoint).toBe(endpoint)
    expect(bridge.token).toBe(master)
    expect(fs.existsSync(manifestB)).toBe(true)
    expect(fs.existsSync(manifestA)).toBe(false)
    expect(readJson(manifestB).projectName).toBe('Game B')
  })

  it('rotates endpoint and tokens on restart', async () => {
    const endpoint = bridge.endpoint
    const master = bridge.token
    await bridge.restart()
    expect(bridge.endpoint).not.toBe(endpoint)
    expect(bridge.token).not.toBe(master)
    const manifest = readJson(manifestB)
    expect(manifest.endpoint).toBe(bridge.endpoint)
    expect(manifest.tokens.master).toBe(bridge.token)
  })

  it('reports status without leaking tokens', () => {
    const status = bridge.getStatus()!
    expect(status.running).toBe(true)
    expect(status.clients).toHaveLength(LINDEN_AGENT_ROLES.length + 1)
    expect(status.manifestPath).toBe(manifestB)
    expect(JSON.stringify(status)).not.toContain(bridge.token)
  })

  it('removes the published endpoint on stop', () => {
    bridge.stop()
    expect(fs.existsSync(manifestB)).toBe(false)
    expect(fs.existsSync(lastPointer)).toBe(false)
    expect(bridge.getStatus()).toBeNull()
  })
})
