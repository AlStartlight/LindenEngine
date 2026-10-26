import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { ExportPreset, LindenProjectConfig } from '../../shared/types/project'
import { ExportProgressEvent, ExportRunResult } from '../../editor/export/ExportRunner'
import { zipDirectory } from './zipUtils'
import os from 'node:os'
import { compileScripts, formatCompileError } from '../play/ScriptCompiler'
import { ensurePlayerRuntime } from '../play/playerRuntime'
import { resolveHtmlEntry } from '../play/PlaySession'
import { injectHeadScript } from '../play/GameProtocol'
import { COMPILED_SCRIPTS_DIR } from '../../shared/playProtocol'
import { MIME_TYPES } from '../../shared/mime'

export interface WebBuildOptions {
  projectPath: string
  preset: ExportPreset
  onProgress?: (event: ExportProgressEvent) => void
  onLog?: (line: string) => void
}

export interface BuildReportItem {
  file: string
  sizeBytes: number
  sizeFormatted: string
}

export interface WebBuildReport {
  totalSizeBytes: number
  totalSizeFormatted: string
  files: BuildReportItem[]
  durationMs: number
  warnings: string[]
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function resolveRuntimeDir(): Promise<string> {
  return ensurePlayerRuntime({ preferSource: false, cacheDir: path.join(os.tmpdir(), 'linden-player-runtime') })
}

/** Copy every file of a prebuilt runtime; readFileSync works inside asar where cpSync may not. */
function copyRuntime(srcDir: string, dstDir: string, includeSourceMap: boolean) {
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.name === 'index.html' || ent.name === 'linden-bridge.js') continue
    if (!includeSourceMap && ent.name.endsWith('.map')) continue
    const src = path.join(srcDir, ent.name)
    const dst = path.join(dstDir, ent.name)
    if (ent.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true })
      copyRuntime(src, dst, includeSourceMap)
    } else {
      fs.writeFileSync(dst, fs.readFileSync(src))
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Folder for the bridge in HTML Game exports (no leading underscore: GitHub Pages hides those) */
const HTML_BRIDGE_DIR = 'linden-runtime'
const ROOT_EXCLUDES = new Set(['build', 'node_modules', 'scenes', 'scripts', 'project.linden.json', 'release', 'dist'])

/**
 * runtime 'html': ship the game's own page folder as-is, plus the linden bridge
 * (input actions, console) injected as the entry page's first script.
 */
async function packageHtmlGame(opts: {
  projectPath: string
  projectConfig: LindenProjectConfig
  outDir: string
  preset: ExportPreset
  emitLog: (msg: string) => void
  warnings: string[]
}) {
  const { projectPath, projectConfig, outDir, emitLog, warnings } = opts
  const resolved = resolveHtmlEntry(path.resolve(projectPath), projectConfig.html?.entry)
  if ('error' in resolved) throw new Error(resolved.error)

  const entryDir = path.dirname(resolved.entry)
  const srcDir = path.join(projectPath, entryDir)
  const outResolved = path.resolve(outDir)
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    if (entryDir === '.' && ROOT_EXCLUDES.has(ent.name)) continue
    const from = path.join(srcDir, ent.name)
    if (path.resolve(from) === outResolved || outResolved.startsWith(path.resolve(from) + path.sep)) continue
    fs.cpSync(from, path.join(outDir, ent.name), { recursive: true })
  }
  emitLog(`[WebBuild] HTML Game disalin dari ${entryDir === '.' ? 'root proyek' : `${entryDir}/`}`)

  const entryName = path.basename(resolved.entry)
  const entryOut = path.join(outDir, entryName)
  let html = fs.readFileSync(entryOut, 'utf-8')

  if (projectConfig.html?.injectBridge !== false) {
    const runtimeDir = await resolveRuntimeDir()
    fs.mkdirSync(path.join(outDir, HTML_BRIDGE_DIR), { recursive: true })
    fs.copyFileSync(path.join(runtimeDir, 'linden-bridge.js'), path.join(outDir, HTML_BRIDGE_DIR, 'bridge.js'))
    fs.writeFileSync(
      path.join(outDir, HTML_BRIDGE_DIR, 'project.json'),
      JSON.stringify({ name: projectConfig.name, input: projectConfig.input ?? {} }, null, 2)
    )
    html = injectHeadScript(html, `${HTML_BRIDGE_DIR}/bridge.js`)
    fs.writeFileSync(entryOut, html, 'utf-8')
    emitLog('[WebBuild] linden bridge disuntikkan ke entry HTML')
  }

  if (entryName !== 'index.html' && !fs.existsSync(path.join(outDir, 'index.html'))) {
    const target = encodeURI(entryName)
    fs.writeFileSync(
      path.join(outDir, 'index.html'),
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${target}"><title>${escapeHtml(projectConfig.name || 'Linden Game')}</title></head><body><a href="${target}">Mainkan</a></body></html>`,
      'utf-8'
    )
  }

  // Readiness: relative src/href in the entry page should exist in the output
  for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']([^"'#?]+)/gi)) {
    const ref = m[1]
    if (/^([a-z]+:|\/\/|data:|#)/i.test(ref) || ref.startsWith('/')) continue
    if (!fs.existsSync(path.join(outDir, decodeURI(ref)))) {
      warnings.push(`Referensi di ${resolved.entry} tidak ditemukan di build: ${ref}`)
    }
  }
}

export class WebBuildRunner {
  /**
   * Run full HTML5 export pipeline
   */
  static async runBuild(options: WebBuildOptions): Promise<ExportRunResult & { report?: WebBuildReport; zipPath?: string }> {
    const { projectPath, preset, onProgress, onLog } = options
    const startTime = Date.now()
    const logs: string[] = []
    const warnings: string[] = []

    const emitLog = (msg: string) => {
      logs.push(msg)
      onLog?.(msg)
    }

    const emitProgress = (
      stage: ExportProgressEvent['stage'],
      percent: number,
      message: string
    ) => {
      onProgress?.({
        presetId: preset.id,
        stage,
        percent,
        message,
      })
    }

    try {
      emitLog(`[WebBuild] Memulai pipeline build HTML5 untuk "${preset.name}"`)
      emitProgress('validation', 15, 'Memvalidasi proyek dan scene...')

      // 1. Validation Stage
      const projectJsonPath = path.join(projectPath, 'project.linden.json')
      let projectConfig: LindenProjectConfig = {
        name: preset.appName || 'Linden Game',
        version: '1.0.0',
        scenesInBuild: ['scenes/Main.lscene'],
      }

      if (fs.existsSync(projectJsonPath)) {
        try {
          projectConfig = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'))
          emitLog(`[WebBuild] Berhasil memuat project.linden.json: "${projectConfig.name}"`)
        } catch (e: any) {
          warnings.push(`Gagal membaca project.linden.json: ${e.message}`)
          emitLog(`[WebBuild] Peringatan: ${e.message}`)
        }
      }

      // Determine output directory
      let outDir = path.resolve(projectPath, preset.output || 'build/web')
      // If output ends with .html, use its dirname
      if (outDir.endsWith('.html')) {
        outDir = path.dirname(outDir)
      }
      fs.mkdirSync(outDir, { recursive: true })

      const appName = preset.appName || projectConfig.name || 'Linden Game'
      if (projectConfig.runtime === 'html') {
        emitProgress('bundle', 45, 'Menyalin HTML Game...')
        await packageHtmlGame({ projectPath, projectConfig, outDir, preset, emitLog, warnings })
      } else {
        // Validate scenes
        const scenes = preset.scenes && preset.scenes.length > 0
          ? preset.scenes
          : projectConfig.scenesInBuild && projectConfig.scenesInBuild.length > 0
            ? projectConfig.scenesInBuild
            : ['scenes/Main.lscene']

        let primarySceneFound = false
        for (const sceneRel of scenes) {
          const sceneFull = path.join(projectPath, sceneRel)
          if (fs.existsSync(sceneFull)) {
            primarySceneFound = true
            emitLog(`[WebBuild] Ditemukan scene: ${sceneRel}`)
          } else {
            warnings.push(`Scene tidak ditemukan di disk: ${sceneRel}`)
          }
        }

        if (!primarySceneFound) {
          emitLog('[WebBuild] Peringatan: Tidak ada scene yang ditemukan, default placeholder scene akan dibuat')
        }

        // 2. Bundle Stage (Rolldown)
        emitProgress('bundle', 45, 'Membundel runtime Linden Player dan asset...')
        emitLog('[WebBuild] Mengompilasi engine player & dependencies via Rolldown...')

        const runtimeDir = await resolveRuntimeDir()
        copyRuntime(runtimeDir, outDir, preset.includeSourceMap ?? false)
        emitLog(`[WebBuild] Runtime disalin dari ${runtimeDir}`)

        // Gameplay scripts: same compiler as Play in the editor
        emitProgress('bundle', 55, 'Mengompilasi script game...')
        const compiled = await compileScripts(projectPath, path.join(outDir, COMPILED_SCRIPTS_DIR), {
          minify: preset.mode === 'release',
          sourcemap: preset.includeSourceMap ?? false,
        })
        if (!compiled.ok) {
          throw new Error(`Kompilasi script gagal:\n${compiled.errors.map(formatCompileError).join('\n')}`)
        }
        if (compiled.sources.length > 0) {
          emitLog(`[WebBuild] ${compiled.sources.length} script dikompilasi ke ${COMPILED_SCRIPTS_DIR}/`)
        }

        emitLog('[WebBuild] Kompilasi modul runtime browser selesai')

        // 3. Generate index.html from template
        emitProgress('bundle', 65, 'Menghasilkan template index.html...')
        const htmlTemplatePath = path.join(runtimeDir, 'index.html')
        let htmlContent = ''
        if (fs.existsSync(htmlTemplatePath)) {
          htmlContent = fs.readFileSync(htmlTemplatePath, 'utf-8')
        } else {
          htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>{{APP_NAME}}</title><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0f172a;}</style></head><body><div id="game-container" style="width:100%;height:100%;"><canvas id="game-canvas" style="width:100%;height:100%;"></canvas></div><script type="module" src="game.js"></script></body></html>`
        }

        // Values land inside HTML/CSS/JS, so only allow safe shapes
        const loadingColor = /^#[0-9a-fA-F]{3,8}$/.test(preset.loadingColor || '') ? preset.loadingColor! : '#0f172a'
        const webgpuReq = preset.webgpuRequired ? 'true' : 'false'
        const canvasMode = ['fixed', 'responsive', 'fullscreen'].includes(preset.canvasMode || '') ? preset.canvasMode! : 'responsive'

        htmlContent = htmlContent
          .replace(/\{\{APP_NAME\}\}/g, () => escapeHtml(appName))
          .replace(/\{\{LOADING_COLOR\}\}/g, loadingColor)
          .replace(/\{\{WEBGPU_REQUIRED\}\}/g, webgpuReq)
          .replace(/\{\{CANVAS_MODE\}\}/g, canvasMode)

        fs.writeFileSync(path.join(outDir, 'index.html'), htmlContent, 'utf-8')
        emitLog('[WebBuild] index.html berhasil ditulis')

        // 4. Copy project.json and scenes/assets into outDir
        emitProgress('package', 75, 'Menyalin data scene dan asset...')
        fs.writeFileSync(
          path.join(outDir, 'project.json'),
          JSON.stringify(
            {
              ...projectConfig,
              name: appName,
              scenesInBuild: scenes,
            },
            null,
            2
          ),
          'utf-8'
        )

        // Copy scenes directory
        const scenesSrcDir = path.join(projectPath, 'scenes')
        const scenesDstDir = path.join(outDir, 'scenes')
        if (fs.existsSync(scenesSrcDir)) {
          fs.cpSync(scenesSrcDir, scenesDstDir, { recursive: true })
          emitLog('[WebBuild] Folder scenes disalin ke output build')
        }

        // Copy assets directory if exists
        const assetsSrcDir = path.join(projectPath, 'assets')
        const assetsDstDir = path.join(outDir, 'assets')
        if (fs.existsSync(assetsSrcDir)) {
          fs.cpSync(assetsSrcDir, assetsDstDir, { recursive: true })
          emitLog('[WebBuild] Folder assets disalin ke output build')
        }

        // HtmlUI fragments
        const uiSrcDir = path.join(projectPath, 'ui')
        if (fs.existsSync(uiSrcDir)) {
          fs.cpSync(uiSrcDir, path.join(outDir, 'ui'), { recursive: true })
          emitLog('[WebBuild] Folder ui disalin ke output build')
        }
      }

      // 5. Packaging & Zip
      emitProgress('sign', 90, 'Membuat paket distribusi ZIP...')
      let zipPath: string | undefined
      if (preset.zipOutput !== false) {
        const zipName = `${appName.replace(/[^a-zA-Z0-9_-]/g, '_')}_web.zip`
        zipPath = path.join(path.dirname(outDir), zipName)
        await zipDirectory(outDir, zipPath)
        emitLog(`[WebBuild] Arsip ZIP berhasil dibuat: ${zipPath}`)
      }

      // 6. Build Report
      const reportItems: BuildReportItem[] = []
      let totalBytes = 0

      function collectReport(dir: string, base: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const ent of entries) {
          const full = path.join(dir, ent.name)
          const rel = base ? `${base}/${ent.name}` : ent.name
          if (ent.isDirectory()) {
            collectReport(full, rel)
          } else if (ent.isFile()) {
            const stat = fs.statSync(full)
            totalBytes += stat.size
            reportItems.push({
              file: rel,
              sizeBytes: stat.size,
              sizeFormatted: formatBytes(stat.size),
            })
          }
        }
      }

      collectReport(outDir, '')
      const durationMs = Date.now() - startTime

      const report: WebBuildReport = {
        totalSizeBytes: totalBytes,
        totalSizeFormatted: formatBytes(totalBytes),
        files: reportItems,
        durationMs,
        warnings,
      }

      emitLog(`[WebBuild] Build selesai: ${report.files.length} file, total ${report.totalSizeFormatted} (${durationMs}ms)`)
      emitProgress('complete', 100, 'HTML5 Web Build selesai!')

      return {
        success: true,
        outputPath: path.join(outDir, 'index.html'),
        zipPath,
        logs,
        durationMs,
        report,
      }
    } catch (err: any) {
      emitLog(`[WebBuild Error] ${err.message}`)
      emitProgress('failed', 100, err.message)
      return {
        success: false,
        outputPath: '',
        logs,
        durationMs: Date.now() - startTime,
        error: err.message,
      }
    }
  }

  /**
   * Starts a local static web server to preview the built HTML5 game.
   */
  static serveLocal(buildDir: string, port = 0): Promise<{ url: string; port: number; close: () => void }> {
    return new Promise((resolve, reject) => {
      const mimeTypes = MIME_TYPES

      const server = http.createServer((req, res) => {
        try {
          let reqPath = decodeURI(req.url?.split('?')[0] || '/')
          if (reqPath === '/' || reqPath === '') reqPath = '/index.html'

          // Prevent directory traversal
          const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '')
          const filePath = path.join(buildDir, safePath)

          if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('404 Not Found')
            return
          }

          const ext = path.extname(filePath).toLowerCase()
          const contentType = mimeTypes[ext] || 'application/octet-stream'

          res.writeHead(200, {
            'Content-Type': contentType,
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          })
          fs.createReadStream(filePath).pipe(res)
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end(`Internal Server Error: ${e.message}`)
        }
      })

      server.on('error', reject)
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address()
        const actualPort = typeof addr === 'object' && addr ? addr.port : port
        const url = `http://127.0.0.1:${actualPort}`
        resolve({
          url,
          port: actualPort,
          close: () => server.close(),
        })
      })
    })
  }
}
