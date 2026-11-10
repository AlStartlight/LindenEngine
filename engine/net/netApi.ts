import type { Entity } from '../ecs/Entity'

/** A player in the room as scripts see it */
export interface NetPlayerInfo {
  id: string
  name: string
  isHost: boolean
  isLocal: boolean
}

export interface NetSpawnOptions {
  position?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  /** JSON data every client receives with the spawn (team, color, ...) */
  data?: unknown
}

/**
 * ctx.net: multiplayer for scripts. Without multiplayer it is an offline stub, so the same script
 * runs single-player: isMine/isHost are true, `send` to 'all' reaches the local onNetEvent.
 */
export interface NetApi {
  /** project.linden.json has multiplayer.enabled */
  readonly enabled: boolean
  readonly connected: boolean
  readonly playerId: string | null
  readonly room: string | null
  readonly isHost: boolean
  /** This client simulates the script's entity (own avatar, own spawns, room entities on the host, non-networked entities) */
  readonly isMine: boolean
  readonly players: NetPlayerInfo[]
  /** Round-trip time to the server in ms (0 offline) */
  readonly ping: number
  /** Owner of an entity (default: this script's): a player id, "room", or null when not networked */
  owner(entity?: Entity): string | null
  /** Data passed to ctx.net.spawn for this entity (or the given one) */
  spawnData(entity?: Entity): unknown
  /** Event to scripts on other clients (onNetEvent(name, data, fromPlayerId)); to: 'all' (default) | 'others' | 'host' | playerId */
  send(name: string, data?: unknown, opts?: { to?: string }): void
  /** Copy of a NetworkSync template on every client, owned by this client; null offline or for an unknown template */
  spawn(template: string, opts?: NetSpawnOptions): Entity | null
  /** Remove a networked entity everywhere (owner, or host for room entities) */
  destroy(entity: Entity): boolean
  /** Room state shared by all players (last write wins); set(key, null) removes the key */
  state: {
    get<T = unknown>(key: string): T | undefined
    set(key: string, value: unknown): void
    on(key: string, cb: (value: unknown, from: string) => void): () => void
    all(): Record<string, unknown>
  }
}

/** Local room state with listeners (offline stub and the client-side mirror) */
export class NetStateStore {
  private values = new Map<string, unknown>()
  private listeners = new Map<string, Set<(value: unknown, from: string) => void>>()

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined
  }

  apply(key: string, value: unknown, from: string): void {
    if (value === null || value === undefined) this.values.delete(key)
    else this.values.set(key, value)
    for (const cb of [...(this.listeners.get(key) ?? [])]) cb(value ?? null, from)
    for (const cb of [...(this.listeners.get('*') ?? [])]) cb({ key, value: value ?? null }, from)
  }

  reset(values: Record<string, unknown>): void {
    this.values = new Map(Object.entries(values))
  }

  on(key: string, cb: (value: unknown, from: string) => void): () => void {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set())
    this.listeners.get(key)!.add(cb)
    return () => this.listeners.get(key)?.delete(cb)
  }

  all(): Record<string, unknown> {
    return Object.fromEntries(this.values)
  }
}

/** ctx.net when the project has no multiplayer */
export function offlineNet(onLocalEvent: (name: string, data: unknown) => void, store = new NetStateStore()): NetApi {
  return {
    enabled: false,
    connected: false,
    playerId: null,
    room: null,
    isHost: true,
    isMine: true,
    players: [],
    ping: 0,
    owner: () => null,
    spawnData: () => undefined,
    send: (name, data, opts) => {
      const to = opts?.to ?? 'all'
      if (to === 'all' || to === 'host') queueMicrotask(() => onLocalEvent(name, data))
    },
    spawn: () => null,
    destroy: () => false,
    state: {
      get: (key) => store.get(key),
      set: (key, value) => store.apply(key, value, 'local'),
      on: (key, cb) => store.on(key, cb),
      all: () => store.all(),
    },
  }
}
