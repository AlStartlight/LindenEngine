import { mergePath, loadLoginShellPath } from '../agent/opencodeBinary'
import type { BlenderStatus } from '../../shared/blenderTypes'
import { loadBridgeSettings, saveBridgeSettings } from './godotExec'
import { blenderCandidates, normalizeBlenderPath, validateBlenderBinary, type VersionRunner, runVersion } from './blenderExec'
import path from 'node:path'

/**
 * Cached Blender detection for the editor (Bridge settings, agent panel) and the agent tools.
 * The result is cached for the app run; "Deteksi otomatis" or a manual path refreshes it.
 */

const NOT_DETECTED: BlenderStatus = { found: false, reason: 'Blender belum dideteksi' }

let status: BlenderStatus = NOT_DETECTED
let pending: Promise<BlenderStatus> | null = null
let runner: VersionRunner = runVersion
const listeners = new Set<(s: BlenderStatus) => void>()

/** Tests swap the `--version` runner */
export function setBlenderVersionRunner(fn: VersionRunner | null): void {
  runner = fn ?? runVersion
}

/** Tests (and the e2e) set the status directly */
export function setBlenderStatusForTest(s: BlenderStatus | null): void {
  status = s ?? NOT_DETECTED
  pending = null
}

export function getBlenderStatus(): BlenderStatus {
  return status
}

/** Called when the detected Blender changes (the agent re-registers its tool list) */
export function onBlenderStatusChange(cb: (s: BlenderStatus) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function update(next: BlenderStatus): BlenderStatus {
  const changed = next.found !== status.found || next.path !== status.path || next.version !== status.version
  status = next
  if (changed) for (const cb of listeners) cb(next)
  return next
}

/** Detection in progress (or done); resolves with the cached status */
export function blenderStatusReady(): Promise<BlenderStatus> {
  return pending ?? Promise.resolve(status)
}

/** Look for Blender (cached unless `refresh`) */
export function detectBlender(opts: { refresh?: boolean } = {}): Promise<BlenderStatus> {
  if (pending && !opts.refresh) return pending
  pending = (async () => {
    const loginPath = await loadLoginShellPath().catch(() => null)
    const pathDirs = mergePath([process.env.PATH, loginPath]).split(path.delimiter).filter(Boolean)
    const candidates = blenderCandidates({ saved: loadBridgeSettings().blenderExecutable, pathDirs })
    const rejected: string[] = []
    for (const cand of candidates) {
      const res = await validateBlenderBinary(cand.bin, cand.source, runner)
      if (res.found) {
        saveBridgeSettings({ blenderExecutable: res.path, blenderVersion: res.version })
        return update(res)
      }
      // A missing default location is not worth reporting; a broken or too old Blender is
      if (cand.source !== 'common' || res.version) rejected.push(res.reason ?? cand.bin)
    }
    const reason =
      'Blender 4.2+ tidak ditemukan' +
      (rejected.length ? `: ${rejected.join('; ')}` : ' di PATH maupun lokasi instalasi umum') +
      '. Atur path di pengaturan Bridge atau set LINDEN_BLENDER.'
    return update({ found: false, reason })
  })()
  return pending
}

/** Path chosen by the user (file dialog or typed); saved only when it is a valid Blender */
export async function setBlenderPath(input: string): Promise<BlenderStatus> {
  if (!input || !input.trim()) return { found: false, reason: 'Path Blender kosong' }
  const bin = normalizeBlenderPath(input)
  const res = await validateBlenderBinary(bin, 'manual', runner)
  if (!res.found) return res
  saveBridgeSettings({ blenderExecutable: res.path, blenderVersion: res.version })
  pending = Promise.resolve(res)
  return update(res)
}
