/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getVersion: () => Promise<string>
    getProjectPath: () => Promise<string>
    getUserDataPath: () => Promise<string>
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
    onMenuNewScene: (callback: () => void) => () => void
    onMenuOpenScene: (callback: () => void) => () => void
    onMenuSaveScene: (callback: Function) => () => void
    onMenuSaveSceneAs: (callback: Function) => () => void
    onMenuBuild: (callback: Function) => void
    onMenuAbout: (callback: Function) => void
    buildExport: (options: any) => Promise<any>
    detectGodot?: (customPath?: string) => Promise<string | null>
    buildGodot?: (options: any) => Promise<any>
    openExternal: (url: string) => Promise<void>
    getSystemInfo: () => Promise<any>
    onDevScriptsReloaded: (callback: Function) => void
  }
}
