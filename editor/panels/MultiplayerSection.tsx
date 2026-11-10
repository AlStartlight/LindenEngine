import React, { useEffect, useState } from 'react'
import { MULTIPLAYER_DEFAULTS, type MultiplayerConfig } from '../../shared/net/config'

/**
 * Project Settings > Multiplayer: the `multiplayer` block of project.linden.json
 * (docs/specs/SPEC-Multiplayer-WebSocket.md). Saved field by field through project:multiplayer.
 */
export const MultiplayerSection: React.FC<{ projectPath: string | null }> = ({ projectPath }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  const [cfg, setCfg] = useState<MultiplayerConfig>(MULTIPLAYER_DEFAULTS)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath || !api?.projectMultiplayer) return
    api.projectMultiplayer({ projectPath }).then((res) => {
      if (res.status === 'ok' && res.config) {
        setCfg(res.config)
        setUrl(res.config.serverUrl)
      }
    })
  }, [projectPath])

  const save = async (patch: Partial<MultiplayerConfig>) => {
    if (!projectPath || !api?.projectMultiplayer) return
    const res = await api.projectMultiplayer({ projectPath, patch })
    if (res.status === 'ok' && res.config) {
      setCfg(res.config)
      setError(null)
    } else setError(res.message ?? 'Gagal menyimpan')
  }

  const disabled = !projectPath || !api?.projectMultiplayer
  const row = 'flex items-center justify-between gap-3'
  const input = 'bg-black/40 border border-gray-700 rounded px-2 py-1 text-white'

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-300 text-sm">Multiplayer (WebSocket)</h3>
      <div className="bg-[#121b33] border border-gray-700/50 rounded-lg p-3 space-y-3 max-w-md">
        <label className={`${row} cursor-pointer`}>
          <span className="text-gray-300">Aktifkan multiplayer</span>
          <input type="checkbox" checked={cfg.enabled} disabled={disabled} onChange={(e) => save({ enabled: e.target.checked })} />
        </label>
        <p className="text-gray-500 leading-relaxed">
          Entity dengan komponen <b>Network Sync</b> tersinkron ke semua pemain. Entity dengan template <code>player</code> menjadi avatar tiap
          pemain. Saat Play, editor menjalankan server lokal; pilih <b>Klien: 2</b> di Game View untuk menguji dua pemain.
        </p>
        <div className="space-y-1">
          <span className="text-gray-300">Server produksi</span>
          <input
            value={url}
            disabled={disabled || !cfg.enabled}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => url !== cfg.serverUrl && save({ serverUrl: url })}
            placeholder="kosong = server yang sama dengan halaman game (/net)"
            className={`${input} w-full font-mono text-[11px]`}
          />
          <p className="text-gray-500">Contoh: wss://game.contoh.com/net. Halaman https wajib memakai wss://.</p>
        </div>
        <div className={row}>
          <span className="text-gray-300">Maks pemain per room</span>
          <input
            type="number"
            min={2}
            max={64}
            value={cfg.maxPlayers}
            disabled={disabled || !cfg.enabled}
            onChange={(e) => save({ maxPlayers: Number(e.target.value) })}
            className={`${input} w-20`}
          />
        </div>
        <div className={row}>
          <span className="text-gray-300">Tick rate (Hz)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={cfg.tickRate}
            disabled={disabled || !cfg.enabled}
            onChange={(e) => save({ tickRate: Number(e.target.value) })}
            className={`${input} w-20`}
          />
        </div>
        <div className={row}>
          <span className="text-gray-300">Room</span>
          <select value={cfg.room} disabled={disabled || !cfg.enabled} onChange={(e) => save({ room: e.target.value as 'auto' | 'code' })} className={input}>
            <option value="auto">Otomatis (satu room)</option>
            <option value="code">Kode room (?room=)</option>
          </select>
        </div>
        {error && <p className="text-red-400">{error}</p>}
      </div>
    </div>
  )
}
