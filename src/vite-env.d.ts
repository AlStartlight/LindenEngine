/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getVersion: () => Promise<string>
    getProjectPath: () => Promise<string>
    getUserDataPath: () => Promise<string>
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
    detectGodot?: (customPath?: string) => Promise<string | null>
    buildGodot?: (options: any) => Promise<any>
    onExportLog?: (callback: (data: { presetId: string; log: string }) => void) => () => void
    onExportProgress?: (callback: (data: any) => void) => () => void
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
