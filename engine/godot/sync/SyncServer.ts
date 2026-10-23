/**
 * WebSocket Live Sync Server
 * Localhost server for real-time bidirectional synchronization with Godot addon.
 */

import { WebSocketServer, WebSocket } from 'ws'
import { nanoid } from '../../utils/index'
import { SyncMessage, DiffEngine } from './DiffEngine'
import { ConflictResolver } from './ConflictResolver'
import { World } from '../../ecs/World'

export interface SyncServerConfig {
  port?: number
  host?: string
  token?: string
  resolver?: ConflictResolver
}

export class SyncServer {
  public readonly port: number
  public readonly host: string
  public readonly token: string
  private wss: WebSocketServer | null = null
  private clients: Set<WebSocket> = new Set()
  private diffEngine: DiffEngine = new DiffEngine()
  public readonly resolver: ConflictResolver
  public onMessageReceived?: (msg: SyncMessage) => void
  public onError?: (err: Error) => void
  public onClientConnected?: (clientInfo: { godotVersion?: string }) => void

  constructor(config: SyncServerConfig = {}) {
    this.port = config.port ?? 6007
    this.host = config.host ?? '127.0.0.1'
    this.token = config.token ?? nanoid(16)
    this.resolver = config.resolver ?? new ConflictResolver('ask')
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ host: this.host, port: this.port })

        this.wss.on('listening', () => {
          resolve()
        })

        this.wss.on('error', (err) => {
          this.onError?.(err)
          reject(err)
        })

        this.wss.on('connection', (ws: WebSocket) => {
          let authenticated = false

          ws.on('message', (raw: Buffer | string) => {
            try {
              const msg: SyncMessage = JSON.parse(raw.toString())

              // Handshake check
              if (msg.type === 'hello') {
                if (msg.token !== this.token) {
                  const errMsg: SyncMessage = {
                    v: 1,
                    type: 'error',
                    details: 'Invalid session token',
                  }
                  ws.send(JSON.stringify(errMsg))
                  ws.close(4001, 'Unauthorized')
                  this.onError?.(new Error('LiveSync: Rejected connection with invalid token'))
                  return
                }

                authenticated = true
                this.clients.add(ws)
                this.onClientConnected?.({ godotVersion: (msg as any).godot_version })

                // Send ack
                const ack: SyncMessage = {
                  v: 1,
                  type: 'ack',
                  token: this.token,
                  details: { status: 'connected' },
                }
                ws.send(JSON.stringify(ack))
                return
              }

              if (!authenticated) {
                ws.close(4002, 'Not authenticated')
                return
              }

              // Echo suppression: Ignore changes that originated from linden
              if (msg.origin === 'linden') {
                return
              }

              this.onMessageReceived?.(msg)
            } catch (err: any) {
              this.onError?.(err)
            }
          })

          ws.on('close', () => {
            this.clients.delete(ws)
          })

          ws.on('error', (err) => {
            this.onError?.(err)
            this.clients.delete(ws)
          })
        })
      } catch (err: any) {
        reject(err)
      }
    })
  }

  broadcast(message: SyncMessage): void {
    const payload = JSON.stringify({ ...message, token: this.token, origin: 'linden' })
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
  }

  stop(): void {
    if (this.wss) {
      for (const client of this.clients) {
        client.close()
      }
      this.clients.clear()
      this.wss.close()
      this.wss = null
    }
  }

  get isRunning(): boolean {
    return this.wss !== null
  }

  get connectedClientsCount(): number {
    return this.clients.size
  }
}
