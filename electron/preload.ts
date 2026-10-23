import { contextBridge, ipcRenderer } from 'electron'

/**
 * Expose APIs to renderer process
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // App management
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getProjectPath: () => ipcRenderer.invoke('app:getProjectPath'),
  getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),

  // File operations
  saveFile: (data: any) => ipcRenderer.invoke('file:save', data),
  loadFile: (path: string) => ipcRenderer.invoke('file:load', path),
  openSceneDialog: (opts?: { defaultDir?: string }) => ipcRenderer.invoke('scene:open', opts),
  saveSceneDialog: (opts?: { defaultPath?: string; content?: string }) =>
    ipcRenderer.invoke('scene:save', opts),

  // Menu events
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

  // Build operations
  buildExport: (options: any) => ipcRenderer.invoke('build:export', options),
  detectGodot: (customPath?: string) => ipcRenderer.invoke('godot:detect', customPath),
  buildGodot: (options: any) => ipcRenderer.invoke('godot:build', options),

  // System operations
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),

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
      detectGodot: (customPath?: string) => Promise<string | null>
      buildGodot: (options: any) => Promise<any>
      openExternal: (url: string) => Promise<void>
      getSystemInfo: () => Promise<any>
      onDevScriptsReloaded: (callback: Function) => void
    }
  }
}
