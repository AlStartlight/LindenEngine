import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import {
  NET_PROTOCOL_VERSION,
  ROOM_OWNER,
  type ClientMessage,
  type NetEntity,
  type NetErrorCode,
  type NetPlayer,
  type ServerMessage,
  ownsEntityId,
  parseClientMessage,
  sanitizeName,
  sanitizeRoom,
} from '../../shared/net/protocol'

/**
 * Linden multiplayer room server (Node, `ws`). One process hosts many rooms; it tracks players,
 * the host, entity ownership, the last snapshot of every entity and the shared room state, and
 * forwards what each sender is allowed to change. Used by the editor (Play), linden_play and the
 * exported server/linden-server.mjs.
 */

export interface RoomServerOptions {
  /** Port to listen on (0 = random). Ignored when `server` is given */
  port?: number
  host?: string
  /** Attach to an existing HTTP server (e.g. one that also serves the game files) */
  server?: http.Server
  /** WebSocket path, default "/net" */
  path?: string
  maxPlayers?: number
  maxEntitiesPerPlayer?: number
  maxMessageBytes?: number
  /** Messages per second per client (token bucket) and burst size */
  rate?: number
  burst?: number
  /** Close clients that sent nothing for this long */
  idleMs?: number
  /** Allowed Origin headers (exact match); empty = any */
  allowedOrigins?: string[]
  log?: (msg: string) => void
}

interface Client {
  id: string
  name: string
  ws: WebSocket
  room: Room | null
  tokens: number
  lastRefill: number
  lastSeen: number
  entities: Set<string>
}

interface Room {
  name: string
  players: Map<string, Client>
  host: string
  entities: Map<string, NetEntity>
  /** Scene entities removed by the host, so late joiners remove them too */
  removed: Set<string>
  state: Map<string, unknown>
}

export interface RoomServerStats {
  rooms: { name: string; players: number; entities: number; host: string }[]
  clients: number
}

const DEFAULTS = {
  path: '/net',
  maxPlayers: 16,
  maxEntitiesPerPlayer: 256,
  maxMessageBytes: 16 * 1024,
  rate: 60,
  burst: 120,
  idleMs: 30_000,
}

export class RoomServer {
  private wss: WebSocketServer | null = null
  private ownServer: http.Server | null = null
  private rooms = new Map<string, Room>()
  private clients = new Set<Client>()
  private idleTimer: NodeJS.Timeout | null = null
  private nextPlayer = 1
  private readonly opts: Required<Omit<RoomServerOptions, 'server' | 'port' | 'host' | 'allowedOrigins' | 'log'>> &
    Pick<RoomServerOptions, 'server' | 'port' | 'host' | 'allowedOrigins' | 'log'>
  private port = 0

  constructor(options: RoomServerOptions = {}) {
    this.opts = { ...DEFAULTS, ...options }
  }

  get url(): string {
    return `ws://${this.opts.host ?? '127.0.0.1'}:${this.port}${this.opts.path}`
  }

  async start(): Promise<{ port: number; url: string }> {
    const server = this.opts.server ?? http.createServer((_req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain' })
      res.end('Linden multiplayer server: connect with WebSocket')
    })
    if (!this.opts.server) this.ownServer = server
    this.wss = new WebSocketServer({
      server,
      path: this.opts.path,
      maxPayload: this.opts.maxMessageBytes,
      verifyClient: (info: { origin: string }) => {
        const allowed = this.opts.allowedOrigins
        return !allowed || allowed.length === 0 || allowed.includes(info.origin)
      },
    })
    this.wss.on('connection', (ws) => this.accept(ws))
    if (this.ownServer) {
      await new Promise<void>((resolve, reject) => {
        this.ownServer!.once('error', reject)
        this.ownServer!.listen(this.opts.port ?? 0, this.opts.host ?? '127.0.0.1', () => resolve())
      })
    }
    const addr = server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : 0
    this.idleTimer = setInterval(() => this.closeIdle(), Math.min(5000, this.opts.idleMs))
    this.idleTimer.unref?.()
    return { port: this.port, url: this.url }
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = null
    for (const c of this.clients) c.ws.terminate()
    this.clients.clear()
    this.rooms.clear()
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()))
    this.wss = null
    if (this.ownServer) await new Promise<void>((resolve) => this.ownServer!.close(() => resolve()))
    this.ownServer = null
  }

  stats(): RoomServerStats {
    return {
      clients: this.clients.size,
      rooms: [...this.rooms.values()].map((r) => ({ name: r.name, players: r.players.size, entities: r.entities.size, host: r.host })),
    }
  }

  // ---------------------------------------------------------------- connections

  private accept(ws: WebSocket): void {
    const now = Date.now()
    const client: Client = {
      id: `p${this.nextPlayer++}${crypto.randomBytes(2).toString('hex')}`,
      name: '',
      ws,
      room: null,
      tokens: this.opts.burst,
      lastRefill: now,
      lastSeen: now,
      entities: new Set(),
    }
    this.clients.add(client)
    ws.on('message', (raw, isBinary) => this.receive(client, raw as Buffer, isBinary))
    ws.on('close', () => this.drop(client))
    ws.on('error', () => this.drop(client))
  }

  private send(client: Client, msg: ServerMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg))
  }

  private broadcast(room: Room, msg: ServerMessage, except?: Client): void {
    const data = JSON.stringify(msg)
    for (const p of room.players.values()) {
      if (p !== except && p.ws.readyState === WebSocket.OPEN) p.ws.send(data)
    }
  }

  private fail(client: Client, code: NetErrorCode, message: string, close = false): void {
    this.send(client, { t: 'error', code, message })
    this.opts.log?.(`[net] ${client.id}: ${code} ${message}`)
    if (close) client.ws.close(4000, code)
  }

  private allow(client: Client): boolean {
    const now = Date.now()
    client.tokens = Math.min(this.opts.burst, client.tokens + ((now - client.lastRefill) / 1000) * this.opts.rate)
    client.lastRefill = now
    if (client.tokens < 1) return false
    client.tokens -= 1
    return true
  }

  private receive(client: Client, raw: Buffer, isBinary: boolean): void {
    client.lastSeen = Date.now()
    if (isBinary) return this.fail(client, 'bad_message', 'Pesan biner tidak didukung')
    if (raw.length > this.opts.maxMessageBytes) return this.fail(client, 'too_large', 'Pesan terlalu besar')
    if (!this.allow(client)) return this.fail(client, 'rate_limited', 'Terlalu banyak pesan; sebagian diabaikan')
    const msg = parseClientMessage(raw.toString('utf-8'))
    if (!msg) return this.fail(client, 'bad_message', 'Format pesan tidak valid')
    if (msg.t === 'ping') return this.send(client, { t: 'pong', c: msg.c, s: Date.now() })
    if (msg.t === 'hello') return this.join(client, msg)
    const room = client.room
    if (!room) return this.fail(client, 'not_joined', 'Kirim hello dulu')
    this.handle(client, room, msg)
  }

  private join(client: Client, msg: Extract<ClientMessage, { t: 'hello' }>): void {
    if (client.room) return this.fail(client, 'bad_message', 'Sudah bergabung ke room')
    if (msg.v !== NET_PROTOCOL_VERSION) {
      return this.fail(client, 'version', `Versi protokol ${msg.v} tidak cocok dengan server (${NET_PROTOCOL_VERSION}); perbarui game atau server`, true)
    }
    const name = sanitizeRoom(msg.room)
    let room = this.rooms.get(name)
    if (room && room.players.size >= this.opts.maxPlayers) {
      return this.fail(client, 'room_full', `Room "${name}" penuh (${this.opts.maxPlayers} pemain)`, true)
    }
    if (!room) {
      room = { name, players: new Map(), host: client.id, entities: new Map(), removed: new Set(), state: new Map() }
      this.rooms.set(name, room)
    }
    client.name = sanitizeName(msg.name, `Pemain ${client.id.slice(1, 4)}`)
    client.room = room
    room.players.set(client.id, client)
    const players: NetPlayer[] = [...room.players.values()].map((p) => ({ id: p.id, name: p.name }))
    this.send(client, {
      t: 'welcome',
      v: NET_PROTOCOL_VERSION,
      playerId: client.id,
      room: room.name,
      host: room.host,
      players,
      entities: [...room.entities.values()],
      removed: [...room.removed],
      state: Object.fromEntries(room.state),
      time: Date.now(),
    })
    this.broadcast(room, { t: 'joined', player: { id: client.id, name: client.name } }, client)
    this.opts.log?.(`[net] ${client.name} (${client.id}) masuk room ${room.name} (${room.players.size} pemain)`)
  }

  /** Who may change an entity: its owner, or the host for room entities */
  private mayControl(client: Client, room: Room, owner: string): boolean {
    return owner === client.id || (owner === ROOM_OWNER && room.host === client.id)
  }

  private handle(client: Client, room: Room, msg: ClientMessage): void {
    switch (msg.t) {
      case 'spawn': {
        if (!ownsEntityId(client.id, msg.id)) return this.fail(client, 'forbidden', `Id entity harus diawali "${client.id}:"`)
        if (room.entities.has(msg.id)) return this.fail(client, 'forbidden', `Entity ${msg.id} sudah ada`)
        if (client.entities.size >= this.opts.maxEntitiesPerPlayer) return this.fail(client, 'limit', `Maksimal ${this.opts.maxEntitiesPerPlayer} entity per pemain`)
        const e: NetEntity = { id: msg.id, owner: client.id, template: msg.template, ...(msg.tf ? { t: msg.tf } : {}), ...(msg.data !== undefined ? { data: msg.data } : {}) }
        room.entities.set(e.id, e)
        client.entities.add(e.id)
        this.broadcast(room, { t: 'spawned', e }, client)
        return
      }
      case 'despawn': {
        const e = room.entities.get(msg.id)
        const sceneEntity = !msg.id.includes(':')
        if (!e && !sceneEntity) return
        if (!this.mayControl(client, room, e?.owner ?? ROOM_OWNER)) return this.fail(client, 'forbidden', `Bukan pemilik ${msg.id}`)
        if (sceneEntity) {
          if (room.removed.size >= 4096) return this.fail(client, 'limit', 'Terlalu banyak entity scene dihapus')
          room.removed.add(msg.id)
        }
        this.removeEntity(room, msg.id)
        this.broadcast(room, { t: 'despawned', id: msg.id }, client)
        return
      }
      case 'state': {
        const accepted: typeof msg.e = []
        for (const entry of msg.e) {
          const [id, p, r] = entry
          let e = room.entities.get(id)
          // Scene entities become known on the host's first snapshot
          if (!e && room.host === client.id && !id.includes(':') && !room.removed.has(id)) {
            e = { id, owner: ROOM_OWNER }
            room.entities.set(id, e)
          }
          if (!e || !this.mayControl(client, room, e.owner)) continue
          e.t = { p, r }
          accepted.push(entry)
        }
        if (accepted.length) this.broadcast(room, { t: 'state', from: client.id, time: Date.now(), e: accepted }, client)
        return
      }
      case 'event': {
        const out: ServerMessage = { t: 'event', name: msg.name, ...(msg.data !== undefined ? { data: msg.data } : {}), from: client.id }
        const to = msg.to ?? 'all'
        if (to === 'all') this.broadcast(room, out)
        else if (to === 'others') this.broadcast(room, out, client)
        else {
          const target = room.players.get(to === 'host' ? room.host : to)
          if (target) this.send(target, out)
        }
        return
      }
      case 'set': {
        // v1 trust model: any player may set any key (last write wins)
        if (msg.value === undefined || msg.value === null) room.state.delete(msg.key)
        else {
          if (!room.state.has(msg.key) && room.state.size >= 512) return this.fail(client, 'limit', 'Maksimal 512 key state room')
          room.state.set(msg.key, msg.value)
        }
        this.broadcast(room, { t: 'set', key: msg.key, value: msg.value ?? null, from: client.id })
        return
      }
    }
  }

  private removeEntity(room: Room, id: string): void {
    const e = room.entities.get(id)
    if (!e) return
    room.entities.delete(id)
    room.players.get(e.owner)?.entities.delete(id)
  }

  private drop(client: Client): void {
    if (!this.clients.delete(client)) return
    const room = client.room
    if (!room) return
    room.players.delete(client.id)
    // A player's entities leave with them; room entities stay for the next host
    for (const id of client.entities) {
      room.entities.delete(id)
      this.broadcast(room, { t: 'despawned', id })
    }
    this.broadcast(room, { t: 'left', id: client.id })
    if (room.players.size === 0) {
      this.rooms.delete(room.name)
    } else if (room.host === client.id) {
      room.host = room.players.keys().next().value as string
      this.broadcast(room, { t: 'host', id: room.host })
    }
    this.opts.log?.(`[net] ${client.name || client.id} keluar dari room ${room.name}`)
  }

  private closeIdle(): void {
    const limit = Date.now() - this.opts.idleMs
    for (const c of this.clients) {
      if (c.lastSeen < limit) {
        this.fail(c, 'bad_message', 'Koneksi idle terlalu lama')
        c.ws.terminate()
        this.drop(c)
      }
    }
  }
}
