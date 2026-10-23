#!/usr/bin/env node
/**
 * Transmuter CLI (FR-01, FR-02, TC-CL-01, TC-CL-02)
 */

import * as path from 'path'
import { Pipeline, transmute } from '../core/Pipeline'
import { EngineId } from '../core/lif/LIFTypes'

export async function runCli(args: string[]): Promise<number> {
  const command = args[0]
  const pipeline = new Pipeline()

  if (!command || command === '--help' || command === '-h') {
    console.log(`
Linden Transmuter CLI
Usage:
  linden-transmuter detect <folder>
  linden-transmuter analyze <folder> --to godot|unity|linden [--json]
  linden-transmuter convert <folder> --to godot|unity|linden --out <folder> [--scripts transpile|stub|skip] [--report report.html]
`)
    return 0
  }

  const folder = args[1]
  if (!folder) {
    console.error('Error: missing folder argument')
    return 1
  }

  const absFolder = path.resolve(process.cwd(), folder)

  if (command === 'detect') {
    const res = await pipeline.detectEngine(absFolder)
    console.log(JSON.stringify(res, null, 2))
    return res.supported ? 0 : 1
  }

  if (command === 'analyze' || command === 'convert') {
    const toIdx = args.indexOf('--to')
    if (toIdx === -1 || !args[toIdx + 1]) {
      console.error('Error: --to <godot|unity|linden> is required')
      return 1
    }
    const toEngine = args[toIdx + 1] as EngineId

    const outIdx = args.indexOf('--out')
    const outDir = outIdx !== -1 && args[outIdx + 1] ? path.resolve(process.cwd(), args[outIdx + 1]) : path.resolve(process.cwd(), 'transmuted_out')

    const detectRes = await pipeline.detectEngine(absFolder)
    if (!detectRes.supported) {
      console.error(`Error: Unsupported source: ${detectRes.reason}`)
      return 1
    }

    const abortController = new AbortController()
    process.once('SIGINT', () => {
      console.log('\nAborting conversion...')
      abortController.abort()
    })

    const isDryRun = command === 'analyze'
    try {
      const report = await transmute(absFolder, detectRes.engine, toEngine, outDir, {
        dryRun: isDryRun,
        signal: abortController.signal,
      })

      const summary = report.getSummary()
      if (args.includes('--json')) {
        console.log(report.toJSON())
      } else {
        console.log(`Transmute ${isDryRun ? 'Analysis' : 'Complete'}:`)
        console.log(`Score: ${(summary.score * 100).toFixed(0)}%`)
        console.log(`Full: ${summary.full}, Partial: ${summary.partial}, Unsupported: ${summary.unsupported}`)
      }

      if (summary.partial > 0 || summary.unsupported > 0) {
        return 2 // Finished with partial/unsupported
      }
      return 0
    } catch (err: any) {
      console.error(`Conversion failed: ${err.message}`)
      return 1
    }
  }

  console.error(`Unknown command: ${command}`)
  return 1
}

if (process.argv[1] && process.argv[1].endsWith('transmuter.ts')) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exit(code)
  })
}
