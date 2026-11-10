import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LINDEN_TOOLS } from '../../electron/agent/lindenTools'

let dir = ''
afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }))

function makeProject(extra: Record<string, string> = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-net-tools-'))
  const scene = {
    format: 'linden-scene',
    version: 2,
    name: 'Main',
    entities: [
      { id: 'ground', name: 'Ground', active: true, static: true, tags: [], layer: 0, parentId: null, components: [
        { type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [100, 1, 100] } },
        { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } },
      ] },
      { id: 'player', name: 'Player', active: true, static: false, tags: ['Player'], layer: 0, parentId: null, components: [
        { type: 'Transform', data: { position: [0, 1.05, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } },
        { type: 'CharacterController', data: {} },
        { type: 'CharacterMovement', data: { walkSpeed: 4 } },
        { type: 'Script', data: { src: 'scripts/Player.ts', props: {} } },
      ] },
    ],
  }
  const files: Record<string, string> = {
    'project.linden.json': JSON.stringify({ name: 'T', version: '1', scenesInBuild: ['scenes/Main.lscene'] }),
    'scenes/Main.lscene': JSON.stringify(scene, null, 2),
    'scripts/Player.ts': `export default class Player {
  ctx: any
  onInit(ctx: any) { this.ctx = ctx }
  onUpdate() {
    if (!this.ctx.net.isMine) return
    if (this.ctx.time.frameCount === 30) this.ctx.net.send('hello', { n: 1 })
  }
}
`,
    ...extra,
  }
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
}

const run = (name: string, args: unknown) => LINDEN_TOOLS[name].execute(dir, args as any, {})

describe('linden_multiplayer_setup + linden_play {clients}', () => {
  it('turns multiplayer on, makes the player the avatar template, and plays two synced clients', async () => {
    makeProject()
    const setup = await run('linden_multiplayer_setup', { playerEntityId: 'player', tickRate: 20 })
    expect(setup.success).toBe(true)
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'project.linden.json'), 'utf-8'))
    expect(cfg.multiplayer).toMatchObject({ enabled: true, tickRate: 20 })
    const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scenes/Main.lscene'), 'utf-8'))
    expect(scene.entities[1].components.find((c: any) => c.type === 'NetworkSync').data.template).toBe('player')

    const res = await run('linden_play', { clients: 2, durationSeconds: 1.5, inputScript: [{ at: 0, action: 'Move', value: [0, 1] }] })
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    const { clients, sync, events, warnings } = res.data
    expect(clients.map((c: any) => [c.name, c.connected, c.players, c.avatars.length])).toEqual([
      ['Klien 1', true, 2, 2],
      ['Klien 2', true, 2, 2],
    ])
    expect(clients.filter((c: any) => c.host)).toHaveLength(1)
    expect(sync.maxPositionError).toBeLessThan(0.1)
    // Each client's own avatar sent one event to everyone
    expect(events.filter((e: any) => e.name === 'hello')).toHaveLength(4)
    expect(warnings.some((w: string) => /isMine/.test(w))).toBe(false)
  }, 60_000)

  it('warns about networked scripts that do not check isMine, and about multiplayer still off', async () => {
    makeProject({ 'scripts/Player.ts': 'export default class Player { onUpdate() {} }\n' })
    const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scenes/Main.lscene'), 'utf-8'))
    scene.entities[1].components.push({ type: 'NetworkSync', data: { template: 'player' } })
    fs.writeFileSync(path.join(dir, 'scenes/Main.lscene'), JSON.stringify(scene))
    const res = await run('linden_play', { clients: 2, durationSeconds: 0.5 })
    expect(res.data.warnings.some((w: string) => /tidak memeriksa ctx\.net\.isMine/.test(w))).toBe(true)
    expect(res.data.warnings.some((w: string) => /multiplayer\.enabled belum true/.test(w))).toBe(true)
  }, 60_000)

  it('reports a bad entity id', async () => {
    makeProject()
    const res = await run('linden_multiplayer_setup', { playerEntityId: 'nope' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/tidak ada/)
  })
})
