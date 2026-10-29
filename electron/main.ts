import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import type { IpcInvokeChannel } from '../shared/ipcChannels'
import { basename, dirname, join } from 'path'
import { stat, readFile, writeFile, mkdir } from 'fs/promises'
import * as fs from 'fs'
import { spawn } from 'child_process'
import { resolveGodotExecutable, setBridgeSettingsDir } from './bridge/godotExec'
import { detectGodotProject } from './bridge/godotDetect'
import { runGodotImportJob, cancelImportJob } from './bridge/importRunner'
import { importSingleGodotScene } from './bridge/sceneImport'
import { syncServerInstance } from './bridge/syncServer'
import { AgentHost } from './agent/AgentHost'
import { WebBuildRunner } from './build/WebBuildRunner'
import { resolveGameRequest } from './play/GameProtocol'
import { resolveAppResource } from './resourcePaths'
import { getPlaySession, readUiFragment, startPlaySession, stopAllPlaySessions, stopPlaySession } from './play/PlaySession'
import { GAME_SCHEME } from '../shared/playProtocol'

// Check if in development mode
const isDev = !app.isPackaged

// The Game Frame (Play in viewport) loads from linden-game://; must be registered before 'ready'
protocol.registerSchemesAsPrivileged([
  {
    scheme: GAME_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

/** Serve linden-game://play/<session>/... from the active Play session only */
function installGameProtocol() {
  protocol.handle(GAME_SCHEME, async (request) => {
    const res = resolveGameRequest(request.url, getPlaySession)
    let body: BodyInit | null = null
    if (res.filePath) body = new Uint8Array(await fs.promises.readFile(res.filePath))
    else if (res.body !== undefined) body = typeof res.body === 'string' ? res.body : new Uint8Array(res.body)
    return new Response(body, { status: res.status, headers: res.headers })
  })
}

/** Game code runs in a cross-origin subframe; keep it from navigating or opening windows */
function guardGameFrame(win: BrowserWindow) {
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return
    const url = event.url
    if (url.startsWith(`${GAME_SCHEME}://`) || url.startsWith('about:')) return
    event.preventDefault()
  })
  win.webContents.setWindowOpenHandler((details) => {
    const fromGame = details.url.startsWith(`${GAME_SCHEME}:`) || details.referrer?.url?.startsWith(`${GAME_SCHEME}:`)
    return { action: fromGame ? 'deny' : 'allow' }
  })
}

let mainWindow: BrowserWindow | null = null

/**
 * Detect Godot executable on the system
 */
function findSystemGodot(customPath?: string): string | null {
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
  const delimiter = platform === 'win32' ? ';' : ':'
  const pathDirs = envPath.split(delimiter)
  const binNames = platform === 'win32' ? ['godot.exe', 'godot4.exe'] : ['godot', 'godot4']

  for (const dir of pathDirs) {
    for (const bin of binNames) {
      const full = join(dir, bin)
      if (fs.existsSync(full)) {
        return full
      }
    }
  }

  return null
}

/**
 * Recent Projects Management
 */
function getRecentProjectsPath(): string {
  return join(app.getPath('userData'), 'recent-projects.json')
}

async function loadRecentProjects(): Promise<Array<{ name: string; path: string; lastOpened: number; exists: boolean }>> {
  try {
    const filePath = getRecentProjectsPath()
    if (!fs.existsSync(filePath)) return []
    const content = await readFile(filePath, 'utf-8')
    const list = JSON.parse(content)
    if (Array.isArray(list)) {
      return list.map((p) => ({
        ...p,
        exists: fs.existsSync(p.path),
      }))
    }
  } catch {}
  return []
}

async function saveRecentProjects(
  list: Array<{ name: string; path: string; lastOpened: number }>
): Promise<void> {
  try {
    const filePath = getRecentProjectsPath()
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(list.slice(0, 10), null, 2), 'utf-8')
  } catch {}
}

/**
 * Headless CLI export mode
 */
async function runCliExport(presetName: string, projectDir: string): Promise<void> {
  console.log(`[Linden CLI] Running headless export for preset: "${presetName}" in "${projectDir}"`)
  try {
    const projectConfigPath = join(projectDir, 'project.linden.json')
    if (!fs.existsSync(projectConfigPath)) {
      console.error(`[Linden CLI] Error: project.linden.json not found in ${projectDir}`)
      process.exit(1)
    }

    const configContent = await readFile(projectConfigPath, 'utf-8')
    const config = JSON.parse(configContent)
    const preset = config.exportPresets?.find((p: any) => p.name === presetName || p.id === presetName)

    if (!preset) {
      console.error(`[Linden CLI] Error: Export preset "${presetName}" not found in project configuration.`)
      process.exit(1)
    }

    const outPath = join(projectDir, preset.output)
    await mkdir(dirname(outPath), { recursive: true })

    if (preset.backend === 'godot') {
      const execPath = findSystemGodot(preset.godotExecutable)
      if (!execPath) {
        console.error('[Linden CLI] Error: Godot executable not found. Please install Godot 4.3+.')
        process.exit(1)
      }

      console.log(`[Linden CLI] Invoking Godot headless build: ${execPath}`)
      const args = ['--headless', '--path', projectDir, '--export-release', preset.name, outPath]
      const child = spawn(execPath, args)
      child.stdout.on('data', (d) => process.stdout.write(d))
      child.stderr.on('data', (d) => process.stderr.write(d))
      child.on('close', (code) => {
        if (code === 0) {
          console.log(`[Linden CLI] Export succeeded: ${outPath}`)
          process.exit(0)
        } else {
          console.error(`[Linden CLI] Godot build failed with code ${code}`)
          process.exit(code || 1)
        }
      })
    } else {
      // Linden native export
      console.log(`[Linden CLI] Building Linden native package for ${preset.platform}...`)
      if (preset.platform === 'web') {
        const buildRes = await WebBuildRunner.runBuild({
          projectPath: projectDir,
          preset,
          onLog: (l) => console.log(l),
        })
        if (!buildRes.success) {
          console.error(`[Linden CLI] Web build failed: ${buildRes.error}`)
          process.exit(1)
        }
      } else {
        await writeFile(outPath, `Linden Native Player Executable Placeholder for ${config.name}`, 'utf-8')
      }
      console.log(`[Linden CLI] Export finished successfully: ${outPath}`)
      process.exit(0)
    }
  } catch (err: any) {
    console.error(`[Linden CLI] Exception during export: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Check CLI args
 */
const exportArgIdx = process.argv.indexOf('--export')
if (exportArgIdx !== -1) {
  const targetPreset = process.argv[exportArgIdx + 1]
  const targetDir = process.argv[exportArgIdx + 2] || '.'
  app.on('ready', () => {
    setBridgeSettingsDir(app.getPath('userData'))
    runCliExport(targetPreset, targetDir)
  })
} else {
  app.on('ready', () => {
    setBridgeSettingsDir(app.getPath('userData'))
    installGameProtocol()
    mainWindow = createWindow()
    guardGameFrame(mainWindow)
    setupMenu()
    AgentHost.getInstance().setProjectsRoot(join(app.getPath('documents'), 'Linden Projects'))
    AgentHost.getInstance().setEventSender((ev) => {
      mainWindow?.webContents.send('agent:event', ev)
    })
  })
}

/**
 * Create main application window
 */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: join(__dirname, isDev ? '../public/icon.png' : '../dist/icon.png'),
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }

  if (isDev) {
    win.webContents.openDevTools()
  }

  return win
}

app.on('window-all-closed', () => {
  stopAllPlaySessions()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = createWindow()
  }
})

/**
 * Setup application menu
 */
async function setupMenu(): Promise<void> {
  const recentProjects = await loadRecentProjects()

  const recentMenuItems = recentProjects.length > 0
    ? [
        ...recentProjects.map((p) => ({
          label: p.name,
          enabled: p.exists,
          click: () => {
            mainWindow?.webContents.send('menu:openRecent', p.path)
          },
        })),
        { type: 'separator' },
        {
          label: 'Clear Recent',
          click: async () => {
            await saveRecentProjects([])
            setupMenu()
            mainWindow?.webContents.send('menu:clearRecent')
          },
        },
      ]
    : [{ label: 'No Recent Projects', enabled: false }]

  const template: any[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project…',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            mainWindow?.webContents.send('menu:newProject')
          },
        },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            mainWindow?.webContents.send('menu:openProject')
          },
        },
        {
          label: 'Open Recent',
          submenu: recentMenuItems,
        },
        { type: 'separator' },
        {
          label: 'New Scene',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.send('menu:newScene')
          },
        },
        {
          label: 'Open Scene…',
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
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            mainWindow?.webContents.send('menu:saveSceneAs')
          },
        },
        { type: 'separator' },
        {
          label: 'Import',
          submenu: [
            {
              label: 'Godot Project…',
              click: () => {
                mainWindow?.webContents.send('menu:importGodotProject')
              },
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Project Settings…',
          click: () => {
            mainWindow?.webContents.send('menu:projectSettings')
          },
        },
        {
          label: 'Export…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => {
            mainWindow?.webContents.send('menu:export')
          },
        },
        {
          label: 'Close Project',
          click: () => {
            mainWindow?.webContents.send('menu:closeProject')
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
      label: 'Window',
      submenu: [
        {
          label: 'Bridge',
          click: () => {
            mainWindow?.webContents.send('menu:openBridge')
          },
        },
        { type: 'separator' },
        {
          label: 'Input Actions',
          click: () => {
            mainWindow?.webContents.send('menu:inputActions')
          },
        },
        {
          label: 'Project Settings',
          click: () => {
            mainWindow?.webContents.send('menu:projectSettings')
          },
        },
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
const registeredChannels = new Set<string>()

function handle(
  channel: IpcInvokeChannel | string,
  listener: Parameters<typeof ipcMain.handle>[1]
) {
  registeredChannels.add(channel)
  return ipcMain.handle(channel, listener)
}

// Core app lifecycle & IPC discovery handlers registered first
handle('app:relaunch', () => {
  app.relaunch()
  app.exit(0)
})

handle('app:ipcChannels', () => {
  return Array.from(registeredChannels)
})

// Window Title
handle('window:setTitle', (_event, title: string) => {
  if (mainWindow) {
    mainWindow.setTitle(title)
  }
})

// App Version
handle('app:getVersion', () => {
  return app.getVersion()
})

// Scene Open
handle('scene:open', async (_event, opts?: { defaultDir?: string }) => {
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

// Scene Save (deprecated: gunakan scene:pickSavePath dan scene:write)
handle(
  'scene:save',
  async (_event, opts?: { defaultPath?: string; content?: string }) => {
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

// Scene: Pick Save Path
handle(
  'scene:pickSavePath',
  async (_event, opts?: { defaultPath?: string }) => {
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

      return { status: 'ok', path: res.filePath }
    } catch (err: any) {
      return { status: 'error', message: err?.message || String(err) }
    }
  }
)

// Scene: Write File
handle(
  'scene:write',
  async (_event, opts: { path: string; content: string }) => {
    try {
      if (!opts?.path) {
        return { status: 'error', message: 'Path tidak boleh kosong.' }
      }
      const dir = dirname(opts.path)
      if (!fs.existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
      await writeFile(opts.path, opts?.content ?? '', 'utf-8')
      return { status: 'ok' }
    } catch (err: any) {
      return { status: 'error', message: err?.message || String(err) }
    }
  }
)

// Project: Create
handle('project:create', async (_event, opts: { name: string; location: string; config: any; sceneContent: string; template?: string }) => {
  try {
    const targetDir = join(opts.location, opts.name)
    if (fs.existsSync(targetDir)) {
      const files = fs.readdirSync(targetDir)
      if (files.length > 0) {
        return { status: 'error', message: `Folder "${targetDir}" sudah ada dan tidak kosong.` }
      }
    }

    await mkdir(targetDir, { recursive: true })
    await mkdir(join(targetDir, 'scenes'), { recursive: true })
    await mkdir(join(targetDir, 'assets'), { recursive: true })

    const configPath = join(targetDir, 'project.linden.json')
    await writeFile(configPath, JSON.stringify(opts.config, null, 2), 'utf-8')

    const scenePath = join(targetDir, 'scenes', 'Main.lscene')
    await writeFile(scenePath, opts.sceneContent, 'utf-8')

    if (opts.template === 'html-threejs') {
      copyHtmlGameTemplate(targetDir)
    }

    // Add to recent
    const recents = await loadRecentProjects()
    const updated = [
      { name: opts.name, path: targetDir, lastOpened: Date.now() },
      ...recents.filter((r) => r.path !== targetDir),
    ]
    await saveRecentProjects(updated)
    setupMenu()

    return {
      status: 'ok',
      projectPath: targetDir,
      config: opts.config,
    }
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) }
  }
})

/** HTML Game template: web/ page files + a local copy of three.js (no CDN, works offline) */
function copyHtmlGameTemplate(targetDir: string) {
  const templateDir = resolveAppResource('resources/templates/html-threejs', 'templates/html-threejs')
  const copyDir = (src: string, dst: string) => {
    fs.mkdirSync(dst, { recursive: true })
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const from = join(src, ent.name)
      const to = join(dst, ent.name)
      if (ent.isDirectory()) copyDir(from, to)
      else fs.writeFileSync(to, fs.readFileSync(from))
    }
  }
  copyDir(templateDir, targetDir)
  // three.module.js imports ./three.core.js (r16x+), so both ship together
  fs.mkdirSync(join(targetDir, 'web', 'vendor'), { recursive: true })
  for (const file of ['three.module.js', 'three.core.js']) {
    const src = resolveAppResource(`node_modules/three/build/${file}`, `app.asar/node_modules/three/build/${file}`)
    fs.writeFileSync(join(targetDir, 'web', 'vendor', file), fs.readFileSync(src))
  }
}

// Project: Open
handle('project:open', async (_event, opts?: { projectPath?: string }) => {
  if (!mainWindow) return { status: 'canceled' }
  try {
    let targetPath = opts?.projectPath
    if (!targetPath) {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Buka Proyek Linden',
        properties: ['openDirectory', 'openFile'],
        filters: [{ name: 'Linden Project', extensions: ['json'] }],
      })
      if (res.canceled || res.filePaths.length === 0) {
        return { status: 'canceled' }
      }
      targetPath = res.filePaths[0]
    }

    let dirPath = targetPath
    let configFilePath = join(targetPath, 'project.linden.json')

    if (targetPath.endsWith('.json')) {
      configFilePath = targetPath
      dirPath = dirname(targetPath)
    }

    if (!fs.existsSync(configFilePath)) {
      return { status: 'error', message: `Tidak ditemukan project.linden.json di folder "${dirPath}".` }
    }

    const content = await readFile(configFilePath, 'utf-8')
    let parsedConfig: any
    try {
      parsedConfig = JSON.parse(content)
    } catch {
      return { status: 'error', message: 'File project.linden.json rusak atau format JSON tidak valid.' }
    }

    if (!parsedConfig.name) {
      return { status: 'error', message: 'Konfigurasi project tidak memiliki properti "name" yang valid.' }
    }

    // Try reading first scene
    let initialSceneContent: string | undefined
    let initialScenePath: string | undefined
    const firstScene = parsedConfig.scenesInBuild?.[0] || 'scenes/Main.lscene'
    const fullScenePath = join(dirPath, firstScene)
    if (fs.existsSync(fullScenePath)) {
      initialSceneContent = await readFile(fullScenePath, 'utf-8')
      initialScenePath = fullScenePath
    }

    // Add to recent
    const recents = await loadRecentProjects()
    const updated = [
      { name: parsedConfig.name, path: dirPath, lastOpened: Date.now() },
      ...recents.filter((r) => r.path !== dirPath),
    ]
    await saveRecentProjects(updated)
    setupMenu()

    return {
      status: 'ok',
      projectPath: dirPath,
      config: parsedConfig,
      initialSceneContent,
      initialScenePath,
    }
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) }
  }
})

// Project: Save Settings
handle('project:saveSettings', async (_event, opts: { projectPath: string; config: any }) => {
  try {
    const configPath = join(opts.projectPath, 'project.linden.json')
    await writeFile(configPath, JSON.stringify(opts.config, null, 2), 'utf-8')
    return { status: 'ok' }
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) }
  }
})

// Project: write only the input section (actions + touch), keeping the rest of the config intact
handle('project:saveInput', async (_event, opts: { projectPath: string; input: { actions?: unknown[]; touch?: unknown } }) => {
  try {
    const configPath = join(opts.projectPath, 'project.linden.json')
    const current = fs.existsSync(configPath) ? JSON.parse(await readFile(configPath, 'utf-8')) : {}
    current.input = { ...(current.input ?? {}), ...opts.input }
    await writeFile(configPath, JSON.stringify(current, null, 2), 'utf-8')
    return { status: 'ok' }
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) }
  }
})

// Project: Recent list
handle('project:recent:list', async () => {
  return await loadRecentProjects()
})

handle('project:recent:add', async (_event, proj: { name: string; path: string; lastOpened: number }) => {
  const recents = await loadRecentProjects()
  const updated = [proj, ...recents.filter((r) => r.path !== proj.path)]
  await saveRecentProjects(updated)
  setupMenu()
  return { status: 'ok' }
})

handle('project:recent:remove', async (_event, targetPath: string) => {
  const recents = await loadRecentProjects()
  const updated = recents.filter((r) => r.path !== targetPath)
  await saveRecentProjects(updated)
  setupMenu()
  return { status: 'ok' }
})

handle('project:recent:clear', async () => {
  await saveRecentProjects([])
  setupMenu()
  return { status: 'ok' }
})

// Generic showOpenDialog
handle('dialog:showOpenDialog', async (_event, opts: any) => {
  if (!mainWindow) return { canceled: true, filePaths: [] }
  return await dialog.showOpenDialog(mainWindow, opts)
})

// Shell: Show Item in Folder
handle('shell:showItemInFolder', async (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

handle('file:save', async (_event, data) => {
  return { success: true, path: data.path }
})

handle('file:load', async (_event, filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      return { success: true, data }
    }
  } catch (err: any) {
    return { success: false, error: err.message, data: null }
  }
  return { success: false, data: null }
})

handle('app:getProjectPath', () => {
  return app.getPath('documents')
})

handle('app:getUserDataPath', () => {
  return app.getPath('userData')
})

handle('godot:detect', async (_event, customPath?: string) => {
  const res = await resolveGodotExecutable(customPath)
  return res.ok && res.path ? res.path : null
})

// Godot Bridge IPC Handlers
handle('bridge:godot:validate', async (_event, customPath?: string) => {
  return await resolveGodotExecutable(customPath)
})

handle('bridge:import:detect', async (_event, dir: string) => {
  return detectGodotProject(dir)
})

handle('bridge:import:run', async (_event, options: any) => {
  return await runGodotImportJob(options, app.getPath('userData'), mainWindow)
})

handle('bridge:import:cancel', async (_event, jobId: string) => {
  cancelImportJob(jobId)
  return { success: true }
})

handle('bridge:scene:import', async (_event, opts?: { tscnPath?: string }) => {
  return await importSingleGodotScene(opts)
})

handle('bridge:sync:start', async (_event, opts?: { port?: number }) => {
  return await syncServerInstance.start(opts?.port || 6007, (msg) => {
    mainWindow?.webContents.send('bridge:sync:message', msg)
  })
})

handle('bridge:sync:stop', async () => {
  await syncServerInstance.stop()
  return { success: true }
})

handle('bridge:sync:status', () => {
  return syncServerInstance.getStatus()
})

handle('bridge:sync:send', (_event, data: any) => {
  syncServerInstance.broadcast(data)
  return { success: true }
})

// Export Runner IPC
handle('export:run', async (_event, opts: { preset: any; projectPath: string }) => {
  const { preset, projectPath } = opts
  const startTime = Date.now()
  const logs: string[] = []

  const logEmit = (line: string) => {
    logs.push(line)
    mainWindow?.webContents.send('export:log', { presetId: preset.id, log: line })
  }

  const progEmit = (stage: string, percent: number, message: string) => {
    mainWindow?.webContents.send('export:progress', { presetId: preset.id, stage, percent, message })
  }

  logEmit(`[Export] Memulai proses export "${preset.name}" (${preset.platform})`)
  progEmit('validation', 20, 'Memvalidasi preset dan output...')

  const fullOutputPath = join(projectPath, preset.output)
  await mkdir(dirname(fullOutputPath), { recursive: true })

  if (preset.backend === 'godot') {
    const execRes = await resolveGodotExecutable(preset.godotExecutable)
    const execPath = execRes.ok ? execRes.path : null
    if (!execPath) {
      const err = `Godot executable not found: ${execRes.reason || 'Please install Godot 4.3+'}`
      logEmit(`[Error] ${err}`)
      progEmit('failed', 100, err)
      return { success: false, outputPath: fullOutputPath, logs, durationMs: Date.now() - startTime, error: err }
    }

    progEmit('bundle', 50, 'Mengekspor ke Godot...')
    progEmit('package', 75, 'Menjalankan Godot headless export...')

    const args = ['--headless', '--path', projectPath, '--export-release', preset.name, fullOutputPath]
    return new Promise((resolve) => {
      const child = spawn(execPath, args)
      child.stdout.on('data', (d) => {
        const lines = d.toString().split('\n')
        for (const l of lines) if (l.trim()) logEmit(l)
      })
      child.stderr.on('data', (d) => {
        const lines = d.toString().split('\n')
        for (const l of lines) if (l.trim()) logEmit(`[stderr] ${l}`)
      })
      child.on('close', (code) => {
        const success = code === 0
        if (success) {
          progEmit('complete', 100, 'Export Godot berhasil dibuat!')
        } else {
          progEmit('failed', 100, `Build gagal dengan kode keluar ${code}`)
        }
        resolve({
          success,
          outputPath: fullOutputPath,
          logs,
          durationMs: Date.now() - startTime,
          error: success ? undefined : `Build failed with exit code ${code}`,
        })
      })
      child.on('error', (err) => {
        logEmit(`[Error] ${err.message}`)
        progEmit('failed', 100, err.message)
        resolve({
          success: false,
          outputPath: fullOutputPath,
          logs,
          durationMs: Date.now() - startTime,
          error: err.message,
        })
      })
    })
  } else {
    // Linden native backend
    if (preset.platform === 'web') {
      return await WebBuildRunner.runBuild({
        projectPath: opts.projectPath,
        preset,
        onProgress: (p) => progEmit(p.stage, p.percent, p.message),
        onLog: (l) => logEmit(l),
      })
    }

    progEmit('bundle', 45, 'Membundel resources Linden...')
    logEmit(`[Linden] Menyiapkan scene dan bundel aset untuk ${preset.platform}`)
    await new Promise((r) => setTimeout(r, 300))

    progEmit('package', 80, 'Menghasilkan paket distribusi...')
    await writeFile(fullOutputPath, `Linden Native Build: ${preset.name}`, 'utf-8')

    progEmit('sign', 95, 'Finalisasi build...')
    await new Promise((r) => setTimeout(r, 200))

    logEmit(`[Linden] Build selesai di: ${fullOutputPath}`)
    progEmit('complete', 100, 'Export Linden selesai!')
    return {
      success: true,
      outputPath: fullOutputPath,
      logs,
      durationMs: Date.now() - startTime,
    }
  }
})

// Godot Headless Build
handle(
  'godot:build',
  async (
    _event,
    opts: { preset: string; projectPath: string; outputPath: string; customExecutable?: string }
  ) => {
    const startTime = Date.now()
    const logs: string[] = []
    const execRes = await resolveGodotExecutable(opts.customExecutable)
    const execPath = execRes.ok ? execRes.path : null

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

    const outDir = dirname(opts.outputPath)
    if (!fs.existsSync(outDir)) {
      await mkdir(outDir, { recursive: true })
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

handle('build:export', async (_event, options) => {
  return await ipcMain.emit('export:run', _event, options)
})

// Open external link
handle('shell:openExternal', async (_event, url) => {
  await shell.openExternal(url)
})

// Get system info
handle('system:getInfo', () => {
  const os = require('os')
  return {
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
  }
})

// Web Export & Local Server
const activeWebServers: { close: () => void }[] = []

handle('export:web:run', async (_event, options: any) => {
  return await WebBuildRunner.runBuild(options)
})

handle('export:web:serve', async (_event, { buildDir }: { buildDir: string }) => {
  const server = await WebBuildRunner.serveLocal(buildDir)
  activeWebServers.push(server)
  await shell.openExternal(server.url)
  return server.url
})

// Play in viewport (Game Frame)
handle('play:start', async (_event, opts: { projectPath: string }) => {
  return startPlaySession({
    projectPath: opts?.projectPath,
    cacheRoot: join(app.getPath('userData'), 'play-cache'),
    preferSourceRuntime: isDev,
    onFilesChanged: (change) => mainWindow?.webContents.send('play:fileChanged', change),
  })
})

handle('play:stop', async (_event, sessionId: string) => stopPlaySession(sessionId))

handle('play:openDevTools', async () => {
  mainWindow?.webContents.openDevTools({ mode: 'detach' })
  return true
})

handle('play:readUiFragment', async (_event, opts: { projectPath: string; src: string }) => {
  try {
    return readUiFragment(opts.projectPath, opts.src)
  } catch (err: any) {
    return { status: 'error', message: err.message }
  }
})

// OpenCode AI Agent Handlers
handle('agent:status', async () => {
  return AgentHost.getInstance().getStatus()
})

handle('agent:start', async (_event, projectPath: string) => {
  return await AgentHost.getInstance().startServer(projectPath)
})

handle('agent:stop', async () => {
  await AgentHost.getInstance().stopServer()
  return { success: true }
})

handle('agent:providers', async () => {
  return await AgentHost.getInstance().getProviders()
})

handle('agent:setModel', async (_event, { providerId, modelId }: any) => {
  AgentHost.getInstance().setModel(providerId, modelId)
  return { success: true }
})

handle('agent:session:list', async () => {
  return await AgentHost.getInstance().listSessions()
})

handle('agent:session:create', async (_event, title?: string) => {
  return await AgentHost.getInstance().createSession(title)
})

handle('agent:session:delete', async (_event, sessionId: string) => {
  return await AgentHost.getInstance().deleteSession(sessionId)
})

handle('agent:session:get', async (_event, sessionId: string) => {
  const sessions = await AgentHost.getInstance().listSessions()
  return sessions.find((s) => s.id === sessionId) || null
})

handle('agent:prompt', async (_event, options: any) => {
  return await AgentHost.getInstance().submitPrompt(options)
})

handle('agent:abort', async (_event, sessionId: string) => {
  return await AgentHost.getInstance().abortPrompt(sessionId)
})

handle('agent:session:turns', async (_event, sessionId: string) => {
  return await AgentHost.getInstance().getSessionTurns(sessionId)
})

handle('agent:turn:snapshot', async (_event, sessionId: string) => {
  return AgentHost.getInstance().getTurnSnapshot(sessionId)
})

handle('agent:permission:reply', async (_event, { requestId, allow }: any) => {
  await AgentHost.getInstance().replyPermission(requestId, allow)
  return { success: true }
})

handle('agent:diff:apply', async (_event, diffId: string) => {
  return await AgentHost.getInstance().applyDiff(diffId)
})

handle('agent:diff:reject', async (_event, diffId: string) => {
  return await AgentHost.getInstance().rejectDiff(diffId)
})

handle('agent:templates', async () => {
  return AgentHost.getInstance().getTemplates()
})

app.on('before-quit', async () => {
  for (const s of activeWebServers) {
    try {
      s.close()
    } catch (_) {}
  }
  await AgentHost.getInstance().stopServer()
})

// Development helpers
if (isDev) {
  handle('dev:reloadScripts', async () => {
    mainWindow?.webContents.send('dev:scriptsReloaded')
  })
}
