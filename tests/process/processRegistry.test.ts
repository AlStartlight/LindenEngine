import { describe, it, expect, beforeEach } from 'vitest'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { ProcessRegistry } from '../../electron/utils/processRegistry'

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('ProcessRegistry', () => {
  let registry: ProcessRegistry

  beforeEach(() => {
    registry = ProcessRegistry.getInstance()
  })

  it('tracks child process and auto-unregisters when child exits naturally', async () => {
    const child = spawn('node', ['-e', 'setTimeout(() => {}, 80)'])
    const unregister = registry.registerProcess(child, 'test-exit')

    expect(registry.activeProcessCount).toBeGreaterThanOrEqual(1)

    await new Promise((r) => child.on('exit', r))
    // Give event loop a microtick to clear Set
    await new Promise((r) => setTimeout(r, 20))

    expect(isPidAlive(child.pid!)).toBe(false)
  })

  it('tracks and closes registered HTTP servers during terminateAll', async () => {
    const server = http.createServer((_, res) => res.end('ok'))
    await new Promise<void>((resolve) => server.listen(0, resolve))

    registry.registerServer(server, 'test-server')
    expect(registry.activeServerCount).toBeGreaterThanOrEqual(1)

    await registry.terminateAll(500)
    expect(registry.activeServerCount).toBe(0)
  })

  it('kills process tree and descendant processes', async () => {
    // Parent spawns a child that sleeps
    const script = `
      const { spawn } = require('child_process');
      const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)']);
      process.stdout.write(String(child.pid));
      setInterval(() => {}, 1000);
    `
    const parent = spawn('node', ['-e', script], {
      detached: process.platform !== 'win32',
    })
    registry.registerProcess(parent, 'test-tree-parent')

    const childPid = await new Promise<number>((resolve) => {
      parent.stdout.once('data', (d) => {
        resolve(Number(d.toString().trim()))
      })
    })

    expect(isPidAlive(parent.pid!)).toBe(true)
    expect(isPidAlive(childPid)).toBe(true)

    await registry.terminateAll(1000)

    // Give OS a moment to reap
    await new Promise((r) => setTimeout(r, 100))

    expect(isPidAlive(parent.pid!)).toBe(false)
    expect(isPidAlive(childPid)).toBe(false)
  })

  it('forceKillRemainingSync forcibly reaps processes synchronously', async () => {
    const proc = spawn('node', ['-e', 'setInterval(() => {}, 1000)'])
    registry.registerProcess(proc, 'test-force-sync')

    expect(isPidAlive(proc.pid!)).toBe(true)

    registry.forceKillRemainingSync()

    await new Promise((r) => setTimeout(r, 50))
    expect(isPidAlive(proc.pid!)).toBe(false)
  })
})
