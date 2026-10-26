import React, { useState } from 'react'
import { getSceneStatusSuffix } from './windowTitle'

interface ToolbarProps {
  isPlaying: boolean
  isPaused?: boolean
  onPlay: () => void
  onStop: () => void
  onPause: () => void
  onStep?: () => void
  onNewProject?: () => void
  onOpenProject?: () => void
  onCloseProject?: () => void
  onExport?: () => void
  onOpenBridge?: () => void
  onNewScene?: () => void
  onOpenScene?: () => void
  onSaveScene?: () => void
  onSaveSceneAs?: () => void
  onUndo?: () => void
  onRedo?: () => void
  projectName?: string
  sceneName?: string
  isDirty?: boolean
  isSaved?: boolean
  recentProjects?: Array<{ name: string; path: string }>
  onOpenRecent?: (path: string) => void
  onClearRecent?: () => void
  onOpenBlueprintEditor?: () => void
  onOpenMaterialEditor?: () => void
  onOpenAnimatorEditor?: () => void
  onOpenSequencerEditor?: () => void
  onOpenInputActions?: () => void
  onOpenProjectSettings?: () => void
  onOpenAgent?: () => void
  /** Phase of the agent's running turn; shows a status chip while set */
  agentActivity?: string
  onCreate3DObject?: (type: 'Cube' | 'Sphere' | 'Capsule' | 'Cylinder' | 'Plane') => void
  onExit?: () => void
}

export const Toolbar: React.FC<ToolbarProps> = ({
  isPlaying,
  isPaused = false,
  onPlay,
  onStop,
  onPause,
  onStep,
  onNewProject,
  onOpenProject,
  onCloseProject,
  onExport,
  onOpenBridge,
  onNewScene,
  onOpenScene,
  onSaveScene,
  onSaveSceneAs,
  onUndo,
  onRedo,
  projectName,
  sceneName = 'Untitled',
  isDirty = false,
  isSaved = true,
  recentProjects = [],
  onOpenRecent,
  onClearRecent,
  onOpenBlueprintEditor,
  onOpenMaterialEditor,
  onOpenAnimatorEditor,
  onOpenSequencerEditor,
  onOpenInputActions,
  onOpenProjectSettings,
  onOpenAgent,
  agentActivity,
  onCreate3DObject,
  onExit,
}) => {
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [showEditMenu, setShowEditMenu] = useState(false)
  const [showGameObjectMenu, setShowGameObjectMenu] = useState(false)
  const [showWindowMenu, setShowWindowMenu] = useState(false)

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  const mod = isMac ? 'Cmd' : 'Ctrl'

  return (
    <div className="bg-[#0f3460] border-b border-gray-700/50 select-none">
      {/* Menu Bar */}
      <div className="flex items-center h-8 px-2 text-sm border-b border-gray-700/30">
        {/* File Menu */}
        <div className="relative">
          <button
            className="px-3 py-1 hover:bg-white/10 rounded"
            onClick={() => {
              setShowFileMenu(!showFileMenu)
              setShowEditMenu(false)
              setShowGameObjectMenu(false)
              setShowWindowMenu(false)
            }}
          >
            File
          </button>
          {showFileMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-56 py-1">
              <MenuItem
                label="New Project…"
                shortcut={`${mod}+Shift+N`}
                onClick={() => {
                  onNewProject?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuItem
                label="Open Project…"
                shortcut={`${mod}+Shift+O`}
                onClick={() => {
                  onOpenProject?.()
                  setShowFileMenu(false)
                }}
              />
              <SubMenu label="Open Recent">
                {recentProjects.length > 0 ? (
                  <>
                    {recentProjects.map((proj) => (
                      <MenuItem
                        key={proj.path}
                        label={proj.name}
                        onClick={() => {
                          onOpenRecent?.(proj.path)
                          setShowFileMenu(false)
                        }}
                      />
                    ))}
                    <MenuDivider />
                    <MenuItem
                      label="Clear Recent"
                      onClick={() => {
                        onClearRecent?.()
                        setShowFileMenu(false)
                      }}
                    />
                  </>
                ) : (
                  <div className="px-3 py-1.5 text-xs text-gray-400 italic">No Recent Projects</div>
                )}
              </SubMenu>
              <MenuDivider />
              <MenuItem
                label="New Scene"
                shortcut={`${mod}+N`}
                onClick={() => {
                  onNewScene?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuItem
                label="Open Scene…"
                shortcut={`${mod}+O`}
                onClick={() => {
                  onOpenScene?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuItem
                label="Save Scene"
                shortcut={`${mod}+S`}
                onClick={() => {
                  onSaveScene?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuItem
                label="Save Scene As…"
                shortcut={`${mod}+Shift+S`}
                onClick={() => {
                  onSaveSceneAs?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuDivider />
              <MenuItem
                label="Project Settings…"
                onClick={() => {
                  onOpenProjectSettings?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuItem
                label="Export…"
                shortcut={`${mod}+Shift+E`}
                onClick={() => {
                  onExport?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuItem
                label="Close Project"
                onClick={() => {
                  onCloseProject?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuDivider />
              <MenuItem
                label="Exit"
                shortcut={`${mod}+Q`}
                onClick={() => {
                  if (onExit) onExit()
                  else if (typeof window !== 'undefined' && (window as any).close) (window as any).close()
                  setShowFileMenu(false)
                }}
              />
            </div>
          )}
        </div>

        {/* Edit Menu */}
        <div className="relative">
          <button
            className="px-3 py-1 hover:bg-white/10 rounded"
            onClick={() => {
              setShowEditMenu(!showEditMenu)
              setShowFileMenu(false)
              setShowGameObjectMenu(false)
              setShowWindowMenu(false)
            }}
          >
            Edit
          </button>
          {showEditMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-44 py-1">
              <MenuItem
                label="Undo"
                shortcut={`${mod}+Z`}
                onClick={() => {
                  onUndo?.()
                  setShowEditMenu(false)
                }}
              />
              <MenuItem
                label="Redo"
                shortcut={`${mod}+Y`}
                onClick={() => {
                  onRedo?.()
                  setShowEditMenu(false)
                }}
              />
              <MenuDivider />
              <MenuItem
                label="Project Settings"
                onClick={() => {
                  onOpenProjectSettings?.()
                  setShowEditMenu(false)
                }}
              />
            </div>
          )}
        </div>

        {/* GameObject Menu */}
        <div className="relative">
          <button
            className="px-3 py-1 hover:bg-white/10 rounded"
            onClick={() => {
              setShowGameObjectMenu(!showGameObjectMenu)
              setShowFileMenu(false)
              setShowEditMenu(false)
              setShowWindowMenu(false)
            }}
          >
            GameObject
          </button>
          {showGameObjectMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-44 py-1">
              <SubMenu label="3D Object">
                <MenuItem
                  label="Cube"
                  onClick={() => {
                    onCreate3DObject?.('Cube')
                    setShowGameObjectMenu(false)
                  }}
                />
                <MenuItem
                  label="Sphere"
                  onClick={() => {
                    onCreate3DObject?.('Sphere')
                    setShowGameObjectMenu(false)
                  }}
                />
                <MenuItem
                  label="Capsule"
                  onClick={() => {
                    onCreate3DObject?.('Capsule')
                    setShowGameObjectMenu(false)
                  }}
                />
                <MenuItem
                  label="Cylinder"
                  onClick={() => {
                    onCreate3DObject?.('Cylinder')
                    setShowGameObjectMenu(false)
                  }}
                />
                <MenuItem
                  label="Plane"
                  onClick={() => {
                    onCreate3DObject?.('Plane')
                    setShowGameObjectMenu(false)
                  }}
                />
              </SubMenu>
            </div>
          )}
        </div>

        {/* Window Menu */}
        <div className="relative">
          <button
            className="px-3 py-1 hover:bg-white/10 rounded"
            onClick={() => {
              setShowWindowMenu(!showWindowMenu)
              setShowFileMenu(false)
              setShowEditMenu(false)
              setShowGameObjectMenu(false)
            }}
          >
            Window
          </button>
          {showWindowMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-48 py-1">
              <MenuItem
                label="Bridge"
                onClick={() => {
                  onOpenBridge?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem
                label="AI Agent Panel"
                onClick={() => {
                  onOpenAgent?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuDivider />
              <MenuItem
                label="Input Actions"
                onClick={() => {
                  onOpenInputActions?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem
                label="Project Settings"
                onClick={() => {
                  onOpenProjectSettings?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuDivider />
              <MenuItem
                label="Blueprint Editor"
                onClick={() => {
                  onOpenBlueprintEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem
                label="Material Editor"
                onClick={() => {
                  onOpenMaterialEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem
                label="Animator Editor"
                onClick={() => {
                  onOpenAnimatorEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem
                label="Sequencer Editor"
                onClick={() => {
                  onOpenSequencerEditor?.()
                  setShowWindowMenu(false)
                }}
              />
            </div>
          )}
        </div>

        <div className="flex-1" />

        {agentActivity && (
          <button
            onClick={onOpenAgent}
            className="mr-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-400/40 text-[11px] text-indigo-200 hover:bg-indigo-500/30 max-w-[260px]"
            title="Buka panel AI Agent"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse shrink-0" />
            <span className="truncate">Agent: {agentActivity}</span>
          </button>
        )}

        {/* Project & Scene Title with dirty indicator */}
        <span className="text-xs text-gray-300 font-medium">
          {projectName ? <span className="text-blue-300 font-semibold">{projectName} — </span> : null}
          {sceneName}
          {getSceneStatusSuffix({ isDirty, isSaved })}
        </span>
      </div>

      {/* Tool Bar */}
      <div className="flex items-center h-10 px-4 gap-2">
        {/* Transform Tools */}
        <div className="flex items-center gap-1 bg-black/30 rounded p-1">
          <ToolButton icon="↔" title="Move Tool (W)" active />
          <ToolButton icon="↻" title="Rotate Tool (E)" />
          <ToolButton icon="⤢" title="Scale Tool (R)" />
        </div>

        <div className="flex-1" />

        {/* Play Controls in Center */}
        <div className="flex items-center gap-1 bg-black/30 rounded p-1">
          <button
            onClick={onPlay}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              isPlaying
                ? 'bg-blue-600 text-white shadow'
                : 'hover:bg-white/10 text-gray-200'
            }`}
            title={`Play / Stop (${mod}+P)`}
          >
            <span>▶</span>
            <span>{isPlaying ? 'Playing' : 'Play'}</span>
          </button>

          <button
            onClick={onPause}
            disabled={!isPlaying}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              isPaused
                ? 'bg-amber-600 text-white'
                : isPlaying
                ? 'hover:bg-white/10 text-gray-200'
                : 'opacity-40 cursor-not-allowed text-gray-500'
            }`}
            title={`Pause (${mod}+Shift+P)`}
          >
            ⏸
          </button>

          <button
            onClick={onStep}
            disabled={!isPlaying}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              isPlaying ? 'hover:bg-white/10 text-gray-200' : 'opacity-40 cursor-not-allowed text-gray-500'
            }`}
            title={`Step Frame (${mod}+Alt+P)`}
          >
            ⏭
          </button>
        </div>

        <div className="flex-1" />
      </div>
    </div>
  )
}

const MenuItem: React.FC<{ label: string; shortcut?: string; onClick?: () => void }> = ({
  label,
  shortcut,
  onClick,
}) => (
  <button
    className="w-full px-3 py-1.5 text-left hover:bg-blue-600/50 flex items-center justify-between text-xs text-gray-200"
    onClick={onClick}
  >
    <span>{label}</span>
    {shortcut && <span className="text-[10px] text-gray-400 font-mono ml-4">{shortcut}</span>}
  </button>
)

const SubMenu: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="relative group">
    <button className="w-full px-3 py-1.5 text-left hover:bg-blue-600/50 flex items-center justify-between text-xs text-gray-200">
      <span>{label}</span>
      <span className="text-[10px]">▶</span>
    </button>
    <div className="hidden group-hover:block absolute left-full top-0 bg-[#16213e] border border-gray-700/50 rounded shadow-xl min-w-48 py-1 z-50">
      {children}
    </div>
  </div>
)

const MenuDivider: React.FC = () => <div className="border-t border-gray-700/40 my-1" />

const ToolButton: React.FC<{ icon: string; title: string; active?: boolean }> = ({
  icon,
  title,
  active = false,
}) => (
  <button
    className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
      active ? 'bg-blue-600 text-white' : 'hover:bg-white/10 text-gray-300'
    }`}
    title={title}
  >
    {icon}
  </button>
)
