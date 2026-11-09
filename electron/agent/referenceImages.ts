import fs from 'node:fs'
import path from 'node:path'

/**
 * Reference images attached in the agent panel (img2threejs input). They are copied into the
 * project's references/ folder, so the agent can read them inside the project and the user can
 * see what a model was built from. Electron-free; main passes a resizer (nativeImage).
 */

export const REFERENCE_DIR = 'references'
export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024
export const MAX_REFERENCE_EDGE = 2048
const EXT: Record<string, string> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp' }

export function referenceMime(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase()
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
}

/** Detect the format from the bytes; names lie (pasted images are often "image.png") */
export function sniffImage(buf: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 12 && String.fromCharCode(...buf.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...buf.subarray(8, 12)) === 'WEBP') return 'webp'
  return null
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'referensi'

export type ImageResizer = (data: Uint8Array, maxEdge: number) => { data: Uint8Array; ext: 'png' | 'jpg' } | null

export interface SavedReference {
  path: string
  bytes: number
  resized: boolean
}

/** Copy an attached image into references/<slug>[-n].<ext>; larger than 2048 px is downscaled when a resizer is given */
export function saveReferenceImage(projectPath: string, name: string, data: Uint8Array, resize?: ImageResizer): SavedReference {
  if (!projectPath || !fs.existsSync(projectPath)) throw new Error('Buka proyek dulu sebelum melampirkan gambar')
  if (data.length === 0) throw new Error('Gambar kosong')
  if (data.length > MAX_REFERENCE_BYTES) throw new Error(`Gambar terlalu besar (${Math.round(data.length / 1024 / 1024)} MB, maks 20 MB)`)
  const kind = sniffImage(data)
  if (!kind || !EXT[kind]) throw new Error('Format gambar tidak didukung (png, jpg, webp)')
  let out = data
  let ext: string = kind
  let resized = false
  if (resize) {
    const r = resize(data, MAX_REFERENCE_EDGE)
    if (r) {
      out = r.data
      ext = r.ext
      resized = true
    }
  }
  const dir = path.join(projectPath, REFERENCE_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const base = slug(name)
  let file = `${base}.${ext}`
  for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${base}-${i}.${ext}`
  fs.writeFileSync(path.join(dir, file), out)
  return { path: `${REFERENCE_DIR}/${file}`, bytes: out.length, resized }
}

/** Validate attachment paths coming back from the renderer: references/<file> that exists */
export function resolveAttachments(projectPath: string, paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  const out: string[] = []
  for (const p of paths.slice(0, 8)) {
    if (typeof p !== 'string') continue
    const norm = p.replace(/\\/g, '/')
    if (!norm.startsWith(`${REFERENCE_DIR}/`) || norm.split('/').some((s) => s === '..' || s === '')) continue
    if (!/\.(png|jpe?g|webp)$/i.test(norm)) continue
    if (fs.existsSync(path.join(projectPath, norm))) out.push(norm)
  }
  return out
}

/** Text the agent sees for the attachments (the image itself goes as a file part when the model can see images) */
export function attachmentNote(paths: string[]): string {
  if (paths.length === 0) return ''
  const list = paths.map((p) => `- ${p}`).join('\n')
  return `\n\n<reference-images>\nGambar referensi dari user (di folder proyek):\n${list}\nUntuk membangun ulang objek di gambar sebagai model 3D, ikuti bagian 7 instruksi Linden (linden_model_build / linden_factory_write, bandingkan dengan linden_reference_view).\n</reference-images>`
}
