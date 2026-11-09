import fs from 'node:fs'
import path from 'node:path'
import type { ToolDefinition, ToolResult } from './index'
import { AgentDiffItem } from '../../../shared/agentTypes'
import {
  IMG2_JOB_ROOT,
  DEFAULT_TIMEOUT_S,
  MAX_TIMEOUT_S,
  ensureSkillRuntime,
  isValidJobName,
  listAllowedScripts,
  normalizeScript,
  readSkillFile,
  readVendorInfo,
  runForgeScript,
  skillSourceDir,
} from '../img2threejs'
import { resolvePython } from '../pythonBinary'

/**
 * Agent tools for image-to-3D reconstruction with img2threejs: the agent follows the skill's
 * SKILL.md (linden_img2_read) and runs every `python3 forge/<x>.py` step through linden_img2_run.
 * The result is a factory in models/ placed with linden_model_build {model:{factory}}.
 */

export { IMG2_SCRIPT_LABELS, img2ScriptLabel } from '../../../shared/img2Labels'

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i

function diffForFactory(projectPath: string, rel: string, before: string): AgentDiffItem | null {
  const full = path.join(projectPath, rel)
  if (!fs.existsSync(full)) return null
  const after = fs.readFileSync(full, 'utf-8')
  if (after === before) return null
  return {
    id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    file: rel,
    kind: 'script',
    action: before ? 'modify' : 'create',
    description: `${before ? 'Perbarui' : 'Buat'} factory ${rel} (img2threejs)`,
    before,
    after,
    status: 'applied',
  }
}

export const IMG2_TOOLS: Record<string, ToolDefinition> = {
  linden_img2_status: {
    name: 'linden_img2_status',
    description:
      'Cek kesiapan rekonstruksi gambar → model 3D (img2threejs): versi Python (butuh >= 3.10), versi skill, profil yang didukung (generic, character) dan job rekonstruksi yang ada di proyek. Panggil sekali sebelum memulai.',
    parameters: { type: 'object', properties: { refresh: { type: 'boolean', description: 'Cari Python lagi (setelah user menginstalnya)' } } },
    async execute(projectPath: string, args: { refresh?: boolean }): Promise<ToolResult> {
      try {
        const python = await resolvePython({ refresh: !!args?.refresh })
        const info = readVendorInfo()
        const root = path.join(projectPath, ...IMG2_JOB_ROOT.split('/'))
        const jobs = fs.existsSync(root)
          ? fs
              .readdirSync(root, { withFileTypes: true })
              .filter((e) => e.isDirectory())
              .map((e) => {
                const dir = path.join(root, e.name)
                const has = (f: string) => fs.existsSync(path.join(dir, f))
                return { job: e.name, state: has('.img2threejs/state.json'), spec: has('object-sculpt-spec.json'), assessment: has('assessment.json') }
              })
          : []
        return {
          success: true,
          data: {
            ready: !!python.bin && !!info,
            python: python.bin ? { path: python.bin, version: python.version } : null,
            pythonError: python.bin ? undefined : python.error,
            skill: info ? { version: info.skillVersion, commit: info.commit, repo: info.repo } : { error: `Salinan skill tidak ditemukan di ${skillSourceDir()}` },
            profiles: ['generic', 'character'],
            unsupported: 'Profil plugin (cs2, animated-character, environment), harness img2, --target dan proyeksi tekstur foto tidak didukung di Linden.',
            jobs,
            jobFolder: `${IMG2_JOB_ROOT}/<job>/`,
            next: python.bin ? 'linden_img2_read {path:"SKILL.md"} lalu ikuti urutannya; jalankan setiap perintah forge lewat linden_img2_run' : 'Sampaikan pythonError ke user dan pakai linden_model_build (parts) sebagai gantinya',
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_img2_read: {
    name: 'linden_img2_read',
    description:
      'Membaca file skill img2threejs yang dibundel Linden: "SKILL.md" (titik masuk, urutan langkah & aturan), lalu file grimoire/... atau docs/... yang disebut SKILL.md pada langkah itu. ' +
      'Path folder mengembalikan daftar isinya. Folder skill berada di luar proyek, jadi jangan membacanya dengan tool read biasa.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Mis. "SKILL.md", "grimoire/intake/image_analysis.md", "grimoire/scripts.md", "grimoire/"' },
        startLine: { type: 'number', description: 'Baris awal (default 1)' },
        maxLines: { type: 'number', description: 'Jumlah baris (default 2000)' },
      },
      required: ['path'],
    },
    async execute(_projectPath: string, args: { path: string; startLine?: number; maxLines?: number }): Promise<ToolResult> {
      try {
        const dir = await ensureSkillRuntime()
        const res = readSkillFile(dir, args.path, args.startLine ?? 1, args.maxLines ?? 0)
        return { success: true, data: res }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_img2_write: {
    name: 'linden_img2_write',
    description:
      'Menulis file kerja rekonstruksi di folder job (.linden/img2threejs/<job>/): object-sculpt-spec.json, assessment.json, regions.json, feature reviews, catatan analisis. ' +
      'Hanya .json/.md/.txt; JSON divalidasi dulu. Pakai ini (bukan tool edit biasa) untuk mengisi spec dari analisis gambarmu. Dengan patch (JSON merge: objek digabung, array/nilai diganti) cukup kirim bagian yang berubah.',
    parameters: {
      type: 'object',
      properties: {
        job: { type: 'string', description: 'Slug rekonstruksi' },
        path: { type: 'string', description: 'Relatif ke folder job, mis. "object-sculpt-spec.json"' },
        content: { type: 'string', description: 'Isi file lengkap (untuk JSON: teks JSON)' },
        patch: { type: 'object', description: 'JSON merge patch ke file JSON yang sudah ada (pengganti content)' },
      },
      required: ['job', 'path'],
    },
    async execute(projectPath: string, args: { job: string; path: string; content?: string; patch?: Record<string, unknown> }, options): Promise<ToolResult> {
      try {
        if (!isValidJobName(args.job)) return { success: false, error: `job harus slug huruf kecil/angka/-/_ (dapat: ${args.job})` }
        const rel = String(args.path ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
        if (!/\.(json|md|txt)$/i.test(rel) || rel.split('/').some((seg) => seg === '..' || seg === '')) {
          return { success: false, error: `path harus file .json/.md/.txt di dalam folder job (dapat: ${args.path})` }
        }
        const base = path.join(projectPath, ...IMG2_JOB_ROOT.split('/'), args.job)
        const full = path.resolve(base, rel)
        if (!full.startsWith(path.resolve(base) + path.sep)) return { success: false, error: 'Path di luar folder job' }
        const before = fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : ''
        let text: string
        if (args.patch !== undefined) {
          if (!/\.json$/i.test(rel)) return { success: false, error: 'patch hanya untuk file .json' }
          if (!before) return { success: false, error: `${rel} belum ada; tulis dengan content dulu` }
          text = JSON.stringify(mergePatch(JSON.parse(before), args.patch), null, 2) + '\n'
        } else if (typeof args.content === 'string') {
          text = args.content
          if (/\.json$/i.test(rel)) {
            try {
              JSON.parse(text)
            } catch (e: any) {
              return { success: false, error: `JSON tidak valid: ${e.message}` }
            }
          }
        } else return { success: false, error: 'Isi content atau patch' }
        if (text.length > 4 * 1024 * 1024) return { success: false, error: 'File terlalu besar (maks 4 MB)' }
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, text, 'utf-8')
        const fileRel = path.relative(projectPath, full).split(path.sep).join('/')
        options?.onDiff?.({
          id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          file: fileRel,
          kind: 'script',
          action: before ? 'modify' : 'create',
          description: `${before ? 'Ubah' : 'Buat'} ${rel} (img2threejs ${args.job})`,
          before,
          after: text,
          status: 'applied',
        })
        return { success: true, data: { path: fileRel, bytes: Buffer.byteLength(text) } }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_img2_run: {
    name: 'linden_img2_run',
    description:
      'Menjalankan satu script forge img2threejs (Python, tanpa dependensi) untuk sebuah job rekonstruksi. Setiap perintah `python3 forge/<script> <args>` di SKILL.md dijalankan sebagai ' +
      '{job, script:"<script>", args:[...]} — JANGAN lewat shell. cwd = .linden/img2threejs/<job>/, jadi path relatif seperti assessment.json, object-sculpt-spec.json, .img2threejs/state.json, cmp.png ada di folder job; ' +
      '"references/...", "models/...", "assets/...", ".linden/..." berarti root proyek; "grimoire/...", "docs/..." berarti folder skill. ' +
      'generate_threejs_factory.py wajib --out models/<job>/create<Nama>Model.ts. hardStop=true (exit 3 / status=stopped) = BERHENTI dan laporkan alasannya ke user. ' +
      'make_comparison_sheet.py mengembalikan gambar lembar perbandingan untuk kamu nilai.',
    parameters: {
      type: 'object',
      properties: {
        job: { type: 'string', description: 'Slug rekonstruksi, mis. "kursi-jati" (huruf kecil, angka, -, _)' },
        script: { type: 'string', description: 'Relatif ke forge/, mis. "next.py", "stage2_spec/validate_sculpt_spec.py"' },
        args: { type: 'array', items: { type: 'string' }, description: 'Argumen persis seperti di SKILL.md, satu elemen per argumen' },
        timeoutSec: { type: 'number', description: `Batas waktu (default ${DEFAULT_TIMEOUT_S}, maks ${MAX_TIMEOUT_S})` },
      },
      required: ['job', 'script'],
    },
    async execute(projectPath: string, args: { job: string; script: string; args?: string[]; timeoutSec?: number }, options): Promise<ToolResult> {
      try {
        if (!isValidJobName(args.job)) return { success: false, error: `job harus slug huruf kecil/angka/-/_ (dapat: ${args.job})` }
        if (args.args !== undefined && (!Array.isArray(args.args) || args.args.some((a) => typeof a !== 'string' && typeof a !== 'number'))) {
          return { success: false, error: 'args harus array string' }
        }
        const script = normalizeScript(args.script)
        // Factory before the run, so the diff list shows what the generator changed
        let factoryBefore = ''
        let factoryRel: string | null = null
        if (script === 'stage3_build/generate_threejs_factory.py') {
          const outIdx = (args.args ?? []).findIndex((a) => a === '--out' || String(a).startsWith('--out='))
          const raw = outIdx >= 0 ? (String(args.args![outIdx]).includes('=') ? String(args.args![outIdx]).split('=')[1] : String(args.args![outIdx + 1] ?? '')) : ''
          if (raw.startsWith('models/')) {
            factoryRel = raw
            const full = path.join(projectPath, raw)
            if (fs.existsSync(full)) factoryBefore = fs.readFileSync(full, 'utf-8')
          }
        }
        const res = await runForgeScript({ projectPath, job: args.job, script, args: (args.args ?? []).map(String), timeoutSec: args.timeoutSec })
        const images: ToolResult['images'] = []
        if (script === 'stage4_review/make_comparison_sheet.py' && res.exitCode === 0 && res.out && IMAGE_EXT.test(res.out)) {
          const full = path.join(projectPath, res.out)
          if (fs.existsSync(full) && fs.statSync(full).size < 8 * 1024 * 1024) {
            images.push({ mimeType: /\.png$/i.test(full) ? 'image/png' : 'image/jpeg', data: fs.readFileSync(full).toString('base64'), label: 'comparison sheet' })
          }
        }
        if (factoryRel && res.exitCode === 0) {
          const diff = diffForFactory(projectPath, factoryRel, factoryBefore)
          if (diff) options?.onDiff?.(diff)
        }
        const next = res.hardStop
          ? 'HARD STOP: berhenti, laporkan alasan di stdout ke user dan minta input.'
          : script === 'stage3_build/generate_threejs_factory.py' && res.exitCode === 0
            ? `Pasang di scene: linden_model_build {model:{factory:"${res.out}", category?, collider}} lalu linden_render_preview`
            : res.exitCode === 0
              ? 'Lanjutkan sesuai SKILL.md; jalankan next.py bila ragu langkah berikutnya'
              : 'Script gagal: baca stderr/stdout, perbaiki input (spec/assessment) lalu jalankan lagi'
        return {
          success: true,
          data: { job: args.job, script, cwd: `${IMG2_JOB_ROOT}/${args.job}`, ...res, next },
          images: images.length ? images : undefined,
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}

/** RFC 7386 JSON merge patch: objects merge, null deletes, everything else replaces */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out: Record<string, unknown> = target && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {}
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) delete out[k]
    else out[k] = mergePatch(out[k], v)
  }
  return out
}

/** For tests and docs: the scripts linden_img2_run accepts */
export async function allowedImg2Scripts(): Promise<string[]> {
  return listAllowedScripts(await ensureSkillRuntime())
}
