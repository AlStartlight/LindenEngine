import fs from 'node:fs'
import path from 'node:path'
import { COMPILED_SCRIPTS_DIR } from '../../shared/playProtocol'
import { FACTORY_SOURCE_DIR, compiledFactoryPath, isValidFactorySrc } from '../../shared/modelFactory'
import { resolveAppResource } from '../resourcePaths'

/**
 * Compiles a project's scripts/ (TS/JS) into browser ESM for Play, linden_play and the web build.
 * `three` and `linden` resolve to globals the runtime provides, so scripts share the player's
 * instances instead of bundling their own copy. `three/addons/*` and `three/examples/jsm/*` are
 * bundled from three's addon sources (their own `three` imports use the shared global). Other bare
 * imports are rejected.
 *
 * Model factories (models/*.ts, Model.factory) compile one file per factory with the same rules;
 * see compileFactory.
 */

export interface CompileError {
  file?: string
  line?: number
  col?: number
  message: string
}

export interface CompileResult {
  ok: boolean
  /** Directory holding <name>.js (+ .map) per script, mirroring scripts/ */
  outDir: string
  /** Project-relative sources that were compiled, e.g. scripts/Player.ts */
  sources: string[]
  errors: CompileError[]
  cached: boolean
}

export interface CompileOptions {
  minify?: boolean
  /** true writes .map files next to the output (Play maps stack traces with them) */
  sourcemap?: boolean
}

const SCRIPT_EXT = /\.(ts|mts|js|mjs)$/
const LINDEN_API_EXPORTS = ['Input', 'Physics', 'Tween', 'Easing']
const VIRTUAL_THREE = '\0linden:three'
const VIRTUAL_API = '\0linden:api'
const ADDON_PREFIX = '\0linden:addon:'

/**
 * Folder holding three's addon sources. electron-builder strips node_modules/** /examples from the
 * asar, so a packaged app ships the addon folders it supports as the extraResource "three-addons".
 */
export function threeAddonRoot(): string {
  return resolveAppResource(path.join('node_modules', 'three', 'examples', 'jsm'), 'three-addons')
}

function addonFile(root: string, rel: string): string | null {
  const withExt = /\.(js|mjs)$/.test(rel) ? rel : `${rel}.js`
  const full = path.resolve(root, withExt)
  if (full !== root && !full.startsWith(root + path.sep)) return null
  return full
}

let threeExportNames: string[] | null = null

async function getThreeExportNames(): Promise<string[]> {
  if (!threeExportNames) {
    const three = await import('three')
    threeExportNames = Object.keys(three).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default')
  }
  return threeExportNames
}

export function listScriptSources(projectPath: string): string[] {
  const root = path.join(projectPath, 'scripts')
  const out: string[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (SCRIPT_EXT.test(ent.name) && !ent.name.endsWith('.d.ts')) {
        out.push(path.relative(projectPath, full).split(path.sep).join('/'))
      }
    }
  }
  walk(root)
  return out.sort()
}

function fingerprint(projectPath: string, sources: string[], opts: CompileOptions): string {
  const parts = sources.map((rel) => {
    const st = fs.statSync(path.join(projectPath, rel))
    return `${rel}:${st.mtimeMs}:${st.size}`
  })
  return `${opts.minify ? 'm' : ''}${opts.sourcemap ? 's' : ''}|${parts.join('|')}`
}

const cache = new Map<string, { key: string; result: CompileResult }>()

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '')
}

function findImportLine(file: string, specifier: string): number | undefined {
  try {
    const lines = fs.readFileSync(file, 'utf-8').split('\n')
    const idx = lines.findIndex((l) => l.includes(`'${specifier}'`) || l.includes(`"${specifier}"`))
    return idx >= 0 ? idx + 1 : undefined
  } catch {
    return undefined
  }
}

export function formatCompileError(e: CompileError): string {
  const loc = e.file ? `${e.file}${e.line ? `:${e.line}${e.col ? `:${e.col}` : ''}` : ''}: ` : ''
  return `${loc}${e.message}`
}

interface ImportPluginOptions {
  root: string
  rel: (abs: string) => string
  importErrors: CompileError[]
  threeNames: string[]
  what: 'script' | 'factory'
}

/** Resolves "three", "linden", three addons and project-relative imports; rejects everything else */
function lindenImportPlugin({ root, rel, importErrors, threeNames, what }: ImportPluginOptions) {
  const addonRoot = path.resolve(threeAddonRoot())
  const fail = (importer: string, id: string, message: string): never => {
    importErrors.push({ file: importer.startsWith(ADDON_PREFIX) ? undefined : rel(importer), line: importer.startsWith(ADDON_PREFIX) ? undefined : findImportLine(importer, id), message })
    throw new Error(message)
  }
  return {
    name: 'linden-script-imports',
    resolveId(id: string, importer?: string) {
      if (id === 'three') return VIRTUAL_THREE
      if (id === 'linden') return VIRTUAL_API
      const addon = /^three\/(?:examples\/jsm|addons)\/(.+)$/.exec(id)
      if (addon && importer) {
        const file = addonFile(addonRoot, addon[1])
        if (!file || !fs.existsSync(file)) return fail(importer, id, `Addon three "${id}" tidak tersedia di Linden`)
        return ADDON_PREFIX + file
      }
      if (importer?.startsWith(ADDON_PREFIX)) {
        const base = importer.slice(ADDON_PREFIX.length)
        if (id.startsWith('.')) {
          const file = path.resolve(path.dirname(base), id)
          if (!file.startsWith(addonRoot + path.sep) || !fs.existsSync(file)) return fail(importer, id, `Addon three butuh "${id}" yang tidak tersedia di Linden`)
          return ADDON_PREFIX + file
        }
        return fail(importer, id, `Addon three mengimpor "${id}" yang tidak didukung di Linden`)
      }
      if (id.startsWith('\0') || !importer) return null
      if (id.startsWith('.') || path.isAbsolute(id)) {
        const target = path.resolve(path.dirname(importer), id)
        if (target !== root && !target.startsWith(root + path.sep)) return fail(importer, id, `Import "${id}" keluar dari folder proyek`)
        return null
      }
      return fail(
        importer,
        id,
        `Paket "${id}" tidak didukung di ${what === 'script' ? 'script' : 'factory model'}. Yang tersedia: "three", "three/addons/*" dan "linden".`
      )
    },
    load(id: string) {
      if (id === VIRTUAL_THREE) {
        return (
          'const T = globalThis.__LINDEN_THREE__;\n' +
          'if (!T) throw new Error("three belum tersedia di runtime Linden");\n' +
          `export const { ${threeNames.join(', ')} } = T;\nexport default T;\n`
        )
      }
      if (id === VIRTUAL_API) {
        return (
          'const L = globalThis.__LINDEN_API__ || {};\n' +
          `export const { ${LINDEN_API_EXPORTS.join(', ')} } = L;\nexport default L;\n`
        )
      }
      if (id.startsWith(ADDON_PREFIX)) return fs.readFileSync(id.slice(ADDON_PREFIX.length), 'utf-8')
      return null
    },
  }
}

function collectErrors(err: any, importErrors: CompileError[], rel: (abs: string) => string, fallback: string): CompileError[] {
  if (importErrors.length > 0) return [...importErrors]
  const list: any[] = Array.isArray(err?.errors) && err.errors.length > 0 ? err.errors : [err]
  return list.map((e) => {
    const file = e?.loc?.file || e?.id
    const firstLine = stripAnsi(String(e?.message ?? e)).split('\n')[0].trim()
    return {
      file: file && !String(file).startsWith('\0') ? rel(file) : undefined,
      line: typeof e?.loc?.line === 'number' ? e.loc.line : undefined,
      col: typeof e?.loc?.column === 'number' ? e.loc.column + 1 : undefined,
      message: firstLine.replace(/^\[[A-Z_]+\]\s*/, '') || fallback,
    }
  })
}

export async function compileScripts(
  projectPath: string,
  outDir: string,
  opts: CompileOptions = {}
): Promise<CompileResult> {
  // rolldown reports real paths (/private/var/... on macOS), so compare against the real root
  const root = fs.existsSync(projectPath) ? fs.realpathSync(projectPath) : path.resolve(projectPath)
  const sources = listScriptSources(root)
  const key = fingerprint(root, sources, opts)
  const cached = cache.get(outDir)
  if (cached && cached.key === key && fs.existsSync(outDir)) {
    return { ...cached.result, cached: true }
  }

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  if (sources.length === 0) {
    const result: CompileResult = { ok: true, outDir, sources, errors: [], cached: false }
    cache.set(outDir, { key, result })
    return result
  }

  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/')
  const input: Record<string, string> = {}
  for (const src of sources) {
    input[src.replace(/^scripts\//, '').replace(SCRIPT_EXT, '')] = path.join(root, src)
  }

  const errors: CompileError[] = []
  // Thrown plugin errors lose custom fields crossing into rolldown, so keep their location here
  const importErrors: CompileError[] = []
  const threeNames = await getThreeExportNames()

  try {
    const { build } = await import('rolldown')
    await build({
      input,
      platform: 'browser',
      logLevel: 'silent',
      plugins: [lindenImportPlugin({ root, rel, importErrors, threeNames, what: 'script' })],
      output: {
        dir: outDir,
        format: 'esm',
        entryFileNames: '[name].js',
        chunkFileNames: '_chunks/[name]-[hash].js',
        minify: opts.minify ?? false,
        sourcemap: opts.sourcemap ?? false,
      },
    } as any)
  } catch (err: any) {
    errors.push(...collectErrors(err, importErrors, rel, 'Kompilasi script gagal'))
  }

  const result: CompileResult = { ok: errors.length === 0, outDir, sources, errors, cached: false }
  if (result.ok) cache.set(outDir, { key, result })
  else cache.delete(outDir)
  return result
}

/** Where compiled scripts live inside a Play/web output root */
export function compiledScriptsDir(outputRoot: string): string {
  return path.join(outputRoot, COMPILED_SCRIPTS_DIR)
}

// ---------------------------------------------------------------------------------------------
// Model factories (Model.factory): models/**/*.ts -> game-models/**/*.js, one self-contained module each

export interface FactoryCompileResult {
  ok: boolean
  /** Absolute path of the compiled module (valid when ok) */
  file: string
  errors: CompileError[]
  cached: boolean
}

/** Every factory source under models/ (project-relative, forward slashes) */
export function listFactorySources(projectPath: string): string[] {
  const root = path.join(projectPath, FACTORY_SOURCE_DIR)
  const out: string[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (SCRIPT_EXT.test(ent.name) && !ent.name.endsWith('.d.ts')) out.push(path.relative(projectPath, full).split(path.sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

const factoryCache = new Map<string, string>()

/** Fingerprint of a factory: every file under models/ (factories may import their own helpers) */
function factoryFingerprint(root: string, src: string, minify: boolean): string {
  const parts = listFactorySources(root).map((rel) => {
    const st = fs.statSync(path.join(root, rel))
    return `${rel}:${st.mtimeMs}:${st.size}`
  })
  return `${src}|${minify ? 'm' : ''}|${parts.join('|')}`
}

/**
 * Compile one factory (models/<x>.ts) into <outRoot>/game-models/<x>.js. Cached per output file
 * while no file under models/ changed.
 */
export async function compileFactory(projectPath: string, src: string, outRoot: string, opts: { minify?: boolean } = {}): Promise<FactoryCompileResult> {
  const root = fs.existsSync(projectPath) ? fs.realpathSync(projectPath) : path.resolve(projectPath)
  const norm = src.replace(/\\/g, '/').replace(/^\.?\//, '')
  const file = path.join(outRoot, ...compiledFactoryPath(norm).split('/'))
  if (!isValidFactorySrc(norm)) {
    return { ok: false, file, errors: [{ message: `Factory harus file .ts/.js di dalam ${FACTORY_SOURCE_DIR}/ (dapat: ${src})` }], cached: false }
  }
  const input = path.join(root, norm)
  if (!fs.existsSync(input)) return { ok: false, file, errors: [{ file: norm, message: 'File factory tidak ditemukan' }], cached: false }

  const key = factoryFingerprint(root, norm, !!opts.minify)
  if (factoryCache.get(file) === key && fs.existsSync(file)) return { ok: true, file, errors: [], cached: true }

  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/')
  const importErrors: CompileError[] = []
  const threeNames = await getThreeExportNames()
  const tmpDir = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    const { build } = await import('rolldown')
    await build({
      input,
      platform: 'browser',
      logLevel: 'silent',
      plugins: [lindenImportPlugin({ root, rel, importErrors, threeNames, what: 'factory' })],
      output: {
        dir: tmpDir,
        format: 'esm',
        entryFileNames: 'factory.js',
        codeSplitting: false,
        minify: opts.minify ?? false,
        sourcemap: false,
      },
    } as any)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.renameSync(path.join(tmpDir, 'factory.js'), file)
    factoryCache.set(file, key)
    return { ok: true, file, errors: [], cached: false }
  } catch (err: any) {
    factoryCache.delete(file)
    return { ok: false, file, errors: collectErrors(err, importErrors, rel, 'Kompilasi factory gagal'), cached: false }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

/** Compile every factory under models/ into <outRoot>/game-models (web export) */
export async function compileFactories(projectPath: string, outRoot: string, opts: { minify?: boolean } = {}): Promise<{ ok: boolean; sources: string[]; errors: CompileError[] }> {
  const sources = listFactorySources(projectPath)
  const errors: CompileError[] = []
  for (const src of sources) {
    const res = await compileFactory(projectPath, src, outRoot, opts)
    if (!res.ok) errors.push(...res.errors.map((e) => ({ ...e, file: e.file ?? src })))
  }
  return { ok: errors.length === 0, sources, errors }
}
