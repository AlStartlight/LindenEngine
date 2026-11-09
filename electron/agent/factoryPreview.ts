/**
 * Model.factory for the editor viewport: run the factory in the sandboxed probe window
 * (previewWindow.createFactoryProbe: sandbox, no preload) and hand the editor its output as GLB.
 * The editor renderer holds the privileged electronAPI, so project code (models/*.ts, possibly
 * generated from an image the user did not make) never runs there.
 *
 * Results are cached on disk by factoryHash (factory, export, options and every models/ file),
 * so reopening a scene does not re-run unchanged factories.
 */
import fs from 'node:fs'
import path from 'node:path'
import { isValidFactorySrc } from '../../shared/modelFactory'
import { factoryHash, type FactoryProbeRunner } from './lindenTools/factoryTools'

export interface FactoryPreviewRequest {
  factory: string
  exportName?: string
  options?: Record<string, unknown>
}

const MAX_OPTIONS_JSON = 16 * 1024
const MAX_CACHE_FILES = 200
const MAX_GLB_BYTES = 256 * 1024 * 1024

/** A request from the renderer is untrusted input: check its shape before it reaches the probe */
export function validateFactoryPreviewRequest(req: unknown): FactoryPreviewRequest {
  const r = (req ?? {}) as Record<string, unknown>
  if (typeof r.factory !== 'string' || !isValidFactorySrc(r.factory)) throw new Error(`Factory tidak valid: ${String(r.factory)}`)
  if (r.exportName !== undefined && (typeof r.exportName !== 'string' || !/^[A-Za-z_$][\w$]{0,127}$/.test(r.exportName))) throw new Error('factoryExport tidak valid')
  const options = r.options ?? {}
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new Error('factoryOptions harus objek')
  if (JSON.stringify(options).length > MAX_OPTIONS_JSON) throw new Error('factoryOptions terlalu besar')
  return { factory: r.factory, exportName: r.exportName as string | undefined, options: options as Record<string, unknown> }
}

export function createFactoryPreviews(opts: { cacheDir: string; probe: () => FactoryProbeRunner | null }) {
  const inflight = new Map<string, Promise<Uint8Array>>()

  const prune = () => {
    try {
      const files = fs
        .readdirSync(opts.cacheDir)
        .filter((f) => f.endsWith('.glb'))
        .map((f) => ({ f, t: fs.statSync(path.join(opts.cacheDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      for (const { f } of files.slice(MAX_CACHE_FILES)) fs.rmSync(path.join(opts.cacheDir, f), { force: true })
    } catch {
      // best effort
    }
  }

  return async function factoryPreview(projectPath: string, request: unknown): Promise<Uint8Array> {
    const req = validateFactoryPreviewRequest(request)
    const source = path.join(projectPath, req.factory)
    if (!fs.existsSync(source)) throw new Error(`File factory tidak ada: ${req.factory}`)
    const hash = factoryHash(projectPath, req.factory, req.exportName, req.options)
    const file = path.join(opts.cacheDir, `${hash}.glb`)
    if (fs.existsSync(file)) {
      const now = new Date()
      fs.utimesSync(file, now, now)
      return new Uint8Array(fs.readFileSync(file))
    }
    let p = inflight.get(hash)
    if (!p) {
      p = (async () => {
        const probe = opts.probe()
        if (!probe) throw new Error('Pratinjau factory tidak tersedia di sesi ini')
        const result = await probe({ projectPath, factory: req.factory, exportName: req.exportName, options: req.options, glb: true })
        if (!result.glb) throw new Error('Probe factory tidak menghasilkan GLB')
        const bytes = new Uint8Array(Buffer.from(result.glb, 'base64'))
        if (bytes.length > MAX_GLB_BYTES) throw new Error('Hasil factory terlalu besar untuk pratinjau editor')
        fs.mkdirSync(opts.cacheDir, { recursive: true })
        const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
        fs.writeFileSync(tmp, bytes)
        fs.renameSync(tmp, file)
        prune()
        return bytes
      })()
      inflight.set(hash, p)
      p.finally(() => inflight.delete(hash)).catch(() => {})
    }
    return p
  }
}
