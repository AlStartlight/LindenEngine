import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { basename, join } from 'path'
import { stat, readFile, writeFile } from 'fs/promises'

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

// Open scene dialog and read file
type OpenSceneResult =
  | { status: 'canceled' }
  | { status: 'ok'; path: string; fileName: string; content: string }
  | { status: 'error'; code: 'FILE_TOO_LARGE' | 'READ_FAILED'; fileName?: string; message: string }

ipcMain.handle('scene:open', async (_event, opts?: { defaultDir?: string }): Promise<OpenSceneResult> => {
  if (!mainWindow) return { status: 'canceled' }
  const defaultPath = opts?.defaultDir || app.getPath('documents')
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Scene',
    defaultPath,
    filters: [{ name: 'Linden Scene', extensions: ['lscene'] }],
    properties: ['openFile'],
  })

  if (res.canceled || res.filePaths.length === 0) {
    return { status: 'canceled' }
  }

  const filePath = res.filePaths[0]
  const fileName = basename(filePath)
  try {
    const fileStat = await stat(filePath)
    if (fileStat.size > 50 * 1024 * 1024) {
      return {
        status: 'error',
        code: 'FILE_TOO_LARGE',
        fileName,
        message: 'File lebih dari 50 MB.',
      }
    }
    const content = await readFile(filePath, 'utf-8')
    return {
      status: 'ok',
      path: filePath,
      fileName,
      content,
    }
  } catch (err: any) {
    return {
      status: 'error',
      code: 'READ_FAILED',
      fileName,
      message: `File tidak bisa dibaca: ${err?.message || String(err)}`,
    }
  }
})

// Save scene dialog and write file
type SaveSceneResult =
  | { status: 'canceled' }
  | { status: 'ok'; path: string }
  | { status: 'error'; message: string }

ipcMain.handle(
  'scene:save',
  async (_event, opts?: { defaultPath?: string; content?: string }): Promise<SaveSceneResult> => {
    if (!mainWindow) return { status: 'canceled' }
    try {
      const defaultPath = opts?.defaultPath || join(app.getPath('documents'), 'Scene.lscene')
      const res = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Scene',
        defaultPath,
        filters: [{ name: 'Linden Scene', extensions: ['lscene'] }],
      })

      if (res.canceled || !res.filePath) {
        return { status: 'canceled' }
      }

      await writeFile(res.filePath, opts?.content ?? '', 'utf-8')
      return { status: 'ok', path: res.filePath }
    } catch (err: any) {
      return { status: 'error', message: err?.message || String(err) }
    }
  }
)

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

// Detect Godot executable
function findSystemGodot(customPath?: string): string | null {
  const fs = require('fs')
  const path = require('path')

  if (customPath && fs.existsSync(customPath)) {
    return customPath
  }

  const platform = process.platform
  const candidatePaths: string[] = []

  if (platform === 'darwin') {
    candidatePaths.push(
      '/Applications/Godot.app/Contents/MacOS/Godot',
      '/Applications/Godot 4.app/Contents/MacOS/Godot',
      '/Applications/Godot_mono.app/Contents/MacOS/Godot',
      `${process.env.HOME || ''}/Applications/Godot.app/Contents/MacOS/Godot`
    )
  } else if (platform === 'win32') {
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    candidatePaths.push(
      `${progFiles}\\Godot\\Godot.exe`,
      `${progFiles}\\Godot 4\\Godot.exe`
    )
  } else {
    candidatePaths.push(
      '/usr/bin/godot',
      '/usr/local/bin/godot',
      '/usr/bin/godot4',
      '/usr/local/bin/godot4',
      '/snap/bin/godot'
    )
  }

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p
    }
  }

  const envPath = process.env.PATH || ''
  const delimiter = path.delimiter || ':'
  const pathDirs = envPath.split(delimiter)
  const binNames = platform === 'win32' ? ['godot.exe', 'godot4.exe'] : ['godot', 'godot4']

  for (const dir of pathDirs) {
    for (const bin of binNames) {
      const full = path.join(dir, bin)
      if (fs.existsSync(full)) {
        return full
      }
    }
  }

  return null
}

ipcMain.handle('godot:detect', (_event, customPath?: string) => {
  return findSystemGodot(customPath)
})

// Godot Headless Build
ipcMain.handle(
  'godot:build',
  async (
    _event,
    opts: { preset: string; projectPath: string; outputPath: string; customExecutable?: string }
  ) => {
    const { spawn } = require('child_process')
    const fs = require('fs')
    const path = require('path')

    const startTime = Date.now()
    const logs: string[] = []
    const execPath = findSystemGodot(opts.customExecutable)

    if (!execPath) {
      const err =
        'Godot executable not found. Please install Godot 4.3+ or configure executable path.'
      return {
        success: false,
        outputPath: opts.outputPath,
        logs: [err],
        durationMs: 0,
        exitCode: -1,
        error: err,
      }
    }

    const outDir = path.dirname(opts.outputPath)
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true })
    }

    const args = [
      '--headless',
      '--path',
      opts.projectPath,
      '--export-release',
      opts.preset,
      opts.outputPath,
    ]

    return new Promise((resolve) => {
      const child = spawn(execPath, args)
      child.stdout.on('data', (chunk: any) => {
        const lines = chunk.toString().split('\n')
        for (const line of lines) {
          if (line.trim()) logs.push(line)
        }
      })
      child.stderr.on('data', (chunk: any) => {
        const lines = chunk.toString().split('\n')
        for (const line of lines) {
          if (line.trim()) logs.push(`[stderr] ${line}`)
        }
      })
      child.on('close', (code: number) => {
        resolve({
          success: code === 0,
          outputPath: opts.outputPath,
          logs,
          durationMs: Date.now() - startTime,
          exitCode: code ?? -1,
          error: code === 0 ? undefined : `Build failed with exit code ${code}`,
        })
      })
      child.on('error', (err: any) => {
        resolve({
          success: false,
          outputPath: opts.outputPath,
          logs: [...logs, err.message],
          durationMs: Date.now() - startTime,
          exitCode: -1,
          error: err.message,
        })
      })
    })
  }
)

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
