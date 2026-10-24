import React, { useState, useEffect } from 'react'
import { RecentProject } from '../../shared/types/project'
import {
  fetchRecentProjects,
  removeRecentProjectEntry,
  clearRecentProjectsList,
  getStartupOpenLastSetting,
  setStartupOpenLastSetting,
  createNewProject,
  openExistingProject,
} from '../project/projectIO'
import { PROJECT_TEMPLATES, ProjectTemplateId } from '../project/projectTemplates'
import { checkIpcMismatch } from '../project/ipc'
import { useEditorStore } from '../store/editorStore'
import { Icons } from '../ui/Icons'

export interface ProjectManagerWindowProps {
  isOpen: boolean
  onClose?: () => void
  onProjectOpened: (projectPath: string, sceneContent?: string, scenePath?: string) => void
  onShowToast?: (message: string) => void
}

export const ProjectManagerWindow: React.FC<ProjectManagerWindowProps> = ({
  isOpen,
  onClose,
  onProjectOpened,
  onShowToast,
}) => {
  const { setProject } = useEditorStore()
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [openLastOnStartup, setOpenLastOnStartup] = useState(false)
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [hasIpcMismatch, setHasIpcMismatch] = useState(false)
  const [missingIpcChannels, setMissingIpcChannels] = useState<string[]>([])

  // New Project Form State
  const [projectName, setProjectName] = useState('MyGame')
  const [projectLocation, setProjectLocation] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplateId>('empty-3d')
  const [selectedRenderer, setSelectedRenderer] = useState<'webgpu' | 'webgl'>('webgpu')
  const [inlineValidationError, setInlineValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadRecents()
      setOpenLastOnStartup(getStartupOpenLastSetting())
      checkIpcMismatch().then((result) => {
        if (result.mismatch) {
          setHasIpcMismatch(true)
          setMissingIpcChannels(result.missingChannels)
          console.warn(
            '[IPC Mismatch] Channel IPC berikut hilang dari proses aplikasi yang sedang berjalan:',
            result.missingChannels
          )
        } else {
          setHasIpcMismatch(false)
          setMissingIpcChannels([])
        }
      })
      if (!projectLocation) {
        if (typeof window !== 'undefined' && window.electronAPI?.getProjectPath) {
          window.electronAPI.getProjectPath().then((p) => {
            if (p) setProjectLocation(`${p}/Linden Projects`)
          }).catch(() => {
            setProjectLocation('/Documents/Linden Projects')
          })
        } else {
          setProjectLocation('/Documents/Linden Projects')
        }
      }
    }
  }, [isOpen])

  const handleRestartApp = () => {
    if (typeof window !== 'undefined' && (window.electronAPI as any)?.relaunchApp) {
      ;(window.electronAPI as any).relaunchApp()
    }
  }

  const loadRecents = async () => {
    const list = await fetchRecentProjects()
    setRecentProjects(list)
  }

  const handleToggleStartup = (checked: boolean) => {
    setOpenLastOnStartup(checked)
    setStartupOpenLastSetting(checked)
  }

  const handleRemoveRecent = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await removeRecentProjectEntry(path)
    await loadRecents()
  }

  const handleClearRecents = async () => {
    await clearRecentProjectsList()
    await loadRecents()
  }

  const handleOpenSpecificProject = async (path?: string) => {
    setIsLoading(true)
    setErrorMessage(null)
    const res = await openExistingProject(path)
    setIsLoading(false)
    if (res.status === 'ok' && res.projectPath && res.config) {
      setProject(res.projectPath, res.config, res.config.name, res.config.exportPresets)
      onProjectOpened(res.projectPath, res.initialSceneContent, res.initialScenePath)
      onShowToast?.(`Project "${res.config.name}" dibuka.`)
      onClose?.()
    } else if (res.status === 'error') {
      setErrorMessage(res.message || 'Gagal membuka project.')
    }
  }

  const handleBrowseLocation = async () => {
    if (typeof window !== 'undefined' && (window.electronAPI as any)?.showOpenDialog) {
      const res = await (window.electronAPI as any).showOpenDialog({
        title: 'Pilih Folder Induk Proyek',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (!res.canceled && res.filePaths?.[0]) {
        setProjectLocation(res.filePaths[0])
      }
    } else {
      const p = prompt('Masukkan lokasi direktori induk proyek:', projectLocation)
      if (p) setProjectLocation(p)
    }
  }

  // Validate project name inline
  useEffect(() => {
    const trimmed = projectName.trim()
    if (!trimmed) {
      setInlineValidationError('Nama project tidak boleh kosong.')
      return
    }
    const invalidChars = /[\\/:*?"<>|]/
    if (invalidChars.test(trimmed)) {
      setInlineValidationError('Nama mengandung karakter tidak sah (/ \\ : * ? " < > |).')
      return
    }
    setInlineValidationError(null)
  }, [projectName])

  const handleCreateProject = async () => {
    if (inlineValidationError || !projectName.trim()) return
    setIsLoading(true)
    setErrorMessage(null)
    const res = await createNewProject({
      name: projectName.trim(),
      location: projectLocation,
      template: selectedTemplate,
      renderer: selectedRenderer,
    })
    setIsLoading(false)
    if (res.status === 'ok' && res.projectPath && res.config) {
      setProject(res.projectPath, res.config, res.config.name, res.config.exportPresets)
      setIsNewProjectModalOpen(false)
      onProjectOpened(res.projectPath, res.initialSceneContent, res.initialScenePath)
      onShowToast?.(`Project "${res.config.name}" berhasil dibuat!`)
      onClose?.()
    } else if (res.status === 'error') {
      setErrorMessage(res.message || 'Gagal membuat project.')
    }
  }

  const formatRelativeTime = (timestamp: number) => {
    const diffMs = Date.now() - timestamp
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'Baru saja'
    if (mins < 60) return `${mins} menit lalu`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} jam lalu`
    const days = Math.floor(hours / 24)
    return `${days} hari lalu`
  }

  const filteredRecents = recentProjects.filter((p) => {
    const q = searchQuery.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
  })

  const fullTargetPath = `${projectLocation.replace(/[\/\\]$/, '')}/${projectName.trim()}`

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-[#0f172a]/95 backdrop-blur-md flex items-center justify-center p-6 select-none animate-fade-in"
    >
      <div className="bg-[#16213e] border border-gray-700/80 rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden text-gray-200">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60 bg-[#0f3460]/80">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">
              L
            </div>
            <div>
              <h1 className="font-bold text-base text-white tracking-wide">Project Manager</h1>
              <p className="text-xs text-gray-400">Linden Engine v0.2.0 • Modern Game Engine</p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1 rounded hover:bg-white/10"
              title="Kembali ke Editor"
            >
              <Icons.Close className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* IPC Mismatch Warning Banner */}
        {hasIpcMismatch && (
          <div className="bg-amber-500/20 border-b border-amber-500/40 px-6 py-3 text-xs text-amber-200 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Icons.AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Editor diperbarui tetapi proses aplikasi masih versi lama.{' '}
                <strong>Restart Linden Engine</strong> untuk melanjutkan.
              </span>
            </div>
            <button
              onClick={handleRestartApp}
              className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded text-xs transition shadow"
            >
              Restart
            </button>
          </div>
        )}

        {/* Error notification banner if any */}
        {errorMessage && (
          <div className="bg-rose-950/60 border-b border-rose-800/60 px-6 py-2.5 text-xs text-rose-300 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Icons.AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-white"
            >
              <Icons.Close className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Quick Actions */}
          <div className="w-72 border-r border-gray-700/60 bg-[#0f3460]/40 p-6 flex flex-col justify-between">
            <div className="space-y-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block">
                Aksi Utama
              </span>

              <button
                onClick={() => {
                  setErrorMessage(null)
                  setIsNewProjectModalOpen(true)
                }}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 px-4 rounded-xl text-sm flex items-center space-x-3 transition shadow-lg shadow-blue-600/30 hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="p-1.5 bg-white/20 rounded-lg">
                  <Icons.Plus className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <div className="font-bold">New Project…</div>
                  <div className="text-[11px] text-blue-200 font-normal">Buat proyek baru dari template</div>
                </div>
              </button>

              <button
                onClick={() => handleOpenSpecificProject()}
                className="w-full bg-[#16213e] hover:bg-[#1f2d52] border border-gray-700/80 text-white font-medium py-3 px-4 rounded-xl text-sm flex items-center space-x-3 transition hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="p-1.5 bg-gray-700/50 rounded-lg text-gray-300">
                  <Icons.Folder className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <div className="font-bold">Open Project…</div>
                  <div className="text-[11px] text-gray-400 font-normal">Buka folder proyek di disk</div>
                </div>
              </button>
            </div>

            {/* Bottom Options */}
            <div className="pt-4 border-t border-gray-700/50 space-y-3">
              <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={openLastOnStartup}
                  onChange={(e) => handleToggleStartup(e.target.checked)}
                  className="rounded bg-gray-900 border-gray-700 text-blue-500 focus:ring-0"
                />
                <span>Buka project terakhir saat start</span>
              </label>

              <div className="text-[11px] text-gray-400">
                Pilih atau klik dua kali pada daftar proyek terkini untuk membukanya langsung.
              </div>
            </div>
          </div>

          {/* Right Column: Search & Recent Projects List */}
          <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <Icons.Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari proyek terkini..."
                  className="w-full bg-[#0f3460]/70 border border-gray-700/80 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {recentProjects.length > 0 && (
                <button
                  onClick={handleClearRecents}
                  className="text-xs text-gray-400 hover:text-rose-400 transition"
                >
                  Clear Recent
                </button>
              )}
            </div>

            {/* Recent List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredRecents.length > 0 ? (
                filteredRecents.map((proj) => {
                  const isMissing = proj.exists === false
                  return (
                    <div
                      key={proj.path}
                      onDoubleClick={() => !isMissing && handleOpenSpecificProject(proj.path)}
                      onClick={() => !isMissing && handleOpenSpecificProject(proj.path)}
                      className={`flex items-center justify-between p-3.5 rounded-xl border transition cursor-pointer ${
                        isMissing
                          ? 'bg-gray-800/20 border-gray-800 text-gray-500 cursor-not-allowed opacity-60'
                          : 'bg-[#0f3460]/40 border-gray-700/50 hover:bg-[#0f3460] hover:border-blue-500/60 text-gray-200'
                      }`}
                    >
                      <div className="flex items-center space-x-3 truncate">
                        <div className="p-2 rounded-lg bg-gray-800/80 text-blue-400 shrink-0">
                          <Icons.Folder className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-sm text-white truncate">{proj.name}</span>
                            {isMissing && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/50">
                                Folder hilang
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 block truncate font-mono mt-0.5">
                            {proj.path}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3 shrink-0">
                        <span className="text-xs text-gray-400">
                          {formatRelativeTime(proj.lastOpened)}
                        </span>
                        <button
                          onClick={(e) => handleRemoveRecent(proj.path, e)}
                          title="Hapus dari daftar recent"
                          className="p-1 text-gray-500 hover:text-rose-400 rounded hover:bg-white/5 transition"
                        >
                          <Icons.Close className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-400">
                  <Icons.Folder className="w-12 h-12 text-gray-600 mb-2" />
                  <p className="text-sm font-medium">Belum ada proyek terkini.</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Buat proyek baru atau buka proyek yang sudah ada untuk memulai.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New Project Modal Dialog */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#16213e] border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col text-gray-200 animate-scale-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60 bg-[#0f3460]/80">
              <h2 className="font-bold text-sm text-white">Create New Project</h2>
              <button
                onClick={() => setIsNewProjectModalOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-white/10"
              >
                <Icons.Close className="w-4 h-4" />
              </button>
            </div>

            {errorMessage && (
              <div className="bg-rose-950/80 border-b border-rose-800/80 px-6 py-2.5 text-xs text-rose-300 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Icons.AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
                <button
                  onClick={() => setErrorMessage(null)}
                  className="text-rose-400 hover:text-white"
                >
                  <Icons.Close className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Project Name */}
              <div>
                <label className="block text-gray-300 font-semibold mb-1">Nama Project</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="MyGame"
                  className="w-full bg-[#0f3460] border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              {/* Location */}
              <div>
                <label className="block text-gray-300 font-semibold mb-1">Lokasi Folder</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={projectLocation}
                    onChange={(e) => setProjectLocation(e.target.value)}
                    className="flex-1 bg-[#0f3460] border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono text-[11px]"
                  />
                  <button
                    onClick={handleBrowseLocation}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg flex items-center space-x-1"
                  >
                    <Icons.Folder className="w-3.5 h-3.5" />
                    <span>Browse…</span>
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  Akan dibuat di: <code className="text-blue-300 font-mono">{fullTargetPath}</code>
                </div>
              </div>

              {/* Inline validation error */}
              {inlineValidationError && (
                <div className="text-xs text-rose-400 flex items-center space-x-1">
                  <Icons.AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{inlineValidationError}</span>
                </div>
              )}

              {/* Template Selection */}
              <div>
                <label className="block text-gray-300 font-semibold mb-2">Template Proyek</label>
                <div className="grid grid-cols-2 gap-2.5">
                  {PROJECT_TEMPLATES.map((tmpl) => {
                    const isSelected = tmpl.id === selectedTemplate
                    return (
                      <div
                        key={tmpl.id}
                        onClick={() => setSelectedTemplate(tmpl.id)}
                        className={`p-3 rounded-xl border cursor-pointer transition ${
                          isSelected
                            ? 'bg-blue-600/20 border-blue-500 text-white shadow'
                            : 'bg-[#0f3460]/40 border-gray-700/60 hover:bg-[#0f3460] text-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-xs text-white">{tmpl.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 uppercase">
                            {tmpl.category}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 leading-relaxed">{tmpl.description}</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Renderer */}
              <div>
                <label className="block text-gray-300 font-semibold mb-1">Renderer</label>
                <select
                  value={selectedRenderer}
                  onChange={(e) => setSelectedRenderer(e.target.value as any)}
                  className="w-full bg-[#0f3460] border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="webgpu">WebGPU (Recommended - Modern & High Performance)</option>
                  <option value="webgl">WebGL 2.0 Fallback (Maximum Compatibility)</option>
                </select>
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-gray-700/60 bg-[#0f3460]/60">
              <button
                onClick={() => setIsNewProjectModalOpen(false)}
                className="px-4 py-2 bg-transparent hover:bg-white/10 text-gray-300 rounded-lg text-xs transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                disabled={Boolean(inlineValidationError) || !projectName.trim() || isLoading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition shadow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icons.Plus className="w-4 h-4" />
                <span>{isLoading ? 'Creating…' : 'Create Project'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
