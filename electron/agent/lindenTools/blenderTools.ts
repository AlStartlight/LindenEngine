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
import { ProcessRegistry } from '../../utils/processRegistry'

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
    let unregisterProc = () => {}
    const finish = (out: BlenderRunOutput) => {
      unregisterProc()
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
      unregisterProc = ProcessRegistry.getInstance().registerProcess(child, 'blender-job')
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
  const previewDir = path.join(jobDir, 'previews')
  const modeArgs = [...write(jobDir), '--previews', previewDir]
  const run = await runBlender(status.path, jobDir, modeArgs)
  const out = path.join(jobDir, 'out.glb')
  if (!run.ok || !run.result || !fs.existsSync(out)) {
    pruneFailedJobs(projectPath)
    return { success: false, error: `${run.error ?? 'Blender tidak menghasilkan out.glb'}\n(log: ${path.relative(projectPath, path.join(jobDir, 'log.txt')).split(path.sep).join('/')})` }
  }
  // Blender renders three review angles inside the same job; the agent must see them
  const previews: { mimeType: string; data: string; label: string }[] = []
  for (const [file, label] of [
    ['three_quarter', '3/4'],
    ['front', 'front'],
    ['side', 'side'],
  ] as const) {
    const previewPath = path.join(previewDir, `preview_${file}.png`)
    if (!fs.existsSync(previewPath)) continue
    previews.push({ mimeType: 'image/png', data: fs.readFileSync(previewPath).toString('base64'), label: `Blender preview (${label})` })
  }

  if (run.result.triangles > MAX_TRIANGLES) {
    pruneFailedJobs(projectPath)
    return { success: false, error: `Model terlalu berat (${run.result.triangles} segitiga, maks ${MAX_TRIANGLES}); kurangi subdivision, segments atau array` }
  }
  try {
    const imported = importAssetFile(projectPath, out, target ?? `assets/models/${slug(name)}.glb`)
    fs.rmSync(jobDir, { recursive: true, force: true })
    const warnings = [...(run.result.warnings ?? [])]
    if (run.result.triangles < 300) warnings.push('Geometri sangat rendah (<300 segitiga): tambahkan bevel/subdivision atau parts sebelum menerima hasil ini')
    return {
      success: true,
      data: {
        ...imported,
        blender: { version: status.version, ...run.result, axes: 'bounds dalam sumbu Blender (Z atas); GLB sudah Y-up' },
        previewCount: previews.length,
        warnings,
        next:
          'Lihat gambar preview di atas, bandingkan dengan referensi (linden_reference_view), lalu iterasi spec bila proporsi/detail/material belum tepat. ' +
          `Setelah puas: linden_model_build {name, model:{src:"${imported.path}"}} lalu linden_render_preview. ` +
          'Agar engine tampil sama dengan preview, salin grade Blender (blender.grade.colorGrade) ke settings.colorGrade lewat linden_scene_apply.',
      },
      ...(previews.length > 0 ? { images: previews } : {}),
    }
  } catch (err: any) {
    pruneFailedJobs(projectPath)
    return { success: false, error: `GLB dari Blender gagal diimpor: ${err.message}` }
  }
}

const blenderAvailable = () => getBlenderStatus().found

const BuildArgs = z.object({ name: z.string().min(1).max(64), spec: BlenderSpecSchema, target: TargetSchema.optional() }).strict()
const ScriptArgs = z.object({ name: z.string().min(1).max(64), code: z.string().min(1), target: TargetSchema.optional() }).strict()
const RigCharacterArgs = z
  .object({
    name: z.string().min(1).max(64),
    sourceModel: z.string().min(1).max(256).optional(),
    spec: BlenderSpecSchema.optional(),
    rigType: z.enum(['humanoid_biped', 'mechanical_biped']).optional(),
    height: z.number().positive().max(100).optional(),
    actions: z.array(z.string().min(1).max(32)).max(32).optional(),
    target: TargetSchema.optional(),
  })
  .strict()
  .refine((d) => d.sourceModel || d.spec, 'harus menyertakan setidaknya satu dari sourceModel atau spec')

const OpeningSchema = z.object({
  wall: z.enum(['north', 'south', 'east', 'west']),
  type: z.enum(['window', 'door']),
  width: z.number().positive(),
  height: z.number().positive(),
  offset: z.number().optional(),
})

const EnvironmentArgs = z
  .object({
    name: z.string().min(1).max(64),
    dimensions: z.object({
      width: z.number().positive().max(100),
      length: z.number().positive().max(100),
      height: z.number().positive().max(50),
    }),
    floorColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    wallColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    ceilingColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    hasCeiling: z.boolean().optional(),
    openings: z.array(OpeningSchema).optional(),
    atmosphere: z
      .object({
        sunColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        sunIntensity: z.number().optional(),
        sunDirection: z.tuple([z.number(), z.number(), z.number()]).optional(),
        ambientColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        fog: z.boolean().optional(),
      })
      .optional(),
    target: TargetSchema.optional(),
  })
  .strict()

function generateEnvironmentScript(config: z.infer<typeof EnvironmentArgs>): string {
  const w = config.dimensions.width
  const l = config.dimensions.length
  const h = config.dimensions.height
  const floorCol = config.floorColor ?? '#4a3c31'
  const wallCol = config.wallColor ?? '#dcdcdc'
  const ceilCol = config.ceilingColor ?? '#f5f5f5'
  const hasCeiling = config.hasCeiling ?? true
  const openings = JSON.stringify(config.openings ?? [])

  return `
import bpy

def hex_to_rgb(hex_str):
    s = hex_str.lstrip('#')
    return (int(s[0:2], 16)/255.0, int(s[2:4], 16)/255.0, int(s[4:6], 16)/255.0, 1.0)

def make_mat(name, color_hex, roughness=0.6):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        if 'Base Color' in bsdf.inputs:
            bsdf.inputs['Base Color'].default_value = hex_to_rgb(color_hex)
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = roughness
    return mat

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

floor_mat = make_mat('FloorMat', '${floorCol}', 0.6)
wall_mat = make_mat('WallMat', '${wallCol}', 0.8)
ceil_mat = make_mat('CeilMat', '${ceilCol}', 0.9)

w, l, h = ${w}, ${l}, ${h}
wt = 0.15

# Floor
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, -wt/2.0))
floor_obj = bpy.context.active_object
floor_obj.name = 'Env_Floor'
floor_obj.scale = (w, l, wt)
bpy.ops.object.transform_apply(scale=True)
floor_obj.data.materials.append(floor_mat)

# Ceiling
if ${hasCeiling ? 'True' : 'False'}:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, h + wt/2.0))
    ceil_obj = bpy.context.active_object
    ceil_obj.name = 'Env_Ceiling'
    ceil_obj.scale = (w, l, wt)
    bpy.ops.object.transform_apply(scale=True)
    ceil_obj.data.materials.append(ceil_mat)

# Walls
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, (l + wt)/2.0, h/2.0))
wall_n = bpy.context.active_object; wall_n.name = 'Env_Wall_North'; wall_n.scale = (w + 2*wt, wt, h); bpy.ops.object.transform_apply(scale=True); wall_n.data.materials.append(wall_mat)

bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, -(l + wt)/2.0, h/2.0))
wall_s = bpy.context.active_object; wall_s.name = 'Env_Wall_South'; wall_s.scale = (w + 2*wt, wt, h); bpy.ops.object.transform_apply(scale=True); wall_s.data.materials.append(wall_mat)

bpy.ops.mesh.primitive_cube_add(size=1.0, location=((w + wt)/2.0, 0, h/2.0))
wall_e = bpy.context.active_object; wall_e.name = 'Env_Wall_East'; wall_e.scale = (wt, l, h); bpy.ops.object.transform_apply(scale=True); wall_e.data.materials.append(wall_mat)

bpy.ops.mesh.primitive_cube_add(size=1.0, location=(-(w + wt)/2.0, 0, h/2.0))
wall_w = bpy.context.active_object; wall_w.name = 'Env_Wall_West'; wall_w.scale = (wt, l, h); bpy.ops.object.transform_apply(scale=True); wall_w.data.materials.append(wall_mat)

openings = ${openings}
walls_map = {'north': wall_n, 'south': wall_s, 'east': wall_e, 'west': wall_w}
for i, op in enumerate(openings):
    w_side = op.get('wall')
    target = walls_map.get(w_side)
    if not target: continue
    op_w = float(op.get('width', 1.2))
    op_h = float(op.get('height', 1.4))
    op_type = op.get('type', 'window')
    offset = float(op.get('offset', 0.0))
    z_pos = op_h/2.0 if op_type == 'door' else 1.0 + op_h/2.0

    if w_side == 'north':
        cx, cy = offset, (l + wt)/2.0; s_xyz = (op_w, wt*2.0, op_h)
    elif w_side == 'south':
        cx, cy = offset, -(l + wt)/2.0; s_xyz = (op_w, wt*2.0, op_h)
    elif w_side == 'east':
        cx, cy = (w + wt)/2.0, offset; s_xyz = (wt*2.0, op_w, op_h)
    else:
        cx, cy = -(w + wt)/2.0, offset; s_xyz = (wt*2.0, op_w, op_h)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(cx, cy, z_pos))
    cutter = bpy.context.active_object; cutter.name = 'Cut_' + str(i); cutter.scale = s_xyz; bpy.ops.object.transform_apply(scale=True)
    mod = target.modifiers.new(name='CutMod_' + str(i), type='BOOLEAN')
    mod.operation = 'DIFFERENCE'; mod.object = cutter
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
`
}

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
      'Membuat model 3D fotorealistis di Blender milik user dari spec deklaratif: primitive/lathe + modifier (bevel/subdivision/solidify/array/mirror/boolean/weightedNormal) ' +
      '+ sculpt prosedural (preset clay/stone/wood/fabric/hammered/organic) + tekstur PBR prosedural (albedo/roughness/normal) yang dipanggang ke GLB + color grading (AgX + CDL). ' +
      'Mengekspor .glb lalu mengimpornya ke assets/models/. Hasilnya menyertakan 3 gambar preview Cycles fotorealistis (3/4, depan, samping) supaya kamu bisa menilai dan mengiterasi ' +
      'sebelum dipasang. Hanya aktif bila user mencentang "Blender 3D". Sumbu spec: Z atas, meter, rotasi derajat. ' +
      'Setelah puas: linden_model_build {model:{src}} lalu linden_render_preview dan linden_scene_apply dengan settings.colorGrade.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nama model, juga nama file default assets/models/<nama>.glb' },
        spec: {
          type: 'object',
          description:
            '{objects:[{name, primitive:"cube"|"uv_sphere"|"cylinder"|"cone"|"torus"|"plane"|"lathe", ' +
            'params?:{size,radius,radius1,radius2,depth,segments,rings,vertices,majorRadius,minorRadius,majorSegments,minorSegments,profile?:[[r,z],…] untuk lathe,profileSubdivisions?}, ' +
            'location?:[x,y,z], rotation?:[x,y,z] derajat, scale?:[x,y,z], ' +
            'sculpt?:{preset:"clay"|"stone"|"wood"|"fabric"|"hammered"|"organic"|"custom", strength?:0..0.2 (fraksi diagonal), scale?, seed?, subdivide?:0..3, decimate?:0..1, ' +
            'layers?:[{type:"noise"|"ridged"|"dents"|"wrinkles"|"grain"|"chips", strength?, scale?, detail?, seed?}]}, ' +
            'modifiers?:[{type:"bevel",width,segments?,limit?}|{type:"subdivision",levels≤3}|{type:"solidify",thickness}|' +
            '{type:"array",count,offset:[x,y,z] relatif}|{type:"mirror",axes:["x"]}|{type:"weightedNormal",weight?:0..100}|' +
            '{type:"boolean",operation:"difference"|"union"|"intersect",with:"<nama objek cutter>"}], ' +
            'material?:{baseColor:"#rrggbb", metallic?, roughness?, texture?:{pattern:"noise"|"wood"|"marble"|"concrete"|"fabric"|"stone"|"brushed"|"rust", scale?, contrast?, colorA?, colorB?, roughnessMin?, roughnessMax?, bump?, normalStrength?, resolution?:256|512|1024, seed?}}, ' +
            'smooth?, smoothAngle?:0..180, uv?:"smart"|"none", cutter?:true}], ' +
            'grade?:{viewTransform?:"AgX"|"Filmic"|"Standard"|"Khronos PBR Neutral", look?:"AgX - Medium High Contrast"|…, exposure? (stop), whiteBalance?:{temperature:2000..12000,tint:-100..100}, colorGrade?:{contrast?,saturation?,temperature?,tint?,lift?,gamma?,gain?,vignette?}}, ' +
            'preview?:{engine?:"cycles"|"eevee", samples? (8..256, default 48), resolution?:256|512|768|1024, backdrop?}, ground?:true, join?:false}',
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

  linden_blender_rig_character: {
    name: 'linden_blender_rig_character',
    description:
      'Menerapkan rigging bipedal, skinning, dan menghasilkan suite animasi locomotion lengkap (Idle, Walk, Run, Jump_Start, Fall, Land, Crouch_Idle, Crouch_Walk, Attack) ' +
      'pada model karakter dari spec atau file GLB yang ada di assets/. Output .glb siap pakai dengan Three.js SkinnedMesh dan CharacterAnimator.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nama karakter, juga nama file default assets/models/<nama>.glb' },
        sourceModel: { type: 'string', description: 'Path file .glb sumber di assets/ (opsional jika menggunakan spec)' },
        spec: { type: 'object', description: 'BlenderSpec deklaratif untuk membuat model mesh baru sebelum dirig' },
        rigType: { type: 'string', enum: ['humanoid_biped', 'mechanical_biped'], description: 'Tipe rig (default humanoid_biped)' },
        height: { type: 'number', description: 'Tinggi karakter dalam meter (default dihitung dari bounding box atau 1.8)' },
        actions: { type: 'array', items: { type: 'string' }, description: 'Daftar animasi yang digenerate (default: full locomotion set)' },
        target: { type: 'string', description: 'Tujuan file .glb di assets/ (default assets/models/<nama>.glb)' },
      },
      required: ['name'],
    },
    available: blenderAvailable,
    async execute(projectPath: string, args: unknown) {
      if (!blenderTurnActive()) return { success: false, error: BLENDER_MODE_OFF_ERROR }
      const parsed = RigCharacterArgs.safeParse(args)
      if (!parsed.success) return { success: false, error: `Argumen tidak valid: ${zodMessage(parsed.error)}` }
      const { name, sourceModel, spec, rigType, height, actions, target } = parsed.data
      try {
        return await buildJob(projectPath, name, target, (jobDir) => {
          const rigConfig = {
            type: rigType ?? 'humanoid_biped',
            height,
            generateLocomotion: true,
            actions,
          }
          if (spec) {
            const specWithRig = { ...spec, rig: rigConfig }
            const specFile = path.join(jobDir, 'spec.json')
            fs.writeFileSync(specFile, JSON.stringify(specWithRig, null, 2))
            return ['--spec', specFile]
          }
          // sourceModel mode
          const sourcePath = path.resolve(projectPath, sourceModel!)
          if (!fs.existsSync(sourcePath)) throw new Error(`Source model "${sourceModel}" tidak ditemukan`)
          const rigFile = path.join(jobDir, 'rig.json')
          fs.writeFileSync(rigFile, JSON.stringify(rigConfig, null, 2))
          return ['--source', sourcePath, '--rig', rigFile]
        })
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_blender_environment: {
    name: 'linden_blender_environment',
    description:
      'Membangun struktur lingkungan/ruangan 3D lengkap (lantai, dinding tebal, plafon, bukaan pintu/jendela, material PBR) di Blender milik user, ' +
      'mengekspor file .glb ke assets/models/environments/, dan menghasilkan struktur konfigurasi linden_scene_apply (settings render atmosfer & entities siap pakai).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nama lingkungan/scene (mis. CozyBedroom, SciFiCorridor)' },
        dimensions: {
          type: 'object',
          properties: {
            width: { type: 'number', description: 'Lebar ruangan (X, dalam meter)' },
            length: { type: 'number', description: 'Panjang ruangan (Y, dalam meter)' },
            height: { type: 'number', description: 'Tinggi ruangan (Z, dalam meter)' },
          },
          required: ['width', 'length', 'height'],
        },
        floorColor: { type: 'string', description: 'Hex warna lantai (#rrggbb)' },
        wallColor: { type: 'string', description: 'Hex warna dinding (#rrggbb)' },
        ceilingColor: { type: 'string', description: 'Hex warna plafon (#rrggbb)' },
        hasCeiling: { type: 'boolean', description: 'Buat plafon atau tidak (default true)' },
        openings: {
          type: 'array',
          description: 'Daftar bukaan jendela atau pintu pada dinding',
          items: {
            type: 'object',
            properties: {
              wall: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
              type: { type: 'string', enum: ['window', 'door'] },
              width: { type: 'number' },
              height: { type: 'number' },
              offset: { type: 'number' },
            },
            required: ['wall', 'type', 'width', 'height'],
          },
        },
        atmosphere: {
          type: 'object',
          description: 'Pencahayaan atmosfer (sun, ambient, fog) yang diinterpretasikan dari gambar',
          properties: {
            sunColor: { type: 'string', description: 'Warna cahaya matahari hex (#rrggbb)' },
            sunIntensity: { type: 'number', description: 'Intensitas matahari (default 2.5)' },
            sunDirection: { type: 'array', items: { type: 'number' }, description: '[x, y, z] arah datangnya cahaya matahari' },
            ambientColor: { type: 'string', description: 'Warna cahaya ambient hex (#rrggbb)' },
            fog: { type: 'boolean', description: 'Aktifkan kabut atmosfer atau tidak' },
          },
        },
        target: { type: 'string', description: 'Path tujuan file GLB (default assets/models/environments/<name>_env.glb)' },
      },
      required: ['name', 'dimensions'],
    },
    available: blenderAvailable,
    async execute(projectPath: string, args: unknown) {
      if (!blenderTurnActive()) return { success: false, error: BLENDER_MODE_OFF_ERROR }
      const parsed = EnvironmentArgs.safeParse(args)
      if (!parsed.success) return { success: false, error: `Argumen tidak valid: ${zodMessage(parsed.error)}` }
      const data = parsed.data
      const defaultTarget = `assets/models/environments/${slug(data.name)}_env.glb`
      const target = data.target ?? defaultTarget

      try {
        const res = await buildJob(projectPath, data.name, target, (jobDir) => {
          const script = generateEnvironmentScript(data)
          const scriptFile = path.join(jobDir, 'build_env.py')
          fs.writeFileSync(scriptFile, script)
          return ['--script', scriptFile]
        })

        if (!res.success || !res.data) return res

        const importedPath = (res.data as any).path || target
        const atmo = data.atmosphere ?? {}
        const suggestedSceneApply = {
          settings: {
            sun: {
              enabled: true,
              color: atmo.sunColor ?? '#fff4e5',
              intensity: atmo.sunIntensity ?? 2.5,
              direction: atmo.sunDirection ?? [0.5, 1, 0.35],
            },
            ambientColor: atmo.ambientColor ?? '#666666',
            fog: {
              enabled: !!atmo.fog,
              color: '#c8d2dc',
              density: 0.015,
            },
            skybox: 'room',
            toneMapping: 'agx',
            colorGrade: {
              enabled: true,
              contrast: 1.08,
              saturation: 1.04,
              temperature: 0.04,
              tint: 0,
              lift: 0,
              gamma: 1,
              gain: 1,
              vignette: 0.16,
            },
          },
          entities: [
            {
              name: `${data.name}_Environment`,
              components: [
                { type: 'Transform', data: { position: [0, 0, 0] } },
                { type: 'ModelComponent', data: { src: importedPath } },
                { type: 'MeshCollider', data: { type: 'trimesh' } },
              ],
            },
          ],
        }

        return {
          success: true,
          data: {
            ...res.data,
            suggestedSceneApply,
            next: `Panggil linden_scene_apply dengan settings dan entities di atas untuk menaruh seluruh lingkungan ke scene Linden.`,
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}
