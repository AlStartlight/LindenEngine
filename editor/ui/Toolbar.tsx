import React, { useState } from 'react'

interface ToolbarProps {
  isPlaying: boolean
  isPaused?: boolean
  onPlay: () => void
  onStop: () => void
  onPause: () => void
  onStep?: () => void
  onNewScene?: () => void
  onOpenScene?: () => void
  onSaveScene?: () => void
  onSaveSceneAs?: () => void
  onUndo?: () => void
  onRedo?: () => void
  sceneName?: string
  isDirty?: boolean
  onOpenBlueprintEditor?: () => void
  onOpenMaterialEditor?: () => void
  onOpenAnimatorEditor?: () => void
  onOpenSequencerEditor?: () => void
  onOpenInputActions?: () => void
  onOpenProjectSettings?: () => void
  onCreate3DObject?: (type: 'Cube' | 'Sphere' | 'Capsule' | 'Cylinder' | 'Plane') => void
}

export const Toolbar: React.FC<ToolbarProps> = ({
  isPlaying,
  isPaused = false,
  onPlay,
  onStop,
  onPause,
  onStep,
  onNewScene,
  onOpenScene,
  onSaveScene,
  onSaveSceneAs,
  onUndo,
  onRedo,
  sceneName = 'Untitled',
  isDirty = false,
  onOpenBlueprintEditor,
  onOpenMaterialEditor,
  onOpenAnimatorEditor,
  onOpenSequencerEditor,
  onOpenInputActions,
  onOpenProjectSettings,
  onCreate3DObject,
}) => {
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [showEditMenu, setShowEditMenu] = useState(false)
  const [showGameObjectMenu, setShowGameObjectMenu] = useState(false)
  const [showWindowMenu, setShowWindowMenu] = useState(false)

  return (
    <div className="bg-[#0f3460] border-b border-gray-700/50 select-none">
      {/* Menu Bar */}
      <div className="flex items-center h-8 px-2 text-sm border-b border-gray-700/30">
        {/* File Menu */}
        <div className="relative">
          <button
            className="px-3 py-1 hover:bg-white/10 rounded"
            onClick={() => setShowFileMenu(!showFileMenu)}
          >
            File
          </button>
          {showFileMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-44 py-1">
              <MenuItem
                label="New Scene"
                shortcut="Ctrl+N"
                onClick={() => {
                  onNewScene?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuItem
                label="Open Scene"
                shortcut="Ctrl+O"
                onClick={() => {
                  onOpenScene?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuItem
                label="Save Scene"
                shortcut="Ctrl+S"
                onClick={() => {
                  onSaveScene?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuItem
                label="Save Scene As..."
                shortcut="Ctrl+Shift+S"
                onClick={() => {
                  onSaveSceneAs?.()
                  setShowFileMenu(false)
                }}
              />
              <MenuDivider />
              <MenuItem
                label="Project Settings"
                onClick={() => {
                  onOpenProjectSettings?.()
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
            onClick={() => setShowEditMenu(!showEditMenu)}
          >
            Edit
          </button>
          {showEditMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-44 py-1">
              <MenuItem
                label="Undo"
                shortcut="Ctrl+Z"
                onClick={() => {
                  onUndo?.()
                  setShowEditMenu(false)
                }}
              />
              <MenuItem
                label="Redo"
                shortcut="Ctrl+Y"
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
            onClick={() => setShowGameObjectMenu(!showGameObjectMenu)}
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
            onClick={() => setShowWindowMenu(!showWindowMenu)}
          >
            Window
          </button>
          {showWindowMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-48 py-1">
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
                label="📝 Blueprint Editor"
                onClick={() => {
                  onOpenBlueprintEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem
                label="🎨 Material Editor"
                onClick={() => {
                  onOpenMaterialEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem
                label="🎬 Animator Editor"
                onClick={() => {
                  onOpenAnimatorEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem
                label="🎥 Sequencer Editor"
                onClick={() => {
                  onOpenSequencerEditor?.()
                  setShowWindowMenu(false)
                }}
              />
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Scene Title with dirty indicator */}
        <span className="text-xs text-gray-300 font-medium">
          {sceneName}
          {isDirty ? ' *' : ''}
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
            title="Play / Stop (Ctrl+P)"
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
            title="Pause (Ctrl+Shift+P)"
          >
            ⏸
          </button>

          <button
            onClick={onStep}
            disabled={!isPlaying}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              isPlaying ? 'hover:bg-white/10 text-gray-200' : 'opacity-40 cursor-not-allowed text-gray-500'
            }`}
            title="Step Frame (Ctrl+Alt+P)"
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
      <span>▶</span>
    </button>
    <div className="hidden group-hover:block absolute left-full top-0 bg-[#16213e] border border-gray-700/50 rounded shadow-xl min-w-36 py-1">
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
