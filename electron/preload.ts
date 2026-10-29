import { contextBridge, ipcRenderer } from 'electron'
import type { IpcInvokeChannel } from '../shared/ipcChannels'

function invoke(channel: IpcInvokeChannel, ...args: any[]) {
  return ipcRenderer.invoke(channel, ...args)
}

/**
 * Expose APIs to renderer process
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // App management
  getVersion: () => invoke('app:getVersion'),
  getProjectPath: () => invoke('app:getProjectPath'),
  listAssets: () => invoke('assets:list'),
  getUserDataPath: () => invoke('app:getUserDataPath'),
  setWindowTitle: (title: string) => invoke('window:setTitle', title),
  getIpcChannels: () => invoke('app:ipcChannels'),
  relaunchApp: () => invoke('app:relaunch'),

  // File operations
  saveFile: (data: any) => invoke('file:save', data),
  loadFile: (path: string) => invoke('file:load', path),
  openSceneDialog: (opts?: { defaultDir?: string }) => invoke('scene:open', opts),
  saveSceneDialog: (opts?: { defaultPath?: string; content?: string }) =>
    invoke('scene:save', opts),
  pickSceneSavePath: (opts?: { defaultPath?: string }) => invoke('scene:pickSavePath', opts),
  writeSceneFile: (opts: { path: string; content: string }) => invoke('scene:write', opts),

  // Project operations
  createProject: (opts: any) => invoke('project:create', opts),
  openProject: (opts?: any) => invoke('project:open', opts),
  saveProjectSettings: (opts: any) => invoke('project:saveSettings', opts),
  saveProjectInput: (opts: { projectPath: string; input: { actions?: unknown[]; touch?: unknown } }) => invoke('project:saveInput', opts),
  saveProjectGraphics: (opts: { projectPath: string; quality?: string; renderer?: string }) => invoke('project:saveGraphics', opts),
  getRecentProjects: () => invoke('project:recent:list'),
  addRecentProject: (project: any) => invoke('project:recent:add', project),
  removeRecentProject: (path: string) => invoke('project:recent:remove', path),
  clearRecentProjects: () => invoke('project:recent:clear'),

  // Dialog & Shell operations
  showOpenDialog: (opts: any) => invoke('dialog:showOpenDialog', opts),
  showItemInFolder: (filePath: string) => invoke('shell:showItemInFolder', filePath),

  // Menu events
  onMenuNewProject: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('menu:newProject', sub)
    return () => ipcRenderer.removeListener('menu:newProject', sub)
  },
  onMenuOpenProject: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('menu:openProject', sub)
    return () => ipcRenderer.removeListener('menu:openProject', sub)
  },
  onMenuOpenRecent: (callback: (path: string) => void) => {
    const sub = (_: any, path: string) => callback(path)
    ipcRenderer.on('menu:openRecent', sub)
    return () => ipcRenderer.removeListener('menu:openRecent', sub)
  },
  onMenuCloseProject: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('menu:closeProject', sub)
    return () => ipcRenderer.removeListener('menu:closeProject', sub)
  },
  onMenuExport: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('menu:export', sub)
    return () => ipcRenderer.removeListener('menu:export', sub)
  },
  onMenuNewScene: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on('menu:newScene', subscription)
    return () => {
      ipcRenderer.removeListener('menu:newScene', subscription)
    }
  },
  onMenuOpenScene: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on('menu:openScene', subscription)
    return () => {
      ipcRenderer.removeListener('menu:openScene', subscription)
    }
  },
  onMenuSaveScene: (callback: Function) => {
    const subscription = () => callback()
    ipcRenderer.on('menu:saveScene', subscription)
    return () => {
      ipcRenderer.removeListener('menu:saveScene', subscription)
    }
  },
  onMenuSaveSceneAs: (callback: Function) => {
    const subscription = () => callback()
    ipcRenderer.on('menu:saveSceneAs', subscription)
    return () => {
      ipcRenderer.removeListener('menu:saveSceneAs', subscription)
    }
  },
  onMenuBuild: (callback: Function) => ipcRenderer.on('menu:build', () => callback()),
  onMenuAbout: (callback: Function) => ipcRenderer.on('menu:about', () => callback()),
  onMenuProjectSettings: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('menu:projectSettings', sub)
    return () => ipcRenderer.removeListener('menu:projectSettings', sub)
  },
  onMenuOpenBridge: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('menu:openBridge', sub)
    return () => ipcRenderer.removeListener('menu:openBridge', sub)
  },
  onMenuInputActions: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('menu:inputActions', sub)
    return () => ipcRenderer.removeListener('menu:inputActions', sub)
  },

  // Build & Export operations
  buildExport: (options: any) => invoke('build:export', options),
  runExport: (options: any) => invoke('export:run', options),
  runWebExport: (options: any) => invoke('export:web:run', options),
  serveWebBuild: (buildDir: string) => invoke('export:web:serve', { buildDir }),
  detectGodot: (customPath?: string) => invoke('godot:detect', customPath),
  buildGodot: (options: any) => invoke('godot:build', options),
  onExportLog: (callback: (data: { presetId: string; log: string }) => void) => {
    const sub = (_: any, data: any) => callback(data)
    ipcRenderer.on('export:log', sub)
    return () => ipcRenderer.removeListener('export:log', sub)
  },
  onExportProgress: (callback: (data: any) => void) => {
    const sub = (_: any, data: any) => callback(data)
    ipcRenderer.on('export:progress', sub)
    return () => ipcRenderer.removeListener('export:progress', sub)
  },

  // Agent operations
  agentGetStatus: () => invoke('agent:status'),
  agentStart: (projectPath: string) => invoke('agent:start', projectPath),
  agentStop: () => invoke('agent:stop'),
  agentGetProviders: () => invoke('agent:providers'),
  agentSetModel: (providerId: string, modelId: string) =>
    invoke('agent:setModel', { providerId, modelId }),
  agentListSessions: () => invoke('agent:session:list'),
  agentCreateSession: (title?: string) => invoke('agent:session:create', title),
  agentDeleteSession: (sessionId: string) => invoke('agent:session:delete', sessionId),
  agentSubmitPrompt: (options: any) => invoke('agent:prompt', options),
  agentAbortPrompt: (sessionId: string) => invoke('agent:abort', sessionId),
  agentReplyPermission: (requestId: string, allow: boolean) =>
    invoke('agent:permission:reply', { requestId, allow }),
  agentApplyDiff: (diffId: string) => invoke('agent:diff:apply', diffId),
  agentRejectDiff: (diffId: string) => invoke('agent:diff:reject', diffId),
  agentGetTemplates: () => invoke('agent:templates'),
  agentGetSessionTurns: (sessionId: string) => invoke('agent:session:turns', sessionId),
  agentGetTurnSnapshot: (sessionId: string) => invoke('agent:turn:snapshot', sessionId),
  onAgentEvent: (callback: (event: any) => void) => {
    const sub = (_: any, data: any) => callback(data)
    ipcRenderer.on('agent:event', sub)
    return () => ipcRenderer.removeListener('agent:event', sub)
  },

  // Play in viewport (Game Frame)
  playStart: (opts: { projectPath: string }) => invoke('play:start', opts),
  playStop: (sessionId: string) => invoke('play:stop', sessionId),
  playOpenDevTools: () => invoke('play:openDevTools'),
  playReadUiFragment: (opts: { projectPath: string; src: string }) => invoke('play:readUiFragment', opts),
  onPlayFileChanged: (callback: (data: import('../shared/playProtocol').PlayFileChange) => void) => {
    const sub = (_: any, data: any) => callback(data)
    ipcRenderer.on('play:fileChanged', sub)
    return () => ipcRenderer.removeListener('play:fileChanged', sub)
  },

  // System operations
  openExternal: (url: string) => invoke('shell:openExternal', url),
  getSystemInfo: () => invoke('system:getInfo'),

  // Godot Bridge operations
  bridgeValidateGodot: (customPath?: string) => invoke('bridge:godot:validate', customPath),
  bridgeDetectGodotProject: (dir: string) => invoke('bridge:import:detect', dir),
  bridgeRunImport: (options: any) => invoke('bridge:import:run', options),
  bridgeCancelImport: (jobId: string) => invoke('bridge:import:cancel', jobId),
  bridgeImportScene: (opts?: { tscnPath?: string }) => invoke('bridge:scene:import', opts),
  bridgeStartSync: (opts?: { port?: number }) => invoke('bridge:sync:start', opts),
  bridgeStopSync: () => invoke('bridge:sync:stop'),
  bridgeGetSyncStatus: () => invoke('bridge:sync:status'),
  bridgeSendSync: (data: any) => invoke('bridge:sync:send', data),
  onBridgeImportProgress: (callback: (data: any) => void) => {
    const sub = (_: any, data: any) => callback(data)
    ipcRenderer.on('bridge:import:progress', sub)
    return () => ipcRenderer.removeListener('bridge:import:progress', sub)
  },
  onBridgeImportLog: (callback: (data: { jobId: string; line: string }) => void) => {
    const sub = (_: any, data: any) => callback(data)
    ipcRenderer.on('bridge:import:log', sub)
    return () => ipcRenderer.removeListener('bridge:import:log', sub)
  },
  onBridgeSyncMessage: (callback: (data: any) => void) => {
    const sub = (_: any, data: any) => callback(data)
    ipcRenderer.on('bridge:sync:message', sub)
    return () => ipcRenderer.removeListener('bridge:sync:message', sub)
  },
  onMenuImportGodotProject: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('menu:importGodotProject', sub)
    return () => ipcRenderer.removeListener('menu:importGodotProject', sub)
  },

  // Development
  onDevScriptsReloaded: (callback: Function) => ipcRenderer.on('dev:scriptsReloaded', () => callback()),
})

/**
 * Type definitions untuk TypeScript
 */
declare global {
  interface Window {
    electronAPI: {
      getVersion: () => Promise<string>
      getProjectPath: () => Promise<string>
      listAssets?: () => Promise<import('../shared/assetProtocol').AssetEntry[]>
      getUserDataPath: () => Promise<string>
      setWindowTitle: (title: string) => Promise<void>
      getIpcChannels?: () => Promise<string[]>
      relaunchApp?: () => Promise<void>
      saveFile: (data: any) => Promise<any>
      loadFile: (path: string) => Promise<any>
      openSceneDialog: (opts?: { defaultDir?: string }) => Promise<{
        status: 'canceled' | 'ok' | 'error'
        path?: string
        fileName?: string
        content?: string
        code?: string
        message?: string
      }>
      saveSceneDialog?: (opts?: { defaultPath?: string; content?: string }) => Promise<{
        status: 'canceled' | 'ok' | 'error'
        path?: string
        message?: string
      }>
      pickSceneSavePath?: (opts?: { defaultPath?: string }) => Promise<{
        status: 'canceled' | 'ok' | 'error'
        path?: string
        message?: string
      }>
      writeSceneFile?: (opts: { path: string; content: string }) => Promise<{
        status: 'ok' | 'error'
        message?: string
      }>
      createProject?: (opts: any) => Promise<any>
      openProject?: (opts?: any) => Promise<any>
      saveProjectSettings?: (opts: any) => Promise<any>
      saveProjectInput?: (opts: { projectPath: string; input: { actions?: unknown[]; touch?: unknown } }) => Promise<{ status: 'ok' | 'error'; message?: string }>
      getRecentProjects?: () => Promise<any[]>
      addRecentProject?: (project: any) => Promise<any>
      removeRecentProject?: (path: string) => Promise<any>
      clearRecentProjects?: () => Promise<any>
      showOpenDialog?: (opts: any) => Promise<any>
      showItemInFolder?: (filePath: string) => Promise<any>
      onMenuNewProject?: (callback: () => void) => () => void
      onMenuOpenProject?: (callback: () => void) => () => void
      onMenuOpenRecent?: (callback: (path: string) => void) => () => void
      onMenuCloseProject?: (callback: () => void) => () => void
      onMenuExport?: (callback: () => void) => () => void
      onMenuNewScene: (callback: () => void) => () => void
      onMenuOpenScene: (callback: () => void) => () => void
      onMenuSaveScene: (callback: Function) => () => void
      onMenuSaveSceneAs: (callback: Function) => () => void
      onMenuBuild: (callback: Function) => void
      onMenuAbout: (callback: Function) => void
      onMenuProjectSettings?: (callback: () => void) => () => void
      onMenuOpenBridge?: (callback: () => void) => () => void
      onMenuInputActions?: (callback: () => void) => () => void
      buildExport: (options: any) => Promise<any>
      runExport?: (options: any) => Promise<any>
      runWebExport?: (options: any) => Promise<any>
      serveWebBuild?: (buildDir: string) => Promise<string>
      detectGodot: (customPath?: string) => Promise<string | null>
      buildGodot: (options: any) => Promise<any>
      onExportLog?: (callback: (data: { presetId: string; log: string }) => void) => () => void
      onExportProgress?: (callback: (data: any) => void) => () => void
      agentGetStatus?: () => Promise<any>
      agentStart?: (projectPath: string) => Promise<any>
      agentStop?: () => Promise<any>
      agentGetProviders?: () => Promise<any[]>
      agentSetModel?: (providerId: string, modelId: string) => Promise<any>
      agentListSessions?: () => Promise<any[]>
      agentCreateSession?: (title?: string) => Promise<any>
      agentDeleteSession?: (sessionId: string) => Promise<boolean>
      agentSubmitPrompt?: (options: any) => Promise<{ messageId: string }>
      agentAbortPrompt?: (sessionId: string) => Promise<boolean>
      agentReplyPermission?: (requestId: string, allow: boolean) => Promise<any>
      agentApplyDiff?: (diffId: string) => Promise<boolean>
      agentRejectDiff?: (diffId: string) => Promise<boolean>
      agentGetTemplates?: () => Promise<any[]>
      agentGetSessionTurns?: (sessionId: string) => Promise<any[]>
      agentGetTurnSnapshot?: (sessionId: string) => Promise<any | null>
      onAgentEvent?: (callback: (event: any) => void) => () => void
      playStart?: (opts: { projectPath: string }) => Promise<import('../shared/playProtocol').PlayStartResult>
      playStop?: (sessionId: string) => Promise<boolean>
      playOpenDevTools?: () => Promise<boolean>
      playReadUiFragment?: (opts: { projectPath: string; src: string }) => Promise<{ status: 'ok' | 'error'; html?: string; message?: string }>
      onPlayFileChanged?: (callback: (data: import('../shared/playProtocol').PlayFileChange) => void) => () => void
      openExternal: (url: string) => Promise<void>
      getSystemInfo: () => Promise<any>
      onDevScriptsReloaded: (callback: Function) => void
    }
  }
}
