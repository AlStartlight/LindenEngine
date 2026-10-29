import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition } from './index'
import { ModelSpecSchema } from '../../../engine/model/ModelSpec'
import { validateModel } from '../../../engine/model/validateModel'
import { buildModelObject } from '../../../engine/model/buildModel'
import { MATERIAL_PRESETS } from '../../../engine/materials/presets'
import { REAL_WORLD_DIMENSIONS, findRealWorldDimension } from '../../../engine/assets/realWorldDimensions'
import { parseSceneFile } from '../../../engine/scene/parseSceneFile'
import { stableStringify } from '../../../engine/scene/serializer'
import { DEFAULT_SCENE_SETTINGS } from '../../../engine/scene/SceneSettings'
import { AgentDiffItem } from '../../../shared/agentTypes'
import { gltfSidecarFiles, inspectAssetFile, ModelInfo } from '../assetInspect'

/**
 * Tools for building realistic objects: real-world sizes, material presets, part-based models with
 * validation, asset import and an offscreen render preview the agent can look at.
 */

export interface PreviewRequest {
  projectPath: string
  scenePath: string
  entityId?: string
  views: PreviewView[]
  size: number
  isolate: boolean
}

export type PreviewView = 'front' | 'side' | 'top' | 'threeQuarter'

export interface PreviewResult {
  images: { view: PreviewView; png: Buffer }[]
  size?: [number, number, number]
  triangles?: number
  warnings: string[]
}

export type PreviewRenderer = (req: PreviewRequest) => Promise<PreviewResult>

let previewRenderer: PreviewRenderer | null = null

/** Electron main registers the offscreen renderer; headless (tests, CLI) has none */
export function setPreviewRenderer(fn: PreviewRenderer | null): void {
  previewRenderer = fn
}

function safePath(projectPath: string, rel: string): string {
  const base = path.resolve(projectPath)
  const full = path.resolve(projectPath, rel)
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`Akses di luar folder proyek ditolak: ${rel}`)
  return full
}

function zodMessage(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
    .join('; ')
}

/** Read a scene as v2 (v1 is migrated), or a new empty scene */
function readSceneV2(projectPath: string, rel: string): { scene: any; before: string } {
  const full = safePath(projectPath, rel)
  if (!fs.existsSync(full)) {
    return { scene: { format: 'linden-scene', version: 2, name: path.basename(rel, '.lscene'), settings: structuredClone(DEFAULT_SCENE_SETTINGS), entities: [] }, before: '' }
  }
  const before = fs.readFileSync(full, 'utf-8')
  const parsed = parseSceneFile(before)
  if ('message' in parsed) throw new Error(`Scene ${rel} tidak bisa dibaca: ${parsed.message}`)
  return { scene: parsed.scene, before }
}

function writeScene(projectPath: string, rel: string, scene: any, before: string, description: string, onDiff?: (d: AgentDiffItem) => void): void {
  const full = safePath(projectPath, rel)
  const after = stableStringify(scene)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, after, 'utf-8')
  onDiff?.({
    id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    file: rel,
    kind: 'scene',
    action: before ? 'modify' : 'create',
    description,
    before,
    after,
    status: 'applied',
  })
}

const Vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

const ModelBuildArgs = z.object({
  scenePath: z.string().default('scenes/Main.lscene'),
  name: z.string().min(1).max(128),
  entityId: z.string().min(1).max(128).optional(),
  parentId: z.string().nullable().optional(),
  position: Vec3.optional(),
  rotation: Vec3.optional(),
  scale: Vec3.optional(),
  model: z.unknown(),
  /** Validate and report without writing the scene */
  dryRun: z.boolean().default(false),
})

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'model'

const SHAPE_DOC =
  'Bentuk part (meter, Y ke atas, origin model = titik yang menapak tanah): ' +
  'roundedBox {size:[x,y,z], radius?} (default sudut membulat), sphere {radius}, capsule {radius,length}, ' +
  'cylinder {radiusTop,radiusBottom,height,bevel?}, cone {radius,height}, torus {radius,tube,arc?}, ' +
  'lathe {points:[[r,y],...] dari bawah ke atas, thickness? (dinding berongga), capBottom?} untuk vas/botol/gelas/kap lampu, ' +
  'extrude {shape:[[x,y],...] berlawanan jarum jam, holes?, depth, bevel?, cornerRadius?} untuk panel/logo/kaki, ' +
  'tube {path:[[x,y,z],...], radius, capped?} untuk pipa/kabel/gagang, plane {size:[w,d], displacement?:{amplitude,scale}}.'

export const MODEL_TOOLS: Record<string, ToolDefinition> = {
  linden_dimensions: {
    name: 'linden_dimensions',
    description:
      'Tabel ukuran nyata objek umum (meter): [lebar x, tinggi y, dalam z] plus detail (tinggi dudukan, diameter roda, ...). ' +
      'Panggil SEBELUM memodelkan objek dari prompt. query bisa nama Inggris/Indonesia (kursi, meja makan, mobil sport); kosong = semua kunci.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Nama objek, mis. "kursi" atau "car_sedan"' } },
    },
    async execute(_projectPath: string, args: { query?: string }) {
      if (!args.query) {
        return { success: true, data: Object.fromEntries(Object.entries(REAL_WORLD_DIMENSIONS).map(([k, v]) => [k, v.size])) }
      }
      const found = findRealWorldDimension(args.query)
      if (found) return { success: true, data: { key: found.key, ...found.entry } }
      const q = args.query.toLowerCase()
      const similar = Object.keys(REAL_WORLD_DIMENSIONS).filter((k) => k.includes(q.split(/\s+/)[0]) || REAL_WORLD_DIMENSIONS[k].aliases?.some((a) => a.includes(q)))
      return { success: true, data: { key: null, message: `"${args.query}" tidak ada di tabel; perkirakan dari objek serupa`, similar } }
    },
  },

  linden_material_presets: {
    name: 'linden_material_presets',
    description:
      'Daftar preset material PBR (kayu jati/oak/walnut, logam, plastik, karet, kaca, air, keramik, marmer, beton, bata, kain, kulit, rumput, tanah, pasir, batu, cat mobil...) ' +
      'beserta parameternya. Pakai id-nya di part.material ("wood_teak") atau {preset, ...override} mis. {"preset":"car_paint","color":"#c00000"}. ' +
      'Override yang bisa dipakai: color, roughness, metalness, opacity, emissive, emissiveIntensity, clearcoat, clearcoatRoughness, transmission, ior, thickness, ' +
      'attenuationColor, sheen, sheenColor, iridescence, anisotropy, tileSize (meter per tile tekstur), procedural {kind,color2,contrast,bump}, textures {map,normalMap,roughnessMap,metalnessMap,aoMap}.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter: wood, metal, plastic, glass, liquid, stone, ceramic, fabric, ground, paint, other' },
        id: { type: 'string', description: 'Detail satu preset' },
      },
    },
    async execute(_projectPath: string, args: { category?: string; id?: string }) {
      const list = MATERIAL_PRESETS.filter((p) => (!args.id || p.id === args.id) && (!args.category || p.category === args.category))
      if (args.id && list.length === 0) return { success: false, error: `Preset "${args.id}" tidak ada` }
      return { success: true, data: list.map((p) => ({ id: p.id, label: p.label, category: p.category, description: p.description, params: p.spec })) }
    },
  },

  linden_model_build: {
    name: 'linden_model_build',
    description:
      'Membuat/memperbarui objek 3D sebagai komponen Model dari daftar PART (atau src glb/gltf/obj di assets/), menaruhnya di scene, ' +
      'lalu menjalankan validator: part melayang/terputus, attachTo yang tidak menempel, part terbenam, objek tidak menapak tanah, ' +
      'skala jauh dari tabel ukuran nyata (isi model.category), normal terbalik. Perbaiki semua issue severity "error" lalu panggil lagi. ' +
      SHAPE_DOC +
      ' Part: {id, name?, parent?, shape, position?, rotation? (derajat), scale?, material? (id preset atau spec), attachTo? (id part yang harus disentuh), allowOverlap?}. ' +
      'Model: {category?, placement: floor|wall|ceiling|free, parts, merge? (default true), instances? [{position,rotation?,scale?}] untuk objek berulang, collider: none|box|convexHull, src?, animation?}.',
    parameters: {
      type: 'object',
      properties: {
        scenePath: { type: 'string', description: 'Default scenes/Main.lscene' },
        name: { type: 'string', description: 'Nama entity, mis. "Kursi Jati"' },
        entityId: { type: 'string', description: 'Id entity; sama dengan yang lama = perbarui' },
        parentId: { type: ['string', 'null'] },
        position: { type: 'array', items: { type: 'number' }, description: '[x,y,z] meter; y=0 berarti menapak lantai' },
        rotation: { type: 'array', items: { type: 'number' }, description: '[x,y,z] derajat' },
        scale: { type: 'array', items: { type: 'number' } },
        model: { type: 'object', description: 'Spesifikasi Model (parts atau src)' },
        dryRun: { type: 'boolean', description: 'Hanya validasi, tidak menulis scene' },
      },
      required: ['name', 'model'],
    },
    async execute(projectPath: string, rawArgs: unknown, options) {
      try {
        const argsRes = ModelBuildArgs.safeParse(rawArgs)
        if (!argsRes.success) return { success: false, error: `Argumen tidak valid: ${zodMessage(argsRes.error)}` }
        const args = argsRes.data
        const modelRes = ModelSpecSchema.safeParse(args.model)
        if (!modelRes.success) return { success: false, error: `Model tidak valid: ${zodMessage(modelRes.error)}` }
        const model = modelRes.data

        let report: ReturnType<typeof validateModel> | null = null
        let assetInfo: ModelInfo | null = null
        let stats: any = null
        if (model.src) {
          const file = safePath(projectPath, model.src)
          if (!fs.existsSync(file)) return { success: false, error: `File model ${model.src} tidak ada; impor dulu dengan linden_asset_import` }
          assetInfo = inspectAssetFile(file) as ModelInfo
        } else {
          report = validateModel(model)
          const obj = buildModelObject(model)
          stats = obj.userData.modelStats
          obj.traverse((o: any) => {
            o.geometry?.dispose?.()
            o.material?.dispose?.()
          })
        }

        const entityId = args.entityId ?? slug(args.name)
        const reference = model.category ? findRealWorldDimension(model.category) : null
        const result = {
          entityId,
          scenePath: args.scenePath,
          written: false,
          validation: report ?? { ok: true, issues: [], size: assetInfo?.size ?? null },
          stats: stats ?? (assetInfo ? { triangles: assetInfo.triangles, meshes: assetInfo.meshes, animations: assetInfo.animations } : null),
          realWorldReference: reference ? { key: reference.key, ...reference.entry } : null,
          next: report && !report.ok ? 'Perbaiki issue "error" lalu panggil linden_model_build lagi' : 'Cek visual dengan linden_render_preview',
        }
        if (args.dryRun) return { success: true, data: result }

        const { scene, before } = readSceneV2(projectPath, args.scenePath)
        const modelData: Record<string, unknown> = { ...model }
        if (model.src && assetInfo?.bounds) modelData.bounds = assetInfo.bounds
        if (!model.src) delete modelData.src
        const existing = scene.entities.find((e: any) => e.id === entityId)
        const transform = {
          type: 'Transform',
          data: {
            position: args.position ?? existing?.components.find((c: any) => c.type === 'Transform')?.data.position ?? [0, 0, 0],
            rotation: args.rotation ?? existing?.components.find((c: any) => c.type === 'Transform')?.data.rotation ?? [0, 0, 0],
            scale: args.scale ?? existing?.components.find((c: any) => c.type === 'Transform')?.data.scale ?? [1, 1, 1],
          },
        }
        if (args.parentId && !scene.entities.some((e: any) => e.id === args.parentId)) {
          return { success: false, error: `parentId "${args.parentId}" tidak ada di scene` }
        }
        if (existing) {
          existing.name = args.name
          if (args.parentId !== undefined) existing.parentId = args.parentId
          // Keep the entity's other components (scripts, colliders); replace Transform and Model
          existing.components = [transform, ...existing.components.filter((c: any) => c.type !== 'Transform' && c.type !== 'Model' && c.type !== 'MeshRenderer'), { type: 'Model', data: modelData }]
        } else {
          scene.entities.push({
            id: entityId,
            name: args.name,
            active: true,
            static: true,
            tags: [],
            layer: 0,
            parentId: args.parentId ?? null,
            components: [transform, { type: 'Model', data: modelData }],
          })
        }
        writeScene(projectPath, args.scenePath, scene, before, `${existing ? 'Perbarui' : 'Buat'} model ${args.name}`, options?.onDiff)
        return { success: true, data: { ...result, written: true } }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_asset_import: {
    name: 'linden_asset_import',
    description:
      'Mengimpor file .glb/.gltf/.obj (model) atau .hdr/.exr (environment) dari path lokal ke assets/ proyek, lalu melaporkan ukuran (meter), ' +
      'bounds, jumlah segitiga, material, animasi, dan peringatan (satuan cm, tidak menapak tanah, terlalu berat). ' +
      'Model dipakai lewat linden_model_build {model:{src}}; HDR lewat settings.environment di linden_scene_apply.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Path file sumber (absolut, atau relatif proyek bila sudah di dalam proyek)' },
        target: { type: 'string', description: 'Tujuan di assets/, default assets/models/<nama> atau assets/hdri/<nama>' },
      },
      required: ['source'],
    },
    async execute(projectPath: string, args: { source: string; target?: string }) {
      try {
        const source = path.isAbsolute(args.source) ? args.source : safePath(projectPath, args.source)
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return { success: false, error: `File sumber tidak ditemukan: ${args.source}` }
        const ext = path.extname(source).toLowerCase()
        if (!['.glb', '.gltf', '.obj', '.hdr', '.exr'].includes(ext)) return { success: false, error: `Format ${ext} tidak didukung (glb, gltf, obj, hdr, exr)` }
        const folder = ext === '.hdr' || ext === '.exr' ? 'assets/hdri' : 'assets/models'
        const target = args.target ?? `${folder}/${path.basename(source)}`
        if (!target.startsWith('assets/')) return { success: false, error: 'target harus di dalam assets/' }
        const dest = safePath(projectPath, target)

        // Inspect before copying so a broken file does not land in the project
        const info = inspectAssetFile(source)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        if (path.resolve(source) !== path.resolve(dest)) fs.copyFileSync(source, dest)
        const copied = [target]
        for (const rel of gltfSidecarFiles(source)) {
          const from = path.join(path.dirname(source), rel)
          const to = path.join(path.dirname(dest), rel)
          if (!fs.existsSync(from) || path.resolve(from) === path.resolve(to)) continue
          fs.mkdirSync(path.dirname(to), { recursive: true })
          fs.copyFileSync(from, to)
          copied.push(path.relative(projectPath, to).split(path.sep).join('/'))
        }
        return { success: true, data: { path: target, bytes: fs.statSync(dest).size, copied, ...info } }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_render_preview: {
    name: 'linden_render_preview',
    description:
      'Merender scene (atau satu entity) secara offscreen dari depan, samping, atas, dan 3/4 dengan renderer yang sama dengan editor/player, ' +
      'lalu mengembalikan gambar PNG supaya kamu bisa MELIHAT hasilnya. Periksa proporsi, part yang melayang/tembus, material, dan skala; perbaiki lalu render lagi (maks 3 iterasi).',
    parameters: {
      type: 'object',
      properties: {
        scenePath: { type: 'string', description: 'Default scenes/Main.lscene' },
        entityId: { type: 'string', description: 'Fokus kamera ke entity ini (default: seluruh scene)' },
        views: { type: 'array', items: { type: 'string', enum: ['front', 'side', 'top', 'threeQuarter'] }, description: 'Default keempatnya' },
        size: { type: 'number', description: 'Ukuran gambar px (256-1024, default 512)' },
        isolate: { type: 'boolean', description: 'Sembunyikan entity lain kecuali lantai (default true bila entityId diisi)' },
      },
    },
    async execute(projectPath: string, args: { scenePath?: string; entityId?: string; views?: PreviewView[]; size?: number; isolate?: boolean }) {
      try {
        if (!previewRenderer) return { success: false, error: 'Render preview butuh editor Linden (Electron) yang sedang berjalan' }
        const scenePath = args.scenePath || 'scenes/Main.lscene'
        if (!fs.existsSync(safePath(projectPath, scenePath))) return { success: false, error: `Scene ${scenePath} tidak ditemukan` }
        const views = (args.views?.length ? args.views : ['front', 'side', 'top', 'threeQuarter']).filter((v): v is PreviewView => ['front', 'side', 'top', 'threeQuarter'].includes(v))
        const size = Math.round(Math.min(1024, Math.max(256, args.size ?? 512)))
        const res = await previewRenderer({ projectPath, scenePath, entityId: args.entityId, views, size, isolate: args.isolate ?? !!args.entityId })

        // Also saved in the project so the user can look at them
        const dir = safePath(projectPath, '.linden/previews')
        fs.mkdirSync(dir, { recursive: true })
        const base = slug(args.entityId ?? path.basename(scenePath, '.lscene'))
        const files = res.images.map((img) => {
          const rel = `.linden/previews/${base}-${img.view}.png`
          fs.writeFileSync(safePath(projectPath, rel), img.png)
          return rel
        })
        return {
          success: true,
          data: { views: res.images.map((i) => i.view), files, size: res.size, triangles: res.triangles, warnings: res.warnings },
          images: res.images.map((i) => ({ mimeType: 'image/png', data: i.png.toString('base64'), label: i.view })),
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}
