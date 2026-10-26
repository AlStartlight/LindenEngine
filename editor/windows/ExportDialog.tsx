import React, { useState, useEffect } from 'react'
import { ExportPreset, ExportPlatform, ExportBackend, ExportMode } from '../../shared/types/project'
import { useEditorStore } from '../store/editorStore'
import { ExportRunner, ExportProgressEvent } from '../export/ExportRunner'
import { Icons } from '../ui/Icons'

export interface ExportDialogProps {
  isOpen: boolean
  onClose: () => void
  onShowToast?: (message: string, actionLabel?: string, onAction?: () => void) => void
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  onShowToast,
}) => {
  const {
    projectPath,
    projectName,
    exportPresets,
    setExportPresets,
    addExportPreset,
    updateExportPreset,
    removeExportPreset,
    projectSettings,
  } = useEditorStore()

  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    exportPresets[0]?.id || ''
  )
  const [activeTab, setActiveTab] = useState<'options' | 'resources' | 'features'>('options')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null)
  const [exportLogs, setExportLogs] = useState<string[]>([])
  const [detectedGodot, setDetectedGodot] = useState<string | null>(null)
  const [lastExportedPath, setLastExportedPath] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedPresetId && exportPresets.length > 0) {
      setSelectedPresetId(exportPresets[0].id)
    }
  }, [exportPresets, selectedPresetId])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.detectGodot) {
      window.electronAPI.detectGodot().then((res) => {
        if (res) setDetectedGodot(res)
      })
    }
  }, [])

  // Keyboard shortcut listener: Esc closes, Enter exports
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const selectedPreset = exportPresets.find((p) => p.id === selectedPresetId) || exportPresets[0]

  const handleUpdateCurrent = (patch: Partial<ExportPreset>) => {
    if (!selectedPreset) return
    const updated = { ...selectedPreset, ...patch }
    updateExportPreset(updated)
  }

  const handleAddPreset = (platform: ExportPlatform) => {
    const platformNames: Record<ExportPlatform, string> = {
      windows: 'Windows Desktop',
      macos: 'macOS',
      linux: 'Linux',
      web: 'Web',
      android: 'Android',
      ios: 'iOS',
    }
    const defaultBackend: ExportBackend = (platform === 'android' || platform === 'ios') ? 'godot' : 'linden'
    const ext: Record<ExportPlatform, string> = {
      windows: 'exe',
      macos: 'dmg',
      linux: 'AppImage',
      web: 'html',
      android: 'apk',
      ios: 'ipa',
    }

    const newPreset: ExportPreset = {
      id: `preset-${platform}-${Date.now()}`,
      name: platformNames[platform],
      platform,
      backend: defaultBackend,
      arch: platform === 'macos' ? ['universal'] : platform === 'web' ? ['wasm'] : ['x64'],
      output: `build/${platform}/${projectName.replace(/\s+/g, '')}.${ext[platform]}`,
      mode: 'release',
      appName: projectName,
      version: '1.0.0',
      ...(platform === 'web'
        ? {
            canvasMode: 'responsive',
            webgpuRequired: false,
            zipOutput: true,
            loadingColor: '#0f172a',
          }
        : {}),
    }

    addExportPreset(newPreset)
    setSelectedPresetId(newPreset.id)
    setShowAddMenu(false)
  }

  const handleDuplicatePreset = () => {
    if (!selectedPreset) return
    const dup: ExportPreset = {
      ...selectedPreset,
      id: `preset-${Date.now()}`,
      name: `${selectedPreset.name} (Copy)`,
    }
    addExportPreset(dup)
    setSelectedPresetId(dup.id)
  }

  const handleDeletePreset = () => {
    if (!selectedPreset || exportPresets.length <= 1) return
    removeExportPreset(selectedPreset.id)
    const next = exportPresets.find((p) => p.id !== selectedPreset.id)
    if (next) setSelectedPresetId(next.id)
  }

  const handleBrowseOutputPath = async () => {
    if (!selectedPreset) return
    if (typeof window !== 'undefined' && (window.electronAPI as any)?.showOpenDialog) {
      const res = await (window.electronAPI as any).showOpenDialog({
        title: 'Pilih Lokasi Output Build',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (!res.canceled && res.filePaths?.[0]) {
        const out = `${res.filePaths[0]}/${selectedPreset.output.split(/[\/\\]/).pop() || 'game'}`
        handleUpdateCurrent({ output: out })
      }
    } else {
      const p = prompt('Masukkan path output:', selectedPreset.output)
      if (p) handleUpdateCurrent({ output: p })
    }
  }

  const handleRunExport = async (presetToExport?: ExportPreset) => {
    const target = presetToExport || selectedPreset
    if (!target) return

    setIsExporting(true)
    setExportLogs([])
    setExportProgress({
      presetId: target.id,
      stage: 'validation',
      percent: 10,
      message: 'Memulai proses export...',
    })

    const res = await ExportRunner.runExport(
      target,
      projectPath || '.',
      (prog) => setExportProgress(prog),
      (log) => setExportLogs((prev) => [...prev, log])
    )

    setIsExporting(false)
    if (res.success) {
      setLastExportedPath(res.outputPath)
      onShowToast?.(
        `Export "${target.name}" selesai dengan sukses!`,
        'Tampilkan di Finder/Explorer',
        () => handleShowInFolder(res.outputPath)
      )
    } else {
      onShowToast?.(`Export gagal: ${res.error || 'Terjadi kesalahan'}`)
    }
  }

  const handleRunInBrowser = async () => {
    if (!selectedPreset) return
    setIsExporting(true)
    setExportLogs([])
    setExportProgress({
      presetId: selectedPreset.id,
      stage: 'bundle',
      percent: 30,
      message: 'Mempersiapkan build HTML5 untuk preview...',
    })

    const res = await ExportRunner.runExport(
      selectedPreset,
      projectPath || '.',
      (prog) => setExportProgress(prog),
      (log) => setExportLogs((prev) => [...prev, log])
    )

    setIsExporting(false)
    if (res.success) {
      setLastExportedPath(res.outputPath)
      let buildDir = res.outputPath
      if (buildDir.endsWith('.html')) {
        const lastSlash = Math.max(buildDir.lastIndexOf('/'), buildDir.lastIndexOf('\\'))
        if (lastSlash !== -1) {
          buildDir = buildDir.substring(0, lastSlash)
        }
      }
      if (typeof window !== 'undefined' && (window.electronAPI as any)?.serveWebBuild) {
        try {
          const url = await (window.electronAPI as any).serveWebBuild(buildDir)
          onShowToast?.(`Server web aktif di ${url}`, 'Buka di Browser', () => {
            if ((window.electronAPI as any)?.openExternal) {
              ;(window.electronAPI as any).openExternal(url)
            }
          })
        } catch (err: any) {
          onShowToast?.(`Gagal menjalankan web server: ${err.message}`)
        }
      } else {
        onShowToast?.('Preview di browser memerlukan aplikasi desktop Electron.')
      }
    } else {
      onShowToast?.(`Build gagal: ${res.error || 'Terjadi kesalahan'}`)
    }
  }

  const handleExportAll = async () => {
    setIsExporting(true)
    setExportLogs([])
    for (const p of exportPresets) {
      await handleRunExport(p)
    }
    setIsExporting(false)
  }

  const handleExportDataOnly = async () => {
    setIsExporting(true)
    setExportLogs([])
    const scenes = projectSettings.scenesInBuild.length > 0 ? projectSettings.scenesInBuild : ['scenes/Main.lscene']
    const out = `build/data/${projectName.replace(/\s+/g, '')}.lpkg`
    const res = await ExportRunner.exportDataOnly(
      projectPath || '.',
      scenes,
      out,
      (l) => setExportLogs((prev) => [...prev, l])
    )
    setIsExporting(false)
    if (res.success) {
      onShowToast?.('Bundle data berhasil diekspor!', 'Tampilkan di Folder', () => handleShowInFolder(out))
    }
  }

  const handleShowInFolder = (filePath: string) => {
    if (typeof window !== 'undefined' && (window.electronAPI as any)?.showItemInFolder) {
      ;(window.electronAPI as any).showItemInFolder(filePath)
    } else {
      alert(`Output file location: ${filePath}`)
    }
  }

  const renderPlatformIcon = (platform: ExportPlatform) => {
    switch (platform) {
      case 'windows': return <Icons.Windows className="w-4 h-4 text-sky-400" />
      case 'macos': return <Icons.Apple className="w-4 h-4 text-gray-200" />
      case 'linux': return <Icons.Linux className="w-4 h-4 text-amber-400" />
      case 'web': return <Icons.Web className="w-4 h-4 text-emerald-400" />
      case 'android': return <Icons.Android className="w-4 h-4 text-green-400" />
      case 'ios': return <Icons.AppleMobile className="w-4 h-4 text-purple-400" />
    }
  }

  const readinessChecks = selectedPreset
    ? ExportRunner.checkPresetReadiness(selectedPreset, projectPath || '.', detectedGodot)
    : []

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
    >
      <div className="bg-[#16213e] border border-gray-700/80 rounded-xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden text-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700/60 bg-[#0f3460]/70">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 bg-blue-600/30 text-blue-400 rounded border border-blue-500/30">
              <Icons.Export className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-sm text-white">Export Project</h2>
              <p className="text-[11px] text-gray-400">Konfigurasi preset build dan ekspor multi-platform</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-white/10"
          >
            <Icons.Close className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel: Preset List */}
          <div className="w-64 border-r border-gray-700/60 bg-[#0f3460]/30 flex flex-col p-3 space-y-2">
            <div className="flex items-center justify-between pb-1 border-b border-gray-700/40">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Presets</span>
              <div className="relative">
                <button
                  onClick={() => setShowAddMenu(!showAddMenu)}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs flex items-center space-x-1"
                >
                  <Icons.Plus className="w-3.5 h-3.5" />
                  <span>Add…</span>
                </button>
                {showAddMenu && (
                  <div className="absolute left-0 mt-1 w-44 bg-[#16213e] border border-gray-700 rounded-lg shadow-xl z-50 py-1 text-xs">
                    {(['windows', 'macos', 'linux', 'web', 'android', 'ios'] as ExportPlatform[]).map((plat) => (
                      <button
                        key={plat}
                        onClick={() => handleAddPreset(plat)}
                        className="w-full px-3 py-1.5 text-left hover:bg-blue-600/30 flex items-center space-x-2"
                      >
                        {renderPlatformIcon(plat)}
                        <span className="capitalize">{plat}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Presets list */}
            <div className="flex-1 overflow-y-auto space-y-1">
              {exportPresets.map((preset) => {
                const isSelected = preset.id === selectedPresetId
                return (
                  <div
                    key={preset.id}
                    onClick={() => setSelectedPresetId(preset.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition ${
                      isSelected
                        ? 'bg-blue-600 text-white font-medium shadow'
                        : 'text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      {renderPlatformIcon(preset.platform)}
                      <span className="truncate">{preset.name}</span>
                    </div>
                    <span className="text-[10px] opacity-75 uppercase">{preset.backend}</span>
                  </div>
                )
              })}
            </div>

            {/* Bottom preset buttons */}
            <div className="pt-2 border-t border-gray-700/40 flex items-center space-x-2">
              <button
                onClick={handleDuplicatePreset}
                disabled={!selectedPreset}
                className="flex-1 py-1.5 bg-gray-700/60 hover:bg-gray-700 text-gray-200 rounded text-xs transition"
              >
                Duplicate
              </button>
              <button
                onClick={handleDeletePreset}
                disabled={exportPresets.length <= 1}
                className="px-2.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 rounded text-xs transition border border-rose-500/30 disabled:opacity-50"
              >
                <Icons.Trash className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Right Panel: Tabs & Settings */}
          {selectedPreset ? (
            <div className="flex-1 flex flex-col overflow-hidden bg-[#16213e]">
              {/* Tab Navigation */}
              <div className="flex border-b border-gray-700/60 bg-[#0f3460]/40 px-4">
                <button
                  onClick={() => setActiveTab('options')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition ${
                    activeTab === 'options'
                      ? 'border-blue-500 text-white font-semibold'
                      : 'border-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  Options
                </button>
                <button
                  onClick={() => setActiveTab('resources')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition ${
                    activeTab === 'resources'
                      ? 'border-blue-500 text-white font-semibold'
                      : 'border-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  Resources
                </button>
                <button
                  onClick={() => setActiveTab('features')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition ${
                    activeTab === 'features'
                      ? 'border-blue-500 text-white font-semibold'
                      : 'border-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  Features & Advanced
                </button>
              </div>

              {/* Tab Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {activeTab === 'options' && (
                  <div className="space-y-4 max-w-2xl text-xs">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-gray-400 font-medium mb-1">Preset Name</label>
                        <input
                          type="text"
                          value={selectedPreset.name}
                          onChange={(e) => handleUpdateCurrent({ name: e.target.value })}
                          className="w-full bg-[#0f3460] border border-gray-700 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-gray-400 font-medium mb-1">Export Mode</label>
                        <select
                          value={selectedPreset.mode}
                          onChange={(e) => handleUpdateCurrent({ mode: e.target.value as ExportMode })}
                          className="w-full bg-[#0f3460] border border-gray-700 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="release">Release (Optimized)</option>
                          <option value="debug">Debug (With logs & inspector)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-gray-400 font-medium mb-1">Backend</label>
                        <select
                          value={selectedPreset.backend}
                          onChange={(e) => handleUpdateCurrent({ backend: e.target.value as ExportBackend })}
                          className="w-full bg-[#0f3460] border border-gray-700 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="linden">Linden Native Player</option>
                          <option value="godot">Godot Headless Bridge</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-gray-400 font-medium mb-1">App Version</label>
                        <input
                          type="text"
                          value={selectedPreset.version || '1.0.0'}
                          onChange={(e) => handleUpdateCurrent({ version: e.target.value })}
                          className="w-full bg-[#0f3460] border border-gray-700 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-400 font-medium mb-1">Output Path</label>
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          value={selectedPreset.output}
                          onChange={(e) => handleUpdateCurrent({ output: e.target.value })}
                          className="flex-1 bg-[#0f3460] border border-gray-700 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500 font-mono text-[11px]"
                        />
                        <button
                          onClick={handleBrowseOutputPath}
                          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded flex items-center space-x-1"
                        >
                          <Icons.Folder className="w-3.5 h-3.5" />
                          <span>Browse</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-400 font-medium mb-1">Package Identifier</label>
                      <input
                        type="text"
                        value={selectedPreset.packageIdentifier || `com.linden.${selectedPreset.name.toLowerCase().replace(/\s+/g, '')}`}
                        onChange={(e) => handleUpdateCurrent({ packageIdentifier: e.target.value })}
                        placeholder="com.example.game"
                        className="w-full bg-[#0f3460] border border-gray-700 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>

                    {selectedPreset.platform === 'web' && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-gray-400 font-medium mb-1">Canvas Mode</label>
                          <select
                            value={selectedPreset.canvasMode || 'responsive'}
                            onChange={(e) => handleUpdateCurrent({ canvasMode: e.target.value as any })}
                            className="w-full bg-[#0f3460] border border-gray-700 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
                          >
                            <option value="responsive">Responsive (Scale with viewport)</option>
                            <option value="fullscreen">Fullscreen (Fixed overlay)</option>
                            <option value="fixed">Fixed (1280x720 center)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-gray-400 font-medium mb-1">Base Path (URL)</label>
                          <input
                            type="text"
                            value={selectedPreset.basePath || './'}
                            onChange={(e) => handleUpdateCurrent({ basePath: e.target.value })}
                            placeholder="./"
                            className="w-full bg-[#0f3460] border border-gray-700 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500 font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'resources' && (
                  <div className="space-y-4 max-w-2xl text-xs">
                    <div>
                      <span className="block font-semibold text-white mb-2">Scenes to Include in Build:</span>
                      <div className="bg-[#0f3460] border border-gray-700 rounded-lg p-3 space-y-2">
                        {(projectSettings.scenesInBuild.length > 0
                          ? projectSettings.scenesInBuild
                          : ['scenes/Main.lscene']
                        ).map((sc, i) => (
                          <label key={i} className="flex items-center space-x-2 text-gray-200 cursor-pointer">
                            <input
                              type="checkbox"
                              defaultChecked
                              className="rounded bg-gray-900 border-gray-600 text-blue-500"
                            />
                            <span>{sc}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Scene pertama pada daftar di atas akan otomatis menjadi root scene saat game dijalankan.
                      </p>
                    </div>
                  </div>
                )}

                {activeTab === 'features' && (
                  <div className="space-y-4 max-w-2xl text-xs">
                    <div className="bg-[#0f3460] border border-gray-700 rounded-lg p-3 space-y-3">
                      <label className="flex items-start space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPreset.webgpuRequired ?? false}
                          onChange={(e) => handleUpdateCurrent({ webgpuRequired: e.target.checked })}
                          className="mt-0.5 rounded bg-gray-900 border-gray-600 text-blue-500"
                        />
                        <div>
                          <span className="font-semibold text-white block">Wajib WebGPU</span>
                          <span className="text-[11px] text-gray-400">
                            Jika dinonaktifkan, player akan otomatis melakukan fallback ke WebGL 2.0 bila WebGPU tidak didukung perangkat pengguna.
                          </span>
                        </div>
                      </label>

                      {selectedPreset.platform === 'web' && (
                        <>
                          <div className="border-t border-gray-700/60 pt-3">
                            <label className="flex items-start space-x-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedPreset.zipOutput !== false}
                                onChange={(e) => handleUpdateCurrent({ zipOutput: e.target.checked })}
                                className="mt-0.5 rounded bg-gray-900 border-gray-600 text-blue-500"
                              />
                              <div>
                                <span className="font-semibold text-white block">Buat Arsip ZIP (itch.io ready)</span>
                                <span className="text-[11px] text-gray-400">
                                  Menghasilkan file .zip terkompresi dari seluruh bundle web, siap diunggah ke platform game.
                                </span>
                              </div>
                            </label>
                          </div>

                          <div className="border-t border-gray-700/60 pt-3">
                            <label className="flex items-start space-x-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedPreset.includeSourceMap ?? false}
                                onChange={(e) => handleUpdateCurrent({ includeSourceMap: e.target.checked })}
                                className="mt-0.5 rounded bg-gray-900 border-gray-600 text-blue-500"
                              />
                              <div>
                                <span className="font-semibold text-white block">Sertakan Source Map</span>
                                <span className="text-[11px] text-gray-400">
                                  Menyertakan source map untuk mempermudah debugging script TypeScript di browser DevTools.
                                </span>
                              </div>
                            </label>
                          </div>

                          <div className="border-t border-gray-700/60 pt-3 grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-gray-300 font-semibold mb-1">Warna Background Loading</label>
                              <div className="flex items-center space-x-2">
                                <input
                                  type="color"
                                  value={selectedPreset.loadingColor || '#0f172a'}
                                  onChange={(e) => handleUpdateCurrent({ loadingColor: e.target.value })}
                                  className="w-8 h-8 rounded border border-gray-700 bg-transparent cursor-pointer"
                                />
                                <input
                                  type="text"
                                  value={selectedPreset.loadingColor || '#0f172a'}
                                  onChange={(e) => handleUpdateCurrent({ loadingColor: e.target.value })}
                                  className="flex-1 bg-[#16213e] border border-gray-700 rounded px-2 py-1 text-white font-mono text-[11px]"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-gray-300 font-semibold mb-1">Judul Layar Loading</label>
                              <input
                                type="text"
                                value={selectedPreset.loadingTitle || selectedPreset.appName || projectName}
                                onChange={(e) => handleUpdateCurrent({ loadingTitle: e.target.value })}
                                className="w-full bg-[#16213e] border border-gray-700 rounded px-2.5 py-1 text-white text-xs"
                                placeholder="Memuat Linden Game..."
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Readiness Checklist Box */}
                <div className="bg-[#0f3460]/70 border border-gray-700/60 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white uppercase tracking-wider">
                      Checklist Kesiapan Build
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {readinessChecks.filter((c) => c.passed).length} / {readinessChecks.length} Terpenuhi
                    </span>
                  </div>

                  <div className="space-y-2">
                    {readinessChecks.map((chk) => (
                      <div
                        key={chk.id}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-xs ${
                          chk.passed
                            ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                            : 'bg-rose-950/20 border-rose-800/40 text-rose-300'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          {chk.passed ? (
                            <Icons.Check className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Icons.AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                          )}
                          <div>
                            <span className="font-semibold block">{chk.label}</span>
                            {chk.description && (
                              <span className="text-[11px] opacity-80 block">{chk.description}</span>
                            )}
                          </div>
                        </div>

                        {!chk.passed && chk.fixLabel && (
                          <button
                            onClick={() => {
                              if (chk.fixAction === 'download_godot') {
                                if (typeof window !== 'undefined' && window.electronAPI?.openExternal) {
                                  window.electronAPI.openExternal('https://godotengine.org/download')
                                } else {
                                  window.open('https://godotengine.org/download', '_blank')
                                }
                              } else if (chk.fixAction === 'browse') {
                                handleBrowseOutputPath()
                              } else {
                                alert(chk.description || 'Silakan konfigurasi opsi ini.')
                              }
                            }}
                            className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-[11px] font-medium"
                          >
                            {chk.fixLabel}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Progress / Logs while exporting */}
                {(isExporting || exportProgress || exportLogs.length > 0) && (
                  <div className="bg-black/50 border border-gray-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">Status Export:</span>
                      <span className="text-gray-400">
                        {exportProgress ? `${exportProgress.stage.toUpperCase()} (${exportProgress.percent}%)` : ''}
                      </span>
                    </div>

                    {exportProgress && (
                      <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            exportProgress.stage === 'failed' ? 'bg-rose-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${exportProgress.percent}%` }}
                        />
                      </div>
                    )}

                    <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-[11px] text-gray-300 bg-black/40 p-2.5 rounded">
                      {exportLogs.map((log, i) => (
                        <div key={i}>{log}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Actions Bar */}
              <div className="border-t border-gray-700/60 bg-[#0f3460]/70 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleExportAll}
                    disabled={isExporting}
                    className="px-3 py-1.5 bg-gray-700/80 hover:bg-gray-700 text-gray-200 rounded text-xs transition disabled:opacity-50"
                  >
                    Export All
                  </button>
                  <button
                    onClick={handleExportDataOnly}
                    disabled={isExporting}
                    className="px-3 py-1.5 bg-gray-700/80 hover:bg-gray-700 text-gray-200 rounded text-xs transition disabled:opacity-50"
                  >
                    Export PCK/Data only
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={onClose}
                    className="px-4 py-1.5 bg-transparent hover:bg-white/10 text-gray-300 rounded text-xs transition"
                  >
                    Close
                  </button>
                  {selectedPreset.platform === 'web' && (
                    <button
                      onClick={handleRunInBrowser}
                      disabled={isExporting}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded text-xs flex items-center space-x-1.5 transition shadow disabled:opacity-50"
                      title="Build dan jalankan preview di browser default"
                    >
                      <Icons.Web className="w-4 h-4" />
                      <span>Run in Browser</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleRunExport()}
                    disabled={isExporting}
                    className="px-5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded text-xs flex items-center space-x-1.5 transition shadow disabled:opacity-50"
                  >
                    <Icons.Export className="w-4 h-4" />
                    <span>{isExporting ? 'Exporting…' : `Export Project…`}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-xs">
              Pilih atau tambahkan preset di panel kiri.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
