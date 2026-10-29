import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Lightweight reporter for very large runs: counts per category, keeps the first
 * failures per category, and fingerprints every title (minus its TC id) so the
 * merge step can prove that no two of the 680.000 cases are the same.
 */
export default class SummaryReporter implements Reporter {
  private batch = process.env.BATCH || 'all'
  private outDir = join(process.cwd(), 'report')
  private byCategory: Record<string, { passed: number; failed: number; skipped: number }> = {}
  private failures: Record<string, Array<{ title: string; error: string }>> = {}
  /** Failures counted per scenario (title with numbers removed) */
  private failureGroups: Record<string, number> = {}
  private fingerprints: string[] = []
  private seen = new Set<string>()
  private duplicates: string[] = []

  onBegin(config: FullConfig): void {
    if (config.configFile) this.outDir = join(dirname(config.configFile), 'report')
    mkdirSync(this.outDir, { recursive: true })
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const category = test.parent.title || 'unknown'
    const bucket = (this.byCategory[category] ??= { passed: 0, failed: 0, skipped: 0 })
    if (result.status === 'passed') bucket.passed++
    else if (result.status === 'skipped') bucket.skipped++
    else {
      bucket.failed++
      const group = `${category} | ${test.title.replace(/^TC-[A-Z0-9]+-\d+ /, '').replace(/-?\d+(\.\d+)?/g, '#')}`
      this.failureGroups[group] = (this.failureGroups[group] || 0) + 1
      const list = (this.failures[category] ??= [])
      if (list.length < 25) {
        const msg = (result.error?.message || result.status).replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join(' | ')
        list.push({ title: test.title, error: msg.slice(0, 600) })
      }
    }

    const key = `${category}|${test.title.replace(/^TC-[A-Z0-9]+-\d+ /, '')}`
    const fp = createHash('sha1').update(key).digest('hex').slice(0, 16)
    if (this.seen.has(fp)) this.duplicates.push(test.title)
    else this.seen.add(fp)
    this.fingerprints.push(fp)

    // Live progress for long batches: report/progress-<batch>.txt every 1.000 tests
    const done = this.fingerprints.length
    if (done % 1000 === 0) {
      const failed = Object.values(this.byCategory).reduce((n, b) => n + b.failed, 0)
      writeFileSync(join(this.outDir, `progress-${this.batch}.txt`), `${done} done, ${failed} failed, ${new Date().toISOString()}\n`)
    }
  }

  onEnd(result: FullResult): void {
    mkdirSync(this.outDir, { recursive: true })
    const totals = Object.values(this.byCategory).reduce(
      (a, b) => ({ passed: a.passed + b.passed, failed: a.failed + b.failed, skipped: a.skipped + b.skipped }),
      { passed: 0, failed: 0, skipped: 0 }
    )
    writeFileSync(
      join(this.outDir, `batch-${this.batch}.json`),
      JSON.stringify({ batch: this.batch, status: result.status, durationMs: result.duration, totals, byCategory: this.byCategory, duplicates: this.duplicates, failureGroups: this.failureGroups, failures: this.failures }, null, 2)
    )
    writeFileSync(join(this.outDir, `fingerprints-${this.batch}.txt`), this.fingerprints.join('\n'))
    const total = totals.passed + totals.failed + totals.skipped
    console.log(`\n[summary] ${this.batch}: ${total} tests, ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped, ${this.duplicates.length} duplicate titles`)
  }

  printsToStdio(): boolean {
    return true
  }
}
