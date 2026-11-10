import { RoomServer } from '../../server/net/RoomServer'
import type { MultiplayerConfig } from '../../shared/net/config'

/**
 * Local room server for one Play session (editor), on 127.0.0.1 with a random port. Every Game
 * View client of the session joins it; it stops with the session.
 */
const servers = new Map<string, RoomServer>()

export async function startDevServer(sessionId: string, cfg: MultiplayerConfig, log?: (msg: string) => void): Promise<{ url: string; origin: string }> {
  const server = new RoomServer({ maxPlayers: cfg.maxPlayers, host: '127.0.0.1', port: 0, log })
  const { port, url } = await server.start()
  servers.set(sessionId, server)
  return { url, origin: `ws://127.0.0.1:${port}` }
}

export async function stopDevServer(sessionId: string): Promise<void> {
  const server = servers.get(sessionId)
  servers.delete(sessionId)
  await server?.close()
}

export function devServerStats(sessionId: string) {
  return servers.get(sessionId)?.stats() ?? null
}
