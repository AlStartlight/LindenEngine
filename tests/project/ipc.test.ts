import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_INVOKE_CHANNELS } from '../../shared/ipcChannels'
import {
  invokeIpc,
  checkIpcMismatch,
  IPC_MISMATCH_ERROR_MESSAGE,
} from '../../editor/project/ipc'

describe('IPC Helper & Channel Verification (SPEC-Fix-IPC-No-Handler)', () => {
  describe('invokeIpc', () => {
    it('returns the result when the async call succeeds', async () => {
      const res = await invokeIpc(async () => ({ success: true, count: 42 }))
      expect(res).toEqual({ success: true, count: 42 })
    })

    it('translates "No handler registered for" error to friendly restart message', async () => {
      const failingCall = async () => {
        throw new Error("Error invoking remote method 'project:create': Error: No handler registered for 'project:create'")
      }

      await expect(invokeIpc(failingCall)).rejects.toThrow(IPC_MISMATCH_ERROR_MESSAGE)
    })

    it('passes through other errors without modification', async () => {
      const failingCall = async () => {
        throw new Error('Folder already exists')
      }

      await expect(invokeIpc(failingCall)).rejects.toThrow('Folder already exists')
    })
  })

  describe('Channel completeness: IPC_INVOKE_CHANNELS vs electron/main.ts', () => {
    it('ensures every channel in IPC_INVOKE_CHANNELS is registered via handle() in electron/main.ts', () => {
      const mainPath = join(process.cwd(), 'electron/main.ts')
      const mainContent = readFileSync(mainPath, 'utf-8')

      // Match handle('channel_name', ... or handle("channel_name", ...
      const handleRegex = /handle\(\s*['"]([^'"]+)['"]/g
      const registeredChannels = new Set<string>()
      let match: RegExpExecArray | null

      while ((match = handleRegex.exec(mainContent)) !== null) {
        registeredChannels.add(match[1])
      }

      const missingChannels: string[] = []
      for (const channel of IPC_INVOKE_CHANNELS) {
        if (!registeredChannels.has(channel)) {
          missingChannels.push(channel)
        }
      }

      expect(missingChannels).toEqual([])
    })
  })

  describe('checkIpcMismatch', () => {
    const originalWindow = globalThis.window

    afterEach(() => {
      globalThis.window = originalWindow
    })

    it('returns isElectron: false when window.electronAPI is undefined', async () => {
      // @ts-ignore
      delete globalThis.window
      const result = await checkIpcMismatch()
      expect(result.isElectron).toBe(false)
      expect(result.mismatch).toBe(false)
      expect(result.missingChannels).toEqual([])
    })

    it('returns mismatch: false when all required channels are registered', async () => {
      // @ts-ignore
      globalThis.window = {
        electronAPI: {
          getIpcChannels: vi.fn().mockResolvedValue([...IPC_INVOKE_CHANNELS, 'extra:channel']),
        },
      } as any

      const result = await checkIpcMismatch()
      expect(result.isElectron).toBe(true)
      expect(result.mismatch).toBe(false)
      expect(result.missingChannels).toEqual([])
    })

    it('returns mismatch: true with list of missing channels when channels are missing', async () => {
      const availableSubset = IPC_INVOKE_CHANNELS.filter((ch) => ch !== 'project:create')
      // @ts-ignore
      globalThis.window = {
        electronAPI: {
          getIpcChannels: vi.fn().mockResolvedValue(availableSubset),
        },
      } as any

      const result = await checkIpcMismatch()
      expect(result.isElectron).toBe(true)
      expect(result.mismatch).toBe(true)
      expect(result.missingChannels).toEqual(['project:create'])
    })

    it('returns mismatch: true when getIpcChannels is not a function or throws', async () => {
      // @ts-ignore
      globalThis.window = {
        electronAPI: {},
      } as any

      const result = await checkIpcMismatch()
      expect(result.isElectron).toBe(true)
      expect(result.mismatch).toBe(true)
      expect(result.missingChannels).toEqual([...IPC_INVOKE_CHANNELS])
    })
  })
})
