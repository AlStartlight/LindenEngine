/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getVersion: () => Promise<string>
    getProjectPath: () => Promise<string>
    getUserDataPath: () => Promise<string>
    /** Files under the open project's assets/ (Asset Browser, Scene settings) */
    listAssets?: () => Promise<import('../shared/assetProtocol').AssetEntry[]>
    saveProjectGraphics?: (opts: { projectPath: string; quality?: string; renderer?: string }) => Promise<{ status: string; message?: string }>
    setWindowTitle?: (title: string) => Promise<void>
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
    detectGodot?: (customPath?: string) => Promise<string | null>
    buildGodot?: (options: any) => Promise<any>
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
    // Godot Bridge operations
    bridgeValidateGodot?: (path?: string) => Promise<{ ok: boolean; path?: string; version?: string; reason?: string }>
    bridgeDetectGodotProject?: (dir: string) => Promise<any>
    bridgeRunImport?: (options: any) => Promise<any>
    bridgeCancelImport?: (jobId: string) => Promise<any>
    bridgeImportScene?: (opts?: { tscnPath?: string }) => Promise<any>
    bridgeStartSync?: (opts?: { port?: number }) => Promise<any>
    bridgeStopSync?: () => Promise<any>
    bridgeGetSyncStatus?: () => Promise<{ isRunning: boolean; port: number; clientCount: number }>
    bridgeSendSync?: (data: any) => Promise<any>
    onBridgeImportProgress?: (callback: (data: any) => void) => () => void
    onBridgeImportLog?: (callback: (data: { jobId: string; line: string }) => void) => () => void
    onBridgeSyncMessage?: (callback: (data: any) => void) => () => void
    onMenuImportGodotProject?: (callback: () => void) => () => void
  }
}
