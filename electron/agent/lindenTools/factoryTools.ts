import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ToolDefinition, ToolResult } from './index'
import { findRealWorldDimension } from '../../../engine/assets/realWorldDimensions'
import type { ModelFactoryBake } from '../../../engine/model/ModelComponent'
import { compileFactory, formatCompileError } from '../../play/ScriptCompiler'
import { isValidFactorySrc } from '../../../shared/modelFactory'
import { parseSceneFile } from '../../../engine/scene/parseSceneFile'
import { stableStringify } from '../../../engine/scene/serializer'
import { AgentDiffItem } from '../../../shared/agentTypes'
import os from 'node:os'

/**
 * Model.factory support for the agent tools: procedural three.js factories in models/ (written by the agent with linden_factory_write)
 * are run once in a hidden window (createFactoryProbe) to measure them, then normalised to Linden's
 * units (`fit`) and stored with what headless physics needs (`bounds`, `bake`).
 */

type V3 = [number, number, number]

/** Raw measurements of a factory group, in the factory's own units (player/factoryProbe.ts) */
export interface FactoryProbe {
  exportName: string
  exports: string[]
  bounds: [V3, V3]
  triangles: number
  meshCount: number
  hull: number[]
  boxes: { id: string; center: V3; halfExtents: V3 }[]
  sockets: string[]
  nodes: string[]
  hasTick: boolean
  hasRig: boolean
  materials: string[]
  shaderMaterials: number
  meshes?: { name: string; vertices: number[][]; indices: number[] }[]
  glb?: string
  warnings: string[]
}

export interface FactoryProbeRequest {
  projectPath: string
  factory: string
  exportName?: string
  options?: Record<string, unknown>
  meshes?: boolean
  glb?: boolean
}

export type FactoryProbeRunner = (req: FactoryProbeRequest) => Promise<FactoryProbe>

let probeRunner: FactoryProbeRunner | null = null

/** Electron main registers the hidden-window probe; headless (tests, CLI) has none */
export function setFactoryProbe(fn: FactoryProbeRunner | null): void {
  probeRunner = fn
}

export function getFactoryProbe(): FactoryProbeRunner | null {
  return probeRunner
}

/** Hash of a factory and how it is called; a stored bake with another hash is stale */
export function factoryHash(projectPath: string, factory: string, exportName?: string, options?: Record<string, unknown>): string {
  const h = crypto.createHash('sha256')
  const dir = path.join(projectPath, 'models')
  // The factory and every helper it may import from models/
  const files: string[] = []
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return
    for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(d, ent.name)
      if (ent.isDirectory()) walk(full)
      else files.push(full)
    }
  }
  walk(dir)
  h.update(factory).update('\0').update(exportName ?? '').update('\0').update(JSON.stringify(options ?? {}))
  for (const f of files) h.update('\0').update(path.relative(projectPath, f)).update('\0').update(fs.readFileSync(f))
  return h.digest('hex').slice(0, 32)
}

export interface FactoryFitInput {
  placement: 'floor' | 'wall' | 'ceiling' | 'free'
  category?: string
  /** Target height in meters; beats the category's real-world height */
  height?: number
  /** Uniform scale to use as is (meters per factory unit) */
  scale?: number
}

export interface FactoryFit {
  scale: number
  offset: V3
  /** Where the scale came from */
  basis: 'scale' | 'height' | 'category' | 'none'
  size: V3
}

/**
 * Scale (relative units -> meters) and offset so the model rests like a Linden model: floor = lowest
 * point at y 0 and centred in x/z; ceiling = highest point at y 0; wall = back (min z) at z 0 and
 * resting at y 0; free = centred on the origin.
 */
export function computeFactoryFit(bounds: [V3, V3], input: FactoryFitInput): FactoryFit {
  const [min, max] = bounds
  const raw: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  let scale = 1
  let basis: FactoryFit['basis'] = 'none'
  const ref = input.category ? findRealWorldDimension(input.category) : null
  if (input.scale && input.scale > 0) {
    scale = input.scale
    basis = 'scale'
  } else if (input.height && input.height > 0 && raw[1] > 1e-9) {
    scale = input.height / raw[1]
    basis = 'height'
  } else if (ref && raw[1] > 1e-9) {
    scale = ref.entry.size[1] / raw[1]
    basis = 'category'
  }
  const cx = (min[0] + max[0]) / 2
  const cy = (min[1] + max[1]) / 2
  const cz = (min[2] + max[2]) / 2
  let offset: V3
  switch (input.placement) {
    case 'ceiling':
      offset = [-cx * scale, -max[1] * scale, -cz * scale]
      break
    case 'wall':
      offset = [-cx * scale, -min[1] * scale, -min[2] * scale]
      break
    case 'free':
      offset = [-cx * scale, -cy * scale, -cz * scale]
      break
    default:
      offset = [-cx * scale, -min[1] * scale, -cz * scale]
  }
  const r = (v: number) => Math.round(v * 1e6) / 1e6
  return { scale: r(scale), offset: offset.map(r) as V3, basis, size: raw.map((n) => r(n * scale)) as V3 }
}

const apply = (p: V3, fit: { scale: number; offset: V3 }): V3 => [p[0] * fit.scale + fit.offset[0], p[1] * fit.scale + fit.offset[1], p[2] * fit.scale + fit.offset[2]]
const round = (v: number) => Math.round(v * 1e5) / 1e5

/** Bounds and bake of a probe after `fit` (model space, meters) */
export function fittedBake(probe: FactoryProbe, fit: { scale: number; offset: V3 }, hash: string): { bounds: [V3, V3]; bake: ModelFactoryBake } {
  const hull: number[] = []
  for (let i = 0; i + 2 < probe.hull.length; i += 3) hull.push(...apply([probe.hull[i], probe.hull[i + 1], probe.hull[i + 2]], fit).map(round))
  return {
    bounds: [apply(probe.bounds[0], fit).map(round) as V3, apply(probe.bounds[1], fit).map(round) as V3],
    bake: {
      hash,
      triangles: probe.triangles,
      hull,
      boxes: probe.boxes.slice(0, 64).map((b) => ({
        id: b.id,
        center: apply(b.center, fit).map(round) as V3,
        halfExtents: b.halfExtents.map((h) => round(h * fit.scale)) as V3,
      })),
      exports: probe.exports,
      sockets: probe.sockets,
    },
  }
}

/** Compile a factory, reporting errors the agent can act on */
export async function checkFactoryCompiles(projectPath: string, factory: string): Promise<string | null> {
  if (!isValidFactorySrc(factory)) return `factory harus file .ts/.js di dalam models/ (dapat: ${factory})`
  if (!fs.existsSync(path.join(projectPath, factory))) return `File factory ${factory} tidak ada`
  const out = path.join(os.tmpdir(), `linden-factory-check-${crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 10)}`)
  const res = await compileFactory(projectPath, factory, out)
  if (!res.ok) return `Kompilasi factory gagal:\n${res.errors.map(formatCompileError).join('\n')}`
  return null
}

/** Write the meshes the probe exported in img2threejs' self_intersection format */
export function writeMeshesJson(projectPath: string, rel: string, probe: FactoryProbe, fit: { scale: number; offset: V3 }): string {
  const full = path.resolve(projectPath, rel)
  const base = path.resolve(projectPath)
  if (!full.startsWith(base + path.sep)) throw new Error(`meshesOut di luar folder proyek: ${rel}`)
  const meshes = (probe.meshes ?? []).map((m) => ({ name: m.name, vertices: m.vertices.map((p) => apply(p as V3, fit).map(round)), indices: m.indices }))
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, JSON.stringify({ meshes }), 'utf-8')
  return path.relative(projectPath, full).split(path.sep).join('/')
}

function safePath(projectPath: string, rel: string): string {
  const base = path.resolve(projectPath)
  const full = path.resolve(projectPath, rel)
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`Akses di luar folder proyek ditolak: ${rel}`)
  return full
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'model'

export const FACTORY_TOOLS: Record<string, ToolDefinition> = {
  linden_model_bake_glb: {
    name: 'linden_model_bake_glb',
    description:
      'Membakar model factory (Model.factory, dari linden_factory_write) menjadi file GLB di assets/models/, untuk export Godot atau model yang terlalu berat dibangun ulang tiap load. ' +
      'Material CanvasTexture ikut sebagai PNG; animasi idle (userData.tick), socket di script (ctx.model) dan ShaderMaterial TIDAK ikut. ' +
      'Dengan switch=true komponen Model entity itu dipindah ke {src: <glb>} (fit sudah diterapkan di file).',
    parameters: {
      type: 'object',
      properties: {
        scenePath: { type: 'string', description: 'Default scenes/Main.lscene' },
        entityId: { type: 'string', description: 'Entity dengan Model.factory' },
        target: { type: 'string', description: 'Tujuan, default assets/models/<entity>.glb' },
        switch: { type: 'boolean', description: 'Ganti Model entity ke src GLB (default false)' },
      },
      required: ['entityId'],
    },
    async execute(projectPath: string, args: { scenePath?: string; entityId: string; target?: string; switch?: boolean }, options): Promise<ToolResult> {
      try {
        const probe = getFactoryProbe()
        if (!probe) return { success: false, error: 'Bake GLB butuh editor Linden (Electron) yang sedang berjalan' }
        const scenePath = args.scenePath || 'scenes/Main.lscene'
        const sceneFile = safePath(projectPath, scenePath)
        if (!fs.existsSync(sceneFile)) return { success: false, error: `Scene ${scenePath} tidak ditemukan` }
        const before = fs.readFileSync(sceneFile, 'utf-8')
        const parsed = parseSceneFile(before)
        if ('message' in parsed) return { success: false, error: `Scene ${scenePath} tidak bisa dibaca: ${parsed.message}` }
        const scene: any = parsed.scene
        const entity = scene.entities.find((e: any) => e.id === args.entityId)
        const model = entity?.components.find((c: any) => c.type === 'Model')
        if (!model?.data?.factory) return { success: false, error: `Entity "${args.entityId}" tidak punya Model.factory` }
        const data = model.data
        const target = args.target ?? `assets/models/${slug(entity.name || args.entityId)}.glb`
        if (!target.startsWith('assets/') || !target.endsWith('.glb')) return { success: false, error: 'target harus file .glb di dalam assets/' }
        const res = await probe({ projectPath, factory: data.factory, exportName: data.factoryExport || undefined, options: data.factoryOptions ?? {}, glb: true })
        if (!res.glb) return { success: false, error: 'Probe tidak menghasilkan GLB' }
        const fit = data.fit ?? { scale: 1, offset: [0, 0, 0] }
        const glb = Buffer.from(res.glb, 'base64')
        const wrapped = wrapGlbWithFit(glb, fit)
        const dest = safePath(projectPath, target)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, wrapped)
        const result: any = { path: target, bytes: wrapped.length, triangles: res.triangles, warnings: res.warnings, switched: false }
        if (args.switch) {
          const { bounds } = fittedBake(res, fit, data.bake?.hash ?? '')
          model.data = {
            ...data,
            src: target,
            bounds,
            factory: '',
            factoryExport: '',
            factoryOptions: undefined,
            fit: undefined,
            bake: undefined,
            parts: [],
          }
          const after = stableStringify(scene)
          fs.writeFileSync(sceneFile, after, 'utf-8')
          options?.onDiff?.({
            id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            file: scenePath,
            kind: 'scene',
            action: 'modify',
            description: `Model ${entity.name} memakai ${target}`,
            before,
            after,
            status: 'applied',
          } as AgentDiffItem)
          result.switched = true
        }
        return { success: true, data: result }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}

/**
 * Put the fit (scale + offset) into the GLB as a root node over the exported scene, so the file is
 * in meters and rests like the Model did. Edits only the JSON chunk.
 */
export function wrapGlbWithFit(glb: Buffer, fit: { scale: number; offset: V3 }): Buffer {
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('Bukan file GLB')
  const jsonLen = glb.readUInt32LE(12)
  if (glb.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB tanpa chunk JSON')
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf-8').replace(/[\s\0]+$/, ''))
  const rest = glb.subarray(20 + jsonLen)
  const sceneIdx = json.scene ?? 0
  const sc = json.scenes?.[sceneIdx]
  if (sc && (fit.scale !== 1 || fit.offset.some((v) => v !== 0))) {
    json.nodes = json.nodes ?? []
    const rootIdx = json.nodes.length
    json.nodes.push({ name: 'LindenFit', scale: [fit.scale, fit.scale, fit.scale], translation: fit.offset, children: sc.nodes ?? [] })
    sc.nodes = [rootIdx]
  }
  let text = Buffer.from(JSON.stringify(json), 'utf-8')
  const pad = (4 - (text.length % 4)) % 4
  if (pad) text = Buffer.concat([text, Buffer.alloc(pad, 0x20)])
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + text.length + rest.length, 8)
  header.writeUInt32LE(text.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, text, rest])
}
