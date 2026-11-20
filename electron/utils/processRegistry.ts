import { ChildProcess, execSync } from 'node:child_process'

interface TrackedProcess {
  name: string
  proc: ChildProcess
  pid?: number
}

interface TrackedServer {
  name: string
  server: { close: (cb?: (err?: Error) => void) => void }
}

export class ProcessRegistry {
  private static instance: ProcessRegistry | null = null
  private processes = new Set<TrackedProcess>()
  private servers = new Set<TrackedServer>()

  public static getInstance(): ProcessRegistry {
    if (!ProcessRegistry.instance) {
      ProcessRegistry.instance = new ProcessRegistry()
    }
    return ProcessRegistry.instance
  }

  /**
   * Register a child process to be tracked and killed upon app exit.
   * Returns an unregister function to call when process finishes naturally.
   */
  public registerProcess(proc: ChildProcess, name: string): () => void {
    const item: TrackedProcess = { name, proc, pid: proc.pid }
    this.processes.add(item)

    const cleanup = () => {
      this.processes.delete(item)
    }

    proc.once('exit', cleanup)
    proc.once('close', cleanup)
    proc.once('error', cleanup)

    return cleanup
  }

  /**
   * Register a network/HTTP server to be closed upon app exit.
   */
  public registerServer(server: { close: (cb?: (err?: Error) => void) => void }, name: string): () => void {
    const item: TrackedServer = { name, server }
    this.servers.add(item)
    return () => {
      this.servers.delete(item)
    }
  }

  /**
   * Get count of actively tracked processes.
   */
  public get activeProcessCount(): number {
    return this.processes.size
  }

  /**
   * Get count of actively tracked servers.
   */
  public get activeServerCount(): number {
    return this.servers.size
  }

  /**
   * Kill an entire process tree given a root PID across Windows and POSIX.
   */
  public async killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (!pid || pid <= 0) return

    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' })
      } catch (_) {}
      return
    }

    // POSIX: Kill descendants recursively then root
    try {
      const pgrepOut = execSync(`pgrep -P ${pid}`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' })
      const childPids = pgrepOut
        .split('\n')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
      for (const cPid of childPids) {
        await this.killProcessTree(cPid, signal)
      }
    } catch (_) {}

    // Try killing process group or root PID
    try {
      process.kill(-pid, signal)
    } catch (_) {
      try {
        process.kill(pid, signal)
      } catch (_) {}
    }
  }

  /**
   * Terminate all tracked processes and servers with a two-stage shutdown (SIGTERM -> SIGKILL).
   */
  public async terminateAll(timeoutMs = 1200): Promise<void> {
    // 1. Close all registered servers
    for (const item of Array.from(this.servers)) {
      try {
        item.server.close()
      } catch (_) {}
    }
    this.servers.clear()

    if (this.processes.size === 0) return

    const active = Array.from(this.processes)
    // Stage 1: Graceful SIGTERM
    for (const item of active) {
      if (item.pid) {
        this.killProcessTree(item.pid, 'SIGTERM').catch(() => {})
      } else {
        try {
          item.proc.kill('SIGTERM')
        } catch (_) {}
      }
    }

    // Wait for exit or timeout
    const start = Date.now()
    while (this.processes.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50))
    }

    // Stage 2: Force SIGKILL on any remaining processes
    if (this.processes.size > 0) {
      for (const item of Array.from(this.processes)) {
        if (item.pid) {
          this.killProcessTree(item.pid, 'SIGKILL').catch(() => {})
        } else {
          try {
            item.proc.kill('SIGKILL')
          } catch (_) {}
        }
      }
      this.processes.clear()
    }
  }

  /**
   * Synchronous emergency kill (used in will-quit / process exit).
   */
  public forceKillRemainingSync(): void {
    for (const item of Array.from(this.processes)) {
      if (item.pid) {
        if (process.platform === 'win32') {
          try {
            execSync(`taskkill /pid ${item.pid} /T /F`, { stdio: 'ignore' })
          } catch (_) {}
        } else {
          try {
            process.kill(item.pid, 'SIGKILL')
          } catch (_) {}
        }
      } else {
        try {
          item.proc.kill('SIGKILL')
        } catch (_) {}
      }
    }
    this.processes.clear()

    for (const item of Array.from(this.servers)) {
      try {
        item.server.close()
      } catch (_) {}
    }
    this.servers.clear()
  }
}
