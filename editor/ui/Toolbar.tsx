import React, { useState, useEffect, useRef } from 'react'
import { getSceneStatusSuffix } from './windowTitle'
import { Icons } from './Icons'
import { useI18n, EDITOR_LANGUAGES, EditorLocale, getEditorLocale } from '../i18n/translations'

// Fallback identifier so any agent session or hot-reload referencing currentLocale never throws ReferenceError
let currentLocale: EditorLocale = 'en-US'
try {
  currentLocale = getEditorLocale()
} catch {}

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
  onOpenInputActions?: () => void
  onOpenProjectSettings?: () => void
  onOpenAgent?: () => void
  /** Phase of the agent's running turn; shows a status chip while set */
  agentActivity?: string
  /** Pending agent diffs, shown as a badge on the right-side Agent entry */
  agentPendingDiffs?: number
  onCreate3DObject?: (type: 'Cube' | 'Sphere' | 'Capsule' | 'Cylinder' | 'Plane') => void
  onExit?: () => void
  activeBottomTab?: 'project' | 'assets' | 'console' | 'output' | 'all' | 'hidden'
  onSelectBottomTab?: (tab: 'project' | 'assets' | 'console' | 'output' | 'all' | 'hidden') => void
  onToggleBottomPanel?: () => void
  onApplyWorkspaceLayout?: (layout: 'default' | 'console-focus' | 'assets-focus' | 'split-all' | 'viewport-maximized') => void
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
  onOpenInputActions,
  onOpenProjectSettings,
  onOpenAgent,
  agentActivity,
  agentPendingDiffs = 0,
  onCreate3DObject,
  onExit,
  activeBottomTab,
  onSelectBottomTab,
  onToggleBottomPanel,
  onApplyWorkspaceLayout,
}) => {
  const [activeMenu, setActiveMenu] = useState<'file' | 'edit' | 'gameobject' | 'window' | null>(null)
  const { t, locale, currentLocale: hookLocale, setLocale } = useI18n()
  const activeLocale = locale || hookLocale || currentLocale || 'en-US'
  const menuBarRef = useRef<HTMLDivElement>(null)

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  const mod = isMac ? 'Cmd' : 'Ctrl'

  // Close menus on outside click or Escape
  useEffect(() => {
    if (!activeMenu) return
    const handleDown = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setActiveMenu(null)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveMenu(null)
      }
    }
    window.addEventListener('mousedown', handleDown)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleDown)
      window.removeEventListener('keydown', handleKey)
    }
  }, [activeMenu])

  const toggleMenu = (menu: 'file' | 'edit' | 'gameobject' | 'window') => {
    setActiveMenu((curr) => (curr === menu ? null : menu))
  }

  const handleMenuHover = (menu: 'file' | 'edit' | 'gameobject' | 'window') => {
    if (activeMenu && activeMenu !== menu) {
      setActiveMenu(menu)
    }
  }

  const closeMenu = () => setActiveMenu(null)

  return (
    <div className="bg-[#0f3460] border-b border-gray-700/50 select-none">
      {/* Menu Bar */}
      <div ref={menuBarRef} className="flex items-center h-8 px-2 text-sm border-b border-gray-700/30">
        {/* File Menu */}
        <div className="relative">
          <button
            className={`px-3 py-1 rounded transition-colors text-xs font-medium ${
              activeMenu === 'file' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'
            }`}
            onClick={() => toggleMenu('file')}
            onMouseEnter={() => handleMenuHover('file')}
          >
            {t('menu.file')}
          </button>
          {activeMenu === 'file' && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/70 rounded-md shadow-2xl z-50 min-w-56 py-1 backdrop-blur-sm">
              <MenuItem
                label={t('menu.new_project')}
                shortcut={`${mod}+Shift+N`}
                onClick={() => {
                  onNewProject?.()
                  closeMenu()
                }}
              />
              <MenuItem
                label={t('menu.open_project')}
                shortcut={`${mod}+Shift+O`}
                onClick={() => {
                  onOpenProject?.()
                  closeMenu()
                }}
              />
              <SubMenu label={t('menu.recent_projects')}>
                {recentProjects.length > 0 ? (
                  <>
                    {recentProjects.map((proj) => (
                      <MenuItem
                        key={proj.path}
                        label={proj.name}
                        onClick={() => {
                          onOpenRecent?.(proj.path)
                          closeMenu()
                        }}
                      />
                    ))}
                    <MenuDivider />
                    <MenuItem
                      label={t('menu.clear_recent_projects')}
                      onClick={() => {
                        onClearRecent?.()
                        closeMenu()
                      }}
                    />
                  </>
                ) : (
                  <div className="px-3 py-1.5 text-xs text-gray-400 italic">{t('menu.no_recent_projects')}</div>
                )}
              </SubMenu>
              <MenuDivider />
              <MenuItem
                label={t('menu.new_scene')}
                shortcut={`${mod}+N`}
                onClick={() => {
                  onNewScene?.()
                  closeMenu()
                }}
              />
              <MenuItem
                label={t('menu.open_scene')}
                shortcut={`${mod}+O`}
                onClick={() => {
                  onOpenScene?.()
                  closeMenu()
                }}
              />
              <MenuItem
                label={t('menu.save_scene')}
                shortcut={`${mod}+S`}
                onClick={() => {
                  onSaveScene?.()
                  closeMenu()
                }}
              />
              <MenuItem
                label={t('menu.save_scene_as')}
                shortcut={`${mod}+Shift+S`}
                onClick={() => {
                  onSaveSceneAs?.()
                  closeMenu()
                }}
              />
              <MenuDivider />
              <MenuItem
                label={t('menu.project_settings')}
                onClick={() => {
                  onOpenProjectSettings?.()
                  closeMenu()
                }}
              />
              <MenuItem
                label={t('menu.export')}
                shortcut={`${mod}+Shift+E`}
                onClick={() => {
                  onExport?.()
                  closeMenu()
                }}
              />
              <MenuItem
                label={t('menu.close_project')}
                onClick={() => {
                  onCloseProject?.()
                  closeMenu()
                }}
              />
              <MenuDivider />
              <MenuItem
                label={t('menu.exit')}
                shortcut={`${mod}+Q`}
                onClick={() => {
                  if (onExit) onExit()
                  else if (typeof window !== 'undefined' && (window as any).close) (window as any).close()
                  closeMenu()
                }}
              />
            </div>
          )}
        </div>

        {/* Edit Menu */}
        <div className="relative">
          <button
            className={`px-3 py-1 rounded transition-colors text-xs font-medium ${
              activeMenu === 'edit' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'
            }`}
            onClick={() => toggleMenu('edit')}
            onMouseEnter={() => handleMenuHover('edit')}
          >
            {t('menu.edit')}
          </button>
          {activeMenu === 'edit' && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/70 rounded-md shadow-2xl z-50 min-w-44 py-1 backdrop-blur-sm">
              <MenuItem
                label={t('menu.undo')}
                shortcut={`${mod}+Z`}
                onClick={() => {
                  onUndo?.()
                  closeMenu()
                }}
              />
              <MenuItem
                label={t('menu.redo')}
                shortcut={`${mod}+Y`}
                onClick={() => {
                  onRedo?.()
                  closeMenu()
                }}
              />
              <MenuDivider />
              <MenuItem
                label={t('menu.project_settings')}
                onClick={() => {
                  onOpenProjectSettings?.()
                  closeMenu()
                }}
              />
            </div>
          )}
        </div>

        {/* GameObject Menu */}
        <div className="relative">
          <button
            className={`px-3 py-1 rounded transition-colors text-xs font-medium ${
              activeMenu === 'gameobject' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'
            }`}
            onClick={() => toggleMenu('gameobject')}
            onMouseEnter={() => handleMenuHover('gameobject')}
          >
            {t('menu.gameobject')}
          </button>
          {activeMenu === 'gameobject' && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/70 rounded-md shadow-2xl z-50 min-w-44 py-1 backdrop-blur-sm">
              <MenuItem
                label={t('menu.create_empty')}
                onClick={() => {
                  onCreate3DObject?.('Cube') // or trigger create empty
                  closeMenu()
                }}
              />
              <SubMenu label={t('menu.object_3d')}>
                <MenuItem
                  label={t('menu.cube')}
                  onClick={() => {
                    onCreate3DObject?.('Cube')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label={t('menu.sphere')}
                  onClick={() => {
                    onCreate3DObject?.('Sphere')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label={t('menu.capsule')}
                  onClick={() => {
                    onCreate3DObject?.('Capsule')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label={t('menu.cylinder')}
                  onClick={() => {
                    onCreate3DObject?.('Cylinder')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label={t('menu.plane')}
                  onClick={() => {
                    onCreate3DObject?.('Plane')
                    closeMenu()
                  }}
                />
              </SubMenu>
            </div>
          )}
        </div>

        {/* Window / Workspace Menu */}
        <div className="relative">
          <button
            className={`px-3 py-1 rounded transition-colors text-xs font-medium ${
              activeMenu === 'window' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'
            }`}
            onClick={() => toggleMenu('window')}
            onMouseEnter={() => handleMenuHover('window')}
          >
            {t('menu.window')}
          </button>
          {activeMenu === 'window' && (
            <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700/70 rounded-md shadow-2xl z-50 min-w-56 py-1 backdrop-blur-sm">
              <SubMenu label={t('menu.reset_layout')}>
                <MenuItem
                  label="Default Layout"
                  onClick={() => {
                    onApplyWorkspaceLayout?.('default')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label="Console Focus"
                  onClick={() => {
                    onApplyWorkspaceLayout?.('console-focus')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label="Assets Focus"
                  onClick={() => {
                    onApplyWorkspaceLayout?.('assets-focus')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label="Split All (3-Way)"
                  onClick={() => {
                    onApplyWorkspaceLayout?.('split-all')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label="Maximize Viewport"
                  onClick={() => {
                    onApplyWorkspaceLayout?.('viewport-maximized')
                    closeMenu()
                  }}
                />
              </SubMenu>

              <SubMenu label={t('panel.split_all')}>
                <MenuItem
                  label={t('panel.project')}
                  active={activeBottomTab === 'project'}
                  icon={<Icons.Folder className="w-3.5 h-3.5 text-blue-400" />}
                  onClick={() => {
                    onSelectBottomTab?.('project')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label={t('panel.assets')}
                  active={activeBottomTab === 'assets'}
                  icon={<Icons.Box className="w-3.5 h-3.5 text-amber-400" />}
                  onClick={() => {
                    onSelectBottomTab?.('assets')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label={t('panel.console')}
                  active={activeBottomTab === 'console'}
                  icon={<Icons.Terminal className="w-3.5 h-3.5 text-emerald-400" />}
                  onClick={() => {
                    onSelectBottomTab?.('console')
                    closeMenu()
                  }}
                />
                <MenuItem
                  label={t('panel.output')}
                  active={activeBottomTab === 'output'}
                  icon={<Icons.FileCode className="w-3.5 h-3.5 text-indigo-400" />}
                  onClick={() => {
                    onSelectBottomTab?.('output')
                    closeMenu()
                  }}
                />
                <MenuDivider />
                <MenuItem
                  label={t('panel.split_all')}
                  shortcut={`${mod}+\``}
                  onClick={() => {
                    onToggleBottomPanel?.()
                    closeMenu()
                  }}
                />
              </SubMenu>

              <MenuDivider />

              <MenuItem
                label={t('panel.bridge')}
                icon={<Icons.Bridge className="w-3.5 h-3.5 text-indigo-400" />}
                onClick={() => {
                  onOpenBridge?.()
                  closeMenu()
                }}
              />
              <MenuDivider />
              <MenuItem
                label={t('menu.input_actions')}
                onClick={() => {
                  onOpenInputActions?.()
                  closeMenu()
                }}
              />
              <MenuItem
                label={t('menu.project_settings')}
                onClick={() => {
                  onOpenProjectSettings?.()
                  closeMenu()
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
            title={t('toolbar.open_agent')}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse shrink-0" />
            <span className="truncate">{t('toolbar.agent_status', { activity: agentActivity })}</span>
          </button>
        )}

        {/* Right-side primary entry: the Agent panel is a first-class surface, not a menu item */}
        <button
          onClick={onOpenAgent}
          className="mr-2 flex items-center gap-1.5 rounded-md border border-indigo-400/40 bg-indigo-500/15 px-2.5 py-1 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/25"
          title={t('toolbar.open_agent')}
        >
          <Icons.Sparkles className="h-3.5 w-3.5 text-indigo-300" />
          <span>{t('panel.agent')}</span>
          {agentPendingDiffs > 0 && (
            <span className="ml-0.5 rounded-full bg-amber-500 px-1.5 text-[9px] font-bold leading-4 text-black">
              {agentPendingDiffs}
            </span>
          )}
        </button>

        {/* Language Selector */}
        <div className="mr-3 flex items-center gap-1.5">
          <span className="text-[11px] text-gray-400">🌐</span>
          <select
            value={activeLocale}
            onChange={(e) => {
              setLocale(e.target.value as EditorLocale)
            }}
            className="bg-black/40 hover:bg-black/60 border border-gray-700/60 rounded px-1.5 py-0.5 text-[11px] text-gray-300 focus:outline-none focus:border-blue-500 cursor-pointer"
            title={t('toolbar.language_select')}
          >
            {EDITOR_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeName}
              </option>
            ))}
          </select>
        </div>

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
          <ToolButton icon="↔" title={t('toolbar.move_tool')} active />
          <ToolButton icon="↻" title={t('toolbar.rotate_tool')} />
          <ToolButton icon="⤢" title={t('toolbar.scale_tool')} />
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
            <span>{isPlaying ? t('toolbar.playing') : t('toolbar.play')}</span>
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
            title={`${t('toolbar.pause')} (${mod}+Shift+P)`}
          >
            ⏸
          </button>

          <button
            onClick={onStep}
            disabled={!isPlaying}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              isPlaying ? 'hover:bg-white/10 text-gray-200' : 'opacity-40 cursor-not-allowed text-gray-500'
            }`}
            title={`${t('toolbar.step')} (${mod}+Alt+P)`}
          >
            ⏭
          </button>
        </div>

        <div className="flex-1" />
      </div>
    </div>
  )
}

const MenuItem: React.FC<{
  label: string
  shortcut?: string
  icon?: React.ReactNode
  active?: boolean
  onClick?: () => void
}> = ({ label, shortcut, icon, active, onClick }) => (
  <button
    className={`w-full px-3 py-1.5 text-left hover:bg-blue-600/50 flex items-center justify-between text-xs transition-colors ${
      active ? 'bg-blue-600/30 text-white font-medium' : 'text-gray-200'
    }`}
    onClick={onClick}
  >
    <span className="flex items-center gap-2">
      {icon && <span className="opacity-80 shrink-0">{icon}</span>}
      <span>{label}</span>
    </span>
    {shortcut && (
      <span className="text-[10px] text-gray-400 font-mono ml-4 px-1 py-0.5 rounded bg-black/30 border border-gray-700/50">
        {shortcut}
      </span>
    )}
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
