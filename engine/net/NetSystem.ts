import type { World } from '../ecs/World'
import type { Entity } from '../ecs/Entity'
import type { GameSimulation } from '../runtime/GameSimulation'
import { ROOM_OWNER, quantize, type NetEntity, type NetPlayer, type NetStateEntry, type ServerMessage } from '../../shared/net/protocol'
import type { MultiplayerConfig } from '../../shared/net/config'
import { NetClient, type NetStatus, type SocketFactory } from './NetClient'
import { NetStateStore, type NetApi, type NetPlayerInfo, type NetSpawnOptions } from './netApi'
import { captureTemplate, instantiateTemplate, type EntityTemplate } from './instantiate'
import { PLAYER_TEMPLATE, type NetworkSync } from './NetworkSync'

/**
 * Multiplayer for one running scene: finds NetworkSync entities, keeps them in step with the room
 * server (snapshots out for what this client owns, interpolated snapshots in for the rest) and
 * gives scripts ctx.net. Runs the same in the player and headless (linden_play, tests).
 *
 * Order of use: prepare() after the scene is loaded, connect() before physics starts (so remote
 * entities get kinematic bodies), start() once scripts are loaded.
 */

type Vec3T = [number, number, number]

interface NetEntry {
  id: string
  owner: string
  template?: string
  data?: unknown
  entityIds: string[]
  buffer: { time: number; p: Vec3T; r: Vec3T }[]
  rate: number
  interpolate: boolean
  syncTransform: boolean
  lastSent: string
  sendAcc: number
}

export interface NetSystemOptions {
  world: World
  sim: GameSimulation
  config: MultiplayerConfig
  /** Room server URL; null = play offline (everything is local and owned) */
  url: string | null
  room?: string
  name?: string
  socket?: SocketFactory
  /** The local player's avatar was created (the player re-picks its camera) */
  onLocalAvatar?: (root: Entity) => void
  onStatus?: (status: NetStatus, detail?: string) => void
  log?: (msg: string) => void
  warn?: (msg: string) => void
}

export const MAX_EVENT_BYTES = 8 * 1024
const MAX_BUFFER = 32

export class NetSystem {
  readonly store = new NetStateStore()
  private templates = new Map<string, EntityTemplate>()
  private entries = new Map<string, NetEntry>()
  private entityToNet = new Map<string, string>()
  private players = new Map<string, NetPlayer>()
  private client: NetClient | null = null
  private playerId: string | null = null
  private roomName: string | null = null
  private host: string | null = null
  private started = false
  private queue: ServerMessage[] = []
  private pendingSpawns: NetEntity[] = []
  private spawnCounter = 0
  private online = false
  private offRemoved: () => void

  constructor(private opts: NetSystemOptions) {
    this.offRemoved = opts.world.events.on('entityRemoved', (entity: Entity) => this.onEntityRemoved(entity.id))
  }

  // ---------------------------------------------------------------- lifecycle

  /** Capture templates (they leave the scene) and register scene entities as room-owned */
  prepare(): void {
    const { world } = this.opts
    const templateRoots: Entity[] = []
    const inTemplate = new Set<string>()
    for (const ent of world.getEntitiesInHierarchyOrder()) {
      if (ent.parentId && inTemplate.has(ent.parentId)) {
        inTemplate.add(ent.id)
        continue
      }
      const sync = ent.getComponent('NetworkSync') as NetworkSync | undefined
      if (!sync) continue
      const name = sync.template.trim()
      if (name) {
        if (this.templates.has(name)) this.opts.warn?.(`[Net] Template "${name}" ada lebih dari satu; yang pertama dipakai`)
        else {
          this.templates.set(name, captureTemplate(world, ent))
          templateRoots.push(ent)
        }
        inTemplate.add(ent.id)
        continue
      }
      this.register({ id: ent.id, owner: ROOM_OWNER }, this.subtreeIds(ent))
    }
    for (const root of templateRoots) world.destroyEntity(root.id)
  }

  /** Join the room; false (and offline play) when no server is configured or reachable */
  async connect(): Promise<boolean> {
    const url = this.opts.url
    if (!url) {
      this.opts.onStatus?.('offline', 'Server multiplayer belum diatur')
      return false
    }
    this.client = new NetClient({
      url,
      room: this.opts.room,
      name: this.opts.name,
      socket: this.opts.socket,
      onMessage: (msg) => this.receive(msg),
      onStatus: (status, detail) => {
        this.online = status === 'connected'
        this.opts.onStatus?.(status, detail)
      },
    })
    try {
      const welcome = await this.client.connect()
      this.applyWelcome(welcome, true)
      return true
    } catch (e: any) {
      this.opts.warn?.(`[Net] ${e?.message ?? e}; game berjalan offline`)
      this.client.close()
      this.client = null
      this.online = false
      return false
    }
  }

  /** Scripts are loaded: create remote entities, this player's avatar, and tell scripts who is here */
  async start(): Promise<void> {
    this.started = true
    for (const e of this.pendingSpawns.splice(0)) await this.spawnRemote(e)
    await this.spawnAvatar()
    const scripts = this.opts.sim.scripts
    for (const p of this.players.values()) if (p.id !== this.playerId) scripts?.notifyAll('onNetJoin', this.playerInfo(p))
    for (const msg of this.queue.splice(0)) await this.handle(msg)
  }

  dispose(): void {
    this.offRemoved()
    this.client?.close()
    this.client = null
    this.online = false
  }

  // ---------------------------------------------------------------- ownership

  get isHost(): boolean {
    return !this.online || this.host === this.playerId
  }

  get connected(): boolean {
    return this.online
  }

  /** Round-trip time to the server in ms (0 offline) */
  get ping(): number {
    return Math.round(this.client?.rtt ?? 0)
  }

  get localPlayerId(): string | null {
    return this.playerId
  }

  private owns(entry: NetEntry): boolean {
    if (!this.online) return true
    return entry.owner === this.playerId || (entry.owner === ROOM_OWNER && this.host === this.playerId)
  }

  isMine(entity: Entity): boolean {
    const id = this.entityToNet.get(entity.id)
    const entry = id ? this.entries.get(id) : undefined
    return !entry || this.owns(entry)
  }

  owner(entity: Entity): string | null {
    const id = this.entityToNet.get(entity.id)
    return (id && this.entries.get(id)?.owner) || null
  }

  /** Root entity of a networked entity by its net id */
  entity(netId: string): Entity | undefined {
    return this.opts.world.getEntity(netId)
  }

  // ---------------------------------------------------------------- frame

  beforeFrame(_dt: number): void {
    if (!this.online || !this.client) return
    const renderTime = this.client.serverNow() - this.opts.config.interpolationMs
    for (const entry of this.entries.values()) {
      if (this.owns(entry) || entry.buffer.length === 0 || !entry.syncTransform) continue
      const root = this.opts.world.getEntity(entry.id)
      if (!root) continue
      const buf = entry.buffer
      let p: Vec3T
      let r: Vec3T
      if (!entry.interpolate || buf.length === 1 || renderTime >= buf[buf.length - 1].time) {
        const last = buf[buf.length - 1]
        p = last.p
        r = last.r
        if (buf.length > 1) buf.splice(0, buf.length - 1)
      } else if (renderTime <= buf[0].time) {
        p = buf[0].p
        r = buf[0].r
      } else {
        let i = 0
        while (i < buf.length - 2 && buf[i + 1].time <= renderTime) i++
        const a = buf[i]
        const b = buf[i + 1]
        const k = b.time > a.time ? (renderTime - a.time) / (b.time - a.time) : 1
        p = [lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k), lerp(a.p[2], b.p[2], k)]
        r = [lerpAngle(a.r[0], b.r[0], k), lerpAngle(a.r[1], b.r[1], k), lerpAngle(a.r[2], b.r[2], k)]
        if (i > 0) buf.splice(0, i)
      }
      const t = root.getTransform()
      t.position = { x: p[0], y: p[1], z: p[2] }
      t.rotation = { x: r[0], y: r[1], z: r[2] }
    }
  }

  afterFrame(dt: number): void {
    if (!this.online || !this.client) return
    const batch: NetStateEntry[] = []
    for (const entry of this.entries.values()) {
      if (!entry.syncTransform || !this.owns(entry)) continue
      entry.sendAcc += dt
      const interval = 1 / (entry.rate || this.opts.config.tickRate)
      if (entry.sendAcc < interval) continue
      entry.sendAcc = entry.sendAcc === Infinity ? 0 : Math.min(entry.sendAcc - interval, interval)
      const root = this.opts.world.getEntity(entry.id)
      if (!root) continue
      const t = root.getTransform()
      const q = quantize(t.position, t.rotation)
      const key = `${q.p.join(',')}|${q.r.join(',')}`
      if (key === entry.lastSent) continue
      entry.lastSent = key
      batch.push([entry.id, q.p, q.r])
    }
    for (let i = 0; i < batch.length; i += 256) this.client.send({ t: 'state', e: batch.slice(i, i + 256) })
  }

  // ---------------------------------------------------------------- messages

  private receive(msg: ServerMessage): void {
    // The first welcome is handled by connect(); later ones come from a reconnect
    if (msg.t === 'welcome' && !this.playerId) return
    if (msg.t === 'error') {
      this.opts.warn?.(`[Net] Server: ${msg.message}`)
      return
    }
    if (!this.started) {
      this.queue.push(msg)
      return
    }
    void this.handle(msg)
  }

  private async handle(msg: ServerMessage): Promise<void> {
    const scripts = this.opts.sim.scripts
    switch (msg.t) {
      case 'welcome':
        return this.reconnected(msg)
      case 'joined':
        this.players.set(msg.player.id, msg.player)
        scripts?.notifyAll('onNetJoin', this.playerInfo(msg.player))
        return
      case 'left': {
        const p = this.players.get(msg.id)
        this.players.delete(msg.id)
        if (p) scripts?.notifyAll('onNetLeave', this.playerInfo(p))
        return
      }
      case 'host': {
        this.host = msg.id
        // The new host simulates the room's entities from where they were last seen
        for (const entry of this.entries.values()) {
          if (entry.owner !== ROOM_OWNER) continue
          entry.buffer = []
          entry.lastSent = ''
          for (const id of entry.entityIds) this.opts.sim.setPuppet(id, msg.id !== this.playerId)
        }
        scripts?.notifyAll('onNetHost', msg.id)
        return
      }
      case 'spawned':
        await this.spawnRemote(msg.e)
        return
      case 'despawned':
        this.removeEntry(msg.id, true)
        return
      case 'state':
        for (const [id, p, r] of msg.e) {
          const entry = this.entries.get(id)
          if (!entry || this.owns(entry)) continue
          entry.buffer.push({ time: msg.time, p, r })
          if (entry.buffer.length > MAX_BUFFER) entry.buffer.shift()
        }
        return
      case 'event':
        scripts?.notifyAll('onNetEvent', msg.name, msg.data, msg.from)
        return
      case 'set': {
        // Our own write was applied locally already
        if (msg.from === this.playerId && JSON.stringify(this.store.get(msg.key) ?? null) === JSON.stringify(msg.value ?? null)) return
        this.store.apply(msg.key, msg.value, msg.from)
        return
      }
    }
  }

  private applyWelcome(w: Extract<ServerMessage, { t: 'welcome' }>, first: boolean): void {
    this.playerId = w.playerId
    this.roomName = w.room
    this.host = w.host
    this.online = true
    this.players = new Map(w.players.map((p) => [p.id, p]))
    this.store.reset(w.state)
    const known = new Map(w.entities.map((e) => [e.id, e]))
    for (const entry of this.entries.values()) {
      if (entry.owner !== ROOM_OWNER) continue
      const remote = this.host !== this.playerId
      for (const id of entry.entityIds) this.opts.sim.setPuppet(id, remote)
      const last = known.get(entry.id)?.t
      const root = this.opts.world.getEntity(entry.id)
      if (remote && last && root) {
        const t = root.getTransform()
        t.position = { x: last.p[0], y: last.p[1], z: last.p[2] }
        t.rotation = { x: last.r[0], y: last.r[1], z: last.r[2] }
      }
    }
    // Scene entities the host already removed (collected coins, ...) are gone here too
    for (const id of w.removed ?? []) {
      this.removeEntry(id, true)
      if (this.opts.world.getEntity(id)) this.opts.world.destroyEntity(id)
    }
    const spawned = w.entities.filter((e) => e.owner !== ROOM_OWNER && e.template)
    if (first) this.pendingSpawns.push(...spawned)
    this.opts.log?.(`[Net] Bergabung ke room "${w.room}" sebagai ${w.playerId} (${w.players.length} pemain${w.host === w.playerId ? ', host' : ''})`)
  }

  /** A dropped connection came back as a new player: rebuild everything spawned */
  private async reconnected(w: Extract<ServerMessage, { t: 'welcome' }>): Promise<void> {
    const avatar = this.playerId ? this.opts.world.getEntity(`${this.playerId}:${PLAYER_TEMPLATE}`) : undefined
    const at = avatar ? { position: { ...avatar.getTransform().position }, rotation: { ...avatar.getTransform().rotation } } : undefined
    for (const entry of [...this.entries.values()]) if (entry.owner !== ROOM_OWNER) this.removeEntry(entry.id, false)
    this.applyWelcome(w, false)
    for (const e of w.entities) if (e.owner !== ROOM_OWNER && e.template) await this.spawnRemote(e)
    await this.spawnAvatar(at)
  }

  // ---------------------------------------------------------------- entities

  private subtreeIds(root: Entity): string[] {
    const ids = [root.id]
    for (let i = 0; i < ids.length; i++) {
      const e = this.opts.world.getEntity(ids[i])
      if (e) ids.push(...e.childIds)
    }
    return ids
  }

  private register(e: { id: string; owner: string; template?: string; data?: unknown }, entityIds: string[]): NetEntry {
    const root = this.opts.world.getEntity(e.id)
    const sync = root?.getComponent('NetworkSync') as NetworkSync | undefined
    const entry: NetEntry = {
      id: e.id,
      owner: e.owner,
      template: e.template,
      data: e.data,
      entityIds,
      buffer: [],
      rate: sync?.rate ?? 0,
      interpolate: sync?.interpolate ?? true,
      syncTransform: sync?.syncTransform ?? true,
      lastSent: '',
      sendAcc: Infinity,
    }
    this.entries.set(e.id, entry)
    for (const id of entityIds) this.entityToNet.set(id, e.id)
    return entry
  }

  private async spawnAvatar(at?: NetSpawnOptions): Promise<void> {
    const tpl = this.templates.get(PLAYER_TEMPLATE)
    if (!tpl) return
    const root = this.spawnLocal(PLAYER_TEMPLATE, at ?? { position: this.avatarSpawnPoint(tpl) }, PLAYER_TEMPLATE)
    if (root) this.opts.onLocalAvatar?.(root)
  }

  /**
   * Where this player's avatar appears: the template's position for the first player, then spread
   * on a circle around it (2 m, golden angle) so avatars never start inside each other
   */
  avatarSpawnPoint(tpl: EntityTemplate): { x: number; y: number; z: number } {
    const data = tpl.entities[0]?.components.find((c) => c.type === 'Transform')?.data?.position
    const base = Array.isArray(data) ? { x: data[0], y: data[1], z: data[2] } : { x: data?.x ?? 0, y: data?.y ?? 0, z: data?.z ?? 0 }
    const index = this.online && this.playerId ? Math.max(0, [...this.players.keys()].indexOf(this.playerId)) : 0
    if (index === 0) return base
    const angle = index * 2.39996
    const radius = 2 * Math.sqrt(index)
    return { x: base.x + Math.cos(angle) * radius, y: base.y, z: base.z + Math.sin(angle) * radius }
  }

  /** Create an owned copy of a template here and announce it */
  spawnLocal(template: string, opts: NetSpawnOptions = {}, suffix?: string): Entity | null {
    const tpl = this.templates.get(template)
    if (!tpl) {
      this.opts.warn?.(`[Net] Template "${template}" tidak ada (beri NetworkSync.template = "${template}" pada entity scene)`)
      return null
    }
    const owner = this.online && this.playerId ? this.playerId : 'local'
    const id = `${owner}:${suffix ?? `${template}-${++this.spawnCounter}`}`
    if (this.opts.world.getEntity(id)) return this.opts.world.getEntity(id)!
    const name = template === PLAYER_TEMPLATE ? `${tpl.name} (${this.players.get(owner)?.name ?? 'saya'})` : undefined
    const entities = instantiateTemplate(this.opts.world, tpl, id, { ...opts, name })
    this.register({ id, owner: this.online ? owner : ROOM_OWNER, template, data: opts.data }, entities.map((e) => e.id))
    void this.opts.sim.addRuntimeEntities(entities)
    if (this.online) {
      const t = entities[0].getTransform()
      this.client?.send({ t: 'spawn', id, template, tf: quantize(t.position, t.rotation), ...(opts.data !== undefined ? { data: opts.data } : {}) })
    }
    return entities[0]
  }

  private async spawnRemote(e: NetEntity): Promise<void> {
    if (this.entries.has(e.id) || this.opts.world.getEntity(e.id)) return
    const tpl = e.template ? this.templates.get(e.template) : undefined
    if (!tpl) {
      this.opts.warn?.(`[Net] Entity ${e.id} memakai template "${e.template}" yang tidak ada di scene ini`)
      return
    }
    const position = e.t ? { x: e.t.p[0], y: e.t.p[1], z: e.t.p[2] } : undefined
    const rotation = e.t ? { x: e.t.r[0], y: e.t.r[1], z: e.t.r[2] } : undefined
    const owner = this.players.get(e.owner)
    const name = e.template === PLAYER_TEMPLATE ? `${tpl.name} (${owner?.name ?? e.owner})` : undefined
    const entities = instantiateTemplate(this.opts.world, tpl, e.id, { position, rotation, name })
    const entry = this.register(e, entities.map((x) => x.id))
    for (const ent of entities) {
      this.opts.sim.setPuppet(ent.id, true)
      // Another player's camera must never take over this view
      const cam = ent.getComponent('Camera') as any
      if (cam) cam.isActive = false
    }
    if (e.t) entry.buffer.push({ time: this.client?.serverNow() ?? 0, p: e.t.p, r: e.t.r })
    await this.opts.sim.addRuntimeEntities(entities)
  }

  /** ctx.net.destroy: the owner (or host for room entities) removes it everywhere */
  destroy(entity: Entity): boolean {
    const id = this.entityToNet.get(entity.id) ?? entity.id
    const entry = this.entries.get(id)
    if (!entry || !this.owns(entry)) return false
    if (this.online) this.client?.send({ t: 'despawn', id })
    this.removeEntry(id, true)
    return true
  }

  private removeEntry(id: string, destroyEntity: boolean): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    for (const eid of entry.entityIds) this.entityToNet.delete(eid)
    if (destroyEntity && this.opts.world.getEntity(id)) this.opts.world.destroyEntity(id)
  }

  /** A script destroyed a networked entity with world.destroyEntity: tell the room if it was ours */
  private onEntityRemoved(entityId: string): void {
    const entry = this.entries.get(entityId)
    if (!entry) return
    if (this.online && this.owns(entry)) this.client?.send({ t: 'despawn', id: entityId })
    this.removeEntry(entityId, false)
  }

  // ---------------------------------------------------------------- scripts

  private playerInfo(p: NetPlayer): NetPlayerInfo {
    return { id: p.id, name: p.name, isHost: p.id === this.host, isLocal: p.id === this.playerId }
  }

  playerList(): NetPlayerInfo[] {
    return [...this.players.values()].map((p) => this.playerInfo(p))
  }

  send(name: string, data: unknown, to = 'all'): void {
    let size = 0
    try {
      size = data === undefined ? 0 : JSON.stringify(data).length
    } catch {
      this.opts.warn?.(`[Net] Data event "${name}" bukan JSON`)
      return
    }
    if (size > MAX_EVENT_BYTES) {
      this.opts.warn?.(`[Net] Event "${name}" terlalu besar (${size} byte, maks ${MAX_EVENT_BYTES})`)
      return
    }
    if (this.online && this.client) {
      this.client.send({ t: 'event', name, ...(data !== undefined ? { data } : {}), ...(to !== 'all' ? { to } : {}) })
    } else if (to === 'all' || to === 'host') {
      queueMicrotask(() => this.opts.sim.scripts?.notifyAll('onNetEvent', name, data, 'local'))
    }
  }

  setState(key: string, value: unknown): void {
    this.store.apply(key, value, this.playerId ?? 'local')
    if (this.online) this.client?.send({ t: 'set', key, value: value ?? null })
  }

  /** ctx.net for one script's entity */
  api(entity: Entity): NetApi {
    const net = this
    return {
      enabled: true,
      get connected() {
        return net.online
      },
      get playerId() {
        return net.playerId
      },
      get room() {
        return net.roomName
      },
      get isHost() {
        return net.isHost
      },
      get isMine() {
        return net.isMine(entity)
      },
      get players() {
        return net.playerList()
      },
      get ping() {
        return net.ping
      },
      owner: (e = entity) => net.owner(e),
      spawnData: (e = entity) => {
        const id = net.entityToNet.get(e.id)
        return id ? net.entries.get(id)?.data : undefined
      },
      send: (name, data, opts) => net.send(name, data, opts?.to ?? 'all'),
      spawn: (template, opts) => net.spawnLocal(template, opts),
      destroy: (e) => net.destroy(e),
      state: {
        get: (key) => net.store.get(key),
        set: (key, value) => net.setState(key, value),
        on: (key, cb) => net.store.on(key, cb),
        all: () => net.store.all(),
      },
    }
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Interpolate degrees the short way round */
function lerpAngle(a: number, b: number, k: number): number {
  let d = ((b - a) % 360 + 540) % 360 - 180
  if (d === -180 && b > a) d = 180
  return a + d * k
}
