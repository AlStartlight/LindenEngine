import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import { z } from 'zod'
import type { ToolDefinition, ToolResult } from './index'
import { importAssetFile } from './modelTools'
import { BlenderSpecSchema, parseBlenderError, parseBlenderResult, type BlenderRunResult } from '../../../shared/blenderSpec'
import { getBlenderStatus } from '../../bridge/blenderDetect'
import { blenderSpawnEnv } from '../../bridge/blenderExec'
import { blenderTurnActive, BLENDER_MODE_OFF_ERROR } from '../blenderMode'
import { resolveAppResource } from '../../resourcePaths'

/**
 * "Blender 3D" mode: the agent builds a model in the user's own Blender (separate process,
 * background mode, factory settings) and the .glb goes through the normal asset import.
 * The Python that runs inside Blender lives in blender-bridge/ (GPL); this file only spawns it.
 */

export const BLENDER_TIMEOUT_MS = 120_000
/** Characters of stderr returned to the agent (the tail; Blender logs are long) */
export const STDERR_TAIL = 4096
export const MAX_SCRIPT_BYTES = 64 * 1024
/** Heavier results are not imported (the scene has to stay interactive) */
export const MAX_TRIANGLES = 300_000
const KEEP_FAILED_JOBS = 5
const JOBS_DIR = '.linden/agent/blender'

export type BlenderSpawn = typeof nodeSpawn
let spawnImpl: BlenderSpawn = nodeSpawn

/** Tests replace the process spawn (no Blender needed) */
export function setBlenderSpawn(fn: BlenderSpawn | null): void {
  spawnImpl = fn ?? nodeSpawn
}

export function tail(text: string, max = STDERR_TAIL): string {
  return text.length > max ? `…${text.slice(-max)}` : text
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'model'

function zodMessage(err: z.ZodError): string {
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
    .join('; ')
}

function runnerPath(): string {
  return resolveAppResource('blender-bridge/runner.py', 'blender-bridge/runner.py')
}

export interface BlenderRunOutput {
  ok: boolean
  result?: BlenderRunResult
  error?: string
}

/**
 * Run blender-bridge/runner.py in the user's Blender inside `jobDir` and parse its summary.
 * Never through a shell; factory settings, autoexec off, offline, killed after the timeout.
 */
export function runBlender(bin: string, jobDir: string, modeArgs: string[], timeoutMs = BLENDER_TIMEOUT_MS): Promise<BlenderRunOutput> {
  const args = ['-b', '--factory-startup', '-Y', '--offline-mode', '--python-exit-code', '1', '-P', runnerPath(), '--', ...modeArgs, '--out', path.join(jobDir, 'out.glb')]
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const finish = (out: BlenderRunOutput) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        fs.writeFileSync(path.join(jobDir, 'log.txt'), `$ ${bin} ${args.join(' ')}\n\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`)
      } catch {}
      resolve(out)
    }
    let child: ReturnType<BlenderSpawn>
    try {
      child = spawnImpl(bin, args, { cwd: jobDir, env: blenderSpawnEnv(path.join(jobDir, 'user')), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e: any) {
      resolve({ ok: false, error: `Gagal menjalankan Blender: ${e.message}` })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    // Keep memory bounded; only the tails matter
    child.stdout?.on('data', (d) => (stdout = (stdout + d.toString()).slice(-256 * 1024)))
    child.stderr?.on('data', (d) => (stderr = (stderr + d.toString()).slice(-256 * 1024)))
    child.on('error', (e) => finish({ ok: false, error: `Gagal menjalankan Blender: ${e.message}` }))
    child.on('close', (code) => {
      if (timedOut) return finish({ ok: false, error: `Blender melewati batas waktu ${Math.round(timeoutMs / 1000)} detik dan dihentikan` })
      const result = parseBlenderResult(stdout)
      if (code === 0 && result) return finish({ ok: true, result })
      const reason = parseBlenderError(stderr) ?? (code === 0 ? 'Blender selesai tanpa baris LINDEN_RESULT' : `Blender keluar dengan kode ${code}`)
      const log = tail(stderr.trim() || stdout.trim())
      finish({ ok: false, error: log ? `${reason}\n--- stderr Blender (akhir) ---\n${log}` : reason })
    })
  })
}

/** Keep the newest failed jobs for debugging, drop the rest */
function pruneFailedJobs(projectPath: string): void {
  const dir = path.join(projectPath, JOBS_DIR)
  try {
    const jobs = fs
      .readdirSync(dir)
      .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const job of jobs.slice(KEEP_FAILED_JOBS)) fs.rmSync(path.join(dir, job.name), { recursive: true, force: true })
  } catch {}
}

const TargetSchema = z
  .string()
  .regex(/^assets\/[A-Za-z0-9_\-./]+\.glb$/, 'target harus file .glb di dalam assets/')
  .refine((t) => !t.split('/').includes('..'), 'target tidak boleh memakai ..')

/** Shared flow of build and script: write inputs, run Blender, import the GLB */
async function buildJob(projectPath: string, name: string, target: string | undefined, write: (jobDir: string) => string[]): Promise<ToolResult> {
  const status = getBlenderStatus()
  if (!status.found || !status.path) return { success: false, error: status.reason ?? 'Blender tidak ditemukan. Atur path di pengaturan Bridge.' }
  const jobId = `${slug(name)}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const jobDir = path.join(projectPath, JOBS_DIR, jobId)
  fs.mkdirSync(jobDir, { recursive: true })
  const modeArgs = write(jobDir)
  const run = await runBlender(status.path, jobDir, modeArgs)
  const out = path.join(jobDir, 'out.glb')
  if (!run.ok || !run.result || !fs.existsSync(out)) {
    pruneFailedJobs(projectPath)
    return { success: false, error: `${run.error ?? 'Blender tidak menghasilkan out.glb'}\n(log: ${path.relative(projectPath, path.join(jobDir, 'log.txt')).split(path.sep).join('/')})` }
  }
  if (run.result.triangles > MAX_TRIANGLES) {
    pruneFailedJobs(projectPath)
    return { success: false, error: `Model terlalu berat (${run.result.triangles} segitiga, maks ${MAX_TRIANGLES}); kurangi subdivision, segments atau array` }
  }
  try {
    const imported = importAssetFile(projectPath, out, target ?? `assets/models/${slug(name)}.glb`)
    fs.rmSync(jobDir, { recursive: true, force: true })
    return {
      success: true,
      data: {
        ...imported,
        blender: { version: status.version, ...run.result, axes: 'bounds dalam sumbu Blender (Z atas); GLB sudah Y-up' },
        next: `linden_model_build {name, model:{src:"${imported.path}"}} lalu linden_render_preview`,
      },
    }
  } catch (err: any) {
    pruneFailedJobs(projectPath)
    return { success: false, error: `GLB dari Blender gagal diimpor: ${err.message}` }
  }
}

const blenderAvailable = () => getBlenderStatus().found

const BuildArgs = z.object({ name: z.string().min(1).max(64), spec: BlenderSpecSchema, target: TargetSchema.optional() }).strict()
const ScriptArgs = z.object({ name: z.string().min(1).max(64), code: z.string().min(1), target: TargetSchema.optional() }).strict()

export const BLENDER_TOOLS: Record<string, ToolDefinition> = {
  linden_blender_status: {
    name: 'linden_blender_status',
    description: 'Status Blender milik user: terdeteksi atau tidak, versi, dan apakah mode Blender 3D aktif untuk prompt ini.',
    parameters: { type: 'object', properties: {} },
    available: blenderAvailable,
    async execute() {
      const s = getBlenderStatus()
      return { success: true, data: { found: s.found, version: s.version ?? null, path: s.path ?? null, active: blenderTurnActive(), ...(s.reason ? { reason: s.reason } : {}) } }
    },
  },

  linden_blender_build: {
    name: 'linden_blender_build',
    description:
      'Membuat model 3D di Blender milik user dari spec deklaratif (primitive + modifier bevel/subdivision/solidify/array/mirror/boolean + material PBR), ' +
      'mengekspor .glb lalu mengimpornya ke assets/models/. Hanya aktif bila user mencentang "Blender 3D". Sumbu spec: Z atas, meter, rotasi derajat. ' +
      'Setelahnya: linden_model_build {model:{src}} lalu linden_render_preview.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nama model, juga nama file default assets/models/<nama>.glb' },
        spec: {
          type: 'object',
          description:
            '{objects:[{name, primitive:"cube"|"uv_sphere"|"cylinder"|"cone"|"torus"|"plane", params?:{size,radius,radius1,radius2,depth,segments,rings,vertices,majorRadius,minorRadius,majorSegments,minorSegments}, ' +
            'location?:[x,y,z], rotation?:[x,y,z] derajat, scale?:[x,y,z], modifiers?:[{type:"bevel",width,segments?,limit?}|{type:"subdivision",levels≤3}|{type:"solidify",thickness}|' +
            '{type:"array",count,offset:[x,y,z] relatif}|{type:"mirror",axes:["x"]}|{type:"boolean",operation:"difference"|"union"|"intersect",with:"<nama objek cutter>"}], ' +
            'material?:{baseColor:"#rrggbb", metallic?, roughness?}, smooth?, uv?:"smart"|"none", cutter?:true}], ground?:true, join?:false}',
        },
        target: { type: 'string', description: 'Tujuan .glb di assets/ (default assets/models/<nama>.glb)' },
      },
      required: ['name', 'spec'],
    },
    available: blenderAvailable,
    async execute(projectPath: string, args: unknown) {
      if (!blenderTurnActive()) return { success: false, error: BLENDER_MODE_OFF_ERROR }
      const parsed = BuildArgs.safeParse(args)
      if (!parsed.success) return { success: false, error: `Spec Blender tidak valid: ${zodMessage(parsed.error)}` }
      const { name, spec, target } = parsed.data
      try {
        return await buildJob(projectPath, name, target, (jobDir) => {
          const file = path.join(jobDir, 'spec.json')
          fs.writeFileSync(file, JSON.stringify(spec, null, 2))
          return ['--spec', file]
        })
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_blender_script: {
    name: 'linden_blender_script',
    description:
      'Menjalankan kode Python bpy buatanmu di Blender milik user (background, factory settings), lalu mengekspor semua objek mesh yang terlihat ke .glb dan mengimpornya. ' +
      'User harus menyetujui kodenya dulu. Pakai HANYA bila bentuknya tidak bisa diwakili spec linden_blender_build. Jangan ekspor sendiri, jangan akses file atau jaringan.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nama model, juga nama file default assets/models/<nama>.glb' },
        code: { type: 'string', description: 'Script Python bpy yang membuat objek mesh di scene kosong (Z atas, meter)' },
        target: { type: 'string', description: 'Tujuan .glb di assets/ (default assets/models/<nama>.glb)' },
      },
      required: ['name', 'code'],
    },
    available: blenderAvailable,
    async execute(projectPath: string, args: unknown, options) {
      if (!blenderTurnActive()) return { success: false, error: BLENDER_MODE_OFF_ERROR }
      const parsed = ScriptArgs.safeParse(args)
      if (!parsed.success) return { success: false, error: `Argumen tidak valid: ${zodMessage(parsed.error)}` }
      const { name, code, target } = parsed.data
      if (Buffer.byteLength(code, 'utf-8') > MAX_SCRIPT_BYTES) return { success: false, error: `Script terlalu panjang (maks ${MAX_SCRIPT_BYTES / 1024} KB)` }
      if (!options?.requestPermission) return { success: false, error: 'Script Blender butuh persetujuan user di editor Linden' }
      const allowed = await options.requestPermission({
        action: 'blender_script',
        message: `Agent ingin menjalankan script Python di Blender untuk membuat "${name}". Script berjalan dengan hak akses akun kamu (bukan sandbox). Periksa kodenya sebelum mengizinkan.`,
        resources: [name],
        code,
      })
      if (!allowed) return { success: false, error: 'Script Blender ditolak user. Coba linden_blender_build dengan spec, atau tanyakan user.' }
      if (!blenderTurnActive()) return { success: false, error: BLENDER_MODE_OFF_ERROR }
      try {
        return await buildJob(projectPath, name, target, (jobDir) => {
          const file = path.join(jobDir, 'script.py')
          fs.writeFileSync(file, code)
          return ['--script', file]
        })
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}
