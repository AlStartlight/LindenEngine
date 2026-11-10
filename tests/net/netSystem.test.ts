import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import WebSocket from 'ws'
import { World } from '../../engine/ecs/World'
import { GameSimulation } from '../../engine/runtime/GameSimulation'
import { ScriptRuntime } from '../../engine/scripting/ScriptRuntime'
import { NetSystem } from '../../engine/net/NetSystem'
import { offlineNet } from '../../engine/net/netApi'
import { normalizeMultiplayer, resolveServerUrl, roomFromUrl } from '../../shared/net/config'
import { RoomServer } from '../../server/net/RoomServer'
import '../../engine/ecs/ComponentRegistry'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** What the test scripts saw, per client */
interface Seen {
  events: [string, unknown, string][]
  joins: string[]
  leaves: string[]
  hosts: string[]
  inits: { entity: string; isMine: boolean }[]
}

function buildScene(world: World, opts: { dynamicAvatar?: boolean } = {}) {
  const ground = world.createEntity('Ground')
  ground.getTransform().position = { x: 0, y: -0.5, z: 0 }
  world.addComponent(ground.id, 'BoxCollider', { size: { x: 100, y: 1, z: 100 } })

  const tpl = world.createEntity('Ship', null, undefined, 'tpl-ship')
  tpl.getTransform().position = { x: 0, y: 5, z: 0 }
  world.addComponent(tpl.id, 'NetworkSync', { template: 'player' })
  world.addComponent(tpl.id, 'Script', { src: 'scripts/Ship.ts' })
  if (opts.dynamicAvatar) {
    world.addComponent(tpl.id, 'Rigidbody', { bodyType: 'dynamic' })
    world.addComponent(tpl.id, 'BoxCollider', { size: { x: 1, y: 1, z: 1 } })
  }
  const cam = world.createEntity('ShipCam', tpl.id, undefined, 'tpl-cam')
  world.addComponent(cam.id, 'Camera', {})

  const bullet = world.createEntity('Bullet', null, undefined, 'tpl-bullet')
  world.addComponent(bullet.id, 'NetworkSync', { template: 'bullet' })

  const door = world.createEntity('Door', null, undefined, 'door')
  world.addComponent(door.id, 'NetworkSync', {})
}

async function client(url: string | null, name: string, opts: { dynamicAvatar?: boolean; room?: string } = {}) {
  const world = new World()
  buildScene(world, opts)
  const sim = new GameSimulation(world)
  const seen: Seen = { events: [], joins: [], leaves: [], hosts: [], inits: [] }
  const net = new NetSystem({
    world,
    sim,
    config: normalizeMultiplayer({ enabled: true, tickRate: 30, interpolationMs: 50 }),
    url,
    name,
    room: opts.room,
    socket: (u) => new WebSocket(u) as any,
    warn: () => {},
  })
  net.prepare()
  await net.connect()
  sim.net = net
  await sim.initPhysics()
  const Ship = class {
    ctx: any
    onInit(ctx: any) {
      this.ctx = ctx
      seen.inits.push({ entity: ctx.entity.id, isMine: ctx.net.isMine })
    }
    onNetEvent(n: string, d: unknown, from: string) {
      // One record per client (every avatar copy runs this script)
      if (this.ctx.net.isMine) seen.events.push([n, d, from])
    }
    onNetJoin(p: any) {
      if (this.ctx.net.isMine) seen.joins.push(p.name)
    }
    onNetLeave(p: any) {
      if (this.ctx.net.isMine) seen.leaves.push(p.name)
    }
    onNetHost(id: string) {
      if (this.ctx.net.isMine) seen.hosts.push(id)
    }
  }
  const scripts = new ScriptRuntime({ world, loadModule: async () => ({ default: Ship }), createNet: (e) => net.api(e), log: () => {} })
  sim.scripts = scripts
  await scripts.loadAll()
  sim.startComponents()
  await net.start()
  return { world, sim, net, seen, me: () => net.localPlayerId! }
}

type Client = Awaited<ReturnType<typeof client>>

/** Advance both games in real time (interpolation follows the server clock) */
async function run(clients: Client[], ms: number, each?: () => void) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    each?.()
    for (const c of clients) c.sim.frame(1 / 60)
    await sleep(16)
  }
}

let server: RoomServer
const open: Client[] = []
beforeEach(async () => {
  server = new RoomServer()
  await server.start()
})
afterEach(async () => {
  for (const c of open.splice(0)) c.sim.dispose()
  await server.close()
})

async function pair(opts: { dynamicAvatar?: boolean } = {}) {
  const a = await client(server.url, 'Asep', opts)
  open.push(a)
  const b = await client(server.url, 'Budi', opts)
  open.push(b)
  await run([a, b], 150)
  return { a, b }
}

describe('NetSystem (two headless games)', () => {
  it('gives every player an avatar from the template and hides the template itself', async () => {
    const { a, b } = await pair()
    for (const c of [a, b]) {
      expect(c.world.getEntity('tpl-ship')).toBeUndefined()
      expect(c.world.getEntity('tpl-bullet')).toBeUndefined()
      expect(c.world.getEntity(`${a.me()}:player`)).toBeDefined()
      expect(c.world.getEntity(`${b.me()}:player`)).toBeDefined()
    }
    // Copies keep the template's children with derived ids
    expect(a.world.getEntity(`${b.me()}:player/tpl-cam`)?.parentId).toBe(`${b.me()}:player`)
    // Another player's camera never becomes active here
    expect((a.world.getEntity(`${b.me()}:player/tpl-cam`)!.getComponent('Camera') as any).isActive).toBe(false)
    expect((a.world.getEntity(`${a.me()}:player/tpl-cam`)!.getComponent('Camera') as any).isActive).toBe(true)
    expect(a.world.getEntity(`${b.me()}:player`)!.name).toBe('Ship (Budi)')
    // Scripts run on every copy and know which one is theirs
    expect(a.seen.inits).toEqual(expect.arrayContaining([{ entity: `${a.me()}:player`, isMine: true }, { entity: `${b.me()}:player`, isMine: false }]))
    expect(b.seen.joins).toEqual([])
    expect(a.seen.joins).toEqual(['Budi'])
  })

  it('moves a remote avatar smoothly to where its owner put it', async () => {
    const { a, b } = await pair()
    const mine = a.world.getEntity(`${a.me()}:player`)!.getTransform()
    const copy = () => b.world.getEntity(`${a.me()}:player`)!.getTransform()
    let x = 0
    const xs: number[] = []
    await run([a, b], 600, () => {
      x = Math.min(3, x + 0.05)
      mine.position = { x, y: 5, z: 0 }
      mine.rotation = { x: 0, y: x * 30, z: 0 }
      xs.push(copy().position.x)
    })
    await run([a, b], 200)
    expect(x).toBeGreaterThan(1)
    expect(copy().position.x).toBeCloseTo(x, 2)
    expect(copy().rotation.y).toBeCloseTo(x * 30, 1)
    // Interpolated, not teleported: the remote copy passes through in-between positions
    expect(new Set(xs.map((v) => Math.round(v * 10))).size).toBeGreaterThan(8)
    // B cannot move A's avatar for A
    copy().position = { x: -50, y: 5, z: 0 }
    await run([a, b], 150)
    expect(mine.position.x).toBe(x)
  })

  it('keeps a remote dynamic body kinematic so it does not fall on its own', async () => {
    const { a, b } = await pair({ dynamicAvatar: true })
    const remoteId = `${a.me()}:player`
    expect(b.sim.isPuppet(remoteId)).toBe(true)
    // A holds its dynamic avatar in the air through physics; a dynamic copy on B would fall
    // between snapshots (its body overrides the Transform), a kinematic puppet follows exactly
    await run([a, b], 500, () => {
      a.sim.physics!.setTranslation(remoteId, { x: 10, y: 5, z: 0 })
      a.sim.physics!.setLinearVelocity(remoteId, { x: 0, y: 0, z: 0 })
    })
    expect(a.world.getEntity(remoteId)!.getTransform().position.y).toBeCloseTo(5, 1)
    expect(b.world.getEntity(remoteId)!.getTransform().position.y).toBeCloseTo(5, 1)
    // ...while B's own avatar is a normal dynamic body, falling under gravity
    expect(b.world.getEntity(`${b.me()}:player`)!.getTransform().position.y).toBeLessThan(4.5)
    expect(b.sim.isPuppet(`${b.me()}:player`)).toBe(false)
    // and the second player's avatar starts away from the first one's
    const first = a.world.getEntity(remoteId)!
    expect(first.name).toBe('Ship (Asep)')
  })

  it('lets only the host drive scene entities and hands them over when the host leaves', async () => {
    const { a, b } = await pair()
    expect(a.net.isHost).toBe(true)
    expect(b.net.isHost).toBe(false)
    const doorA = a.world.getEntity('door')!.getTransform()
    const doorB = b.world.getEntity('door')!.getTransform()
    await run([a, b], 300, () => {
      doorA.position = { x: 0, y: 2, z: 0 }
      doorB.position = { x: 9, y: 9, z: 9 }
    })
    expect(doorA.position.y).toBe(2)
    expect(b.net.isMine(b.world.getEntity('door')!)).toBe(false)

    a.sim.dispose()
    open.splice(open.indexOf(a), 1)
    await run([b], 300)
    expect(b.net.isHost).toBe(true)
    expect(b.net.isMine(b.world.getEntity('door')!)).toBe(true)
    expect(b.world.getEntity(`${a.me()}:player`)).toBeUndefined()
    expect(b.seen.leaves).toEqual(['Asep'])
    expect(b.seen.hosts).toEqual([b.me()])
  })

  it('delivers script events and shared room state', async () => {
    const { a, b } = await pair()
    const apiA = a.net.api(a.world.getEntity(`${a.me()}:player`)!)
    const apiB = b.net.api(b.world.getEntity(`${b.me()}:player`)!)
    const got: unknown[] = []
    apiB.state.on('score', (v) => got.push(v))
    apiA.send('fire', { power: 3 })
    apiA.send('whisper', 'hi', { to: b.me() })
    apiA.state.set('score', { red: 2 })
    expect(apiA.state.get('score')).toEqual({ red: 2 })
    await run([a, b], 200)
    expect(a.seen.events).toEqual([['fire', { power: 3 }, a.me()]])
    expect(b.seen.events).toEqual([
      ['fire', { power: 3 }, a.me()],
      ['whisper', 'hi', a.me()],
    ])
    expect(got).toEqual([{ red: 2 }])
    expect(apiB.state.all()).toEqual({ score: { red: 2 } })
    expect(apiB.players.map((p) => [p.name, p.isHost, p.isLocal])).toEqual([
      ['Asep', true, false],
      ['Budi', false, true],
    ])
  })

  it('spawns and destroys networked entities from scripts, also for late joiners', async () => {
    const { a, b } = await pair()
    const apiA = a.net.api(a.world.getEntity(`${a.me()}:player`)!)
    const shot = apiA.spawn('bullet', { position: { x: 1, y: 2, z: 3 }, data: { dmg: 5 } })!
    expect(shot.id).toBe(`${a.me()}:bullet-1`)
    await run([a, b], 150)
    const copy = b.world.getEntity(shot.id)!
    expect(copy.getTransform().position).toEqual({ x: 1, y: 2, z: 3 })
    expect(b.net.api(copy).spawnData()).toEqual({ dmg: 5 })
    expect(b.net.api(copy).owner()).toBe(a.me())
    expect(b.net.api(copy).destroy(copy)).toBe(false)

    // The host collects a scene entity; a late joiner never sees it
    a.world.destroyEntity('door')
    await run([a, b], 150)
    expect(b.world.getEntity('door')).toBeUndefined()
    const c = await client(server.url, 'Cici')
    open.push(c)
    await run([a, b, c], 150)
    expect(c.world.getEntity(shot.id)).toBeDefined()
    expect(c.world.getEntity('door')).toBeUndefined()

    expect(apiA.destroy(shot)).toBe(true)
    await run([a, b, c], 150)
    expect(b.world.getEntity(shot.id)).toBeUndefined()
    expect(c.world.getEntity(shot.id)).toBeUndefined()
    expect(apiA.spawn('nope')).toBeNull()
  })

  it('plays offline when no server is set or reachable', async () => {
    const off = await client(null, 'Solo')
    open.push(off)
    expect(off.net.connected).toBe(false)
    const avatar = off.world.getEntity('local:player')!
    expect(avatar).toBeDefined()
    const api = off.net.api(avatar)
    expect(api.isMine).toBe(true)
    expect(api.isHost).toBe(true)
    api.send('ping', 1)
    await run([off], 50)
    expect(off.seen.events).toEqual([['ping', 1, 'local']])

    const unreachable = await client('ws://127.0.0.1:1/net', 'X')
    open.push(unreachable)
    expect(unreachable.net.connected).toBe(false)
    expect(unreachable.world.getEntity('local:player')).toBeDefined()
  })
})

describe('multiplayer config and the offline ctx.net stub', () => {
  it('normalizes the project block and picks the server URL', () => {
    expect(normalizeMultiplayer(undefined)).toMatchObject({ enabled: false, tickRate: 15, maxPlayers: 16, room: 'auto' })
    expect(normalizeMultiplayer({ enabled: true, tickRate: 500, serverUrl: 'http://x', room: 'code' })).toMatchObject({ enabled: true, tickRate: 60, serverUrl: '', room: 'code' })
    const cfg = normalizeMultiplayer({ enabled: true, serverUrl: 'wss://game.example.com/net' })
    expect(resolveServerUrl(cfg, 'https://cdn.example.com/game/index.html')).toBe('wss://game.example.com/net')
    expect(resolveServerUrl(cfg, 'linden-game://play/s1/index.html?net=ws://127.0.0.1:5000/net')).toBe('ws://127.0.0.1:5000/net')
    const same = normalizeMultiplayer({ enabled: true })
    expect(resolveServerUrl(same, 'https://mygame.com/play/')).toBe('wss://mygame.com/net')
    expect(resolveServerUrl(same, 'http://127.0.0.1:8080/index.html')).toBe('ws://127.0.0.1:8080/net')
    expect(resolveServerUrl(same, 'linden-game://play/s1/index.html')).toBeNull()
    expect(roomFromUrl('http://x/?room=arena&name=Asep')).toEqual({ room: 'arena', name: 'Asep' })
  })

  it('offline stub runs multiplayer scripts single-player', async () => {
    const got: unknown[] = []
    const net = offlineNet((name, data) => got.push([name, data]))
    expect([net.enabled, net.connected, net.isMine, net.isHost]).toEqual([false, false, true, true])
    net.send('a', 1)
    net.send('b', 2, { to: 'others' })
    net.state.set('k', 5)
    expect(net.state.get('k')).toBe(5)
    await Promise.resolve()
    expect(got).toEqual([['a', 1]])
    expect(net.spawn('x')).toBeNull()
  })
})

describe('avatar spawn points', () => {
  it('puts the first player on the template and spreads the others around it', async () => {
    const server2 = new RoomServer()
    await server2.start()
    const cs: Client[] = []
    try {
      for (const n of ['A', 'B', 'C']) cs.push(await client(server2.url, n))
      const pos = cs.map((c) => c.world.getEntity(`${c.me()}:player`)!.getTransform().position)
      expect(pos[0]).toEqual({ x: 0, y: 5, z: 0 })
      for (const p of pos.slice(1)) {
        expect(p.y).toBe(5)
        expect(Math.hypot(p.x, p.z)).toBeGreaterThan(1.9)
      }
      expect(Math.hypot(pos[1].x - pos[2].x, pos[1].z - pos[2].z)).toBeGreaterThan(1.5)
    } finally {
      for (const c of cs) c.sim.dispose()
      await server2.close()
    }
  })
})
