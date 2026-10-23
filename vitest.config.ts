import { defineConfig, configDefaults } from 'vitest/config'

// Unit tests live in tests/; docs/test-case* hold Playwright suites with their own runner
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'docs/**', 'release/**', 'dist-electron/**'],
  },
})
