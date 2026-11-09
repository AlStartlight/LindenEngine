import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { compileFactory, formatCompileError } from './ScriptCompiler'
import { COMPILED_FACTORIES_DIR, factorySourceStem } from '../../shared/modelFactory'

/**
 * Serves compiled model factories (Model.factory) on demand: a request for
 * game-models/<x>.js compiles models/<x>.ts (cached) and answers with the module. Used by the
 * linden-asset:// protocol (editor viewport) and linden-game:// (Play and render previews).
 */

const SOURCE_EXTS = ['.ts', '.mts', '.js', '.mjs']

let cacheRoot: string | null = null

/** Writable folder for compiled factories (userData/play-cache) */
export function setFactoryCacheRoot(dir: string | null): void {
  cacheRoot = dir
}

export function isFactoryModuleRequest(rel: string): boolean {
  return rel.replace(/^\/+/, '').startsWith(`${COMPILED_FACTORIES_DIR}/`)
}

export interface FactoryModuleResponse {
  status: number
  headers: Record<string, string>
  body: string | Uint8Array
}

function projectCacheDir(projectRoot: string, root: string): string {
  const key = crypto.createHash('sha1').update(projectRoot).digest('hex').slice(0, 16)
  return path.join(root, 'projects', key, 'factories')
}

/** game-models/<x>.js of projectRoot, compiled from models/<x>.(ts|mts|js|mjs) */
export async function resolveFactoryModule(projectRoot: string, rel: string, root: string | null = cacheRoot): Promise<FactoryModuleResponse> {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
  const js = { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' }
  const stem = factorySourceStem(rel.replace(/^\/+/, '').replace(/\?.*$/, ''))
  if (!stem) return { status: 403, headers, body: 'Forbidden' }
  if (!root) return { status: 503, headers, body: 'Factory cache belum siap' }
  const src = SOURCE_EXTS.map((ext) => stem + ext).find((s) => fs.existsSync(path.join(projectRoot, s)))
  if (!src) return { status: 404, headers, body: `Factory ${stem}.ts tidak ditemukan` }
  const res = await compileFactory(projectRoot, src, projectCacheDir(projectRoot, root))
  if (!res.ok) {
    // A module that throws keeps the error readable in the console and the entity warning
    const message = res.errors.map(formatCompileError).join('\n') || 'Kompilasi factory gagal'
    return { status: 200, headers: js, body: `throw new Error(${JSON.stringify(`Kompilasi factory ${src} gagal:\n${message}`)});\n` }
  }
  return { status: 200, headers: js, body: new Uint8Array(await fs.promises.readFile(res.file)) }
}
