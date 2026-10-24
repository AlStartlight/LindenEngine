import React, { useState, useEffect } from 'react'
import { GodotBridge } from '../../engine/godot/GodotBridge'
import { CompatReport } from '../../engine/godot/report/CompatReport'
import { GodotBuildRunner } from '../../engine/godot/build/GodotBuildRunner'
import { TransmuterWizard } from './TransmuterWizard'
import { Icons } from '../ui/Icons'

export interface BridgePanelProps {
  bridge?: GodotBridge
  onExport?: () => void
  onImport?: () => void
  onOpenExportDialog?: () => void
  onOpenGodotImportWizard?: () => void
}

export const BridgePanel: React.FC<BridgePanelProps> = ({
  bridge,
  onExport,
  onImport,
  onOpenExportDialog,
  onOpenGodotImportWizard,
}) => {
  const [selectedTarget, setSelectedTarget] = useState<'godot' | 'unity'>('godot')
  const [projectPath, setProjectPath] = useState<string>(bridge?.getConfig().godotProjectPath || '')
  const [executablePath, setExecutablePath] = useState<string>(bridge?.getConfig().godotExecutable || '')
  const [isSyncActive, setIsSyncActive] = useState<boolean>(bridge?.isLiveSyncActive || false)
  const [statusMsg, setStatusMsg] = useState<string>('Ready')
  const [report, setReport] = useState<CompatReport | null>(null)
  const [showIssues, setShowIssues] = useState(false)
  const [detectedGodot, setDetectedGodot] = useState<string | null>(
    GodotBuildRunner.findGodotExecutable(bridge?.getConfig().godotExecutable)
  )
  const [godotValidation, setGodotValidation] = useState<{
    ok: boolean
    path?: string
    version?: string
    reason?: string
  } | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.bridgeValidateGodot) {
      window.electronAPI.bridgeValidateGodot(executablePath || bridge?.getConfig().godotExecutable).then((res) => {
        setGodotValidation(res)
        if (res.ok && res.path) {
          setDetectedGodot(res.path)
        }
      })
    }
  }, [executablePath, bridge])

  const handleBrowseProjectPath = async () => {
    if (typeof window !== 'undefined' && (window.electronAPI as any)?.showOpenDialog) {
      const res = await (window.electronAPI as any).showOpenDialog({
        title: 'Select Godot Project Directory',
        properties: ['openDirectory'],
      })
      if (!res.canceled && res.filePaths?.[0]) {
        const p = res.filePaths[0]
        setProjectPath(p)
        bridge?.setConfig({ godotProjectPath: p })
      }
    } else {
      const p = prompt('Enter Godot project directory path:', projectPath)
      if (p) {
        setProjectPath(p)
        bridge?.setConfig({ godotProjectPath: p })
      }
    }
  }

  const handleBrowseExecutable = async () => {
    if (typeof window !== 'undefined' && (window.electronAPI as any)?.showOpenDialog) {
      const res = await (window.electronAPI as any).showOpenDialog({
        title: 'Select Godot Executable or Application (.app)',
        properties: ['openFile'],
      })
      if (!res.canceled && res.filePaths?.[0]) {
        const p = res.filePaths[0]
        setExecutablePath(p)
        bridge?.setConfig({ godotExecutable: p })

        if (window.electronAPI?.bridgeValidateGodot) {
          const val = await window.electronAPI.bridgeValidateGodot(p)
          setGodotValidation(val)
          if (val.ok && val.path) {
            setDetectedGodot(val.path)
            setStatusMsg(`Godot ${val.version} terdeteksi dan tervalidasi`)
          } else {
            setStatusMsg(`Godot tidak valid: ${val.reason || 'Bukan Godot 4.3+'}`)
          }
        } else {
          setDetectedGodot(p)
        }
      }
    } else {
      const p = prompt('Enter Godot executable binary path:', executablePath)
      if (p) {
        setExecutablePath(p)
        bridge?.setConfig({ godotExecutable: p })
        setDetectedGodot(p)
      }
    }
  }

  const handleAutoDetect = async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.bridgeValidateGodot) {
      const val = await window.electronAPI.bridgeValidateGodot()
      setGodotValidation(val)
      if (val.ok && val.path) {
        setDetectedGodot(val.path)
        setExecutablePath(val.path)
        bridge?.setConfig({ godotExecutable: val.path })
        setStatusMsg(`Godot ${val.version} ditemukan di: ${val.path}`)
      } else {
        setStatusMsg('Godot 4.3+ tidak ditemukan di sistem.')
      }
    } else {
      const found = GodotBuildRunner.findGodotExecutable()
      if (found) {
        setDetectedGodot(found)
        setExecutablePath(found)
        bridge?.setConfig({ godotExecutable: found })
      }
    }
  }

  const handleToggleSync = async () => {
    try {
      if (isSyncActive) {
        if (typeof window !== 'undefined' && window.electronAPI?.bridgeStopSync) {
          await window.electronAPI.bridgeStopSync()
        } else if (bridge) {
          bridge.stopLiveSync()
        }
        setIsSyncActive(false)
        setStatusMsg('Live sync stopped')
      } else {
        const port = bridge?.getConfig().syncPort || 6007
        if (typeof window !== 'undefined' && window.electronAPI?.bridgeStartSync) {
          await window.electronAPI.bridgeStartSync({ port })
        } else if (bridge) {
          await bridge.startLiveSync()
        }
        setIsSyncActive(true)
        setStatusMsg(`Live sync active on port ${port}`)
      }
    } catch (err: any) {
      setStatusMsg(`Sync error: ${err.message}`)
    }
  }

  const handleExport = async () => {
    setStatusMsg('Exporting scene to Godot (.tscn)...')
    if (onExport) {
      onExport()
    } else if (bridge && (bridge as any).currentWorld) {
      try {
        const targetProj = projectPath || bridge.getConfig().godotProjectPath || '.'
        const outPath = `${targetProj}/main_scene.tscn`
        const rep = await bridge.exportScene((bridge as any).currentWorld, outPath)
        setReport(rep)
        setStatusMsg(`Exported successfully: ${rep.convertedCount} items converted`)
      } catch (err: any) {
        setStatusMsg(`Export failed: ${err.message}`)
      }
    }
  }

  const handleImport = async () => {
    setStatusMsg('Importing scene from Godot (.tscn)...')
    if (typeof window !== 'undefined' && window.electronAPI?.bridgeImportScene) {
      try {
        const res = await window.electronAPI.bridgeImportScene()
        if (res.canceled) {
          setStatusMsg('Import scene dibatalkan.')
          return
        }
        if (res.report) {
          setReport(res.report)
          setStatusMsg(`Scene berhasil diimpor: ${res.report.convertedCount} node terkonversi`)
        }
        if (onImport) onImport()
      } catch (err: any) {
        setStatusMsg(`Import failed: ${err.message}`)
      }
    } else if (onImport) {
      onImport()
    } else if (bridge) {
      try {
        const targetProj = projectPath || bridge.getConfig().godotProjectPath || '.'
        const inPath = `${targetProj}/main_scene.tscn`
        const res = await bridge.importScene(inPath)
        setReport(res.report)
        setStatusMsg(`Imported successfully: ${res.report.convertedCount} items converted`)
      } catch (err: any) {
        setStatusMsg(`Import failed: ${err.message}`)
      }
    }
  }

  const openGodotDownload = () => {
    const url = 'https://godotengine.org/download'
    if (typeof window !== 'undefined' && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  const openImportWizard = () => {
    if (onOpenGodotImportWizard) {
      onOpenGodotImportWizard()
    } else if (typeof window !== 'undefined' && (window as any).__openGodotImportWizard) {
      ;(window as any).__openGodotImportWizard()
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#16213e] text-gray-200 p-4 space-y-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700/60 pb-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-lg border border-indigo-500/30">
            <Icons.Bridge className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-bold text-base text-white">Bridge</h2>
              <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-medium border border-indigo-700/40">
                Interop
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">Sinkron dan ekspor ke engine lain</p>
          </div>
        </div>

        {/* Target Engine Selector */}
        <div className="flex items-center bg-[#0f3460] p-1 rounded-lg border border-gray-700/50">
          <button
            onClick={() => setSelectedTarget('godot')}
            className={`px-3 py-1 text-xs font-medium rounded transition ${
              selectedTarget === 'godot'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Target: Godot
          </button>
          <button
            onClick={() => setSelectedTarget('unity')}
            className={`px-3 py-1 text-xs font-medium rounded transition ${
              selectedTarget === 'unity'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Target: Unity
          </button>
        </div>
      </div>

      {selectedTarget === 'unity' ? (
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#0f3460]/40 rounded-xl border border-gray-700/50 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-700/50 pb-3">
              <div>
                <h3 className="font-semibold text-sm text-white">Unity Interop & Transmuter</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Migrasi dua arah scene, aset, dan script antara Unity dan Linden Engine via LIF (Linden Intermediate Format).
                </p>
              </div>
            </div>
            <TransmuterWizard />
          </div>
        </div>
      ) : (
        <div className="space-y-4 max-w-4xl">
          {/* Card 1: Hubungkan */}
          <div className="bg-[#0f3460]/50 rounded-xl border border-gray-700/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                  1
                </span>
                <h3 className="font-semibold text-sm text-white">Hubungkan</h3>
              </div>
              <button
                onClick={handleAutoDetect}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center space-x-1"
              >
                <Icons.Sync className="w-3.5 h-3.5" />
                <span>Auto-detect</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-gray-400 font-medium mb-1">Path Project Godot</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={projectPath}
                    onChange={(e) => {
                      setProjectPath(e.target.value)
                      bridge?.setConfig({ godotProjectPath: e.target.value })
                    }}
                    placeholder="/path/to/godot_project"
                    className="flex-1 bg-[#16213e] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleBrowseProjectPath}
                    className="px-2.5 py-1.5 bg-gray-700/70 hover:bg-gray-600 text-gray-200 rounded text-xs flex items-center space-x-1"
                  >
                    <Icons.Folder className="w-3.5 h-3.5" />
                    <span>Browse</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-gray-400 font-medium mb-1">Godot Executable</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={executablePath}
                    onChange={(e) => {
                      setExecutablePath(e.target.value)
                      bridge?.setConfig({ godotExecutable: e.target.value })
                    }}
                    placeholder={detectedGodot || 'Path ke executable Godot 4.3+'}
                    className="flex-1 bg-[#16213e] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleBrowseExecutable}
                    className="px-2.5 py-1.5 bg-gray-700/70 hover:bg-gray-600 text-gray-200 rounded text-xs flex items-center space-x-1"
                  >
                    <Icons.Folder className="w-3.5 h-3.5" />
                    <span>Browse</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Status Detection Badge */}
            <div className="pt-1">
              {godotValidation?.ok && godotValidation.path ? (
                <div className="flex items-center space-x-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-3 py-2 rounded-lg">
                  <Icons.Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    ✓ Godot {godotValidation.version} di:{' '}
                    <code className="text-[11px] font-mono text-emerald-300">{godotValidation.path}</code>
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 px-3 py-2 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Icons.AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      {godotValidation?.reason || 'Godot executable 4.3+ belum terdeteksi di sistem.'}
                    </span>
                  </div>
                  <button
                    onClick={openGodotDownload}
                    className="px-2.5 py-1 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 rounded border border-amber-500/40 text-[11px] flex items-center space-x-1"
                  >
                    <span>Unduh Godot</span>
                    <Icons.ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Sinkronkan */}
          <div className="bg-[#0f3460]/50 rounded-xl border border-gray-700/50 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                  2
                </span>
                <h3 className="font-semibold text-sm text-white">Sinkronkan</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isSyncActive ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'
                  }`}
                />
                <span className="text-xs text-gray-400">
                  {isSyncActive ? 'Live Sync Aktif' : 'Sync Nonaktif'}
                </span>
              </div>
            </div>

            {/* Primary Action: Import Project */}
            <div className="bg-[#16213e] p-3.5 rounded-xl border border-indigo-500/30 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="font-semibold text-white text-xs flex items-center space-x-1.5">
                  <span>Import Project Godot</span>
                  <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded text-[10px]">
                    Utama
                  </span>
                </div>
                <div className="text-[11px] text-gray-400 max-w-lg">
                  Impor seluruh project Godot (hierarki scene, script, dan aset) menjadi project Linden baru dengan Godot headless parser.
                </div>
              </div>
              <button
                onClick={openImportWizard}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 px-3.5 rounded-lg text-xs flex items-center space-x-1.5 transition shadow"
              >
                <Icons.Import className="w-4 h-4" />
                <span>Import Project…</span>
              </button>
            </div>

            {/* Secondary Actions */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
                Scene Tunggal & Live Sync
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  onClick={handleExport}
                  className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center space-x-2 transition shadow"
                >
                  <Icons.Export className="w-4 h-4" />
                  <span>Export Scene (.tscn)</span>
                </button>

                <button
                  onClick={handleImport}
                  className="bg-indigo-600/80 hover:bg-indigo-600 text-white py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center space-x-2 transition shadow"
                >
                  <Icons.Import className="w-4 h-4" />
                  <span>Import Scene (.tscn)</span>
                </button>

                <button
                  onClick={handleToggleSync}
                  className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center space-x-2 transition ${
                    isSyncActive
                      ? 'bg-rose-600 hover:bg-rose-500 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  <Icons.Sync className="w-4 h-4" />
                  <span>{isSyncActive ? 'Stop Live Sync' : 'Start Live Sync'}</span>
                </button>
              </div>
            </div>

            <div className="text-[11px] text-gray-400 bg-[#16213e]/70 px-3 py-2 rounded-lg border border-gray-700/40 flex items-center justify-between">
              <span>Port {bridge?.getConfig().syncPort || 6007} • Localhost (127.0.0.1)</span>
              <span className="text-gray-300 font-mono">Status: {statusMsg}</span>
            </div>

            {report && (
              <div className="bg-[#16213e] p-3 rounded-lg border border-gray-700/60 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">Hasil Konversi:</span>
                  <button
                    onClick={() => setShowIssues(!showIssues)}
                    className="text-[11px] text-blue-400 hover:underline"
                  >
                    {showIssues ? 'Sembunyikan detail' : `Lihat detail (${report.issues.length})`}
                  </button>
                </div>
                <div className="text-gray-300 text-[11px]">
                  Terkonversi: <b className="text-emerald-400">{report.convertedCount}</b> • Dilewati: <b className="text-gray-400">{report.skippedCount}</b> • Peringatan: <b className="text-amber-400">{report.warnings.length}</b> • Error: <b className="text-rose-400">{report.errors.length}</b>
                </div>
                {showIssues && report.issues.length > 0 && (
                  <div className="max-h-28 overflow-y-auto space-y-1 font-mono text-[10px] bg-black/40 p-2 rounded">
                    {report.issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className={
                          issue.severity === 'error'
                            ? 'text-rose-400'
                            : issue.severity === 'warning'
                            ? 'text-amber-400'
                            : 'text-gray-400'
                        }
                      >
                        [{issue.severity.toUpperCase()}] {issue.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card 3: Ekspor */}
          <div className="bg-[#0f3460]/50 rounded-xl border border-gray-700/50 p-4 space-y-3">
            <div className="flex items-center space-x-2">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                3
              </span>
              <h3 className="font-semibold text-sm text-white">Ekspor Multi-Platform</h3>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Export multi-platform dipusatkan di dialog <b>Export</b>. Godot digunakan sebagai backend build headless untuk Android dan iOS, serta opsional untuk platform lainnya.
            </p>

            <button
              onClick={() => {
                if (onOpenExportDialog) {
                  onOpenExportDialog()
                } else if (typeof window !== 'undefined' && (window as any).__openExportDialog) {
                  ;(window as any).__openExportDialog()
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2 px-4 rounded-lg text-xs flex items-center space-x-2 transition shadow"
            >
              <Icons.Export className="w-4 h-4" />
              <span>Buka Dialog Export…</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
