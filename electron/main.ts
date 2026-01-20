import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'

// Check if in development mode
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

/**
 * Create main application window
 */
function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: join(__dirname, '../public/icon.png'),
  })

  const startUrl = isDev ? 'http://localhost:5173' : `file://${join(__dirname, '../dist/index.html')}`

  mainWindow.loadURL(startUrl)

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  return mainWindow
}

/**
 * App initialization
 */
app.on('ready', () => {
  mainWindow = createWindow()
  setupMenu()
})

/**
 * Quit app when all windows are closed
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * Re-create window on macOS
 */
app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = createWindow()
  }
})

/**
 * Setup application menu
 */
function setupMenu(): void {
  const template: any[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Scene',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.send('menu:newScene')
          },
        },
        {
          label: 'Open Scene',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow?.webContents.send('menu:openScene')
          },
        },
        {
          label: 'Save Scene',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow?.webContents.send('menu:saveScene')
          },
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            mainWindow?.webContents.send('menu:saveSceneAs')
          },
        },
        { type: 'separator' },
        {
          label: 'Build Project',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            mainWindow?.webContents.send('menu:build')
          },
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit()
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'F5', role: 'reload' },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: 'Toggle DevTools', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Linden Engine',
          click: () => {
            mainWindow?.webContents.send('menu:about')
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/**
 * IPC Handlers
 */

// Get app version
ipcMain.handle('app:getVersion', () => {
  return app.getVersion()
})

// Save file
ipcMain.handle('file:save', async (_event, data) => {
  console.log('[IPC] File save requested:', data)
  return { success: true, path: data.path }
})

// Load file
ipcMain.handle('file:load', async (_event, path) => {
  console.log('[IPC] File load requested:', path)
  return { success: true, data: null }
})

// Get project path
ipcMain.handle('app:getProjectPath', () => {
  return app.getPath('documents')
})

// Get user data path
ipcMain.handle('app:getUserDataPath', () => {
  return app.getPath('userData')
})

// Build project
ipcMain.handle('build:export', async (_event, options) => {
  console.log('[IPC] Build export requested:', options)
  return { success: true, outputPath: '' }
})

// Open external link
ipcMain.handle('shell:openExternal', async (_event, url) => {
  const { shell } = await import('electron')
  await shell.openExternal(url)
})

// Get system info
ipcMain.handle('system:getInfo', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    cpuCount: require('os').cpus().length,
    totalMemory: require('os').totalmem(),
    freeMemory: require('os').freemem(),
  }
})

// Development helpers
if (isDev) {
  ipcMain.handle('dev:reloadScripts', async () => {
    mainWindow?.webContents.send('dev:scriptsReloaded')
  })
}
