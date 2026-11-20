import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import chokidar from 'chokidar'

const require = createRequire(import.meta.url)
const electronBin = require('electron')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WATCH_PATHS = [
  path.join(ROOT, 'electron'),
  path.join(ROOT, 'shared'),
  path.join(ROOT, 'engine', 'godot'),
  path.join(ROOT, 'engine', 'transmuter'),
]

let electronProcess = null
let isRestarting = false
let isQuitting = false
let debounceTimer = null

function buildElectron() {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32'
    const cmd = isWin ? 'npm.cmd' : 'npm'
    const child = spawn(cmd, ['run', 'build:electron'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: isWin,
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`build:electron gagal dengan exit code ${code}`))
    })
    child.on('error', reject)
  })
}

function startElectron() {
  if (isQuitting) return

  electronProcess = spawn(electronBin, ['.'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173' },
  })

  electronProcess.on('exit', (code, signal) => {
    electronProcess = null
    if (isRestarting) {
      // Intentional restart triggered by code change
      return
    }

    if (!isQuitting) {
      console.log(`\n[Linden Watch] Aplikasi Electron ditutup (${signal ? `signal ${signal}` : `exit code ${code ?? 0}`}).`)
      console.log('[Linden Watch] Menghentikan seluruh proses dev dan background...')
      shutdown(code ?? 0)
    }
  })
}

async function restartElectron(changedPath) {
  if (isQuitting) return
  isRestarting = true
  console.log(`\n[Linden Watch] Perubahan terdeteksi: ${path.relative(ROOT, changedPath)}. Membuild ulang...`)

  if (electronProcess) {
    const procToKill = electronProcess
    procToKill.kill('SIGTERM')
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try {
          procToKill.kill('SIGKILL')
        } catch (_) {}
        resolve()
      }, 800)
      procToKill.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  try {
    await buildElectron()
    isRestarting = false
    startElectron()
  } catch (err) {
    console.error('[Linden Watch] Build gagal saat reload:', err.message)
    isRestarting = false
  }
}

function shutdown(code = 0) {
  if (isQuitting) return
  isQuitting = true
  clearTimeout(debounceTimer)

  try {
    watcher.close()
  } catch (_) {}

  if (electronProcess) {
    try {
      electronProcess.kill('SIGKILL')
    } catch (_) {}
    electronProcess = null
  }

  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('SIGHUP', () => shutdown(0))

// 1. Initial build & launch
try {
  await buildElectron()
  startElectron()
} catch (err) {
  console.error('[Linden Watch] Build awal gagal:', err.message)
  process.exit(1)
}

// 2. Watcher setup
const watcher = chokidar.watch(WATCH_PATHS, {
  ignored: (filePath) => {
    if (filePath.includes('node_modules') || filePath.includes('.git') || filePath.includes('dist')) {
      return true
    }
    // Only monitor directories or .ts files (exclude tests and types)
    if (filePath.endsWith('.d.ts') || filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts')) {
      return true
    }
    return false
  },
  ignoreInitial: true,
})

watcher.on('all', (_event, changedPath) => {
  if (!changedPath.endsWith('.ts')) return
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    restartElectron(changedPath).catch((e) => console.error(e))
  }, 300)
})
