import React, { useState } from 'react'

interface ToolbarProps {
  isPlaying: boolean
  onPlay: () => void
  onStop: () => void
  onPause: () => void
  onOpenBlueprintEditor?: () => void
  onOpenMaterialEditor?: () => void
  onOpenAnimatorEditor?: () => void
  onOpenSequencerEditor?: () => void
}

export const Toolbar: React.FC<ToolbarProps> = ({
  isPlaying,
  onPlay,
  onStop,
  onOpenBlueprintEditor,
  onOpenMaterialEditor,
  onOpenAnimatorEditor,
  onOpenSequencerEditor,
}) => {
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [showEditMenu, setShowEditMenu] = useState(false)
  const [showGameObjectMenu, setShowGameObjectMenu] = useState(false)
  const [showWindowMenu, setShowWindowMenu] = useState(false)

  return (
    <div className="bg-[#0f3460] border-b border-gray-700/50">
      {/* Menu Bar */}
      <div className="flex items-center h-8 px-2 text-sm border-b border-gray-700/30">
        <div className="relative">
          <button
            className="px-3 py-1 hover:bg-white/10 rounded"
            onClick={() => setShowFileMenu(!showFileMenu)}
          >
            File
          </button>
          {showFileMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-40">
              <MenuItem label="New Scene" shortcut="Ctrl+N" />
              <MenuItem label="Open Scene" shortcut="Ctrl+O" />
              <MenuItem label="Save Scene" shortcut="Ctrl+S" />
              <MenuItem label="Save Scene As..." shortcut="Ctrl+Shift+S" />
              <MenuDivider />
              <MenuItem label="Build Settings" shortcut="Ctrl+Shift+B" />
              <MenuItem label="Build and Run" shortcut="Ctrl+B" />
              <MenuDivider />
              <MenuItem label="Exit" />
            </div>
          )}
        </div>

        <div className="relative">
          <button
            className="px-3 py-1 hover:bg-white/10 rounded"
            onClick={() => setShowEditMenu(!showEditMenu)}
          >
            Edit
          </button>
          {showEditMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-40">
              <MenuItem label="Undo" shortcut="Ctrl+Z" />
              <MenuItem label="Redo" shortcut="Ctrl+Y" />
              <MenuDivider />
              <MenuItem label="Cut" shortcut="Ctrl+X" />
              <MenuItem label="Copy" shortcut="Ctrl+C" />
              <MenuItem label="Paste" shortcut="Ctrl+V" />
              <MenuItem label="Duplicate" shortcut="Ctrl+D" />
              <MenuItem label="Delete" shortcut="Del" />
              <MenuDivider />
              <MenuItem label="Project Settings" />
              <MenuItem label="Preferences" />
            </div>
          )}
        </div>

        <div className="relative">
          <button
            className="px-3 py-1 hover:bg-white/10 rounded"
            onClick={() => setShowGameObjectMenu(!showGameObjectMenu)}
          >
            GameObject
          </button>
          {showGameObjectMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-48">
              <MenuItem label="Create Empty" shortcut="Ctrl+Shift+N" />
              <MenuDivider />
              <SubMenu label="3D Object">
                <MenuItem label="Cube" />
                <MenuItem label="Sphere" />
                <MenuItem label="Cylinder" />
                <MenuItem label="Capsule" />
                <MenuItem label="Plane" />
                <MenuItem label="Quad" />
              </SubMenu>
              <SubMenu label="Light">
                <MenuItem label="Directional Light" />
                <MenuItem label="Point Light" />
                <MenuItem label="Spot Light" />
                <MenuItem label="Area Light" />
              </SubMenu>
              <SubMenu label="Audio">
                <MenuItem label="Audio Source" />
                <MenuItem label="Audio Listener" />
              </SubMenu>
              <SubMenu label="Effects">
                <MenuItem label="Particle System" />
                <MenuItem label="Trail" />
                <MenuItem label="Line" />
              </SubMenu>
              <MenuItem label="Camera" />
            </div>
          )}
        </div>

        <button className="px-3 py-1 hover:bg-white/10 rounded">
          Component
        </button>

        <div className="relative">
          <button
            className="px-3 py-1 hover:bg-white/10 rounded"
            onClick={() => setShowWindowMenu(!showWindowMenu)}
          >
            Window
          </button>
          {showWindowMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50 min-w-48">
              <MenuItem 
                label="📝 Blueprint Editor" 
                shortcut="Ctrl+B"
                onClick={() => {
                  onOpenBlueprintEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem 
                label="🎨 Material Editor" 
                shortcut="Ctrl+M"
                onClick={() => {
                  onOpenMaterialEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem 
                label="🎬 Animator Editor" 
                shortcut="Ctrl+A"
                onClick={() => {
                  onOpenAnimatorEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuItem 
                label="🎥 Sequencer Editor" 
                shortcut="Ctrl+Shift+S"
                onClick={() => {
                  onOpenSequencerEditor?.()
                  setShowWindowMenu(false)
                }}
              />
              <MenuDivider />
              <MenuItem label="Hierarchy" />
              <MenuItem label="Inspector" />
              <MenuItem label="Console" />
              <MenuItem label="Asset Browser" />
            </div>
          )}
        </div>

        <button className="px-3 py-1 hover:bg-white/10 rounded">
          Help
        </button>

        <div className="flex-1" />

        <span className="text-xs text-gray-400">Linden Engine</span>
      </div>

      {/* Tool Bar */}
      <div className="flex items-center h-10 px-4 gap-2">
        {/* Transform Tools */}
        <div className="flex items-center gap-1 bg-black/30 rounded p-1">
          <ToolButton icon="↔" title="Move Tool (W)" active />
          <ToolButton icon="↻" title="Rotate Tool (E)" />
          <ToolButton icon="⤢" title="Scale Tool (R)" />
          <ToolButton icon="⊞" title="Rect Tool (T)" />
        </div>

        <div className="w-px h-6 bg-gray-700/50" />

        {/* Pivot/Center Toggle */}
        <div className="flex items-center gap-1 bg-black/30 rounded p-1">
          <button className="px-2 py-1 text-xs bg-blue-600/50 rounded">Pivot</button>
          <button className="px-2 py-1 text-xs hover:bg-white/10 rounded">Center</button>
        </div>

        <div className="flex items-center gap-1 bg-black/30 rounded p-1">
          <button className="px-2 py-1 text-xs bg-blue-600/50 rounded">Local</button>
          <button className="px-2 py-1 text-xs hover:bg-white/10 rounded">Global</button>
        </div>

        <div className="flex-1" />

        {/* Play Controls */}
        <div className="flex items-center gap-1 bg-black/30 rounded p-1">
          <button
            onClick={onPlay}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1 ${
              isPlaying
                ? 'bg-blue-600 text-white'
                : 'hover:bg-white/10'
            }`}
            title="Play (Ctrl+P)"
          >
            <span>{isPlaying ? '⏸' : '▶'}</span>
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          
          <button
            onClick={onStop}
            className="px-3 py-1.5 rounded text-sm hover:bg-white/10 transition-colors"
            title="Stop"
          >
            ⏹
          </button>
          
          <button
            className="px-3 py-1.5 rounded text-sm hover:bg-white/10 transition-colors"
            title="Step Frame"
          >
            ⏭
          </button>
        </div>

        <div className="flex-1" />

        {/* Right side tools */}
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded text-sm hover:bg-white/10 transition-colors">
            👤 Account
          </button>
          <button className="px-3 py-1.5 rounded text-sm hover:bg-white/10 transition-colors">
            ☁️ Cloud
          </button>
          <button className="w-8 h-8 rounded hover:bg-white/10 transition-colors flex items-center justify-center">
            ⚙
          </button>
        </div>
      </div>
    </div>
  )
}

// Helper Components
const MenuItem: React.FC<{ label: string; shortcut?: string; onClick?: () => void }> = ({ 
  label, 
  shortcut,
  onClick 
}) => (
  <button
    className="w-full px-3 py-1.5 text-left text-sm hover:bg-blue-600/50 flex justify-between items-center"
    onClick={onClick}
  >
    <span>{label}</span>
    {shortcut && <span className="text-xs text-gray-400 ml-4">{shortcut}</span>}
  </button>
)

const MenuDivider: React.FC = () => (
  <div className="h-px bg-gray-700/50 my-1" />
)

const SubMenu: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [showSubMenu, setShowSubMenu] = useState(false)
  
  return (
    <div 
      className="relative"
      onMouseEnter={() => setShowSubMenu(true)}
      onMouseLeave={() => setShowSubMenu(false)}
    >
      <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-blue-600/50 flex justify-between items-center">
        <span>{label}</span>
        <span className="text-xs">▶</span>
      </button>
      {showSubMenu && (
        <div className="absolute left-full top-0 ml-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl min-w-40">
          {children}
        </div>
      )}
    </div>
  )
}

const ToolButton: React.FC<{ icon: string; title: string; active?: boolean }> = ({ 
  icon, 
  title, 
  active 
}) => (
  <button
    className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
      active ? 'bg-blue-600/50 text-white' : 'hover:bg-white/10 text-gray-400'
    }`}
    title={title}
  >
    {icon}
  </button>
)

export default Toolbar
