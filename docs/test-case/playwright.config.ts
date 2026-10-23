import { defineConfig } from '@playwright/test'

/**
 * Linden Engine — 10.000 generated test cases
 *
 * Runs on the Playwright Test runner in headless mode without a browser:
 * no spec uses the `page`/`browser` fixtures, so Playwright never launches Chromium.
 *
 *   npx playwright test -c docs/test-case/playwright.config.ts
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  timeout: 10_000,
  reporter: [
    ['dot'],
    ['json', { outputFile: 'report/results.json' }],
    ['html', { outputFolder: 'report/html', open: 'never' }],
  ],
  outputDir: 'report/artifacts',
  use: {
    headless: true,
  },
})
