import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { SceneViewport } from './viewport/SceneViewport'
import { HierarchyPanel } from './panels/HierarchyPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import { AgentPanel } from './panels/AgentPanel'
import { useAgentStore } from './agent/agentStore'
import { subscribeAgentEvents } from './agent/agentEvents'
import { isAgentSceneForOpenScene } from './agent/agentSceneSync'
import { phaseLabel } from './agent/TurnView'
import { ProjectPanel } from './panels/ProjectPanel'
import { AssetBrowser } from './panels/AssetBrowser'
import { SceneSettingsPanel } from './panels/SceneSettingsPanel'
import { Toolbar } from './ui/Toolbar'
import { ConsolePanel } from './panels/ConsolePanel'
import { OutputPanel } from './panels/OutputPanel'
import { BridgePanel } from './panels/BridgePanel'
import { GodotBridge } from '../engine/godot/GodotBridge'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { InputActionsWindow } from './windows/InputActionsWindow'
import { ProjectSettingsWindow } from './windows/ProjectSettingsWindow'
import { ExportDialog } from './windows/ExportDialog'
import { ProjectManagerWindow } from './windows/ProjectManagerWindow'
import { NewSceneDialog } from './windows/NewSceneDialog'
import { GodotImportWizard } from './windows/GodotImportWizard'
import { Toast, ToastData } from './ui/Toast'
import { pickAndReadScene, pickSceneSavePath, writeSceneFile, saveSceneFile } from './io/sceneIO'
import { formatWindowTitle, getSceneStatusSuffix, getSceneNameFromPath } from './ui/windowTitle'
import { openExistingProject, fetchRecentProjects, getStartupOpenLastSetting } from './project/projectIO'
import { SceneSerializer } from '../engine/scene/serializer'
import { useEditorStore } from './store/editorStore'
import { Icons } from './ui/Icons'
import {
  createEntityCommand,
  deleteEntityCommand,
  duplicateEntityCommand,
} from './commands/entityCommands'

export const EditorLayout: React.FC = () => {
  const {
    world,
    commandStack,
    selectedEntityIds,
    selectEntity,
    executeCommand,
    undo,
    redo,
    playState,
    startPlay,
    pausePlay,
    stepPlay,
    stopPlay,
    projectName,
    projectPath,
    isProjectOpen,
    projectSettings,
    setProject,
    closeProject,
    recentProjects,
    setRecentProjects,
    clearRecentProjects,
    sceneName,
    currentScenePath,
    isDirty,
    newScene,
    saveScene,
    openScene,
    activeEditorPanel,
    setActiveEditorPanel,
    activeWindow,
    setActiveWindow,
  } = useEditorStore()

  // Bottom panel tab: 'project' | 'console' | 'output' | 'all'
  const [bottomTab, setBottomTab] = useState<'project' | 'assets' | 'console' | 'output' | 'all' | 'hidden'>('all')
  const [rightTab, setRightTab] = useState<'inspector' | 'scene' | 'agent'>('inspector')
  const isAgentGenerating = useAgentStore((s) => s.isGenerating)
  const agentDiffs = useAgentStore((s) => s.pendingDiffs)
  const agentPendingDiffs = agentDiffs.filter((d) => d.status !== 'rejected')
  const agentActivity = useAgentStore((s) => (s.isGenerating ? s.turns[s.turns.length - 1] : undefined))
  const [consoleMessages, setConsoleMessages] = useState<Array<{ type: string; message: string; time: Date }>>([])
  const [outputLogs, setOutputLogs] = useState<string[]>([])
  const [viewportKey, setViewportKey] = useState(0)

  // Dialog states
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false)
  const [isNewSceneDialogOpen, setIsNewSceneDialogOpen] = useState(false)
  const [isGodotImportWizardOpen, setIsGodotImportWizardOpen] = useState(false)
  const [toast, setToast] = useState<ToastData | null>(null)
  const [lastBuildStatus, setLastBuildStatus] = useState<string>('Ready')

  const existingSceneNames = useMemo(() => {
    const names = new Set<string>()
    if (projectSettings?.scenesInBuild) {
      for (const s of projectSettings.scenesInBuild) {
        names.add(getSceneNameFromPath(s).toLowerCase())
      }
    }
    if (currentScenePath) {
      names.add(getSceneNameFromPath(currentScenePath).toLowerCase())
    }
    return Array.from(names)
  }, [projectSettings?.scenesInBuild, currentScenePath])

  // Bridge reference
  const godotBridgeRef = useRef<GodotBridge | null>(null)
  if (godotBridgeRef.current === null) {
    godotBridgeRef.current = new GodotBridge({ world })
  }

  // Allow global access to export dialog and import wizard
  useEffect(() => {
    ;(window as any).__openExportDialog = () => setIsExportDialogOpen(true)
    ;(window as any).__openGodotImportWizard = () => setIsGodotImportWizardOpen(true)
    return () => {
      delete (window as any).__openExportDialog
      delete (window as any).__openGodotImportWizard
    }
  }, [])

  // Sync bridge project path
  useEffect(() => {
    const bridge = godotBridgeRef.current
    if (!bridge) return
    if (projectPath) {
      bridge.setConfig({ godotProjectPath: projectPath })
    } else if (!bridge.getConfig().godotProjectPath) {
      window.electronAPI?.getProjectPath?.()
        .then((p) => {
          if (p && !bridge.getConfig().godotProjectPath) {
            bridge.setConfig({ godotProjectPath: p })
          }
        })
        .catch(() => {})
    }
  }, [projectPath])

  useEffect(() => {
    if (godotBridgeRef.current) {
      ;(godotBridgeRef.current as any).currentWorld = world
    }
  }, [world])

  // Load recents on startup and check startup setting
  useEffect(() => {
    fetchRecentProjects().then((recents) => {
      setRecentProjects(recents)
      const openLast = getStartupOpenLastSetting()
      if (openLast && recents.length > 0 && recents[0].exists !== false) {
        openExistingProject(recents[0].path).then((res) => {
          if (res.status === 'ok' && res.projectPath && res.config) {
            setProject(res.projectPath, res.config, res.config.name, res.config.exportPresets)
            if (res.initialSceneContent) {
              openScene(res.initialSceneContent, res.initialScenePath)
            }
          } else {
            setIsProjectManagerOpen(true)
          }
        })
      } else if (!projectPath) {
        setIsProjectManagerOpen(true)
      }
    })
  }, [])

  const [confirmDialogConfig, setConfirmDialogConfig] = useState<{
    isOpen: boolean
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    onConfirm: () => void
    onCancel: () => void
  } | null>(null)

  const addConsoleMessage = useCallback((type: string, message: string) => {
    setConsoleMessages((prev) => [...prev.slice(-99), { type, message, time: new Date() }])
  }, [])

  const addOutputLog = useCallback((log: string) => {
    setOutputLogs((prev) => [...prev.slice(-499), log])
  }, [])

  const showToast = useCallback((message: string, actionLabel?: string, onAction?: () => void) => {
    setToast({
      id: String(Date.now()),
      message,
      actionLabel,
      onAction,
    })
  }, [])

  // The agent runs inside the open project's folder only: stop it when the project closes
  useEffect(() => {
    if (!projectPath && useAgentStore.getState().status?.running) {
      useAgentStore.getState().stopAgent()
    }
  }, [projectPath])

  // Agent events for the whole editor: follow new turns in the Agent tab and show scene
  // changes the agent writes in the viewport
  useEffect(() => {
    if (!projectPath) return
    return subscribeAgentEvents((event) => {
      if (event.type === 'turn_started') {
        setRightTab('agent')
        return
      }
      if (event.type !== 'diff_proposed' || event.data.kind !== 'scene') return
      const editor = useEditorStore.getState()
      if (!isAgentSceneForOpenScene(projectPath, event.data.file, editor.currentScenePath)) return
      if (editor.isDirty) {
        showToast('Agent mengubah scene ini, tetapi ada perubahan yang belum disimpan.', 'Muat ulang', () => {
          if (useEditorStore.getState().applyAgentSceneChange(event.data.after)) setViewportKey((k) => k + 1)
        })
        return
      }
      if (editor.applyAgentSceneChange(event.data.after)) {
        setViewportKey((k) => k + 1)
        showToast('Scene diperbarui oleh Agent.', 'Undo', () => useEditorStore.getState().undo())
      }
    })
  }, [projectPath, showToast])

  // Update window title with project name, scene name, and * dirty / (unsaved) indicator
  useEffect(() => {
    const fullTitle = formatWindowTitle({
      projectName: isProjectOpen ? projectName : null,
      sceneName,
      isDirty,
      isSaved: currentScenePath !== null,
    })
    document.title = fullTitle
    if (typeof window !== 'undefined' && window.electronAPI?.setWindowTitle) {
      window.electronAPI.setWindowTitle(fullTitle)
    }
  }, [projectName, sceneName, isDirty, currentScenePath, isProjectOpen])

  // Play / Pause / Step / Stop handlers
  const handlePlayToggle = async () => {
    if (playState === 'stopped') {
      try {
        await startPlay()
        const session = useEditorStore.getState().playSession
        addConsoleMessage(
          'info',
          session ? `Play mode started (${session.mode === 'html' ? 'HTML Game' : 'Game View'})` : 'Play mode started (Rapier 3D initialized)'
        )
      } catch (err: any) {
        // Compile errors arrive one per line (file:line: message)
        const [first, ...details] = String(err.message).split('\n')
        addConsoleMessage('error', `Failed to start Play mode: ${first}`)
        details.forEach((line) => addConsoleMessage('error', line))
      }
    } else {
      stopPlay()
      addConsoleMessage('info', 'Play mode stopped (Scene restored)')
    }
  }

  const handlePauseToggle = () => {
    pausePlay()
    addConsoleMessage('info', playState === 'playing' ? 'Paused' : 'Resumed')
  }

  const handleStep = () => {
    stepPlay()
    addConsoleMessage('info', 'Stepped 1 frame')
  }

  // Save Scene
  const handleSaveScene = useCallback(async (isSaveAs: boolean = false) => {
    try {
      let targetPath: string | null = null
      if (!isSaveAs && currentScenePath) {
        targetPath = currentScenePath
      } else {
        const defaultPath = projectPath
          ? `${projectPath.replace(/[\\/]+$/, '')}/scenes/${sceneName}.lscene`
          : `${sceneName}.lscene`
        const pickRes = await pickSceneSavePath(defaultPath)
        if (pickRes.status === 'canceled') {
          return
        }
        if (pickRes.status === 'error') {
          addConsoleMessage('error', `Failed to pick save path: ${pickRes.message}`)
          return
        }
        targetPath = pickRes.path
      }

      if (!targetPath) return

      const finalName = getSceneNameFromPath(targetPath)
      const content = SceneSerializer.serialize(world, finalName)

      const writeRes = await writeSceneFile(targetPath, content)
      if (writeRes.status === 'error') {
        addConsoleMessage('error', `Failed to save scene: ${writeRes.message}`)
        showToast(`Gagal menyimpan scene: ${writeRes.message}`)
        return
      }

      saveScene(targetPath, finalName)
      addConsoleMessage('info', `Scene saved: ${targetPath}`)
      showToast('Scene berhasil disimpan.')
    } catch (err: any) {
      addConsoleMessage('error', `Failed to save scene: ${err.message}`)
    }
  }, [currentScenePath, sceneName, projectPath, world, saveScene, addConsoleMessage, showToast])

  // Open Scene
  const handleOpenScene = useCallback(async () => {
    if (isDirty) {
      const confirmed = await new Promise<boolean>((resolve) => {
        setConfirmDialogConfig({
          isOpen: true,
          title: 'Open Scene',
          message: 'The current scene has unsaved changes. Discard changes and open another scene?',
          confirmLabel: 'Discard',
          cancelLabel: 'Cancel',
          onConfirm: () => {
            setConfirmDialogConfig(null)
            resolve(true)
          },
          onCancel: () => {
            setConfirmDialogConfig(null)
            resolve(false)
          },
        })
      })
      if (!confirmed) return
    }

    try {
      const picked = await pickAndReadScene()
      if (picked.status === 'canceled') return
      if (picked.status === 'error') {
        addConsoleMessage('error', `Failed to open scene: ${picked.message}`)
        return
      }

      openScene(picked.content, picked.path || undefined)
      setViewportKey((k) => k + 1)
      addConsoleMessage('info', `Opened scene: ${picked.fileName}`)
    } catch (err: any) {
      addConsoleMessage('error', `Failed to open scene: ${err.message}`)
    }
  }, [isDirty, openScene, addConsoleMessage])

  // New Scene
  const handleNewScene = useCallback(async () => {
    if (isDirty) {
      const confirmed = await new Promise<boolean>((resolve) => {
        setConfirmDialogConfig({
          isOpen: true,
          title: 'New Scene',
          message: 'The current scene has unsaved changes. Discard changes and create a new scene?',
          confirmLabel: 'Discard',
          cancelLabel: 'Cancel',
          onConfirm: () => {
            setConfirmDialogConfig(null)
            resolve(true)
          },
          onCancel: () => {
            setConfirmDialogConfig(null)
            resolve(false)
          },
        })
      })
      if (!confirmed) return
    }

    setIsNewSceneDialogOpen(true)
  }, [isDirty])

  const handleCreateNewScene = useCallback((name: string) => {
    setIsNewSceneDialogOpen(false)
    newScene(name)
    setViewportKey((k) => k + 1)
    addConsoleMessage('info', `New scene created: ${name}`)
  }, [newScene, addConsoleMessage])

  // Project Management Handlers
  const handleNewProject = useCallback(async () => {
    if (isDirty) {
      const confirmed = await new Promise<boolean>((resolve) => {
        setConfirmDialogConfig({
          isOpen: true,
          title: 'New Project',
          message: 'Proyek saat ini memiliki perubahan yang belum disimpan. Abaikan dan buat proyek baru?',
          confirmLabel: 'Abaikan',
          cancelLabel: 'Batal',
          onConfirm: () => {
            setConfirmDialogConfig(null)
            resolve(true)
          },
          onCancel: () => {
            setConfirmDialogConfig(null)
            resolve(false)
          },
        })
      })
      if (!confirmed) return
    }
    setIsProjectManagerOpen(true)
  }, [isDirty])

  const handleOpenProject = useCallback(async (customPath?: string) => {
    if (isDirty) {
      const confirmed = await new Promise<boolean>((resolve) => {
        setConfirmDialogConfig({
          isOpen: true,
          title: 'Open Project',
          message: 'Proyek saat ini memiliki perubahan yang belum disimpan. Abaikan dan buka proyek lain?',
          confirmLabel: 'Abaikan',
          cancelLabel: 'Batal',
          onConfirm: () => {
            setConfirmDialogConfig(null)
            resolve(true)
          },
          onCancel: () => {
            setConfirmDialogConfig(null)
            resolve(false)
          },
        })
      })
      if (!confirmed) return
    }

    const res = await openExistingProject(customPath)
    if (res.status === 'ok' && res.projectPath && res.config) {
      setProject(res.projectPath, res.config, res.config.name, res.config.exportPresets)
      if (res.initialSceneContent) {
        openScene(res.initialSceneContent, res.initialScenePath)
      } else {
        newScene()
      }
      setViewportKey((k) => k + 1)
      showToast(`Proyek "${res.config.name}" berhasil dimuat.`)
      const recents = await fetchRecentProjects()
      setRecentProjects(recents)
    } else if (res.status === 'error') {
      addConsoleMessage('error', `Gagal membuka proyek: ${res.message}`)
      showToast(`Gagal membuka proyek: ${res.message}`)
    }
  }, [isDirty, setProject, openScene, newScene, showToast, addConsoleMessage, setRecentProjects])

  const handleCloseProject = useCallback(async () => {
    if (isDirty) {
      const confirmed = await new Promise<boolean>((resolve) => {
        setConfirmDialogConfig({
          isOpen: true,
          title: 'Close Project',
          message: 'Proyek saat ini memiliki perubahan yang belum disimpan. Abaikan dan tutup proyek?',
          confirmLabel: 'Abaikan & Tutup',
          cancelLabel: 'Batal',
          onConfirm: () => {
            setConfirmDialogConfig(null)
            resolve(true)
          },
          onCancel: () => {
            setConfirmDialogConfig(null)
            resolve(false)
          },
        })
      })
      if (!confirmed) return
    }

    closeProject()
    setIsProjectManagerOpen(true)
    showToast('Proyek ditutup.')
  }, [isDirty, closeProject, showToast])

  // Handle 3D object creation from menu
  const handleCreate3DObject = (type: 'Cube' | 'Sphere' | 'Capsule' | 'Cylinder' | 'Plane') => {
    executeCommand(createEntityCommand(type))
    const all = world.getEntities()
    const newest = all[all.length - 1]
    if (newest) {
      executeCommand({
        label: `Add MeshRenderer (${type})`,
        do: (w) => {
          w.addComponent(newest.id, 'MeshRenderer', { primitive: type.toLowerCase() })
          if (type === 'Cube') w.addComponent(newest.id, 'BoxCollider')
          else if (type === 'Sphere') w.addComponent(newest.id, 'SphereCollider')
          else if (type === 'Capsule') w.addComponent(newest.id, 'CapsuleCollider')
          else if (type === 'Plane') w.addComponent(newest.id, 'BoxCollider', { size: { x: 10, y: 0.1, z: 10 } })
        },
        undo: (w) => {
          w.removeComponent(newest.id, 'MeshRenderer')
        },
      })
      selectEntity(newest.id)
    }
  }

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase()
      const isInput = activeTag === 'input' || activeTag === 'textarea'

      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey

      if (isInput) return

      // New Project: Ctrl+Shift+N
      if (cmdOrCtrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        handleNewProject()
        return
      }

      // Open Project: Ctrl+Shift+O
      if (cmdOrCtrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        handleOpenProject()
        return
      }

      // Export: Ctrl+Shift+E
      if (cmdOrCtrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setIsExportDialogOpen(true)
        return
      }

      // Ctrl+P: Play / Stop toggle
      if (cmdOrCtrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        handlePlayToggle()
        return
      }

      // Ctrl+Shift+P: Pause toggle
      if (cmdOrCtrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        handlePauseToggle()
        return
      }

      // Ctrl+Alt+P: Step
      if (cmdOrCtrl && e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        handleStep()
        return
      }

      // Ctrl+Z: Undo
      if (cmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }

      // Ctrl+Y: Redo
      if (cmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }

      // Ctrl+S: Save Scene
      if (cmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveScene(false)
        return
      }

      // Ctrl+Shift+S: Save Scene As
      if (cmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveScene(true)
        return
      }

      // Ctrl+O: Open Scene
      if (cmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        handleOpenScene()
        return
      }

      // Ctrl+N: New Scene
      if (cmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        handleNewScene()
        return
      }

      // Ctrl+D: Duplicate Entity
      if (cmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        for (const id of selectedEntityIds) {
          executeCommand(duplicateEntityCommand(id))
        }
        return
      }

      // Delete: Delete Entity
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEntityIds.length > 0) {
          e.preventDefault()
          for (const id of selectedEntityIds) {
            executeCommand(deleteEntityCommand(id))
          }
          selectEntity(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    playState,
    selectedEntityIds,
    isDirty,
    undo,
    redo,
    selectEntity,
    executeCommand,
    handleNewProject,
    handleOpenProject,
    handleSaveScene,
    handleOpenScene,
    handleNewScene,
  ])

  // IPC Menu Listeners
  useEffect(() => {
    addConsoleMessage('info', 'Linden Engine initialized (UX Overhaul & Multi-Platform Build)')

    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api) return

    const unsubNewProj = api.onMenuNewProject?.(() => handleNewProject())
    const unsubOpenProj = api.onMenuOpenProject?.(() => handleOpenProject())
    const unsubOpenRecent = api.onMenuOpenRecent?.((p) => handleOpenProject(p))
    const unsubCloseProj = api.onMenuCloseProject?.(() => handleCloseProject())
    const unsubExport = api.onMenuExport?.(() => setIsExportDialogOpen(true))
    const unsubImportGodot = api.onMenuImportGodotProject?.(() => setIsGodotImportWizardOpen(true))
    const unsubNew = api.onMenuNewScene?.(() => handleNewScene())
    const unsubOpen = api.onMenuOpenScene?.(() => handleOpenScene())
    const unsubSave = api.onMenuSaveScene?.(() => handleSaveScene(false))
    const unsubSaveAs = api.onMenuSaveSceneAs?.(() => handleSaveScene(true))
    const unsubProjSettings = api.onMenuProjectSettings?.(() => setActiveWindow('projectSettings'))
    const unsubBridge = api.onMenuOpenBridge?.(() => setActiveEditorPanel('bridge'))
    const unsubInputActions = api.onMenuInputActions?.(() => setActiveWindow('inputActions'))

    const unsubExportLog = api.onExportLog?.((data) => {
      addOutputLog(data.log)
    })
    const unsubExportProgress = api.onExportProgress?.((data) => {
      if (data.stage === 'complete') {
        setLastBuildStatus(`Berhasil (${data.stage})`)
      } else if (data.stage === 'failed') {
        setLastBuildStatus(`Gagal (${data.message})`)
      } else {
        setLastBuildStatus(`Exporting: ${data.stage} (${data.percent}%)`)
      }
    })

    return () => {
      unsubNewProj?.()
      unsubOpenProj?.()
      unsubOpenRecent?.()
      unsubCloseProj?.()
      unsubExport?.()
      unsubImportGodot?.()
      unsubNew?.()
      unsubOpen?.()
      unsubSave?.()
      unsubSaveAs?.()
      unsubProjSettings?.()
      unsubBridge?.()
      unsubInputActions?.()
      unsubExportLog?.()
      unsubExportProgress?.()
    }
  }, [
    handleNewProject,
    handleOpenProject,
    handleCloseProject,
    handleNewScene,
    handleOpenScene,
    handleSaveScene,
    addConsoleMessage,
    addOutputLog,
    setActiveWindow,
    setActiveEditorPanel,
  ])

  const isLiveSyncActive = godotBridgeRef.current?.isLiveSyncActive || false

  return (
    <div className="flex flex-col h-screen bg-[#1a1a2e] text-white overflow-hidden select-none">
      {/* Toolbar */}
      <Toolbar
        isPlaying={playState !== 'stopped'}
        isPaused={playState === 'paused'}
        onPlay={handlePlayToggle}
        onStop={() => stopPlay()}
        onPause={handlePauseToggle}
        onStep={handleStep}
        onNewProject={handleNewProject}
        onOpenProject={() => handleOpenProject()}
        onCloseProject={handleCloseProject}
        onExport={() => setIsExportDialogOpen(true)}
        onOpenBridge={() => setActiveEditorPanel('bridge')}
        onNewScene={handleNewScene}
        onOpenScene={handleOpenScene}
        onSaveScene={() => handleSaveScene(false)}
        onSaveSceneAs={() => handleSaveScene(true)}
        onUndo={undo}
        onRedo={redo}
        projectName={projectName}
        sceneName={sceneName}
        isDirty={isDirty}
        isSaved={currentScenePath !== null}
        recentProjects={recentProjects}
        onOpenRecent={(p) => handleOpenProject(p)}
        onClearRecent={async () => {
          await clearRecentProjects()
          setRecentProjects([])
        }}
        onOpenInputActions={() => setActiveWindow('inputActions')}
        onOpenProjectSettings={() => setActiveWindow('projectSettings')}
        onOpenAgent={() => setRightTab('agent')}
        agentActivity={agentActivity ? phaseLabel(agentActivity) : undefined}
        onCreate3DObject={handleCreate3DObject}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Hierarchy */}
        <div className="w-64 border-r border-gray-700/50 bg-[#16213e] flex flex-col">
          <div className="p-2 border-b border-gray-700/50 bg-[#0f3460] flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-200">Hierarchy</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <HierarchyPanel />
          </div>
        </div>

        {/* Center Panel - Viewport & Editors */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#1a1a2e]">
          {/* Middle Panel Container */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Middle Panel Tabs */}
            <div className="flex border-b border-gray-700/50 bg-[#0f3460]">
              <button
                onClick={() => setActiveEditorPanel('viewport')}
                className={`px-4 py-1.5 text-xs font-medium transition-colors flex items-center ${
                  activeEditorPanel === 'viewport'
                    ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icons.Viewport className="w-3.5 h-3.5 mr-1.5" />
                <span>Viewport</span>
              </button>
              <button
                onClick={() => setActiveEditorPanel('bridge')}
                className={`px-4 py-1.5 text-xs font-medium transition-colors flex items-center ${
                  activeEditorPanel === 'bridge' || (activeEditorPanel as string) === 'godot'
                    ? 'bg-[#16213e] text-white border-t-2 border-indigo-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icons.Bridge className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                <span>Bridge</span>
              </button>
            </div>

            {/* Panel Content */}
            <div className="flex-1 relative">
              {activeEditorPanel === 'viewport' && (
                <ErrorBoundary
                  onError={(error) => addConsoleMessage('error', `Viewport error: ${error.message}`)}
                  fallback={(error, reset) => (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-sm text-gray-300">
                      <div>Failed to load viewport: {error.message}</div>
                      <button
                        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
                        onClick={() => {
                          setViewportKey((k) => k + 1)
                          reset()
                        }}
                      >
                        Reload Viewport
                      </button>
                    </div>
                  )}
                >
                  <SceneViewport key={viewportKey} onConsoleMessage={addConsoleMessage} />
                </ErrorBoundary>
              )}
              {(activeEditorPanel === 'bridge' || (activeEditorPanel as string) === 'godot') && (
                <BridgePanel
                  bridge={godotBridgeRef.current}
                  onOpenExportDialog={() => setIsExportDialogOpen(true)}
                  onOpenGodotImportWizard={() => setIsGodotImportWizardOpen(true)}
                />
              )}
            </div>
          </div>

          {/* Bottom Panel - Project / Console / Output */}
          {bottomTab !== 'hidden' && (
            <div className="h-56 border-t border-gray-700/50 bg-[#16213e] flex flex-col">
              {/* Bottom Tabs */}
              <div className="flex border-b border-gray-700/50 bg-[#0f3460]">
                <button
                  onClick={() => setBottomTab('project')}
                  className={`px-4 py-1.5 text-xs font-medium ${
                    bottomTab === 'project'
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Project
                </button>
                <button
                  onClick={() => setBottomTab('assets')}
                  className={`px-4 py-1.5 text-xs font-medium ${
                    bottomTab === 'assets'
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Assets
                </button>
                <button
                  onClick={() => setBottomTab('console')}
                  className={`px-4 py-1.5 text-xs font-medium ${
                    bottomTab === 'console'
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Console
                </button>
                <button
                  onClick={() => setBottomTab('output')}
                  className={`px-4 py-1.5 text-xs font-medium ${
                    bottomTab === 'output'
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Output
                </button>
                <button
                  onClick={() => setBottomTab('all')}
                  className={`px-4 py-1.5 text-xs font-medium ${
                    bottomTab === 'all'
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  All
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setBottomTab('hidden')}
                  className="px-3 py-1.5 text-gray-400 hover:text-white text-xs"
                  title="Hide bottom panel"
                >
                  ✕
                </button>
              </div>

              {/* Bottom Content Area */}
              <div className="flex-1 flex overflow-hidden">
                {bottomTab === 'project' && (
                  <div className="flex-1 overflow-hidden">
                    <ProjectPanel />
                  </div>
                )}
                {bottomTab === 'assets' && (
                  <div className="flex-1 overflow-hidden">
                    <AssetBrowser />
                  </div>
                )}
                {bottomTab === 'console' && (
                  <div className="flex-1 overflow-auto">
                    <ConsolePanel messages={consoleMessages} />
                  </div>
                )}
                {bottomTab === 'output' && (
                  <div className="flex-1 overflow-auto">
                    <OutputPanel logs={outputLogs} onClearLogs={() => setOutputLogs([])} />
                  </div>
                )}
                {bottomTab === 'all' && (
                  <div className="flex-1 flex overflow-hidden">
                    <div className="w-1/3 border-r border-gray-700/50 overflow-hidden">
                      <ProjectPanel />
                    </div>
                    <div className="w-1/3 border-r border-gray-700/50 overflow-auto">
                      <ConsolePanel messages={consoleMessages} />
                    </div>
                    <div className="w-1/3 overflow-auto">
                      <OutputPanel logs={outputLogs} onClearLogs={() => setOutputLogs([])} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status Bar */}
          <div className="h-6 bg-[#0f3460] border-t border-gray-700/60 px-3 flex items-center justify-between text-[11px] text-gray-300 select-none">
            <div className="flex items-center space-x-4">
              <span>Project: <strong className="text-white">{projectName}</strong></span>
              <span>Scene: <strong className="text-white">{sceneName}{getSceneStatusSuffix({ isDirty, isSaved: currentScenePath !== null })}</strong></span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="flex items-center space-x-1.5">
                <span className={`w-2 h-2 rounded-full ${isLiveSyncActive ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                <span>{isLiveSyncActive ? 'Bridge Sync Aktif' : 'Bridge Sync Offline'}</span>
              </span>
              <span>Build: <strong className="text-gray-200">{lastBuildStatus}</strong></span>
            </div>
          </div>
        </div>

        {/* Right Panel - Inspector / AI Agent */}
        <div className="w-[22rem] shrink-0 min-w-0 border-l border-gray-700/50 bg-[#16213e] flex flex-col">
          <div className="flex border-b border-gray-700/50 bg-[#0f3460]">
            <button
              onClick={() => setRightTab('inspector')}
              className={`flex-1 py-1.5 px-3 text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors ${
                rightTab === 'inspector'
                  ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>Inspector</span>
            </button>
            <button
              onClick={() => setRightTab('scene')}
              title="Environment, tone mapping, exposure, fog, bayangan, post-processing"
              className={`flex-1 py-1.5 px-3 text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors ${
                rightTab === 'scene'
                  ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>Scene</span>
            </button>
            <button
              onClick={() => setRightTab('agent')}
              className={`flex-1 py-1.5 px-3 text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors relative ${
                rightTab === 'agent'
                  ? 'bg-[#16213e] text-white border-t-2 border-indigo-500'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icons.Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>AI Agent</span>
              {isAgentGenerating && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping absolute top-1 right-2" />
              )}
              {agentPendingDiffs.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-[10px] text-black font-bold">
                  {agentPendingDiffs.length}
                </span>
              )}
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {rightTab === 'inspector' ? <InspectorPanel /> : rightTab === 'scene' ? <SceneSettingsPanel /> : <AgentPanel />}
          </div>
        </div>
      </div>

      {/* Windows Dialogs */}
      {activeWindow === 'inputActions' && (
        <InputActionsWindow onClose={() => setActiveWindow(null)} />
      )}
      {activeWindow === 'projectSettings' && (
        <ProjectSettingsWindow onClose={() => setActiveWindow(null)} />
      )}

      {/* Export Dialog */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onShowToast={showToast}
      />

      {/* Godot Import Wizard */}
      <GodotImportWizard
        isOpen={isGodotImportWizardOpen}
        onClose={() => setIsGodotImportWizardOpen(false)}
        onOpenProject={async (projPath) => {
          await handleOpenProject(projPath)
        }}
        onShowToast={showToast}
      />

      {/* Project Manager Window */}
      <ProjectManagerWindow
        isOpen={isProjectManagerOpen}
        onClose={() => setIsProjectManagerOpen(false)}
        onProjectOpened={(_projPath, sceneContent, scenePath) => {
          if (sceneContent) {
            openScene(sceneContent, scenePath)
          } else {
            newScene()
          }
          setViewportKey((k) => k + 1)
        }}
        onShowToast={showToast}
      />

      {/* Toast Notification */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* New Scene Dialog */}
      <NewSceneDialog
        isOpen={isNewSceneDialogOpen}
        onClose={() => setIsNewSceneDialogOpen(false)}
        onCreate={handleCreateNewScene}
        existingScenes={existingSceneNames}
      />

      {/* Confirm Dialog */}
      {confirmDialogConfig && (
        <ConfirmDialog
          isOpen={confirmDialogConfig.isOpen}
          title={confirmDialogConfig.title}
          message={confirmDialogConfig.message}
          confirmLabel={confirmDialogConfig.confirmLabel}
          cancelLabel={confirmDialogConfig.cancelLabel}
          onConfirm={confirmDialogConfig.onConfirm}
          onCancel={confirmDialogConfig.onCancel}
        />
      )}
    </div>
  )
}

export default EditorLayout
