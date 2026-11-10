/**
 * `multiplayer` block of project.linden.json (docs/specs/SPEC-Multiplayer-WebSocket.md)
 */

export interface MultiplayerConfig {
  enabled: boolean
  /** Production server (wss://...); empty = the server that serves the game page (/net) */
  serverUrl: string
  maxPlayers: number
  /** Snapshots per second for NetworkSync entities without their own rate */
  tickRate: number
  /** "auto": everyone joins room "default" (or ?room=); "code": players share a room code (?room=) */
  room: 'auto' | 'code'
  /** Remote entities are shown this far in the past, between two snapshots */
  interpolationMs: number
}

export const MULTIPLAYER_DEFAULTS: MultiplayerConfig = {
  enabled: false,
  serverUrl: '',
  maxPlayers: 16,
  tickRate: 15,
  room: 'auto',
  interpolationMs: 100,
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

export function normalizeMultiplayer(raw: unknown): MultiplayerConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const url = typeof r.serverUrl === 'string' && /^wss?:\/\/[^\s]+$/i.test(r.serverUrl.trim()) ? r.serverUrl.trim() : ''
  return {
    enabled: r.enabled === true,
    serverUrl: url,
    maxPlayers: Math.round(clamp(r.maxPlayers, 2, 64, MULTIPLAYER_DEFAULTS.maxPlayers)),
    tickRate: Math.round(clamp(r.tickRate, 1, 60, MULTIPLAYER_DEFAULTS.tickRate)),
    room: r.room === 'code' ? 'code' : 'auto',
    interpolationMs: Math.round(clamp(r.interpolationMs, 0, 1000, MULTIPLAYER_DEFAULTS.interpolationMs)),
  }
}

/**
 * Where the game connects: `?net=` (editor Play, tests) > multiplayer.serverUrl > the page's own
 * host at /net (the exported server serves both). Null when none applies (e.g. file://).
 */
export function resolveServerUrl(cfg: MultiplayerConfig, pageUrl: string): string | null {
  let page: URL
  try {
    page = new URL(pageUrl)
  } catch {
    return cfg.serverUrl || null
  }
  const override = page.searchParams.get('net')
  if (override && /^wss?:\/\/[^\s]+$/i.test(override)) return override
  if (cfg.serverUrl) return cfg.serverUrl
  if (page.protocol === 'http:' || page.protocol === 'https:') return `${page.protocol === 'https:' ? 'wss' : 'ws'}://${page.host}/net`
  return null
}

/** Room and player name from the page URL (?room=, ?name=) */
export function roomFromUrl(pageUrl: string): { room?: string; name?: string } {
  try {
    const q = new URL(pageUrl).searchParams
    return { room: q.get('room') || undefined, name: q.get('name') || undefined }
  } catch {
    return {}
  }
}
