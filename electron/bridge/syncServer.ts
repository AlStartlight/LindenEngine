import { WebSocketServer, WebSocket } from 'ws'

export interface BridgeSyncStatus {
  isRunning: boolean
  port: number
  clientCount: number
}

class MainProcessSyncServer {
  private wss: WebSocketServer | null = null
  private port: number = 6007
  private clients: Set<WebSocket> = new Set()
  private messageCallback: ((data: any) => void) | null = null

  public start(port: number = 6007, onMessage?: (data: any) => void): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      if (this.wss) {
        return resolve({ port: this.port })
      }

      this.port = port
      this.messageCallback = onMessage || null

      try {
        this.wss = new WebSocketServer({ port })

        this.wss.on('listening', () => {
          resolve({ port: this.port })
        })

        this.wss.on('connection', (ws: WebSocket) => {
          this.clients.add(ws)

          ws.on('message', (raw: any) => {
            try {
              const str = raw.toString()
              const parsed = JSON.parse(str)
              if (this.messageCallback) {
                this.messageCallback(parsed)
              }
            } catch {
              if (this.messageCallback) {
                this.messageCallback({ raw: raw.toString() })
              }
            }
          })

          ws.on('close', () => {
            this.clients.delete(ws)
          })

          ws.on('error', () => {
            this.clients.delete(ws)
          })
        })

        this.wss.on('error', (err: any) => {
          this.stop()
          reject(err)
        })
      } catch (err) {
        reject(err)
      }
    })
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        return resolve()
      }

      for (const client of this.clients) {
        try {
          client.close()
        } catch {}
      }
      this.clients.clear()

      this.wss.close(() => {
        this.wss = null
        resolve()
      })
    })
  }

  public broadcast(data: any): void {
    if (!this.wss) return
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload)
        } catch {}
      }
    }
  }

  public getStatus(): BridgeSyncStatus {
    return {
      isRunning: this.wss !== null,
      port: this.port,
      clientCount: this.clients.size,
    }
  }
}

export const syncServerInstance = new MainProcessSyncServer()
