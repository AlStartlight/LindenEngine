import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolveGodotExecutable } from './godotExec'
import { TscnParser, tscnDocumentToSceneIR } from '../../engine/godot/tscn/TscnParser'
import type { GodotSceneIR, ImportProgressEvent } from '../../shared/godotBridgeTypes'

function getExtractScriptPath(): string {
  const devPath = path.join(process.cwd(), 'resources', 'bridge', 'linden_extract.gd')
  if (fs.existsSync(devPath)) return devPath

  const appPath = path.join(__dirname, '..', 'resources', 'bridge', 'linden_extract.gd')
  if (fs.existsSync(appPath)) return appPath

  const resourcesPath = (process as any).resourcesPath
  if (resourcesPath) {
    const packagedPath = path.join(resourcesPath, 'resources', 'bridge', 'linden_extract.gd')
    if (fs.existsSync(packagedPath)) return packagedPath
  }

  return devPath
}

function copyDirectoryExcluding(src: string, dest: string, excludeNames: Set<string>) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (excludeNames.has(entry.name)) continue
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirectoryExcluding(srcPath, destPath, excludeNames)
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(srcPath, destPath)
      } catch {}
    }
  }
}

function runProcessAsync(
  bin: string,
  args: string[],
  cwd: string,
  onLog?: (line: string) => void,
  timeoutMs: number = 120000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let killed = false

    const proc = spawn(bin, args, {
      cwd,
      env: { ...process.env, GODOT_HEADLESS: '1' },
    })

    const timer = setTimeout(() => {
      killed = true
      proc.kill('SIGKILL')
      reject(new Error(`Proses Godot timeout setelah ${timeoutMs / 1000} detik`))
    }, timeoutMs)

    proc.stdout.on('data', (d) => {
      const text = d.toString()
      stdout += text
      if (onLog) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) onLog(line)
        }
      }
    })

    proc.stderr.on('data', (d) => {
      const text = d.toString()
      stderr += text
      if (onLog) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) onLog(`[stderr] ${line}`)
        }
      }
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (!killed) {
        resolve({ code: code ?? 0, stdout, stderr })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

export interface ExtractionResult {
  source: 'godot-headless' | 'ts-parser'
  scenes: GodotSceneIR[]
  summary?: any
}

export async function extractGodotProject(
  projectDir: string,
  userDataDir: string,
  jobId: string,
  onProgress?: (event: ImportProgressEvent) => void,
  onLog?: (line: string) => void
): Promise<ExtractionResult> {
  const projectGodotPath = path.join(projectDir, 'project.godot')
  if (!fs.existsSync(projectGodotPath)) {
    throw new Error(`project.godot tidak ditemukan di ${projectDir}`)
  }

  // Check if Godot executable is valid
  const godotResolution = await resolveGodotExecutable()

  if (godotResolution.ok && godotResolution.path) {
    // 1. Headless Extraction
    try {
      const stat = fs.statSync(projectGodotPath)
      const hash = crypto
        .createHash('sha1')
        .update(`${projectDir}:${stat.mtimeMs}`)
        .digest('hex')
        .slice(0, 16)

      const cacheDir = path.join(userDataDir, 'bridge-cache', hash)
      const irDir = path.join(cacheDir, '.linden', 'ir')
      const summaryPath = path.join(irDir, 'summary.json')

      let isCached = false
      if (fs.existsSync(summaryPath)) {
        isCached = true
      }

      if (!isCached) {
        onProgress?.({
          jobId,
          stage: 'copy',
          done: 1,
          total: 5,
          message: 'Menyiapkan cache isolasi project Godot...',
        })
        onLog?.(`[GodotExtract] Menyalin ke cache isolasi: ${cacheDir}`)

        copyDirectoryExcluding(projectDir, cacheDir, new Set(['.git', '.godot', '.linden']))

        // Copy linden_extract.gd
        const scriptSource = getExtractScriptPath()
        const lindenDir = path.join(cacheDir, '.linden')
        if (!fs.existsSync(lindenDir)) fs.mkdirSync(lindenDir, { recursive: true })
        fs.copyFileSync(scriptSource, path.join(lindenDir, 'linden_extract.gd'))

        // Step 1: --import
        onProgress?.({
          jobId,
          stage: 'import',
          done: 2,
          total: 5,
          message: 'Menjalankan Godot headless --import aset...',
        })
        onLog?.(`[GodotExtract] Menjalankan: ${godotResolution.path} --headless --path ${cacheDir} --import`)

        try {
          await runProcessAsync(
            godotResolution.path,
            ['--headless', '--path', cacheDir, '--import'],
            cacheDir,
            onLog,
            120000
          )
        } catch (err: any) {
          onLog?.(`[GodotExtract] Warning import: ${err.message}`)
        }

        // Step 2: run extract script
        onProgress?.({
          jobId,
          stage: 'extract',
          done: 3,
          total: 5,
          message: 'Mengekstrak struktur scene dan node via Godot...',
        })
        onLog?.(`[GodotExtract] Menjalankan extractor script...`)

        await runProcessAsync(
          godotResolution.path,
          [
            '--headless',
            '--path',
            cacheDir,
            '--script',
            'res://.linden/linden_extract.gd',
            '--',
            '--out',
            irDir,
          ],
          cacheDir,
          onLog,
          120000
        )
      } else {
        onLog?.(`[GodotExtract] Menggunakan IR dari cache: ${irDir}`)
      }

      // Read extracted IR files
      if (fs.existsSync(irDir)) {
        const scenes: GodotSceneIR[] = []
        let summary: any = null

        if (fs.existsSync(summaryPath)) {
          try {
            summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
          } catch {}
        }

        function readIrFolder(dir: string) {
          const items = fs.readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
            const p = path.join(dir, item.name)
            if (item.isDirectory()) {
              readIrFolder(p)
            } else if (item.isFile() && item.name.endsWith('.json') && item.name !== 'summary.json') {
              try {
                const ir: GodotSceneIR = JSON.parse(fs.readFileSync(p, 'utf-8'))
                ir.source = 'godot-headless'
                scenes.push(ir)
              } catch (e: any) {
                onLog?.(`[GodotExtract] Gagal membaca IR ${p}: ${e.message}`)
              }
            }
          }
        }

        readIrFolder(irDir)

        if (scenes.length > 0) {
          return {
            source: 'godot-headless',
            scenes,
            summary,
          }
        }
      }
    } catch (headlessErr: any) {
      onLog?.(`[GodotExtract] Headless extractor error: ${headlessErr.message}. Beralih ke parser TS...`)
    }
  }

  // 2. Fallback: TypeScript Parser
  onProgress?.({
    jobId,
    stage: 'extract',
    done: 3,
    total: 5,
    message: 'Mengekstrak scene dengan TypeScript Parser (Import Dasar)...',
  })
  onLog?.(`[GodotExtract] Menggunakan Fallback TS Parser...`)

  const parser = new TscnParser()
  const scenes: GodotSceneIR[] = []

  function scanTscnFiles(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.name === '.git' || ent.name === '.godot' || ent.name === '.linden') continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        scanTscnFiles(full)
      } else if (ent.isFile() && ent.name.endsWith('.tscn')) {
        const rel = path.relative(projectDir, full).replace(/\\/g, '/')
        const sceneResPath = `res://${rel}`
        try {
          const content = fs.readFileSync(full, 'utf-8')
          const doc = parser.parse(content)
          const ir = tscnDocumentToSceneIR(doc, sceneResPath)
          scenes.push(ir)
        } catch (parseErr: any) {
          onLog?.(`[GodotExtract] Gagal parse TS ${sceneResPath}: ${parseErr.message}`)
        }
      }
    }
  }

  scanTscnFiles(projectDir)

  return {
    source: 'ts-parser',
    scenes,
    summary: {
      scenes: scenes.length,
      ok: scenes.length,
      failed: [],
    },
  }
}
