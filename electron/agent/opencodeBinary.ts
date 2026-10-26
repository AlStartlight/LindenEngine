import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Find the `opencode` CLI from a packaged app.
 *
 * Apps started from Finder/Dock (macOS) or a desktop launcher (Linux) don't inherit the user's
 * shell PATH, so a CLI installed with nvm, Homebrew, volta, bun or `npm i -g` is invisible to a
 * plain spawn('opencode'). We rebuild PATH from the user's login shell plus the usual install
 * folders, resolve the binary to an absolute path, and give child processes the same PATH so the
 * agent's own shell commands (git, node, npm...) work too.
 */

const MARKER = '__LINDEN_PATH__'
const SHELL_TIMEOUT_MS = 4000

export interface OpencodeResolution {
  /** Absolute path of the CLI, or null when not found */
  bin: string | null
  /** PATH to hand to child processes */
  envPath: string
  /** Folders that were searched, for the error message */
  searched: string[]
  /** Where the binary came from */
  source: 'OPENCODE_BIN' | 'PATH' | 'not-found'
}

/** Extract PATH printed between markers (login shells may print banners around it) */
export function parseShellPath(output: string): string | null {
  const start = output.indexOf(MARKER)
  const end = output.lastIndexOf(MARKER)
  if (start < 0 || end <= start) return null
  const value = output.slice(start + MARKER.length, end).trim()
  return value || null
}

/** PATH of the user's login shell (macOS/Linux), or null if it can't be read quickly */
export function loadLoginShellPath(shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }
    let child: ReturnType<typeof spawn>
    try {
      // -i -l: same environment as a terminal window (nvm, Homebrew shellenv, ~/.zprofile...)
      // ${PATH} with braces: `$PATH__MARKER` would be read as one variable name
      child = spawn(shell, ['-ilc', `printf '%s' "${MARKER}\${PATH}${MARKER}"`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        // Keep oh-my-zsh & co. from prompting or updating during the probe
        env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_DISABLE_COMPFIX: 'true', TERM: 'dumb' },
        detached: false,
      })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(parseShellPath(out))
    }, SHELL_TIMEOUT_MS)
    child.stdout?.on('data', (d) => (out += d.toString()))
    child.on('error', () => finish(null))
    child.on('close', () => finish(parseShellPath(out)))
  })
}

/** Usual install folders of node/CLI tools, newest nvm/fnm node first */
export function candidateDirs(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, readDir = safeReadDir): string[] {
  const dirs: string[] = []
  const versionDirs = (root: string, suffix: string[]) =>
    readDir(root)
      .filter((v) => /^v?\d+\.\d+\.\d+/.test(v))
      .sort((a, b) => compareSemver(b.replace(/^v/, ''), a.replace(/^v/, '')))
      .map((v) => path.join(root, v, ...suffix))

  if (env.OPENCODE_INSTALL_DIR) dirs.push(path.join(env.OPENCODE_INSTALL_DIR, 'bin'))
  dirs.push(path.join(home, '.opencode', 'bin'))

  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming')
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    dirs.push(path.join(appData, 'npm'), path.join(localAppData, 'pnpm'), path.join(home, '.bun', 'bin'), path.join(localAppData, 'Volta', 'bin'))
    if (env.NVM_SYMLINK) dirs.push(env.NVM_SYMLINK)
    if (env.ProgramFiles) dirs.push(path.join(env.ProgramFiles, 'nodejs'))
    return dirs
  }

  const nvmDir = env.NVM_DIR || path.join(home, '.nvm')
  dirs.push(
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, 'Library', 'pnpm'),
    path.join(home, '.local', 'share', 'pnpm'),
    ...versionDirs(path.join(nvmDir, 'versions', 'node'), ['bin']),
    ...versionDirs(path.join(home, '.local', 'share', 'fnm', 'node-versions'), ['installation', 'bin']),
    ...versionDirs(path.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'), ['installation', 'bin']),
    '/usr/bin',
    '/bin'
  )
  return dirs
}

/** Join PATH parts, dropping empties and duplicates while keeping the first occurrence */
export function mergePath(parts: (string | null | undefined)[], delimiter = path.delimiter): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    if (!part) continue
    for (const dir of part.split(delimiter)) {
      const d = dir.trim()
      if (d && !seen.has(d)) {
        seen.add(d)
        out.push(d)
      }
    }
  }
  return out.join(delimiter)
}

/** First executable named `name` in dirs (Windows: .exe/.cmd/.bat as well) */
export function findExecutable(name: string, dirs: string[], platform: NodeJS.Platform = process.platform): string | null {
  const names = platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name]
  for (const dir of dirs) {
    for (const n of names) {
      const full = path.join(dir, n)
      try {
        const st = fs.statSync(full)
        if (!st.isFile()) continue
        if (platform !== 'win32') fs.accessSync(full, fs.constants.X_OK)
        return full
      } catch {
        // keep looking
      }
    }
  }
  return null
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

let cached: Promise<OpencodeResolution> | null = null

/**
 * Resolve the CLI once per process. Order: OPENCODE_BIN, then the current PATH, the login shell
 * PATH and the usual install folders. `refresh` forces a new lookup (e.g. after installing).
 */
export function resolveOpencode(opts: { refresh?: boolean } = {}): Promise<OpencodeResolution> {
  if (!cached || opts.refresh) cached = doResolve()
  return cached
}

async function doResolve(): Promise<OpencodeResolution> {
  const env = process.env
  const loginPath = await loadLoginShellPath()
  const envPath = mergePath([env.PATH, loginPath, candidateDirs(os.homedir(), process.platform, env).join(path.delimiter)])
  const searched = envPath.split(path.delimiter)

  const override = env.OPENCODE_BIN?.trim()
  if (override) {
    const exists = fs.existsSync(override)
    return { bin: exists ? override : null, envPath, searched: [override], source: exists ? 'OPENCODE_BIN' : 'not-found' }
  }
  const bin = findExecutable('opencode', searched)
  return { bin, envPath, searched, source: bin ? 'PATH' : 'not-found' }
}

/** Windows npm shims (.cmd/.bat) can only be started through the shell */
export function needsShell(bin: string): boolean {
  return /\.(cmd|bat)$/i.test(bin)
}
