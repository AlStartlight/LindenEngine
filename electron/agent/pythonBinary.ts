import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { candidateDirs, findExecutable, loadLoginShellPath, mergePath } from './opencodeBinary'

/**
 * Find a Python >= 3.10 for the img2threejs forge scripts (linden_img2_run). Like the opencode CLI,
 * an app started from Finder/Dock misses the user's shell PATH, so the login shell PATH and the usual
 * install folders (Homebrew, pyenv, uv, python.org, Windows launcher) are searched too.
 * macOS' /usr/bin/python3 is 3.9 and is reported, not used.
 */

export const PYTHON_MIN = [3, 10] as const

export interface PythonResolution {
  /** Command to run (absolute path), or null */
  bin: string | null
  /** Extra arguments before the script (Windows launcher: ["-3"]) */
  args: string[]
  version: string | null
  envPath: string
  /** Interpreters found but too old, for the error message */
  rejected: { bin: string; version: string }[]
  source: 'LINDEN_PYTHON' | 'PATH' | 'not-found'
  error?: string
}

const NAMES = ['python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python']

/** "3.12.4" from `python -c` output */
export function parsePythonVersion(out: string): string | null {
  const m = out.match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null
}

export function isSupportedPython(version: string | null): boolean {
  if (!version) return false
  const [maj, min] = version.split('.').map(Number)
  return maj > PYTHON_MIN[0] || (maj === PYTHON_MIN[0] && min >= PYTHON_MIN[1])
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** Folders where Pythons usually live, besides the node/CLI folders opencode uses */
export function pythonDirs(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, readDir = safeReadDir): string[] {
  const dirs: string[] = []
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    const programs = path.join(local, 'Programs', 'Python')
    for (const v of readDir(programs).filter((d) => /^Python3\d+/.test(d)).sort().reverse()) dirs.push(path.join(programs, v))
    if (env.ProgramFiles) for (const v of readDir(env.ProgramFiles).filter((d) => /^Python3\d+/.test(d)).sort().reverse()) dirs.push(path.join(env.ProgramFiles, v))
    dirs.push(path.join(local, 'Microsoft', 'WindowsApps'))
    return dirs
  }
  dirs.push(path.join(home, '.pyenv', 'shims'), path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin')
  // uv-managed interpreters: ~/.local/share/uv/python/cpython-3.12.x-<platform>/bin
  const uv = path.join(env.UV_PYTHON_INSTALL_DIR || path.join(home, '.local', 'share', 'uv', 'python'))
  for (const v of readDir(uv).filter((d) => /^cpython-3\.\d+/.test(d)).sort().reverse()) dirs.push(path.join(uv, v, 'bin'))
  if (platform === 'darwin') {
    const fw = '/Library/Frameworks/Python.framework/Versions'
    for (const v of readDir(fw).filter((d) => /^3\.\d+$/.test(d)).sort((a, b) => Number(b.split('.')[1]) - Number(a.split('.')[1]))) dirs.push(path.join(fw, v, 'bin'))
  }
  dirs.push('/usr/bin', '/bin')
  return dirs
}

function probeVersion(bin: string, args: string[], envPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, [...args, '-c', 'import sys;print("%d.%d.%d" % sys.version_info[:3])'], { env: { ...process.env, PATH: envPath }, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.stdout?.on('data', (d) => (out += d.toString()))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(parsePythonVersion(out))
    })
  })
}

let cached: Promise<PythonResolution> | null = null

/** Resolve once per process; `refresh` looks again (e.g. after the user installed Python) */
export function resolvePython(opts: { refresh?: boolean } = {}): Promise<PythonResolution> {
  if (!cached || opts.refresh) cached = doResolve()
  return cached
}

async function doResolve(): Promise<PythonResolution> {
  const env = process.env
  const home = os.homedir()
  const loginPath = await loadLoginShellPath()
  const envPath = mergePath([env.PATH, loginPath, pythonDirs(home, process.platform, env).join(path.delimiter), candidateDirs(home, process.platform, env).join(path.delimiter)])
  const dirs = envPath.split(path.delimiter)
  const rejected: { bin: string; version: string }[] = []

  const override = env.LINDEN_PYTHON?.trim()
  if (override) {
    const version = fs.existsSync(override) ? await probeVersion(override, [], envPath) : null
    if (isSupportedPython(version)) return { bin: override, args: [], version, envPath, rejected, source: 'LINDEN_PYTHON' }
    return {
      bin: null,
      args: [],
      version,
      envPath,
      rejected: version ? [{ bin: override, version }] : [],
      source: 'not-found',
      error: version ? `LINDEN_PYTHON (${override}) adalah Python ${version}; img2threejs butuh >= 3.10` : `LINDEN_PYTHON menunjuk ke file yang tidak bisa dijalankan: ${override}`,
    }
  }

  const tried = new Set<string>()
  for (const name of NAMES) {
    for (const dir of dirs) {
      const bin = findExecutable(name, [dir])
      if (!bin) continue
      let real = bin
      try {
        real = fs.realpathSync(bin)
      } catch {
        // keep the link path
      }
      if (tried.has(real)) continue
      tried.add(real)
      const version = await probeVersion(bin, [], envPath)
      if (isSupportedPython(version)) return { bin, args: [], version, envPath, rejected, source: 'PATH' }
      if (version) rejected.push({ bin, version })
    }
  }
  if (process.platform === 'win32') {
    const py = findExecutable('py', dirs)
    if (py) {
      const version = await probeVersion(py, ['-3'], envPath)
      if (isSupportedPython(version)) return { bin: py, args: ['-3'], version, envPath, rejected, source: 'PATH' }
      if (version) rejected.push({ bin: `${py} -3`, version })
    }
  }
  return { bin: null, args: [], version: null, envPath, rejected, source: 'not-found', error: pythonMissingMessage(rejected) }
}

export function pythonMissingMessage(rejected: { bin: string; version: string }[]): string {
  const old = rejected.length ? ` Ditemukan tapi terlalu lama: ${rejected.map((r) => `${r.bin} (${r.version})`).join(', ')}.` : ''
  const hint =
    process.platform === 'darwin'
      ? 'brew install python@3.12, installer dari python.org, atau uv python install 3.12'
      : process.platform === 'win32'
        ? 'installer dari python.org (centang "Add to PATH") atau winget install Python.Python.3.12'
        : 'paket python3.12 dari distro, atau uv python install 3.12'
  return `Rekonstruksi img2threejs butuh Python 3.10 atau lebih baru.${old} Instal: ${hint}. Lokasi khusus: set LINDEN_PYTHON=/path/ke/python3, lalu coba lagi.`
}
