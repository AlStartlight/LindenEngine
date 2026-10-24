import React, { useState, useEffect, useRef } from 'react'
import { Icons } from '../ui/Icons'
import type {
  GodotProjectInfo,
  ImportProgressEvent,
  ImportSummary,
} from '../../shared/godotBridgeTypes'

export interface GodotImportWizardProps {
  isOpen: boolean
  onClose: () => void
  onOpenProject?: (projectPath: string) => void
  onShowToast?: (message: string) => void
}

export const GodotImportWizard: React.FC<GodotImportWizardProps> = ({
  isOpen,
  onClose,
  onOpenProject,
  onShowToast,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Step 1: Sumber
  const [sourceDir, setSourceDir] = useState<string>('')
  const [isDetecting, setIsDetecting] = useState<boolean>(false)
  const [projectInfo, setProjectInfo] = useState<GodotProjectInfo | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [godotExec, setGodotExec] = useState<{ ok: boolean; path?: string; version?: string } | null>(null)

  // Step 2: Tujuan
  const [projectName, setProjectName] = useState<string>('')
  const [destDir, setDestDir] = useState<string>('')
  const [transpileScripts, setTranspileScripts] = useState<boolean>(false)
  const [copyAddons, setCopyAddons] = useState<boolean>(true)

  // Step 3: Proses
  const [jobId, setJobId] = useState<string>('')
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Step 4: Hasil
  const [resultSummary, setResultSummary] = useState<ImportSummary | null>(null)
  const [createdProjectPath, setCreatedProjectPath] = useState<string | null>(null)
  const [reportPath, setReportPath] = useState<string | null>(null)

  // Check Godot executable and default directories on open
  useEffect(() => {
    if (!isOpen) return

    if (typeof window !== 'undefined' && window.electronAPI?.bridgeValidateGodot) {
      window.electronAPI.bridgeValidateGodot().then((res) => {
        setGodotExec(res)
      })
    }

    if (typeof window !== 'undefined' && window.electronAPI?.getProjectPath) {
      window.electronAPI.getProjectPath().then((p) => {
        if (!destDir && p) {
          setDestDir(p)
        }
      })
    }
  }, [isOpen])

  // Setup IPC log and progress listeners
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return

    const unsubProg = window.electronAPI.onBridgeImportProgress?.((data) => {
      setProgress(data)
    })

    const unsubLog = window.electronAPI.onBridgeImportLog?.((data) => {
      setLogs((prev) => [...prev, data.line])
    })

    return () => {
      unsubProg?.()
      unsubLog?.()
    }
  }, [])

  // Auto scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  const runDetect = async (dirPath: string) => {
    if (!dirPath.trim()) {
      setProjectInfo(null)
      setDetectError(null)
      return
    }

    setIsDetecting(true)
    setDetectError(null)

    try {
      if (typeof window !== 'undefined' && window.electronAPI?.bridgeDetectGodotProject) {
        const info = await window.electronAPI.bridgeDetectGodotProject(dirPath)
        setProjectInfo(info)
        setProjectName(info.name || 'GodotProject')
      } else {
        setDetectError('Electron API bridgeDetectGodotProject tidak tersedia')
      }
    } catch (err: any) {
      setProjectInfo(null)
      setDetectError(err.message || 'Gagal mendeteksi project Godot')
    } finally {
      setIsDetecting(false)
    }
  }

  const handleBrowseSource = async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.showOpenDialog) {
      const res = await window.electronAPI.showOpenDialog({
        title: 'Pilih Folder Project Godot (berisi project.godot)',
        properties: ['openDirectory'],
      })
      if (!res.canceled && res.filePaths?.[0]) {
        const p = res.filePaths[0]
        setSourceDir(p)
        runDetect(p)
      }
    }
  }

  const handleBrowseDest = async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.showOpenDialog) {
      const res = await window.electronAPI.showOpenDialog({
        title: 'Pilih Lokasi Tujuan Project Linden',
        properties: ['openDirectory'],
      })
      if (!res.canceled && res.filePaths?.[0]) {
        setDestDir(res.filePaths[0])
      }
    }
  }

  const handleStartImport = async () => {
    const currentJobId = `job-${Date.now()}`
    setJobId(currentJobId)
    setLogs([])
    setProgress(null)
    setStep(3)

    try {
      if (typeof window !== 'undefined' && window.electronAPI?.bridgeRunImport) {
        const res = await window.electronAPI.bridgeRunImport({
          jobId: currentJobId,
          dir: sourceDir,
          dest: destDir,
          name: projectName,
          transpileScripts,
          copyAddons,
        })

        setResultSummary(res.summary)
        setCreatedProjectPath(res.projectPath)
        setReportPath(res.reportPath)
        setStep(4)
      }
    } catch (err: any) {
      onShowToast?.(`Import gagal: ${err.message}`)
    }
  }

  const handleCancelImport = async () => {
    if (jobId && typeof window !== 'undefined' && window.electronAPI?.bridgeCancelImport) {
      await window.electronAPI.bridgeCancelImport(jobId)
      setStep(1)
      onShowToast?.('Import dibatalkan.')
    }
  }

  const handleOpenCreatedProject = () => {
    if (createdProjectPath && onOpenProject) {
      onOpenProject(createdProjectPath)
      onClose()
    }
  }

  const handleViewReport = () => {
    if (reportPath && typeof window !== 'undefined' && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(`file://${reportPath}`)
    }
  }

  const handleShowInFinder = () => {
    if (createdProjectPath && typeof window !== 'undefined' && window.electronAPI?.showItemInFolder) {
      window.electronAPI.showItemInFolder(createdProjectPath)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#16213e] border border-gray-700/80 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Wizard Header */}
        <div className="bg-[#0f3460] px-6 py-4 border-b border-gray-700/70 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-600/30 text-indigo-300 rounded-lg border border-indigo-500/30">
              <Icons.Bridge className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Import Project Godot ke Linden Engine</h2>
              <p className="text-xs text-gray-300">
                Migrasi otomatis scene, node hierarki, aset, dan script
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-700/50 transition"
          >
            <Icons.Close className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Step Indicator */}
        <div className="flex items-center justify-between px-8 py-3 bg-[#111a30] border-b border-gray-800 text-xs">
          {[
            { num: 1, label: '1. Sumber' },
            { num: 2, label: '2. Tujuan' },
            { num: 3, label: '3. Proses' },
            { num: 4, label: '4. Hasil' },
          ].map((s) => (
            <div
              key={s.num}
              className={`flex items-center space-x-2 font-medium ${
                step === s.num
                  ? 'text-blue-400 font-bold'
                  : step > s.num
                  ? 'text-emerald-400'
                  : 'text-gray-500'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  step === s.num
                    ? 'bg-blue-600 text-white'
                    : step > s.num
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-700 text-gray-400'
                }`}
              >
                {step > s.num ? '✓' : s.num}
              </span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Wizard Body Content */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          {/* STEP 1: Sumber */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Folder Project Godot
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={sourceDir}
                    onChange={(e) => {
                      setSourceDir(e.target.value)
                      runDetect(e.target.value)
                    }}
                    placeholder="/path/to/godot_project (folder berisi project.godot)"
                    className="flex-1 bg-[#0f172a] border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleBrowseSource}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg flex items-center space-x-1.5 transition"
                  >
                    <Icons.Folder className="w-4 h-4" />
                    <span>Pilih Folder</span>
                  </button>
                </div>
              </div>

              {/* Godot Binary Status */}
              <div>
                {godotExec?.ok ? (
                  <div className="flex items-center space-x-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-3 py-2 rounded-lg">
                    <Icons.Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      Ditemukan Godot {godotExec.version} di:{' '}
                      <code className="text-[11px] font-mono text-emerald-300">{godotExec.path}</code>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 px-3 py-2 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <Icons.AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Godot 4.3+ belum terdeteksi. Import Dasar (TS Fallback) akan digunakan.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Detect Result Card */}
              {isDetecting && (
                <div className="text-xs text-gray-400 flex items-center space-x-2 p-4 bg-[#0f172a] rounded-lg border border-gray-800">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span>Mendeteksi struktur project Godot...</span>
                </div>
              )}

              {detectError && (
                <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/40 p-3 rounded-lg flex items-center space-x-2">
                  <Icons.AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{detectError}</span>
                </div>
              )}

              {projectInfo && (
                <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                    <span className="font-semibold text-white text-sm">{projectInfo.name}</span>
                    <span className="px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-mono text-[11px] border border-indigo-700/50">
                      Godot {projectInfo.godotVersion}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-gray-300">
                    <div className="bg-[#16213e] p-2.5 rounded-lg border border-gray-700/50">
                      <div className="text-gray-400 text-[11px]">Scene (.tscn)</div>
                      <div className="text-base font-bold text-white mt-0.5">{projectInfo.counts.scenes}</div>
                    </div>
                    <div className="bg-[#16213e] p-2.5 rounded-lg border border-gray-700/50">
                      <div className="text-gray-400 text-[11px]">Script (.gd)</div>
                      <div className="text-base font-bold text-white mt-0.5">{projectInfo.counts.scripts}</div>
                    </div>
                    <div className="bg-[#16213e] p-2.5 rounded-lg border border-gray-700/50">
                      <div className="text-gray-400 text-[11px]">Aset (Gambar/Audio)</div>
                      <div className="text-base font-bold text-white mt-0.5">{projectInfo.counts.assets}</div>
                    </div>
                    <div className="bg-[#16213e] p-2.5 rounded-lg border border-gray-700/50">
                      <div className="text-gray-400 text-[11px]">Addons / Plugin</div>
                      <div className="text-base font-bold text-white mt-0.5">{projectInfo.addons.length}</div>
                    </div>
                  </div>

                  {projectInfo.mainScene && (
                    <div className="text-[11px] text-gray-400">
                      Main Scene: <code className="text-gray-300">{projectInfo.mainScene}</code>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Tujuan */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Nama Project Linden
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Nama Project"
                  className="w-full bg-[#0f172a] border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Direktori Tujuan
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={destDir}
                    onChange={(e) => setDestDir(e.target.value)}
                    placeholder="/lokasi/project"
                    className="flex-1 bg-[#0f172a] border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleBrowseDest}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-lg flex items-center space-x-1.5 transition"
                  >
                    <Icons.Folder className="w-4 h-4" />
                    <span>Browse</span>
                  </button>
                </div>
              </div>

              <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-4 space-y-3">
                <span className="font-semibold text-xs text-white block">Opsi Import</span>
                <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={transpileScripts}
                    onChange={(e) => setTranspileScripts(e.target.checked)}
                    className="rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-0"
                  />
                  <span>Transpile GDScript ke TypeScript stub (.ts)</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyAddons}
                    onChange={(e) => setCopyAddons(e.target.checked)}
                    className="rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-0"
                  />
                  <span>Salin folder addons / plugin Godot</span>
                </label>
              </div>
            </div>
          )}

          {/* STEP 3: Proses */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span className="font-semibold text-white">
                    {progress?.message || 'Memulai proses import...'}
                  </span>
                  <span>{progress ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%'}</span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{
                      width: progress ? `${(progress.done / progress.total) * 100}%` : '5%',
                    }}
                  />
                </div>
              </div>

              {/* Terminal log stream */}
              <div
                ref={logContainerRef}
                className="bg-black/60 border border-gray-800 rounded-xl p-3 h-56 overflow-y-auto font-mono text-[11px] text-gray-300 space-y-1"
              >
                {logs.length === 0 ? (
                  <span className="text-gray-500">Menunggu log runner...</span>
                ) : (
                  logs.map((line, idx) => (
                    <div
                      key={idx}
                      className={
                        line.includes('[Error]') || line.includes('[stderr]')
                          ? 'text-rose-400'
                          : line.includes('[GodotExtract]')
                          ? 'text-indigo-300'
                          : 'text-gray-300'
                      }
                    >
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* STEP 4: Hasil */}
          {step === 4 && resultSummary && (
            <div className="space-y-4">
              {/* Scores */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4">
                  <div className="text-xs text-emerald-400 font-semibold">Tampilan Native</div>
                  <div className="text-2xl font-bold text-emerald-300 mt-1">
                    {resultSummary.nativeScore}%
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">
                    {resultSummary.nativeNodes} dari {resultSummary.totalNodes} node dirender secara native.
                  </div>
                </div>

                <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-4">
                  <div className="text-xs text-blue-400 font-semibold">Data Terjaga (Passthrough)</div>
                  <div className="text-2xl font-bold text-blue-300 mt-1">
                    {resultSummary.preservedScore}%
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">
                    {resultSummary.nativeNodes + resultSummary.passthroughNodes} node disimpan lengkap tanpa kehilangan data.
                  </div>
                </div>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-[#0f172a] p-2.5 rounded-lg border border-gray-800">
                  <div className="text-gray-400 text-[10px]">Scene</div>
                  <div className="font-bold text-white mt-0.5">{resultSummary.totalScenes}</div>
                </div>
                <div className="bg-[#0f172a] p-2.5 rounded-lg border border-gray-800">
                  <div className="text-gray-400 text-[10px]">Node Total</div>
                  <div className="font-bold text-white mt-0.5">{resultSummary.totalNodes}</div>
                </div>
                <div className="bg-[#0f172a] p-2.5 rounded-lg border border-gray-800">
                  <div className="text-gray-400 text-[10px]">Aset</div>
                  <div className="font-bold text-white mt-0.5">{resultSummary.assetsCopied}</div>
                </div>
                <div className="bg-[#0f172a] p-2.5 rounded-lg border border-gray-800">
                  <div className="text-gray-400 text-[10px]">Script</div>
                  <div className="font-bold text-white mt-0.5">{resultSummary.scriptsCopied}</div>
                </div>
              </div>

              {/* Node distribution preview */}
              <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-3 text-xs space-y-2">
                <span className="font-semibold text-gray-300 text-xs">Distribusi Tipe Node:</span>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {Object.entries(resultSummary.nodeTypeCounts)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([type, cnt]) => (
                      <div key={type} className="flex items-center justify-between font-mono text-[11px] px-2 py-1 bg-black/20 rounded">
                        <span className="text-gray-300">{type}</span>
                        <span className="text-gray-400">
                          {cnt.total} node ({cnt.native} native, {cnt.passthrough} passthrough)
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Actions */}
        <div className="bg-[#0f3460] px-6 py-3.5 border-t border-gray-700/70 flex items-center justify-between">
          <div>
            {step === 3 && (
              <button
                onClick={handleCancelImport}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-lg transition"
              >
                Batal
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {step === 1 && (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium rounded-lg transition"
                >
                  Tutup
                </button>
                <button
                  disabled={!projectInfo}
                  onClick={() => setStep(2)}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition shadow"
                >
                  Lanjut
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium rounded-lg transition"
                >
                  Kembali
                </button>
                <button
                  onClick={handleStartImport}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition shadow"
                >
                  Mulai Import
                </button>
              </>
            )}

            {step === 4 && (
              <>
                <button
                  onClick={handleShowInFinder}
                  className="px-3.5 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium rounded-lg transition flex items-center space-x-1"
                >
                  <Icons.Folder className="w-3.5 h-3.5" />
                  <span>Tampilkan di Finder</span>
                </button>
                <button
                  onClick={handleViewReport}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition flex items-center space-x-1"
                >
                  <Icons.ExternalLink className="w-3.5 h-3.5" />
                  <span>Lihat Laporan</span>
                </button>
                <button
                  onClick={handleOpenCreatedProject}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition shadow flex items-center space-x-1"
                >
                  <Icons.Check className="w-4 h-4" />
                  <span>Buka Project</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
