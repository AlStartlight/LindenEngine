import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveAppResource } from '../resourcePaths'
import { resolvePython, type PythonResolution } from './pythonBinary'

/**
 * img2threejs (https://github.com/img2threejs/img2threejs) inside Linden Agent. A pinned, trimmed
 * copy ships in resources/agent-skills/img2threejs (scripts/vendor-img2threejs.mjs). Its forge
 * scripts write caches next to themselves, so they run from a per-version copy in userData; every
 * reconstruction gets a job folder in the project (.linden/img2threejs/<job>/) as its cwd.
 * See docs/specs/SPEC-Img2ThreeJS-Agent.md.
 */

export const IMG2_JOB_ROOT = '.linden/img2threejs'
const OUTPUT_CAP = 64 * 1024
export const DEFAULT_TIMEOUT_S = 120
export const MAX_TIMEOUT_S = 600

/** Scripts the agent may not run: emission targets need plugins, projection needs a ShaderMaterial, vision adapters install/run third-party models */
export const BLOCKED_SCRIPTS = new Set(['stage3_build/emit_target.py', 'stage3_build/bake_projected_texture.py', 'stage1_intake/run_vision_adapter.py'])
const SCRIPT_DIRS = ['stage1_intake', 'stage2_spec', 'stage3_build', 'stage4_review', 'stage5_rig']
const TOP_SCRIPTS = ['state.py', 'next.py', 'report.py']

/** Flags whose value is always a path */
const PATH_FLAGS = new Set([
  '--out', '--out-dir', '--state', '--image', '--reference', '--spec', '--assessment', '--evidence', '--render', '--render-screenshot',
  '--comparison-image', '--manifest', '--augmentation', '--feature-reviews-json', '--domain-review-json', '--review-scene-json', '--blocked-report',
  '--measured', '--crop', '--registry', '--input', '--meshes', '--mask', '--capture',
])
/** Project folders a relative path may name directly; anything else is relative to the job folder */
const PROJECT_PREFIXES = ['references/', 'models/', 'assets/', 'scenes/', '.linden/']
/** Skill folders a relative path may name (read-only reference data) */
const SKILL_PREFIXES = ['grimoire/', 'docs/', 'forge/']
const PATHLIKE_EXT = /\.(png|jpe?g|webp|gif|bmp|json|ts|js|md|txt|glb|gltf|csv)$/i

let runtimeRoot: string | null = null

/** Writable folder for the per-version skill copy (userData/agent-skills) */
export function setImg2RuntimeRoot(dir: string | null): void {
  runtimeRoot = dir
  runtimeReady = null
}

/** The vendored, read-only copy shipped with Linden */
export function skillSourceDir(): string {
  return resolveAppResource(path.join('resources', 'agent-skills', 'img2threejs'), path.join('agent-skills', 'img2threejs'))
}

export interface SkillVendorInfo {
  repo: string
  commit: string | null
  skillVersion: string | null
  treeSha256: string
}

export function readVendorInfo(dir = skillSourceDir()): SkillVendorInfo | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'VENDOR.json'), 'utf-8'))
  } catch {
    return null
  }
}

let runtimeReady: Promise<string> | null = null

/** Copy the vendored skill into userData once per version and return that folder */
export function ensureSkillRuntime(): Promise<string> {
  if (!runtimeReady) runtimeReady = prepareRuntime().catch((err) => {
    runtimeReady = null
    throw err
  })
  return runtimeReady
}

/** Files the skill writes at runtime, or Linden adds, that are not part of the vendored tree */
const RUNTIME_ONLY = /(^|\/)(\.cache|__pycache__)(\/|$)|\.pyc$|^\.linden-ready$|^VENDOR\.json$/

/**
 * sha256 over the skill tree, the same way scripts/vendor-img2threejs.mjs computes VENDOR.json
 * treeSha256 (sorted paths, "path\0content"), skipping runtime-only files.
 */
export function skillTreeHash(dir: string): string {
  const h = crypto.createHash('sha256')
  const walk = (d: string, rel: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const r = rel ? `${rel}/${name}` : name
      if (RUNTIME_ONLY.test(r)) continue
      const full = path.join(d, name)
      if (fs.statSync(full).isDirectory()) walk(full, r)
      else h.update(r).update('\0').update(fs.readFileSync(full))
    }
  }
  walk(dir, '')
  return h.digest('hex')
}

async function prepareRuntime(): Promise<string> {
  const src = skillSourceDir()
  const info = readVendorInfo(src)
  if (!info || !fs.existsSync(path.join(src, 'forge'))) throw new Error(`Salinan img2threejs tidak ditemukan di ${src}`)
  const root = runtimeRoot ?? path.join(os.tmpdir(), 'linden-agent-skills')
  const name = `img2threejs-${(info.treeSha256 || 'dev').slice(0, 12)}`
  const dest = path.join(root, name)
  if (fs.existsSync(path.join(dest, '.linden-ready'))) {
    // The copy lives in a writable folder: run it only while it still matches the vendored tree
    if (!info.treeSha256 || skillTreeHash(dest) === info.treeSha256) return dest
    fs.rmSync(dest, { recursive: true, force: true })
  }
  fs.mkdirSync(root, { recursive: true })
  // Older copies (other versions, or unpatched ones) are never used again
  for (const old of fs.readdirSync(root)) {
    if (old !== name && /^img2threejs-[0-9a-f]{12}$|^img2threejs-dev$/.test(old)) fs.rmSync(path.join(root, old), { recursive: true, force: true })
  }
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`
  await fs.promises.cp(src, tmp, { recursive: true })
  fs.writeFileSync(path.join(tmp, '.linden-ready'), JSON.stringify({ commit: info.commit, at: new Date().toISOString() }))
  try {
    fs.renameSync(tmp, dest)
  } catch (err) {
    // Another window prepared it first
    fs.rmSync(tmp, { recursive: true, force: true })
    if (!fs.existsSync(path.join(dest, '.linden-ready'))) throw err
  }
  return dest
}

/** Scripts linden_img2_run accepts, relative to forge/ */
export function listAllowedScripts(skillDir: string): string[] {
  const forge = path.join(skillDir, 'forge')
  const out: string[] = TOP_SCRIPTS.filter((s) => fs.existsSync(path.join(forge, s)))
  for (const dir of SCRIPT_DIRS) {
    let names: string[] = []
    try {
      names = fs.readdirSync(path.join(forge, dir))
    } catch {
      continue
    }
    for (const n of names.sort()) if (n.endsWith('.py') && !n.startsWith('_')) out.push(`${dir}/${n}`)
  }
  return out.filter((s) => !BLOCKED_SCRIPTS.has(s))
}

/** "forge/stage2_spec/x.py", "python3 forge/x.py" or "x.py" → "stage2_spec/x.py" */
export function normalizeScript(script: string): string {
  return script.trim().replace(/\\/g, '/').replace(/^python3?\s+/, '').replace(/^\.\//, '').replace(/^forge\//, '')
}

export function isValidJobName(job: unknown): job is string {
  return typeof job === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(job)
}

export function jobDir(projectPath: string, job: string): string {
  return path.join(projectPath, ...IMG2_JOB_ROOT.split('/'), job)
}

const within = (base: string, p: string) => p === base || p.startsWith(base + path.sep)

export interface ResolvedArgs {
  args: string[]
  error?: string
  /** Project-relative value of --out, if any */
  out?: string
}

/**
 * Rewrite path arguments for a run with cwd = job folder: paths stay inside the project (or the
 * skill's reference folders), "references/..", "models/..", "assets/..", ".linden/.." mean the
 * project root, anything else relative means the job folder. --target is refused.
 */
export function resolveScriptArgs(projectPath: string, job: string, skillDir: string, raw: string[]): ResolvedArgs {
  const project = path.resolve(projectPath)
  const jobAbs = jobDir(project, job)
  const skill = path.resolve(skillDir)
  const out: string[] = []
  let outRel: string | undefined
  let expectPath = false
  let lastFlag = ''

  const mapPath = (value: string): string | { error: string } => {
    const norm = value.replace(/\\/g, '/')
    let abs: string
    if (path.isAbsolute(value)) abs = path.resolve(value)
    else if (PROJECT_PREFIXES.some((p) => norm.startsWith(p))) abs = path.resolve(project, norm)
    else if (SKILL_PREFIXES.some((p) => norm.startsWith(p))) abs = path.resolve(skill, norm)
    else abs = path.resolve(jobAbs, norm)
    if (!within(project, abs) && !within(skill, abs)) return { error: `Path di luar proyek ditolak: ${value}` }
    if (within(skill, abs) && !SKILL_PREFIXES.some((p) => path.relative(skill, abs).split(path.sep).join('/').startsWith(p))) {
      return { error: `Path skill hanya boleh di grimoire/, docs/ atau forge/: ${value}` }
    }
    return abs
  }

  for (let i = 0; i < raw.length; i++) {
    const a = String(raw[i])
    if (a === '--target' || a.startsWith('--target=')) return { args: [], error: '--target (emission target / plugin exporter) tidak didukung di Linden' }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const flag = eq > 0 ? a.slice(0, eq) : a
      if (eq > 0) {
        const value = a.slice(eq + 1)
        if (PATH_FLAGS.has(flag) && value && !/^[[{]/.test(value)) {
          const mapped = mapPath(value)
          if (typeof mapped !== 'string') return { args: [], error: mapped.error }
          out.push(`${flag}=${mapped}`)
          if (flag === '--out') outRel = path.relative(project, mapped).split(path.sep).join('/')
        } else out.push(a)
        expectPath = false
      } else {
        out.push(a)
        expectPath = PATH_FLAGS.has(flag)
        lastFlag = flag
      }
      continue
    }
    const looksLikePath = !/^[[{]/.test(a) && !/^-?\d/.test(a) && (a.includes('/') || a.includes('\\') || PATHLIKE_EXT.test(a))
    // --capture 0=front.png: angle=path pairs (turntable_gate.py)
    const capture = lastFlag === '--capture' && expectPath ? /^(-?\d+(?:\.\d+)?)=(.+)$/.exec(a) : null
    if (capture) {
      const mapped = mapPath(capture[2])
      if (typeof mapped !== 'string') return { args: [], error: mapped.error }
      out.push(`${capture[1]}=${mapped}`)
    } else if (expectPath || looksLikePath) {
      const mapped = mapPath(a)
      if (typeof mapped !== 'string') return { args: [], error: mapped.error }
      out.push(mapped)
      if (expectPath && lastFlag === '--out') outRel = path.relative(project, mapped).split(path.sep).join('/')
    } else out.push(a)
    expectPath = false
  }
  return { args: out, out: outRel }
}

function snapshot(dirs: string[]): Map<string, number> {
  const m = new Map<string, number>()
  const walk = (d: string, depth: number) => {
    if (depth > 6) return
    let ents: fs.Dirent[] = []
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (e.isFile()) {
        try {
          m.set(full, fs.statSync(full).mtimeMs)
        } catch {
          // gone
        }
      }
      if (m.size > 20000) return
    }
  }
  for (const d of dirs) walk(d, 0)
  return m
}

const tail = (s: string) => (s.length > OUTPUT_CAP ? `[...${s.length - OUTPUT_CAP} karakter awal dipotong]\n${s.slice(-OUTPUT_CAP)}` : s)

export interface Img2RunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  /** Project-relative files the run created or changed */
  files: string[]
  hardStop: boolean
  timedOut: boolean
  durationMs: number
  python: string | null
  out?: string
}

export interface Img2RunOptions {
  projectPath: string
  job: string
  script: string
  args: string[]
  timeoutSec?: number
  python?: PythonResolution
  skillDir?: string
}

/** Run one forge script for a job. Throws on setup errors (no Python, bad script, bad paths). */
export async function runForgeScript(opts: Img2RunOptions): Promise<Img2RunResult> {
  if (!isValidJobName(opts.job)) throw new Error(`job harus slug huruf kecil/angka/-/_ (maks 64), mis. "kursi-jati" (dapat: ${opts.job})`)
  const python = opts.python ?? (await resolvePython())
  if (!python.bin) throw new Error(python.error ?? 'Python >= 3.10 tidak ditemukan')
  const skillDir = opts.skillDir ?? (await ensureSkillRuntime())
  const script = normalizeScript(opts.script)
  const allowed = listAllowedScripts(skillDir)
  if (!allowed.includes(script)) {
    const hint = BLOCKED_SCRIPTS.has(script) ? 'script ini tidak didukung di Linden' : `script tidak dikenal; contoh: ${allowed.slice(0, 6).join(', ')}`
    throw new Error(`${script}: ${hint}`)
  }
  const project = path.resolve(opts.projectPath)
  const resolved = resolveScriptArgs(project, opts.job, skillDir, opts.args ?? [])
  if (resolved.error) throw new Error(resolved.error)
  if (script === 'stage3_build/generate_threejs_factory.py') {
    if (!resolved.out || !/^models\/.+\.ts$/.test(resolved.out)) throw new Error('generate_threejs_factory.py: --out harus file .ts di dalam models/, mis. models/kursi-jati/createKursiJatiModel.ts')
    if (resolved.args.includes('--allow-nonstrict')) throw new Error('--allow-nonstrict hanya untuk fixture uji, bukan hasil produksi')
  }

  const cwd = jobDir(project, opts.job)
  fs.mkdirSync(cwd, { recursive: true })
  const tmp = path.join(project, '.linden', 'agent', 'tmp')
  fs.mkdirSync(tmp, { recursive: true })
  const img2Home = path.join(path.dirname(skillDir), 'img2-home')
  fs.mkdirSync(img2Home, { recursive: true })

  const watch = [cwd, path.join(project, 'models'), path.join(project, 'references')]
  const before = snapshot(watch)
  const started = Date.now()
  const timeoutMs = Math.min(MAX_TIMEOUT_S, Math.max(5, opts.timeoutSec ?? DEFAULT_TIMEOUT_S)) * 1000

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(python.bin!, [...python.args, '-B', '-E', '-s', path.join(skillDir, 'forge', ...script.split('/')), ...resolved.args], {
      cwd,
      shell: false,
      env: {
        PATH: python.envPath,
        HOME: process.env.HOME ?? os.homedir(),
        USERPROFILE: process.env.USERPROFILE ?? '',
        SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        LANG: process.env.LANG ?? 'C.UTF-8',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        TMPDIR: tmp,
        TMP: tmp,
        TEMP: tmp,
        // Plugin registry: an empty, Linden-owned home, so user-installed img2 plugins never leak in
        IMG2_HOME: img2Home,
      },
    })
    const cap = (cur: string, d: Buffer) => (cur.length > OUTPUT_CAP * 4 ? cur.slice(-OUTPUT_CAP * 2) + d.toString() : cur + d.toString())
    child.stdout.on('data', (d) => (stdout = cap(stdout, d)))
    child.stderr.on('data', (d) => (stderr = cap(stderr, d)))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`Python tidak bisa dijalankan (${python.bin}): ${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })

  const after = snapshot(watch)
  const files: string[] = []
  for (const [f, m] of after) if (before.get(f) !== m) files.push(path.relative(project, f).split(path.sep).join('/'))
  files.sort()
  const hardStop = result.code === 3 || /\bstatus=stopped\b/.test(result.stdout)
  return {
    exitCode: result.code,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
    files: files.slice(0, 200),
    hardStop,
    timedOut: result.timedOut,
    durationMs: Date.now() - started,
    python: python.version,
    out: resolved.out,
  }
}

/** A file of the skill (SKILL.md, grimoire/**, docs/**, forge/** data) for the agent to read */
export function readSkillFile(
  skillDir: string,
  rel: string,
  startLine = 1,
  maxLines = 0
): { path: string; text: string; lines: number; truncated: boolean; notice?: string } {
  const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/#.*$/, '') || 'SKILL.md'
  const ok = norm === 'SKILL.md' || norm === 'CHANGELOG.md' || norm === 'LICENSE' || norm === 'VENDOR.json' || SKILL_PREFIXES.some((p) => norm.startsWith(p))
  if (!ok || norm.split('/').includes('..')) throw new Error(`Hanya SKILL.md, grimoire/, docs/ dan forge/ yang bisa dibaca (dapat: ${rel})`)
  const full = path.resolve(skillDir, norm)
  if (!within(path.resolve(skillDir), full)) throw new Error(`Path di luar skill: ${rel}`)
  if (!fs.existsSync(full)) throw new Error(`File skill tidak ada: ${norm}`)
  if (fs.statSync(full).isDirectory()) {
    const entries = fs.readdirSync(full, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort()
    return { path: norm, text: entries.join('\n'), lines: entries.length, truncated: false }
  }
  const all = fs.readFileSync(full, 'utf-8').split('\n')
  const start = Math.max(1, startLine)
  const limit = maxLines > 0 ? maxLines : 2000
  const slice = all.slice(start - 1, start - 1 + limit)
  let text = slice.join('\n')
  let truncated = start - 1 + limit < all.length
  if (text.length > 200 * 1024) {
    text = text.slice(0, 200 * 1024)
    truncated = true
  }
  const notice = HOST_NOTES.find((n) => n.files.test(norm))?.note
  return { path: norm, text: notice ? `${notice}\n\n${text}` : text, lines: all.length, truncated, ...(notice ? { notice } : {}) }
}

const INSTALL_NOTE =
  '[Linden] img2threejs is already installed in Linden, pinned and patched (VENDOR.json). Install, update, symlink and plugin steps in this file do not apply: ' +
  'do not run npx/npm/pip/uv or `img2` commands, and do not edit ~/.claude, ~/.hermes, ~/.codex, ~/.img2 or .env files. Run forge scripts only with linden_img2_run.'

/**
 * Notes Linden puts above skill files whose host-setup instructions do not apply here (upstream
 * documents an `npx img2threejs@latest install` flow, plugin hosts and a showcase toolchain).
 */
const HOST_NOTES: { files: RegExp; note: string }[] = [
  { files: /^(SKILL\.md|CHANGELOG\.md|docs\/(INSTALL|PLUGINS)\.md)$/, note: INSTALL_NOTE },
  {
    files: /^docs\/GLB_(ANIMATED_)?CHARACTER(_POLISH)?_PROMPT\.md$|^docs\/standard-prompts\//,
    note: `${INSTALL_NOTE} The showcase build (integrations/, build-character.sh, <subject>.env, npx tsc/vite) is not shipped with Linden; use linden_model_build and linden_render_preview instead.`,
  },
]

/** Short hash of a file (for review evidence) */
export function fileSha(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
}
