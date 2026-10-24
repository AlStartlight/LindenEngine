import fs from 'node:fs'
import path from 'node:path'
import { spawnSync, execSync } from 'node:child_process'
import type { GodotExecResolution } from '../../shared/godotBridgeTypes'

let cachedSettingsPath: string | null = null

export function setBridgeSettingsDir(userDataDir: string) {
  cachedSettingsPath = path.join(userDataDir, 'bridge-settings.json')
}

export function loadBridgeSettings(): { godotExecutable?: string; godotVersion?: string } {
  if (cachedSettingsPath && fs.existsSync(cachedSettingsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachedSettingsPath, 'utf-8'))
      return data || {}
    } catch {
      return {}
    }
  }
  return {}
}

export function saveBridgeSettings(settings: { godotExecutable?: string; godotVersion?: string }) {
  if (cachedSettingsPath) {
    try {
      const existing = loadBridgeSettings()
      const merged = { ...existing, ...settings }
      fs.writeFileSync(cachedSettingsPath, JSON.stringify(merged, null, 2), 'utf-8')
    } catch {}
  }
}

/**
 * Normalizes user-provided path (handles macOS .app bundles)
 */
export function normalizeGodotPath(inputPath: string): string {
  let clean = inputPath.trim()
  if (clean.endsWith('/') || clean.endsWith('\\')) {
    clean = clean.slice(0, -1)
  }

  if (process.platform === 'darwin' && clean.endsWith('.app')) {
    const binary = path.join(clean, 'Contents', 'MacOS', 'Godot')
    if (fs.existsSync(binary)) {
      return binary
    }
  }

  return clean
}

export function parseGodotVersion(output: string): { ok: boolean; version?: string; reason?: string } {
  const clean = (output || '').trim()
  if (!clean) {
    return { ok: false, reason: 'Godot --version tidak memberikan output' }
  }

  // Example outputs:
  // "4.7.2.stable.official.972322"
  // "4.3.stable"
  const match = clean.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) {
    return { ok: false, reason: `Format versi Godot tidak dikenali: "${clean}"` }
  }

  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10)
  const patch = match[3] ? parseInt(match[3], 10) : 0
  const semver = `${major}.${minor}.${patch}`

  if (major < 4 || (major === 4 && minor < 3)) {
    return {
      ok: false,
      version: semver,
      reason: `Versi Godot minimal 4.3 diperlukan (terdeteksi: ${clean})`,
    }
  }

  return { ok: true, version: semver }
}

/**
 * Validates executable binary by running `--version` and checking version >= 4.3
 */
export function validateGodotBinary(
  binaryPath: string,
  runner?: (bin: string, args: string[]) => { status?: number | null; stdout?: string; stderr?: string; error?: Error }
): GodotExecResolution {
  if (!fs.existsSync(binaryPath)) {
    return { ok: false, reason: `File tidak ditemukan: ${binaryPath}` }
  }

  try {
    const stats = fs.statSync(binaryPath)
    if (stats.isDirectory()) {
      return { ok: false, reason: `Path merupakan direktori, bukan binary: ${binaryPath}` }
    }
  } catch (err: any) {
    return { ok: false, reason: `Gagal membaca file: ${err.message}` }
  }

  try {
    const proc = runner
      ? runner(binaryPath, ['--version'])
      : spawnSync(binaryPath, ['--version'], {
          timeout: 5000,
          encoding: 'utf-8',
          env: { ...process.env, GODOT_HEADLESS: '1' },
        })

    if (proc.error) {
      return { ok: false, reason: `Gagal menjalankan Godot: ${proc.error.message}` }
    }

    if (proc.status !== 0) {
      return { ok: false, reason: `Godot keluar dengan kode error ${proc.status}: ${proc.stderr || ''}` }
    }

    const output = (proc.stdout || '').trim()
    const parsed = parseGodotVersion(output)
    if (!parsed.ok) {
      return {
        ok: false,
        path: binaryPath,
        version: parsed.version,
        reason: parsed.reason,
      }
    }

    return {
      ok: true,
      path: binaryPath,
      version: parsed.version,
    }
  } catch (err: any) {
    return { ok: false, reason: `Validasi gagal: ${err.message}` }
  }
}

/**
 * Searches candidate system paths for Godot binary
 */
export function findSystemGodotCandidates(): string[] {
  const candidates: string[] = []
  const platform = process.platform

  if (platform === 'darwin') {
    const searchDirs = [
      '/Applications',
      path.join(process.env.HOME || '', 'Applications'),
      path.join(process.env.HOME || '', 'Downloads'),
    ]

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue
      try {
        const entries = fs.readdirSync(dir)
        for (const entry of entries) {
          if (entry.toLowerCase().startsWith('godot') && entry.endsWith('.app')) {
            const bin = path.join(dir, entry, 'Contents', 'MacOS', 'Godot')
            if (fs.existsSync(bin)) {
              candidates.push(bin)
            }
          }
        }
      } catch {}
    }

    candidates.push(
      '/Applications/Godot.app/Contents/MacOS/Godot',
      '/Applications/Godot 4.app/Contents/MacOS/Godot',
      '/Applications/Godot_mono.app/Contents/MacOS/Godot'
    )
  } else if (platform === 'win32') {
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    candidates.push(
      path.join(progFiles, 'Godot', 'Godot.exe'),
      path.join(progFiles, 'Godot 4', 'Godot.exe'),
      path.join(progFilesX86, 'Godot', 'Godot.exe')
    )
  } else {
    candidates.push(
      '/usr/bin/godot',
      '/usr/local/bin/godot',
      '/usr/bin/godot4',
      '/usr/local/bin/godot4',
      '/snap/bin/godot'
    )
  }

  // Try PATH lookup
  try {
    const cmd = platform === 'win32' ? 'where godot' : 'which godot'
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 1000 }).trim()
    if (out) {
      const p = out.split(/\r?\n/)[0]
      if (p && fs.existsSync(p)) candidates.push(p)
    }
  } catch {}

  // Deduplicate while preserving order
  return Array.from(new Set(candidates))
}

/**
 * Resolves and validates Godot executable.
 * Stores valid result in userData/bridge-settings.json.
 */
export async function resolveGodotExecutable(inputPath?: string): Promise<GodotExecResolution> {
  // 1. If explicit inputPath given
  if (inputPath && inputPath.trim()) {
    const normalized = normalizeGodotPath(inputPath)
    const result = validateGodotBinary(normalized)
    if (result.ok && result.path && result.version) {
      saveBridgeSettings({ godotExecutable: result.path, godotVersion: result.version })
    }
    return result
  }

  // 2. Check cached settings
  const settings = loadBridgeSettings()
  if (settings.godotExecutable) {
    const res = validateGodotBinary(settings.godotExecutable)
    if (res.ok) {
      return res
    }
  }

  // 3. Search candidate paths
  const candidates = findSystemGodotCandidates()
  for (const cand of candidates) {
    const res = validateGodotBinary(cand)
    if (res.ok && res.path && res.version) {
      saveBridgeSettings({ godotExecutable: res.path, godotVersion: res.version })
      return res
    }
  }

  return {
    ok: false,
    reason: 'Godot 4.3+ executable tidak ditemukan di sistem.',
  }
}
