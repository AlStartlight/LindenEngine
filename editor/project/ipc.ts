import { IPC_INVOKE_CHANNELS } from '../../shared/ipcChannels'

export const IPC_MISMATCH_ERROR_MESSAGE =
  'Fitur ini belum tersedia di proses aplikasi yang sedang berjalan. Restart Linden Engine lalu coba lagi.'

export async function invokeIpc<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    if (msg.includes('No handler registered for')) {
      throw new Error(IPC_MISMATCH_ERROR_MESSAGE)
    }
    throw err
  }
}

export interface IpcMismatchCheckResult {
  isElectron: boolean
  mismatch: boolean
  missingChannels: string[]
}

export async function checkIpcMismatch(): Promise<IpcMismatchCheckResult> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return { isElectron: false, mismatch: false, missingChannels: [] }
  }

  try {
    if (typeof window.electronAPI.getIpcChannels !== 'function') {
      return {
        isElectron: true,
        mismatch: true,
        missingChannels: [...IPC_INVOKE_CHANNELS],
      }
    }

    const available = await window.electronAPI.getIpcChannels()
    const availableSet = new Set(available || [])
    const missing = IPC_INVOKE_CHANNELS.filter((ch) => !availableSet.has(ch))

    return {
      isElectron: true,
      mismatch: missing.length > 0,
      missingChannels: missing,
    }
  } catch {
    return {
      isElectron: true,
      mismatch: true,
      missingChannels: [...IPC_INVOKE_CHANNELS],
    }
  }
}
