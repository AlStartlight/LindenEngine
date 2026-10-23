import { defineConfig } from '@playwright/test'

/**
 * Linden Engine — 1.000.000 unique generated test cases.
 * Headless, no browser: no spec uses `page`/`browser`, everything runs in Node.
 * Run per category with tools/run-all.sh (one Playwright invocation per folder keeps memory bounded).
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  timeout: 20_000,
  reporter: [['dot'], ['./lib/summary-reporter.ts']],
  outputDir: 'report/artifacts',
  use: { headless: true },
})
