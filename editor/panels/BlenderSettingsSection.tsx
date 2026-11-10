import React, { useEffect, useState } from 'react'
import type { BlenderStatus } from '../../shared/blenderTypes'
import { Icons } from '../ui/Icons'

const SOURCE_LABEL: Record<NonNullable<BlenderStatus['source']>, string> = {
  env: 'LINDEN_BLENDER',
  settings: 'tersimpan',
  path: 'PATH',
  common: 'lokasi instalasi',
  manual: 'dipilih manual',
}

/**
 * Bridge settings: the user's own Blender for the agent's "Blender 3D" mode. Blender is never
 * bundled; Linden only runs the program found here as a separate process.
 */
export const BlenderSettingsSection: React.FC = () => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  const [status, setStatus] = useState<BlenderStatus | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const show = (s: BlenderStatus, applied: boolean) => {
    if (applied) setStatus(s)
    if (s.found && s.path) setInput(s.path)
    setMessage(s.found ? null : s.reason ?? 'Blender tidak valid')
  }

  useEffect(() => {
    api?.blenderStatus?.().then((s) => show(s, true)).catch(() => {})
  }, [])

  const run = async (fn: () => Promise<BlenderStatus>) => {
    setBusy(true)
    try {
      const s = await fn()
      // A rejected manual path leaves the working Blender in place
      show(s, s.found || !status?.found)
    } catch (e: any) {
      setMessage(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  const detect = () => api?.blenderDetect && run(api.blenderDetect)
  const apply = () => api?.blenderSetPath && input.trim() && run(() => api.blenderSetPath!(input.trim()))
  const browse = async () => {
    if (!api?.showOpenDialog || !api.blenderSetPath) return
    const res = await api.showOpenDialog({
      title: 'Pilih program Blender (Blender.app / blender.exe / blender)',
      // macOS: Blender.app can be picked as a whole; main turns it into .../Contents/MacOS/Blender
      properties: ['openFile'],
    })
    const picked = !res?.canceled ? res?.filePaths?.[0] : null
    if (picked) {
      setInput(picked)
      run(() => api.blenderSetPath!(picked))
    }
  }

  return (
    <div className="bg-[#0f3460]/50 rounded-xl border border-gray-700/50 p-4 space-y-3 max-w-4xl">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm text-white">Blender</h3>
        <button
          onClick={detect}
          disabled={busy || !api?.blenderDetect}
          className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 flex items-center space-x-1 shrink-0"
        >
          <Icons.Sync className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          <span>Deteksi otomatis</span>
        </button>
      </div>
      <p className="text-[11px] text-gray-400 -mt-1">
        Dipakai agent saat opsi "Blender 3D" dicentang. Blender milik kamu dijalankan sebagai proses terpisah (min. 4.2).
      </p>

      <div className="flex flex-wrap gap-2 text-xs">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          placeholder="/Applications/Blender.app atau C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"
          className="flex-1 min-w-[12rem] bg-[#1a1a2e] border border-gray-600 rounded px-2 py-1.5 text-gray-200 font-mono text-[11px]"
        />
        <button onClick={apply} disabled={busy || !input.trim()} className="px-2.5 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">
          Simpan
        </button>
        <button onClick={browse} disabled={busy} className="px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          Pilih file…
        </button>
      </div>

      <div className="text-[11px]">
        {status?.found ? (
          <span className="text-emerald-400">
            ✓ Blender {status.version} {status.source ? `(sumber: ${SOURCE_LABEL[status.source]})` : ''}
          </span>
        ) : (
          <span className="text-amber-300">Blender belum terdeteksi</span>
        )}
        {message && <p className="text-red-300 mt-1 [overflow-wrap:anywhere]">{message}</p>}
      </div>
    </div>
  )
}
