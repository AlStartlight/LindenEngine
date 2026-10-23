import { test } from '@playwright/test'

/**
 * A generated case. `title` must describe the exact input (scenario + parameters):
 * the summary reporter rejects the run if two cases share a title, so every case
 * in the 1.000.000 is provably distinct.
 */
export interface Case {
  title: string
  run: () => void | Promise<void>
}

export type CaseSource = () => Iterable<Case>

/**
 * Registers cases [start, end) of a category generator as Playwright tests.
 * Generators are deterministic, so every part file sees the same sequence.
 */
/**
 * SAMPLE=n runs every n-th case (plus the last 5 of each category, which are small groups),
 * for a quick per-module pass instead of the full 1.000.000.
 */
const SAMPLE = Math.max(1, Number(process.env.SAMPLE || 1))

export function defineSlice(prefix: string, category: string, source: CaseSource, start: number, end: number, total: number): void {
  test.describe(category, () => {
    let i = 0
    for (const c of source()) {
      // The last part walks the whole generator to prove it yields exactly `total` cases
      if (i >= end && end < total) break
      if (i >= start && i < end && (i % SAMPLE === 0 || i >= total - 5)) {
        test(`TC-${prefix}-${String(i + 1).padStart(7, '0')} ${c.title}`, c.run)
      }
      i++
    }
    if (i < end || (end === total && i !== total)) {
      throw new Error(`[${category}] generator produced ${i} cases, expected ${end === total ? total : `at least ${end}`}`)
    }
  })
}
