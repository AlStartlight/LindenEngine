#!/usr/bin/env node
/**
 * Scan the agent skills Linden ships with SkillSpector (static, no LLM) against their reviewed
 * baselines. Fails on any finding that is not in a baseline, so an upgrade
 * (scripts/vendor-img2threejs.mjs) cannot bring in new risky content unnoticed.
 *
 *   npm run check:skills
 *
 * Needs `skillspector` (https://github.com/NVIDIA/SkillSpector) on PATH, in ~/.local/bin, or
 * SKILLSPECTOR=/path/to/skillspector. Triage notes: docs/security/<skill>/FINDINGS_TRIAGE.md.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = [{ name: 'img2threejs', dir: 'resources/agent-skills/img2threejs', baseline: 'docs/security/img2threejs/skillspector-baseline.yaml' }]

function findScanner() {
  const candidates = [process.env.SKILLSPECTOR, 'skillspector', path.join(os.homedir(), '.local/bin/skillspector')].filter(Boolean)
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf-8' })
    if (r.status === 0) return { bin: c, version: r.stdout.trim() }
  }
  return null
}

const scanner = findScanner()
if (!scanner) {
  console.error('skillspector not found. Install: https://github.com/NVIDIA/SkillSpector (or set SKILLSPECTOR=/path/to/skillspector)')
  process.exit(2)
}
console.log(scanner.version)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-skillscan-'))
let failed = false
try {
  for (const s of SKILLS) {
    const out = path.join(work, `${s.name}.json`)
    const r = spawnSync(scanner.bin, ['scan', path.join(ROOT, s.dir), '--no-llm', '--baseline', path.join(ROOT, s.baseline), '--format', 'json', '--output', out], { encoding: 'utf-8' })
    if (!fs.existsSync(out)) {
      console.error(`${s.name}: scan failed (exit ${r.status})\n${r.stderr.slice(-2000)}`)
      failed = true
      continue
    }
    const report = JSON.parse(fs.readFileSync(out, 'utf-8'))
    const risk = report.risk_assessment
    const cov = report.analysis_completeness ?? {}
    const active = report.issues ?? []
    console.log(`${s.name}: score ${risk.score} ${risk.recommendation}, ${active.length} new finding(s), ${report.suppressed_count} reviewed (baseline), coverage ${cov.coverage_percent ?? '?'}% ${cov.status ?? ''}`)
    for (const i of active) {
      const loc = i.location ?? {}
      console.log(`  ${i.severity} ${i.id} ${i.category} ${loc.file}:${loc.start_line ?? ''} — ${String(i.finding ?? '').replace(/\s+/g, ' ').slice(0, 120)}`)
    }
    if (active.length > 0) {
      console.log(`  → review each one; record real fixes in docs/security/${s.name}/FINDINGS_TRIAGE.md and add verified false positives to ${s.baseline}`)
      failed = true
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
