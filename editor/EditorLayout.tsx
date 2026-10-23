import React, { useState, useEffect, useCallback, useRef } from 'react'
import { SceneViewport } from './viewport/SceneViewport'
import { HierarchyPanel } from './panels/HierarchyPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import { ProjectPanel } from './panels/ProjectPanel'
import { Toolbar } from './ui/Toolbar'
import { ConsolePanel } from './panels/ConsolePanel'
import { BlueprintEditor } from './panels/BlueprintEditor'
import { MaterialEditor } from './panels/MaterialEditor'
import { AnimatorEditor } from './panels/AnimatorEditor'
import { SequencerEditor } from './panels/SequencerEditor'
import { GodotPanel } from './panels/GodotPanel'
import { GodotBridge } from '../engine/godot/GodotBridge'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { InputActionsWindow } from './windows/InputActionsWindow'
import { ProjectSettingsWindow } from './windows/ProjectSettingsWindow'
import { pickAndReadScene, saveSceneFile } from './io/sceneIO'
import { SceneSerializer } from '../engine/scene/serializer'
import { useEditorStore } from './store/editorStore'
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

  const [showConsole, setShowConsole] = useState(true)
  const [showProject, setShowProject] = useState(true)
  const [consoleMessages, setConsoleMessages] = useState<Array<{ type: string; message: string; time: Date }>>([])
  const [viewportKey, setViewportKey] = useState(0)
  // Created once; the renderer has no `process`, so the project path comes from the Electron preload
  const godotBridgeRef = useRef<GodotBridge | null>(null)
  if (godotBridgeRef.current === null) {
    godotBridgeRef.current = new GodotBridge({ world })
  }

  useEffect(() => {
    const bridge = godotBridgeRef.current
    if (!bridge || bridge.getConfig().godotProjectPath) return
    window.electronAPI?.getProjectPath?.()
      .then((projectPath) => {
        if (projectPath && !bridge.getConfig().godotProjectPath) {
          bridge.setConfig({ godotProjectPath: projectPath })
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (godotBridgeRef.current) {
      (godotBridgeRef.current as any).currentWorld = world
    }
  }, [world])

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

  // Update window title with scene name and * dirty indicator
  useEffect(() => {
    const dirtyMark = isDirty ? ' *' : ''
    document.title = `${sceneName}${dirtyMark} — Linden Engine`
  }, [sceneName, isDirty])

  // Play / Pause / Step / Stop handlers
  const handlePlayToggle = async () => {
    if (playState === 'stopped') {
      try {
        await startPlay()
        addConsoleMessage('info', 'Play mode started (Rapier 3D initialized)')
      } catch (err: any) {
        addConsoleMessage('error', `Failed to start Play mode: ${err.message}`)
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
      const isExisting = !isSaveAs && !!currentScenePath
      const targetName = isExisting ? currentScenePath : `${sceneName}.lscene`
      const currentJson = SceneSerializer.serialize(world, sceneName)

      const res = await saveSceneFile(currentJson, targetName, isExisting ? currentScenePath : null)
      if (res.status === 'ok') {
        const savedPath = res.path || (isExisting ? currentScenePath : targetName)
        saveScene(savedPath || undefined)
        addConsoleMessage('info', `Scene saved: ${savedPath}`)
      }
    } catch (err: any) {
      addConsoleMessage('error', `Failed to save scene: ${err.message}`)
    }
  }, [currentScenePath, sceneName, world, saveScene, addConsoleMessage])

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

    newScene()
    setViewportKey((k) => k + 1)
    addConsoleMessage('info', 'New scene created')
  }, [isDirty, newScene, addConsoleMessage])

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

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey

      // Native text undo/redo inside input fields should NOT trigger scene undo! (TC-F03-09)
      if (isInput) return

      // Ctrl+P: Play / Stop toggle (TC-F05-01)
      if (cmdOrCtrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        handlePlayToggle()
        return
      }

      // Ctrl+Shift+P: Pause toggle (TC-F05-04)
      if (cmdOrCtrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        handlePauseToggle()
        return
      }

      // Ctrl+Alt+P: Step (TC-F05-04)
      if (cmdOrCtrl && e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        handleStep()
        return
      }

      // Ctrl+Z: Undo (TC-F03-06)
      if (cmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }

      // Ctrl+Y: Redo (TC-F03-06)
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
    sceneName,
    currentScenePath,
    undo,
    redo,
    selectEntity,
    executeCommand,
  ])

  useEffect(() => {
    addConsoleMessage('info', 'Linden Engine initialized (Godot Parity / Unity UX)')

    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api) return

    const unsubNew = api.onMenuNewScene?.(() => {
      handleNewScene()
    })
    const unsubOpen = api.onMenuOpenScene?.(() => {
      handleOpenScene()
    })
    const unsubSave = api.onMenuSaveScene?.(() => {
      handleSaveScene(false)
    })
    const unsubSaveAs = api.onMenuSaveSceneAs?.(() => {
      handleSaveScene(true)
    })

    return () => {
      unsubNew?.()
      unsubOpen?.()
      unsubSave?.()
      unsubSaveAs?.()
    }
  }, [handleNewScene, handleOpenScene, handleSaveScene, addConsoleMessage])

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
        onNewScene={handleNewScene}
        onOpenScene={handleOpenScene}
        onSaveScene={() => handleSaveScene(false)}
        onSaveSceneAs={() => handleSaveScene(true)}
        onUndo={undo}
        onRedo={redo}
        sceneName={sceneName}
        isDirty={isDirty}
        onOpenBlueprintEditor={() => setActiveEditorPanel('blueprint')}
        onOpenMaterialEditor={() => setActiveEditorPanel('material')}
        onOpenAnimatorEditor={() => setActiveEditorPanel('animator')}
        onOpenSequencerEditor={() => setActiveEditorPanel('sequencer')}
        onOpenInputActions={() => setActiveWindow('inputActions')}
        onOpenProjectSettings={() => setActiveWindow('projectSettings')}
        onCreate3DObject={handleCreate3DObject}
      />

      {/* Main Workspace Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Hierarchy */}
        <div className="w-64 border-r border-gray-700/50 bg-[#16213e] flex flex-col">
          <div className="p-2 border-b border-gray-700/50 bg-[#0f3460] flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-200">Hierarchy</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <HierarchyPanel />
          </div>
        </div>

        {/* Center Panel - Viewport & Bottom Panels */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Main Viewport or Active Editor Tab */}
          <div className="flex-1 relative flex flex-col">
            {/* Panel Tabs */}
            <div className="flex bg-[#0f3460] border-b border-gray-700/50">
              <button
                onClick={() => setActiveEditorPanel('viewport')}
                className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                  activeEditorPanel === 'viewport'
                    ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                🎮 Scene
              </button>
              <button
                onClick={() => setActiveEditorPanel('blueprint')}
                className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                  activeEditorPanel === 'blueprint'
                    ? 'bg-[#16213e] text-white border-t-2 border-cyan-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                📝 Blueprint
              </button>
              <button
                onClick={() => setActiveEditorPanel('material')}
                className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                  activeEditorPanel === 'material'
                    ? 'bg-[#16213e] text-white border-t-2 border-green-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                🎨 Material
              </button>
              <button
                onClick={() => setActiveEditorPanel('animator')}
                className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                  activeEditorPanel === 'animator'
                    ? 'bg-[#16213e] text-white border-t-2 border-orange-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                🎬 Animator
              </button>
              <button
                onClick={() => setActiveEditorPanel('sequencer')}
                className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                  activeEditorPanel === 'sequencer'
                    ? 'bg-[#16213e] text-white border-t-2 border-purple-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                🎥 Sequencer
              </button>
              <button
                onClick={() => setActiveEditorPanel('godot')}
                className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                  activeEditorPanel === 'godot'
                    ? 'bg-[#16213e] text-white border-t-2 border-indigo-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                🤖 Godot Bridge
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
                  <SceneViewport key={viewportKey} />
                </ErrorBoundary>
              )}
              {activeEditorPanel === 'blueprint' && <BlueprintEditor />}
              {activeEditorPanel === 'material' && <MaterialEditor />}
              {activeEditorPanel === 'animator' && <AnimatorEditor />}
              {activeEditorPanel === 'sequencer' && <SequencerEditor />}
              {activeEditorPanel === 'godot' && <GodotPanel bridge={godotBridgeRef.current} />}
            </div>
          </div>

          {/* Bottom Panel - Project / Console */}
          {(showProject || showConsole) && (
            <div className="h-56 border-t border-gray-700/50 bg-[#16213e] flex flex-col">
              {/* Bottom Tabs */}
              <div className="flex border-b border-gray-700/50 bg-[#0f3460]">
                <button
                  onClick={() => {
                    setShowProject(true)
                    setShowConsole(false)
                  }}
                  className={`px-4 py-1.5 text-xs font-medium ${
                    showProject && !showConsole
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Project
                </button>
                <button
                  onClick={() => {
                    setShowConsole(true)
                    setShowProject(false)
                  }}
                  className={`px-4 py-1.5 text-xs font-medium ${
                    showConsole && !showProject
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Console
                </button>
                <button
                  onClick={() => {
                    setShowProject(true)
                    setShowConsole(true)
                  }}
                  className={`px-4 py-1.5 text-xs font-medium ${
                    showProject && showConsole
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Both
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    setShowProject(false)
                    setShowConsole(false)
                  }}
                  className="px-3 py-1.5 text-gray-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>

              {/* Bottom Content Area */}
              <div className="flex-1 flex overflow-hidden">
                {showProject && (
                  <div className={`${showConsole ? 'w-1/2 border-r border-gray-700/50' : 'flex-1'} overflow-hidden`}>
                    <ProjectPanel />
                  </div>
                )}
                {showConsole && (
                  <div className={`${showProject ? 'w-1/2' : 'flex-1'} overflow-auto`}>
                    <ConsolePanel messages={consoleMessages} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Inspector */}
        <div className="w-80 border-l border-gray-700/50 bg-[#16213e] flex flex-col">
          <div className="p-2 border-b border-gray-700/50 bg-[#0f3460] flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-200">Inspector</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <InspectorPanel />
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
