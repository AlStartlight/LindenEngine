/**
 * Transmuter Pipeline (FR-01..15, NFR-01..07)
 * 7-stage engine conversion pipeline: Detect -> Parse -> Resolve -> Normalize -> Validate -> Emit -> Report
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { EngineId, LIFProject } from './lif/LIFTypes'
import { LIFValidator } from './lif/LIFValidator'
import { IdMap } from './IdMap'
import { FidelityReport } from './FidelityReport'
import { GodotImporter, DetectResult } from '../adapters/godot/GodotImporter'
import { GodotExporter } from '../adapters/godot/GodotExporter'
import { UnityImporter } from '../adapters/unity/UnityImporter'
import { UnityExporter } from '../adapters/unity/UnityExporter'
import { LindenImporter } from '../adapters/linden/LindenImporter'
import { LindenExporter } from '../adapters/linden/LindenExporter'

export interface TransmuteOptions {
  dryRun?: boolean
  scripts?: 'transpile' | 'stub' | 'skip'
  convertModelsToGltf?: boolean
  customShaders?: 'fallback-pbr' | 'skip'
  incremental?: boolean
  signal?: AbortSignal
  reportPath?: string
}

export interface Importer {
  readonly engine: EngineId
  detect(dir: string): Promise<DetectResult>
  toLIF(dir: string, report?: FidelityReport): Promise<LIFProject>
}

export interface Exporter {
  readonly engine: EngineId
  fromLIF(project: LIFProject, outDir: string, idMap?: IdMap, report?: FidelityReport): Promise<void>
}

export class Pipeline {
  private importers: Map<EngineId, Importer> = new Map()
  private exporters: Map<EngineId, Exporter> = new Map()

  constructor() {
    const godotImp = new GodotImporter()
    const godotExp = new GodotExporter()
    const unityImp = new UnityImporter()
    const unityExp = new UnityExporter()
    const lindenImp = new LindenImporter()
    const lindenExp = new LindenExporter()

    this.importers.set('godot', godotImp)
    this.importers.set('unity', unityImp)
    this.importers.set('linden', lindenImp)

    this.exporters.set('godot', godotExp)
    this.exporters.set('unity', unityExp)
    this.exporters.set('linden', lindenExp)
  }

  getImporter(engine: EngineId): Importer {
    const imp = this.importers.get(engine)
    if (!imp) throw new Error(`[Pipeline] No importer found for engine "${engine}"`)
    return imp
  }

  getExporter(engine: EngineId): Exporter {
    const exp = this.exporters.get(engine)
    if (!exp) throw new Error(`[Pipeline] No exporter found for engine "${engine}"`)
    return exp
  }

  async detectEngine(dir: string): Promise<DetectResult> {
    for (const [engine, imp] of this.importers.entries()) {
      const res = await imp.detect(dir)
      if (res.supported || res.reason?.includes('not supported')) {
        return res
      }
    }
    return { engine: 'linden', version: 'unknown', supported: false, reason: 'Unrecognized project format' }
  }

  async run(
    srcDir: string,
    fromEngine: EngineId,
    toEngine: EngineId,
    outDir: string,
    opts: TransmuteOptions = {}
  ): Promise<FidelityReport> {
    const report = new FidelityReport(
      { engine: fromEngine, version: '1.0' },
      { engine: toEngine, version: '1.0' }
    )

    // Check cancellation
    if (opts.signal?.aborted) {
      throw new Error('Conversion aborted by user')
    }

    // Stage 1: Detect
    const importer = this.getImporter(fromEngine)
    const detectRes = await importer.detect(srcDir)
    if (!detectRes.supported) {
      throw new Error(`[Transmuter] Source project unsupported: ${detectRes.reason}`)
    }
    report.source.version = detectRes.version

    // Stage 2 & 3 & 4: Parse, Resolve, Normalize into LIF
    const lifProject = await importer.toLIF(srcDir, report)

    // Stage 5: Validate
    const validation = LIFValidator.validate(lifProject)
    if (!validation.valid) {
      for (const err of validation.errors) {
        report.addItem('node', err.path, 'unsupported', err.message)
      }
    }

    // If dry run, write reports and stop here
    if (opts.dryRun) {
      return report
    }

    // Check cancellation before emit
    if (opts.signal?.aborted) {
      throw new Error('Conversion aborted by user')
    }

    // Stage 6: Emit (Atomic via temp folder)
    const exporter = this.getExporter(toEngine)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transmuter-temp-'))

    try {
      const idMap = new IdMap()
      await exporter.fromLIF(lifProject, tempDir, idMap, report)

      if (opts.signal?.aborted) {
        throw new Error('Conversion aborted by user')
      }

      // Atomic copy/move from tempDir to outDir
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true })
      }
      this.copyDirRecursive(tempDir, outDir)
    } finally {
      // Clean up tempDir
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }

    // Stage 7: Write reports
    try {
      const reportBase = opts.reportPath ? opts.reportPath : path.join(outDir, 'transmuter-report')
      fs.writeFileSync(`${reportBase}.json`, report.toJSON(), 'utf-8')
      fs.writeFileSync(`${reportBase}.html`, report.toHTML(), 'utf-8')
    } catch {}

    return report
  }

  private copyDirRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
    }
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const ent of entries) {
      const sPath = path.join(src, ent.name)
      const dPath = path.join(dest, ent.name)
      if (ent.isDirectory()) {
        this.copyDirRecursive(sPath, dPath)
      } else {
        fs.copyFileSync(sPath, dPath)
      }
    }
  }
}

export async function transmute(
  src: string,
  from: EngineId,
  to: EngineId,
  outDir: string,
  opts?: TransmuteOptions
): Promise<FidelityReport> {
  const pipeline = new Pipeline()
  return pipeline.run(src, from, to, outDir, opts)
}
