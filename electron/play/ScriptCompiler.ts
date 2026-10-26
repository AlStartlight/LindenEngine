import fs from 'node:fs'
import path from 'node:path'
import { COMPILED_SCRIPTS_DIR } from '../../shared/playProtocol'

/**
 * Compiles a project's scripts/ (TS/JS) into browser ESM for Play, linden_play and the web build.
 * `three` and `linden` resolve to globals the runtime provides, so scripts share the player's
 * instances instead of bundling their own copy. Other bare imports are rejected.
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
      plugins: [
        {
          name: 'linden-script-imports',
          resolveId(id: string, importer?: string) {
            if (id === 'three') return VIRTUAL_THREE
            if (id === 'linden') return VIRTUAL_API
            if (id.startsWith('\0') || !importer) return null
            if (id.startsWith('.') || path.isAbsolute(id)) {
              const target = path.resolve(path.dirname(importer), id)
              if (target !== root && !target.startsWith(root + path.sep)) {
                const message = `Import "${id}" keluar dari folder proyek`
                importErrors.push({ file: rel(importer), line: findImportLine(importer, id), message })
                throw new Error(message)
              }
              return null
            }
            const message = `Paket "${id}" tidak didukung di script. Yang tersedia: "three" dan "linden".`
            importErrors.push({ file: rel(importer), line: findImportLine(importer, id), message })
            throw new Error(message)
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
            return null
          },
        },
      ],
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
    if (importErrors.length > 0) {
      errors.push(...importErrors)
    } else {
      const list: any[] = Array.isArray(err?.errors) && err.errors.length > 0 ? err.errors : [err]
      for (const e of list) {
        const file = e?.loc?.file || e?.id
        const firstLine = stripAnsi(String(e?.message ?? e)).split('\n')[0].trim()
        errors.push({
          file: file ? rel(file) : undefined,
          line: typeof e?.loc?.line === 'number' ? e.loc.line : undefined,
          col: typeof e?.loc?.column === 'number' ? e.loc.column + 1 : undefined,
          message: firstLine.replace(/^\[[A-Z_]+\]\s*/, '') || 'Kompilasi script gagal',
        })
      }
    }
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
