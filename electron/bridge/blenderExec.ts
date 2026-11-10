import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { BLENDER_MIN_VERSION, type BlenderSource, type BlenderStatus } from '../../shared/blenderTypes'
import { findExecutable } from '../agent/opencodeBinary'

/**
 * Finding and validating the user's own Blender install. Blender (GPL) only ever runs as a
 * separate process; nothing from Blender is bundled, linked or imported here.
 */

export interface BlenderCandidate {
  bin: string
  source: BlenderSource
}

/** `blender --version`: "Blender 4.2.3 LTS" on some line (macOS may print warnings first) */
export function parseBlenderVersion(output: string): { ok: boolean; version?: string; reason?: string } {
  const clean = (output || '').trim()
  if (!clean) return { ok: false, reason: 'Blender --version tidak memberikan output' }
  const match = clean.match(/^Blender (\d+)\.(\d+)(?:\.(\d+))?/m)
  if (!match) return { ok: false, reason: `Format versi Blender tidak dikenali: "${clean.split(/\r?\n/)[0].slice(0, 120)}"` }
  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10)
  const patch = match[3] ? parseInt(match[3], 10) : 0
  const version = `${major}.${minor}.${patch}`
  if (major < BLENDER_MIN_VERSION.major || (major === BLENDER_MIN_VERSION.major && minor < BLENDER_MIN_VERSION.minor)) {
    return { ok: false, version, reason: `Versi Blender minimal ${BLENDER_MIN_VERSION.major}.${BLENDER_MIN_VERSION.minor} diperlukan (terdeteksi: ${version})` }
  }
  return { ok: true, version }
}

/**
 * User input to the executable: trims quotes and trailing slashes, turns a macOS .app bundle
 * into its binary and a Windows install folder into its blender.exe.
 */
export function normalizeBlenderPath(
  input: string,
  platform: NodeJS.Platform = process.platform,
  isDir: (p: string) => boolean = defaultIsDir
): string {
  const p = platform === 'win32' ? path.win32 : path.posix
  let clean = input.trim().replace(/^["']|["']$/g, '')
  while (clean.length > 1 && /[\\/]$/.test(clean)) clean = clean.slice(0, -1)
  if (platform === 'darwin' && clean.toLowerCase().endsWith('.app')) return p.join(clean, 'Contents', 'MacOS', 'Blender')
  if (platform === 'win32' && !clean.toLowerCase().endsWith('.exe') && isDir(clean)) return p.join(clean, 'blender.exe')
  return clean
}

function defaultIsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** "Blender 4.10" > "Blender 4.2": folder names under Program Files\Blender Foundation, newest first */
export function sortWindowsBlenderDirs(dirNames: string[]): string[] {
  const ver = (n: string) => (n.match(/(\d+)\.(\d+)(?:\.(\d+))?/) ?? []).slice(1).map((x) => parseInt(x ?? '0', 10) || 0)
  return dirNames
    .filter((n) => /^blender\b/i.test(n))
    .sort((a, b) => {
      const va = ver(a)
      const vb = ver(b)
      for (let i = 0; i < 3; i++) if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0)
      return 0
    })
}

/**
 * Candidates in lookup order: LINDEN_BLENDER, the saved path, `blender` on the (login shell)
 * PATH, then the usual install locations of the platform.
 */
export function blenderCandidates(opts: {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  saved?: string
  pathDirs?: string[]
  readDir?: (dir: string) => string[]
  findOnPath?: (name: string, dirs: string[], platform: NodeJS.Platform) => string | null
}): BlenderCandidate[] {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const home = opts.home ?? os.homedir()
  const readDir = opts.readDir ?? safeReadDir
  const findOnPath = opts.findOnPath ?? findExecutable
  const p = platform === 'win32' ? path.win32 : path.posix
  const out: BlenderCandidate[] = []

  const override = env.LINDEN_BLENDER?.trim()
  if (override) out.push({ bin: normalizeBlenderPath(override, platform), source: 'env' })
  if (opts.saved) out.push({ bin: opts.saved, source: 'settings' })
  const onPath = findOnPath('blender', opts.pathDirs ?? [], platform)
  if (onPath) out.push({ bin: onPath, source: 'path' })

  if (platform === 'darwin') {
    for (const dir of ['/Applications', p.join(home, 'Applications')]) {
      const apps = readDir(dir).filter((e) => /^blender.*\.app$/i.test(e))
      // Blender.app first, then versioned copies ("Blender 4.2.app") newest first
      apps.sort((a, b) => (a.toLowerCase() === 'blender.app' ? -1 : b.toLowerCase() === 'blender.app' ? 1 : b.localeCompare(a, undefined, { numeric: true })))
      for (const app of apps) out.push({ bin: p.join(dir, app, 'Contents', 'MacOS', 'Blender'), source: 'common' })
    }
  } else if (platform === 'win32') {
    for (const root of [env['ProgramFiles'] || 'C:\\Program Files', env['ProgramFiles(x86)']].filter(Boolean) as string[]) {
      const foundation = p.join(root, 'Blender Foundation')
      for (const dir of sortWindowsBlenderDirs(readDir(foundation))) out.push({ bin: p.join(foundation, dir, 'blender.exe'), source: 'common' })
    }
  } else {
    out.push(
      { bin: '/snap/bin/blender', source: 'common' },
      { bin: '/usr/bin/blender', source: 'common' },
      { bin: '/usr/local/bin/blender', source: 'common' },
      { bin: '/var/lib/flatpak/exports/bin/org.blender.Blender', source: 'common' },
      { bin: p.join(home, '.local/share/flatpak/exports/bin/org.blender.Blender'), source: 'common' }
    )
  }

  const seen = new Set<string>()
  return out.filter((c) => (seen.has(c.bin) ? false : (seen.add(c.bin), true)))
}

/**
 * Environment for every Blender run: no inherited Python settings and user script/config folders
 * pointed at an empty Linden folder, on top of --factory-startup (no user add-ons or startup scripts).
 */
export function blenderSpawnEnv(isolatedDir: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (/^PYTHON/i.test(k) || /^BLENDER_/i.test(k)) continue
    env[k] = v
  }
  env.BLENDER_USER_SCRIPTS = path.join(isolatedDir, 'scripts')
  env.BLENDER_USER_CONFIG = path.join(isolatedDir, 'config')
  env.BLENDER_USER_EXTENSIONS = path.join(isolatedDir, 'extensions')
  return env
}

export type VersionRunner = (bin: string) => Promise<{ code: number | null; stdout: string; stderr: string; error?: string }>

const VERSION_TIMEOUT_MS = 15000

/** Run `<bin> --version` without a shell (first launch on macOS can take a few seconds) */
export const runVersion: VersionRunner = (bin) =>
  new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (r: { code: number | null; stdout: string; stderr: string; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, ['--version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: blenderSpawnEnv(os.tmpdir()) })
    } catch (e: any) {
      resolve({ code: null, stdout: '', stderr: '', error: e.message })
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ code: null, stdout, stderr, error: `tidak merespons dalam ${VERSION_TIMEOUT_MS / 1000} detik` })
    }, VERSION_TIMEOUT_MS)
    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', (e) => finish({ code: null, stdout, stderr, error: e.message }))
    child.on('close', (code) => finish({ code, stdout, stderr }))
  })

/** Check that `bin` is an executable Blender >= 4.2 */
export async function validateBlenderBinary(bin: string, source: BlenderSource, runner: VersionRunner = runVersion): Promise<BlenderStatus> {
  try {
    const st = fs.statSync(bin)
    if (st.isDirectory()) return { found: false, path: bin, reason: `Path merupakan folder, bukan program Blender: ${bin}` }
  } catch {
    return { found: false, path: bin, reason: `File tidak ditemukan: ${bin}` }
  }
  const res = await runner(bin)
  if (res.error) return { found: false, path: bin, reason: `Gagal menjalankan Blender: ${res.error}` }
  if (res.code !== 0) return { found: false, path: bin, reason: `Blender keluar dengan kode ${res.code}: ${res.stderr.trim().slice(-300)}` }
  const parsed = parseBlenderVersion(res.stdout)
  if (!parsed.ok) return { found: false, path: bin, version: parsed.version, reason: parsed.reason }
  return { found: true, path: bin, version: parsed.version, source }
}
