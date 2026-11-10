import { NET_PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../shared/net/protocol'

/**
 * WebSocket connection to a Linden room server. The transport is injected: the browser's
 * WebSocket in the player, `ws` (or Node's global WebSocket) headless.
 */

export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: any) => void) | null
  onmessage: ((ev: { data: any }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: any) => void) | null
}

export type SocketFactory = (url: string) => WebSocketLike

export type NetStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

export interface NetClientOptions {
  url: string
  room?: string
  name?: string
  socket?: SocketFactory
  onMessage: (msg: ServerMessage) => void
  onStatus?: (status: NetStatus, detail?: string) => void
  pingMs?: number
  /** Reconnect attempts after a connection that worked drops (0 = never) */
  maxRetries?: number
  connectTimeoutMs?: number
}

const OPEN = 1

export class NetClient {
  private socket: WebSocketLike | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retries = 0
  private closedByUser = false
  private welcomed = false
  /** Round-trip time in ms (smoothed) */
  rtt = 0
  /** serverTime ≈ Date.now() + offset */
  private offset = 0
  private bestRtt = Infinity
  status: NetStatus = 'offline'

  constructor(private opts: NetClientOptions) {}

  /** Server clock estimate in ms */
  serverNow(): number {
    return Date.now() + this.offset
  }

  get connected(): boolean {
    return this.welcomed && this.socket?.readyState === OPEN
  }

  /** Open the connection; resolves with the welcome, rejects when it fails first time */
  connect(): Promise<Extract<ServerMessage, { t: 'welcome' }>> {
    this.closedByUser = false
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.teardown()
        reject(new Error(`Server multiplayer tidak merespons (${this.opts.url})`))
      }, this.opts.connectTimeoutMs ?? 5000)
      this.open({
        onWelcome: (w) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(w)
        },
        onFail: (reason) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(new Error(reason))
        },
      })
    })
  }

  private setStatus(status: NetStatus, detail?: string): void {
    this.status = status
    this.opts.onStatus?.(status, detail)
  }

  private open(first?: { onWelcome: (w: any) => void; onFail: (reason: string) => void }): void {
    const factory = this.opts.socket ?? ((url: string) => new (globalThis as any).WebSocket(url) as WebSocketLike)
    let socket: WebSocketLike
    this.setStatus(first ? 'connecting' : 'reconnecting')
    try {
      socket = factory(this.opts.url)
    } catch (e: any) {
      first?.onFail(`Tidak bisa membuka koneksi ke ${this.opts.url}: ${e?.message ?? e}`)
      return
    }
    this.socket = socket
    this.welcomed = false
    let lastError = ''
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: 'hello', v: NET_PROTOCOL_VERSION, room: this.opts.room, name: this.opts.name } satisfies ClientMessage))
    }
    socket.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))
      } catch {
        return
      }
      if (msg.t === 'pong') return this.onPong(msg)
      if (msg.t === 'welcome') {
        this.welcomed = true
        this.retries = 0
        this.offset = msg.time - Date.now()
        this.startPing()
        this.setStatus('connected')
        first?.onWelcome(msg)
      }
      if (msg.t === 'error') lastError = msg.message
      this.opts.onMessage(msg)
    }
    socket.onerror = () => {
      lastError ||= `Koneksi ke ${this.opts.url} gagal`
    }
    socket.onclose = (ev) => {
      const wasWelcomed = this.welcomed
      this.stopPing()
      this.welcomed = false
      if (this.socket === socket) this.socket = null
      if (!wasWelcomed) {
        first?.onFail(lastError || `Koneksi ke ${this.opts.url} ditutup (${ev.code})`)
        if (!first) this.scheduleRetry()
        return
      }
      if (this.closedByUser) return
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    const max = this.opts.maxRetries ?? 5
    if (this.closedByUser || this.retries >= max) {
      this.setStatus('offline', 'Koneksi multiplayer terputus')
      return
    }
    const delay = Math.min(8000, 1000 * 2 ** this.retries++)
    this.setStatus('reconnecting', `Menyambung ulang dalam ${Math.round(delay / 1000)} dtk`)
    this.retryTimer = setTimeout(() => this.open(), delay)
  }

  private startPing(): void {
    this.stopPing()
    const ping = () => this.send({ t: 'ping', c: Date.now() })
    ping()
    this.pingTimer = setInterval(ping, this.opts.pingMs ?? 2000)
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private onPong(msg: { c: number; s: number }): void {
    const now = Date.now()
    const rtt = Math.max(0, now - msg.c)
    this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt
    // The sample with the lowest round trip gives the best clock offset
    if (rtt <= this.bestRtt * 1.2) {
      this.bestRtt = Math.min(this.bestRtt, rtt)
      this.offset = msg.s + rtt / 2 - now
    }
  }

  send(msg: ClientMessage): boolean {
    const s = this.socket
    if (!s || s.readyState !== OPEN) return false
    s.send(JSON.stringify(msg))
    return true
  }

  close(): void {
    this.closedByUser = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.teardown()
    this.setStatus('offline')
  }

  private teardown(): void {
    this.stopPing()
    const s = this.socket
    this.socket = null
    this.welcomed = false
    if (s) {
      s.onclose = null
      s.onmessage = null
      try {
        s.close(1000)
      } catch {}
    }
  }
}
