import { z } from 'zod'

/**
 * Linden multiplayer wire protocol (JSON over WebSocket), shared by the room server
 * (server/net/RoomServer.ts) and the game client (engine/net/NetClient.ts).
 *
 * Authority (v1): every networked entity has an owner, a player id or "room". Owners simulate
 * their entities and send snapshots; the server forwards only what a sender may change.
 * Room-owned entities are driven by the room's host (its oldest player).
 */

export const NET_PROTOCOL_VERSION = 1
export const ROOM_OWNER = 'room'

/** Position (m) and rotation (Euler degrees, like Transform) */
export interface NetTransform {
  p: [number, number, number]
  r: [number, number, number]
}

export interface NetPlayer {
  id: string
  name: string
}

export interface NetEntity {
  id: string
  /** Player id, or "room" */
  owner: string
  /** NetworkSync.template it was cloned from; absent for entities that are part of the scene */
  template?: string
  t?: NetTransform
  data?: unknown
}

/** One entry of a state batch: [entityId, position, rotation] */
export type NetStateEntry = [string, [number, number, number], [number, number, number]]

export type EventTarget = 'all' | 'others' | 'host' | string

// ---------------------------------------------------------------- client -> server

const finite = z.number().finite()
const vec3 = z.tuple([finite, finite, finite])
const transform = z.object({ p: vec3, r: vec3 }).strict()
const entityId = z.string().min(1).max(96)
const json = z.unknown()

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), v: z.number().int(), room: z.string().max(64).optional(), name: z.string().max(64).optional() }).strict(),
  z.object({ t: z.literal('spawn'), id: entityId, template: z.string().min(1).max(64), tf: transform.optional(), data: json.optional() }).strict(),
  z.object({ t: z.literal('despawn'), id: entityId }).strict(),
  z.object({ t: z.literal('state'), e: z.array(z.tuple([entityId, vec3, vec3])).max(256) }).strict(),
  z.object({ t: z.literal('event'), name: z.string().min(1).max(64), data: json.optional(), to: z.string().max(64).optional() }).strict(),
  z.object({ t: z.literal('set'), key: z.string().min(1).max(64), value: json }).strict(),
  z.object({ t: z.literal('ping'), c: finite }).strict(),
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>

// ---------------------------------------------------------------- server -> client

export type ServerMessage =
  | {
      t: 'welcome'
      v: number
      playerId: string
      room: string
      host: string
      players: NetPlayer[]
      entities: NetEntity[]
      /** Scene entities the host removed (collected coins, ...) */
      removed: string[]
      state: Record<string, unknown>
      time: number
    }
  | { t: 'joined'; player: NetPlayer }
  | { t: 'left'; id: string }
  | { t: 'host'; id: string }
  | { t: 'spawned'; e: NetEntity }
  | { t: 'despawned'; id: string }
  | { t: 'state'; from: string; time: number; e: NetStateEntry[] }
  | { t: 'event'; name: string; data?: unknown; from: string }
  | { t: 'set'; key: string; value: unknown; from: string }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: NetErrorCode; message: string }

export type NetErrorCode = 'version' | 'room_full' | 'bad_message' | 'rate_limited' | 'too_large' | 'forbidden' | 'not_joined' | 'limit'

// ---------------------------------------------------------------- helpers

const round = (v: number, k: number) => Math.round(v * k) / k

/** Quantize a transform for the wire: 1 mm, 0.01° */
export function quantize(p: { x: number; y: number; z: number }, r: { x: number; y: number; z: number }): NetTransform {
  return { p: [round(p.x, 1000), round(p.y, 1000), round(p.z, 1000)], r: [round(r.x, 100), round(r.y, 100), round(r.z, 100)] }
}

/** Player names: printable, trimmed, at most 24 characters */
export function sanitizeName(name: unknown, fallback: string): string {
  const clean = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24) : ''
  return clean || fallback
}

/** Room names: [A-Za-z0-9_-], 1-32 characters; anything else falls back to "default" */
export function sanitizeRoom(room: unknown): string {
  return typeof room === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(room) ? room : 'default'
}

/** Entity ids a player may create: "<playerId>:<suffix>" */
export function ownsEntityId(playerId: string, id: string): boolean {
  return id.startsWith(`${playerId}:`) && id.length > playerId.length + 1
}

/** Parse and validate one client message; null when it is not a valid message */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const res = ClientMessageSchema.safeParse(data)
  return res.success ? res.data : null
}
