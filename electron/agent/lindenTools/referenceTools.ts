/**
 * Rebuilding an object from a reference image with Linden's own tools (no third-party skill):
 *
 * - linden_reference_view: show the agent the user's reference image next to the latest
 *   linden_render_preview frames of an entity, so it can compare and correct.
 * - linden_factory_write: write a hand-written three.js factory (models/<x>/create<X>Model.ts,
 *   `export function create<X>Model(): THREE.Group`) and compile-check it. The factory then goes
 *   into a scene with linden_model_build {model: {factory}}; it only ever runs sandboxed.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ToolDefinition, ToolResult } from './index'
import { sniffImage } from '../referenceImages'
import { isValidFactorySrc } from '../../../shared/modelFactory'
import { checkFactoryCompiles } from './factoryTools'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_FACTORY_BYTES = 512 * 1024
const VIEWS = ['front', 'side', 'top', 'threeQuarter'] as const
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const

function within(base: string, full: string): boolean {
  const b = path.resolve(base)
  return full === b || full.startsWith(b + path.sep)
}

/** A project image the agent may look at: references/ or assets/, a real PNG/JPEG/WebP */
function readProjectImage(projectPath: string, rel: string): { mimeType: string; data: string } {
  const norm = String(rel ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!/^(references|assets)\//.test(norm) || norm.split('/').includes('..')) throw new Error(`Gambar referensi harus di references/ atau assets/ (dapat: ${rel})`)
  const full = path.resolve(projectPath, norm)
  if (!within(projectPath, full)) throw new Error(`Path di luar proyek: ${rel}`)
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`Gambar tidak ada: ${norm}`)
  if (fs.statSync(full).size > MAX_IMAGE_BYTES) throw new Error(`Gambar terlalu besar (maks 20 MB): ${norm}`)
  const buf = fs.readFileSync(full)
  const kind = sniffImage(buf)
  if (!kind) throw new Error(`${norm} bukan PNG/JPEG/WebP`)
  return { mimeType: MIME[kind], data: buf.toString('base64') }
}

function listReferences(projectPath: string): string[] {
  const dir = path.join(projectPath, 'references')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort()
    .map((f) => `references/${f}`)
}

export const REFERENCE_TOOLS: Record<string, ToolDefinition> = {
  linden_reference_view: {
    name: 'linden_reference_view',
    description:
      'Lihat gambar referensi user (references/<file>, dari lampiran panel agent) bersama render terakhir sebuah entity dari linden_render_preview, untuk membandingkan proporsi, bentuk, warna dan detail. ' +
      'Tanpa reference: daftar gambar di references/. Panggil linden_render_preview dulu agar render terbaru tersedia.',
    parameters: {
      type: 'object',
      properties: {
        reference: { type: 'string', description: 'Gambar referensi, mis. references/kursi.png' },
        entityId: { type: 'string', description: 'Entity yang dibandingkan (render .linden/previews/<entityId>-<view>.png)' },
        views: { type: 'array', items: { type: 'string', enum: [...VIEWS] }, description: 'Default ["front", "threeQuarter"]' },
      },
    },
    async execute(projectPath: string, args: { reference?: string; entityId?: string; views?: string[] }): Promise<ToolResult> {
      try {
        const refs = listReferences(projectPath)
        if (!args?.reference) return { success: true, data: { references: refs, hint: refs.length ? 'Panggil lagi dengan reference: "<path>"' : 'Belum ada gambar; minta user melampirkan gambar di panel agent' } }
        const images: NonNullable<ToolResult['images']> = [{ ...readProjectImage(projectPath, args.reference), label: `referensi ${args.reference}` }]
        const shown: string[] = []
        const missing: string[] = []
        if (args.entityId) {
          if (!/^[\w.-]{1,128}$/.test(args.entityId)) return { success: false, error: 'entityId tidak valid' }
          const views = (args.views?.length ? args.views : ['front', 'threeQuarter']).filter((v): v is (typeof VIEWS)[number] => (VIEWS as readonly string[]).includes(v))
          for (const v of views) {
            const rel = `.linden/previews/${args.entityId}-${v}.png`
            const full = path.join(projectPath, rel)
            if (!fs.existsSync(full)) {
              missing.push(v)
              continue
            }
            images.push({ mimeType: 'image/png', data: fs.readFileSync(full).toString('base64'), label: `render ${args.entityId} ${v}` })
            shown.push(rel)
          }
        }
        return {
          success: true,
          data: {
            reference: args.reference,
            renders: shown,
            ...(missing.length ? { missingViews: missing, hint: `Belum ada render ${missing.join(', ')}: panggil linden_render_preview {entityId: "${args.entityId}"}` } : {}),
            compare: 'Bandingkan siluet dan proporsi (tinggi:lebar:tebal), jumlah dan posisi bagian, ketebalan, warna/material, lalu detail. Perbaiki yang paling besar dulu.',
          },
          images,
        }
      } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) }
      }
    },
  },

  linden_factory_write: {
    name: 'linden_factory_write',
    description:
      'Tulis factory three.js buatan sendiri untuk bentuk yang tidak cukup dengan part linden_model_build (lengkung organik, detail rumit, geometri custom): file models/<nama>/create<Nama>Model.ts ' +
      'yang mengekspor `export function create<Nama>Model(options?): THREE.Group`. Hanya boleh import dari "three" dan addon three (three/examples/jsm/... atau three/addons/...). ' +
      'Satuan relatif, objek di tengah origin; ukuran meter diatur linden_model_build (category/fitHeight). Opsional: root.userData.tick = (dt) => {...} untuk animasi idle saat Play, ' +
      'root.userData.sculptRuntime = { sockets: {...}, colliders: {...} } untuk socket dan collider compound. File dikompilasi untuk dicek; pasang dengan linden_model_build {model: {factory: "<path>"}}.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'models/<nama>/create<Nama>Model.ts' },
        content: { type: 'string', description: 'Isi lengkap file TypeScript' },
      },
      required: ['path', 'content'],
    },
    async execute(projectPath: string, args: { path: string; content: string }, options): Promise<ToolResult> {
      try {
        const rel = String(args?.path ?? '').replace(/\\/g, '/')
        if (!isValidFactorySrc(rel) || !rel.endsWith('.ts')) return { success: false, error: `path harus file .ts di dalam models/, mis. models/kursi/createKursiModel.ts (dapat: ${args?.path})` }
        if (typeof args.content !== 'string' || !args.content.trim()) return { success: false, error: 'content kosong' }
        if (Buffer.byteLength(args.content) > MAX_FACTORY_BYTES) return { success: false, error: 'Factory terlalu besar (maks 512 KB)' }
        if (!/export\s+(async\s+)?function\s+create\w+Model\s*\(|export\s+const\s+create\w+Model\s*=/.test(args.content)) {
          return { success: false, error: 'Factory harus mengekspor create<Nama>Model(), mis. `export function createKursiModel(): THREE.Group`' }
        }
        const full = path.resolve(projectPath, rel)
        if (!within(projectPath, full)) return { success: false, error: `Path di luar proyek: ${rel}` }
        const before = fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : undefined
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, args.content, 'utf-8')
        options?.onDiff?.({
          id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          file: rel,
          kind: 'script',
          action: before !== undefined ? 'modify' : 'create',
          description: `${before !== undefined ? 'Ubah' : 'Buat'} factory ${rel}`,
          before,
          after: args.content,
          status: 'applied',
        })
        const compileError = await checkFactoryCompiles(projectPath, rel)
        if (compileError) return { success: false, error: `${compileError}\nFile sudah ditulis; perbaiki lalu panggil linden_factory_write lagi.`, data: { path: rel } }
        return { success: true, data: { path: rel, bytes: Buffer.byteLength(args.content), next: `linden_model_build {name, entityId, model: {factory: "${rel}", category?, placement: "floor", collider: "compound"|"box"}, fitHeight?: <meter>} lalu linden_render_preview dan linden_reference_view` } }
      } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) }
      }
    },
  },
}
