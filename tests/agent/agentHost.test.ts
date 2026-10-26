import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentHost, compareVersions, parseOpencodeVersion } from '../../electron/agent/AgentHost'
import { LindenMcpServer } from '../../electron/agent/LindenMcpServer'
import { validateSceneEntities } from '../../electron/agent/lindenTools'
import { AgentDiffItem, AgentEvent } from '../../shared/agentTypes'

describe('OpenCode version check', () => {
  it('parses CLI output and compares semver', () => {
    expect(parseOpencodeVersion('opencode v2.0.27\n')).toBe('2.0.27')
    expect(parseOpencodeVersion('garbage')).toBeNull()
    expect(compareVersions('2.0.27', '2.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.19.4', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('2.1.0', '2.1.0')).toBe(0)
  })
})

describe('LindenMcpServer', () => {
  let projectDir: string
  let server: LindenMcpServer
  const diffs: AgentDiffItem[] = []

  const rpc = (body: unknown, token = server.token) =>
    fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })

  beforeAll(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-mcp-'))
    server = new LindenMcpServer({ projectPath: projectDir, onDiff: (d) => diffs.push(d) })
    await server.start()
  })

  afterAll(() => {
    server.close()
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('rejects requests without the bearer token', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'wrong')
    expect(res.status).toBe(401)
  })

  it('answers initialize and lists Linden tools without the linden_ prefix', async () => {
    const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).json()
    expect(init.result.protocolVersion).toBe('2025-11-25')
    expect(init.result.capabilities.tools).toBeDefined()

    const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    const names = list.result.tools.map((t: any) => t.name)
    expect(names).toContain('scene_apply')
    expect(names).toContain('export_web')
    expect(names.some((n: string) => n.startsWith('linden_'))).toBe(false)
  })

  it('acknowledges notifications with 202', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
  })

  it('runs tools/call against the project and reports diffs', async () => {
    const res = await (
      await rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'scene_apply',
          arguments: {
            scenePath: 'scenes/Main.lscene',
            entities: [{ id: 'p', name: 'Player', parentId: null, components: [{ type: 'Transform', data: { position: [0, 1, 0] } }] }],
          },
        },
      })
    ).json()
    expect(res.result.isError).toBe(false)
    expect(fs.existsSync(path.join(projectDir, 'scenes/Main.lscene'))).toBe(true)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].action).toBe('create')
  })

  it('returns tool errors as isError content and unknown tools as JSON-RPC errors', async () => {
    const bad = await (
      await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'scene_read', arguments: { scenePath: '../outside.lscene' } } })
    ).json()
    expect(bad.result.isError).toBe(true)

    const unknown = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } })).json()
    expect(unknown.error.code).toBe(-32602)
  })
})

describe('validateSceneEntities', () => {
  it('rejects unknown components and malformed transforms', () => {
    expect(validateSceneEntities([{ id: 'a', name: 'A', components: [{ type: 'Transform', data: { position: [0, 0, 0] } }] } as any])).toBeNull()
    expect(validateSceneEntities([{ id: 'a', name: 'A', components: [{ type: 'NotAComponent' }] } as any])).toMatch(/NotAComponent/)
    expect(validateSceneEntities([{ id: 'a', name: 'A', components: [{ type: 'Transform', data: { scale: [1, 'x', 1] } }] } as any])).toMatch(/scale/)
  })
})

describe('AgentHost permission routing', () => {
  it('forwards permission requests only for watched sessions', () => {
    const host = AgentHost.getInstance()
    const events: AgentEvent[] = []
    host.setEventSender((e) => events.push(e))
    ;(host as any).tracker.watch('ses_perm')

    host.handleEvent({ type: 'permission.asked', data: { sessionID: 'other', id: 'per_0', action: 'shell', resources: ['ls'] } })
    expect(events).toHaveLength(0)

    host.handleEvent({ type: 'permission.asked', data: { sessionID: 'ses_perm', id: 'per_1', action: 'shell', resources: ['ls', 'pwd'] } })
    expect(events.at(-1)).toMatchObject({ type: 'permission_requested', data: { id: 'per_1', action: 'shell', resources: ['ls', 'pwd'] } })

    host.handleEvent({
      type: 'permission.asked',
      data: {
        sessionID: 'ses_perm',
        id: 'per_2',
        action: 'edit',
        resources: ['a.txt'],
        metadata: { files: [{ file: 'a.txt', status: 'added', additions: 3, deletions: 0, patch: '...' }] },
      },
    })
    expect(events.at(-1)).toMatchObject({ data: { files: [{ file: 'a.txt', additions: 3, deletions: 0 }] } })
  })

  it('announces resolution once when OpenCode replies to a request', () => {
    const host = AgentHost.getInstance()
    const events: AgentEvent[] = []
    host.setEventSender((e) => events.push(e))
    host.handleEvent({ type: 'permission.replied', data: { sessionID: 'ses_perm', requestID: 'per_1', reply: 'reject' } })
    host.handleEvent({ type: 'permission.replied', data: { sessionID: 'ses_perm', requestID: 'per_1', reply: 'reject' } })
    expect(events.filter((e) => e.type === 'permission_resolved')).toEqual([
      { type: 'permission_resolved', sessionId: 'ses_perm', data: { id: 'per_1' } },
    ])
  })
})

describe('linden_play headless simulation', () => {
  const scene = (withGround: boolean) =>
    JSON.stringify({
      format: 'linden-scene',
      version: 2,
      name: 'Sim',
      entities: [
        ...(withGround
          ? [{ id: 'g', name: 'Ground', parentId: null, components: [
              { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
              { type: 'Rigidbody', data: { bodyType: 'static' } },
              { type: 'BoxCollider', data: { size: { x: 20, y: 1, z: 20 } } },
            ] }]
          : []),
        { id: 'b', name: 'Crate', parentId: null, components: [
          { type: 'Transform', data: { position: [0, 5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
          { type: 'Rigidbody', data: { bodyType: 'dynamic', mass: 1 } },
          { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } },
        ] },
      ],
    })

  it('lands a dynamic body on a static ground', async () => {
    const { simulateScene } = await import('../../electron/agent/lindenTools')
    const report = await simulateScene(scene(true), 3)
    expect(report.errors).toEqual([])
    expect(report.simulatedSeconds).toBe(3)
    expect(report.finalPositions.Crate[1]).toBeGreaterThan(0)
    expect(report.finalPositions.Crate[1]).toBeLessThan(5)
  })

  it('reports a body falling out of the world', async () => {
    const { simulateScene } = await import('../../electron/agent/lindenTools')
    const report = await simulateScene(scene(false), 5)
    expect(report.errors.join(' ')).toMatch(/Crate.*jatuh/)
  })
})

describe('agent confined to the project folder', () => {
  it('only accepts an absolute folder that holds project.linden.json', async () => {
    const { projectFolderError } = await import('../../electron/agent/AgentHost')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-folder-'))
    try {
      expect(projectFolderError('relative/path')).toMatch(/absolut/)
      expect(projectFolderError(path.join(dir, 'missing'))).toMatch(/tidak ditemukan/)
      expect(projectFolderError(dir)).toMatch(/Bukan folder proyek Linden/)
      fs.writeFileSync(path.join(dir, 'project.linden.json'), '{}')
      expect(projectFolderError(dir)).toBeNull()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('only accepts projects inside the projects root when one is set', async () => {
    const { projectFolderError } = await import('../../electron/agent/AgentHost')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-root-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-outside-'))
    const inside = path.join(root, 'Game')
    try {
      fs.mkdirSync(inside)
      fs.writeFileSync(path.join(inside, 'project.linden.json'), '{}')
      fs.writeFileSync(path.join(outside, 'project.linden.json'), '{}')
      expect(projectFolderError(inside, root)).toBeNull()
      expect(projectFolderError(outside, root)).toMatch(/hanya berjalan di proyek/)
      expect(projectFolderError(root, root)).toMatch(/hanya berjalan di proyek/)
      // A symlink inside the root that points outside it is refused too
      fs.symlinkSync(outside, path.join(root, 'link'))
      expect(projectFolderError(path.join(root, 'link'), root)).toMatch(/hanya berjalan di proyek/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('denies /tmp paths and shell commands that use /tmp', async () => {
    const { SESSION_PERMISSIONS } = await import('../../electron/agent/AgentHost')
    const denied = SESSION_PERMISSIONS.filter((r) => r.action === '*' && r.effect === 'deny').map((r) => r.resource)
    for (const resource of ['/tmp', '/tmp/*', '/private/tmp/*', '* /tmp*', '*>/tmp*', '*=/tmp*']) {
      expect(denied).toContain(resource)
    }
    // The deny rules come after every allow rule, so no allow can override them
    const lastAllow = SESSION_PERMISSIONS.map((r) => r.effect).lastIndexOf('allow')
    expect(SESSION_PERMISSIONS.findIndex((r) => r.resource === '/tmp')).toBeGreaterThan(lastAllow)
  })

  it('refuses to start in a non-project folder and writes nothing there', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-notproject-'))
    try {
      const status = await AgentHost.getInstance().startServer(dir)
      expect(status.running).toBe(false)
      expect(status.error).toMatch(/Bukan folder proyek Linden/)
      expect(fs.readdirSync(dir)).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('always denies access outside the session folder last, so no earlier rule can allow it', async () => {
    const { SESSION_PERMISSIONS } = await import('../../electron/agent/AgentHost')
    expect(SESSION_PERMISSIONS.at(-1)).toEqual({ action: 'external_directory', resource: '*', effect: 'deny' })
  })
})
