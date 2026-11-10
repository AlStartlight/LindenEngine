import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { RoomServer, type RoomServerOptions } from '../../server/net/RoomServer'
import { NET_PROTOCOL_VERSION, type ServerMessage, parseClientMessage, quantize, sanitizeName, sanitizeRoom, ownsEntityId } from '../../shared/net/protocol'

/** Test client: records every server message and can wait for one */
class TestClient {
  ws: WebSocket
  messages: ServerMessage[] = []
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []
  closed = new Promise<number>((resolve) => this.ws?.on('close', (code) => resolve(code)))

  constructor(url: string, origin?: string) {
    this.ws = new WebSocket(url, origin ? { origin } : undefined)
    this.closed = new Promise<number>((resolve) => this.ws.on('close', (code) => resolve(code)))
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage
      this.messages.push(msg)
      const i = this.waiters.findIndex((w) => w.pred(msg))
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg)
    })
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve()
      this.ws.once('open', () => resolve())
      this.ws.once('error', reject)
    })
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  next<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 2000): Promise<Extract<ServerMessage, { t: T }>> {
    const seen = this.messages.find((m) => m.t === t && pred(m as any))
    if (seen) {
      this.messages.splice(this.messages.indexOf(seen), 1)
      return Promise.resolve(seen as any)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout menunggu ${t}`)), ms)
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as any),
        resolve: (m) => {
          clearTimeout(timer)
          this.messages.splice(this.messages.indexOf(m), 1)
          resolve(m as any)
        },
      })
    })
  }

  async join(room = 'default', name?: string) {
    await this.open()
    this.send({ t: 'hello', v: NET_PROTOCOL_VERSION, room, name })
    return this.next('welcome')
  }

  close() {
    this.ws.close()
  }
}

let server: RoomServer
const clients: TestClient[] = []
async function start(opts: RoomServerOptions = {}) {
  server = new RoomServer(opts)
  await server.start()
  return server
}
const client = (origin?: string) => {
  const c = new TestClient(server.url, origin)
  clients.push(c)
  return c
}
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate()
  await server?.close()
})

describe('protocol helpers', () => {
  it('validates client messages and sanitizes names', () => {
    expect(parseClientMessage('{"t":"ping","c":1}')).toEqual({ t: 'ping', c: 1 })
    expect(parseClientMessage('{"t":"ping","c":"x"}')).toBeNull()
    expect(parseClientMessage('{"t":"state","e":[["a",[0,0,0],[0,0,0]]],"extra":1}')).toBeNull()
    expect(parseClientMessage('not json')).toBeNull()
    expect(sanitizeName('  <b>Asep</b>\n ', 'x')).toBe('bAsep/b')
    expect(sanitizeName('', 'Pemain 1')).toBe('Pemain 1')
    expect(sanitizeRoom('arena-1')).toBe('arena-1')
    expect(sanitizeRoom('../etc')).toBe('default')
    expect(ownsEntityId('p1ab', 'p1ab:player')).toBe(true)
    expect(ownsEntityId('p1ab', 'p2cd:player')).toBe(false)
    expect(ownsEntityId('p1ab', 'p1ab:')).toBe(false)
    expect(quantize({ x: 1.23456, y: 0, z: -2 }, { x: 10.123, y: 0, z: 0 })).toEqual({ p: [1.235, 0, -2], r: [10.12, 0, 0] })
  })
})

describe('RoomServer', () => {
  it('welcomes players, announces joins/leaves and moves the host to the next player', async () => {
    await start()
    const a = client()
    const wa = await a.join('arena', 'Asep')
    expect(wa).toMatchObject({ v: NET_PROTOCOL_VERSION, room: 'arena', host: wa.playerId, players: [{ id: wa.playerId, name: 'Asep' }], entities: [], removed: [], state: {} })

    const b = client()
    const wb = await b.join('arena', 'Budi')
    expect(wb.host).toBe(wa.playerId)
    expect(wb.players.map((p) => p.name)).toEqual(['Asep', 'Budi'])
    expect(await a.next('joined')).toEqual({ t: 'joined', player: { id: wb.playerId, name: 'Budi' } })

    a.close()
    expect(await b.next('left')).toEqual({ t: 'left', id: wa.playerId })
    expect(await b.next('host')).toEqual({ t: 'host', id: wb.playerId })
    expect(server.stats().rooms).toEqual([{ name: 'arena', players: 1, entities: 0, host: wb.playerId }])
  })

  it('keeps rooms apart', async () => {
    await start()
    const a = client()
    await a.join('one')
    const b = client()
    const wb = await b.join('two')
    expect(wb.players).toHaveLength(1)
    a.send({ t: 'event', name: 'hi' })
    await a.next('event')
    await new Promise((r) => setTimeout(r, 50))
    expect(b.messages.filter((m) => m.t === 'event')).toEqual([])
  })

  it('forwards spawns and snapshots from the owner only, and gives late joiners the last state', async () => {
    await start()
    const a = client()
    const wa = await a.join()
    const b = client()
    const wb = await b.join()
    const id = `${wa.playerId}:player`

    a.send({ t: 'spawn', id, template: 'player', tf: { p: [0, 1, 0], r: [0, 0, 0] } })
    expect(await b.next('spawned')).toEqual({ t: 'spawned', e: { id, owner: wa.playerId, template: 'player', t: { p: [0, 1, 0], r: [0, 0, 0] } } })

    a.send({ t: 'state', e: [[id, [1, 1, 0], [0, 90, 0]]] })
    const st = await b.next('state')
    expect(st.from).toBe(wa.playerId)
    expect(st.e).toEqual([[id, [1, 1, 0], [0, 90, 0]]])

    // B may not move A's entity nor spawn under A's id
    b.send({ t: 'state', e: [[id, [99, 99, 99], [0, 0, 0]]] })
    b.send({ t: 'spawn', id: `${wa.playerId}:fake`, template: 'player' })
    expect((await b.next('error')).code).toBe('forbidden')
    b.send({ t: 'despawn', id })
    expect((await b.next('error')).code).toBe('forbidden')

    const c = client()
    const wc = await c.join()
    expect(wc.entities).toEqual([{ id, owner: wa.playerId, template: 'player', t: { p: [1, 1, 0], r: [0, 90, 0] } }])
    expect(wb.playerId).not.toBe(wc.playerId)
  })

  it('lets only the host drive scene entities, and the next host after it leaves', async () => {
    await start()
    const a = client()
    const wa = await a.join()
    const b = client()
    const wb = await b.join()

    b.send({ t: 'state', e: [['door', [5, 0, 0], [0, 0, 0]]] })
    a.send({ t: 'state', e: [['door', [1, 0, 0], [0, 0, 0]]] })
    expect((await b.next('state')).e).toEqual([['door', [1, 0, 0], [0, 0, 0]]])
    expect(a.messages.filter((m) => m.t === 'state')).toEqual([])

    a.close()
    await b.next('host', (m) => m.id === wb.playerId)
    b.send({ t: 'state', e: [['door', [2, 0, 0], [0, 0, 0]]] })
    const c = client()
    const wc = await c.join()
    expect(wc.entities).toEqual([{ id: 'door', owner: 'room', t: { p: [2, 0, 0], r: [0, 0, 0] } }])
    expect(wa.playerId).not.toBe(wb.playerId)
  })

  it('removes a leaving player\'s entities', async () => {
    await start()
    const a = client()
    const wa = await a.join()
    const b = client()
    await b.join()
    a.send({ t: 'spawn', id: `${wa.playerId}:player`, template: 'player' })
    await b.next('spawned')
    a.close()
    expect(await b.next('despawned')).toEqual({ t: 'despawned', id: `${wa.playerId}:player` })
    expect(server.stats().rooms[0].entities).toBe(0)
  })

  it('routes events to all, others, the host or one player', async () => {
    await start()
    const a = client()
    const wa = await a.join()
    const b = client()
    const wb = await b.join()

    b.send({ t: 'event', name: 'fire', data: { x: 1 }, to: 'all' })
    expect(await a.next('event')).toEqual({ t: 'event', name: 'fire', data: { x: 1 }, from: wb.playerId })
    expect((await b.next('event')).name).toBe('fire')

    b.send({ t: 'event', name: 'chat', to: 'others' })
    await a.next('event', (m) => m.name === 'chat')
    b.send({ t: 'event', name: 'ask', to: 'host' })
    await a.next('event', (m) => m.name === 'ask')
    a.send({ t: 'event', name: 'dm', to: wb.playerId })
    await b.next('event', (m) => m.name === 'dm')
    await new Promise((r) => setTimeout(r, 50))
    expect(b.messages.filter((m) => m.t === 'event' && ['chat', 'ask'].includes((m as any).name))).toEqual([])
    expect(wa.host).toBe(wa.playerId)
  })

  it('shares room state with everyone, including late joiners', async () => {
    await start()
    const a = client()
    const wa = await a.join()
    a.send({ t: 'set', key: 'score', value: { red: 1 } })
    expect(await a.next('set')).toEqual({ t: 'set', key: 'score', value: { red: 1 }, from: wa.playerId })
    const b = client()
    expect((await b.join()).state).toEqual({ score: { red: 1 } })
    b.send({ t: 'set', key: 'score', value: null })
    await a.next('set', (m) => m.value === null)
    const c = client()
    expect((await c.join()).state).toEqual({})
  })

  it('rejects other protocol versions, full rooms, bad and oversized messages', async () => {
    await start({ maxPlayers: 1, maxMessageBytes: 1024 })
    const old = client()
    await old.open()
    old.send({ t: 'hello', v: 999 })
    expect((await old.next('error')).code).toBe('version')
    expect(await old.closed).toBe(4000)

    const a = client()
    await a.join()
    const b = client()
    await b.open()
    b.send({ t: 'hello', v: NET_PROTOCOL_VERSION })
    expect((await b.next('error')).code).toBe('room_full')

    a.send('{"t":"nope"}')
    expect((await a.next('error')).code).toBe('bad_message')
    a.send({ t: 'event', name: 'big', data: 'x'.repeat(2000) })
    // ws closes the socket for payloads over maxPayload
    expect(await a.closed).toBe(1009)
  })

  it('rate limits floods and refuses messages before hello', async () => {
    await start({ rate: 5, burst: 5 })
    const a = client()
    await a.open()
    a.send({ t: 'event', name: 'x' })
    expect((await a.next('error')).code).toBe('not_joined')
    await a.join()
    for (let i = 0; i < 20; i++) a.send({ t: 'ping', c: i })
    expect((await a.next('error', (m) => m.code === 'rate_limited')).code).toBe('rate_limited')
  })

  it('answers pings with the server time and closes idle clients', async () => {
    await start({ idleMs: 150 })
    const a = client()
    await a.join()
    a.send({ t: 'ping', c: 42 })
    const pong = await a.next('pong')
    expect(pong.c).toBe(42)
    expect(Math.abs(pong.s - Date.now())).toBeLessThan(1000)
    await a.closed
    expect(server.stats().clients).toBe(0)
  })

  it('accepts only allowed origins when configured', async () => {
    await start({ allowedOrigins: ['https://game.example.com'] })
    const bad = client('https://evil.example.com')
    await expect(bad.open()).rejects.toThrow()
    const ok = client('https://game.example.com')
    await ok.join()
  })
})
