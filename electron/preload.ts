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

  // Menu events
  onMenuNewScene: (callback: Function) => ipcRenderer.on('menu:newScene', () => callback()),
  onMenuOpenScene: (callback: Function) => ipcRenderer.on('menu:openScene', () => callback()),
  onMenuSaveScene: (callback: Function) => ipcRenderer.on('menu:saveScene', () => callback()),
  onMenuSaveSceneAs: (callback: Function) => ipcRenderer.on('menu:saveSceneAs', () => callback()),
  onMenuBuild: (callback: Function) => ipcRenderer.on('menu:build', () => callback()),
  onMenuAbout: (callback: Function) => ipcRenderer.on('menu:about', () => callback()),

  // Build operations
  buildExport: (options: any) => ipcRenderer.invoke('build:export', options),

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
      onMenuNewScene: (callback: Function) => void
      onMenuOpenScene: (callback: Function) => void
      onMenuSaveScene: (callback: Function) => void
      onMenuSaveSceneAs: (callback: Function) => void
      onMenuBuild: (callback: Function) => void
      onMenuAbout: (callback: Function) => void
      buildExport: (options: any) => Promise<any>
      openExternal: (url: string) => Promise<void>
      getSystemInfo: () => Promise<any>
      onDevScriptsReloaded: (callback: Function) => void
    }
  }
}
