import { defineConfig, configDefaults } from 'vitest/config'

// Unit tests live in tests/; docs/test-case* hold Playwright suites with their own runner
export default defineConfig({
  test: {
    // native/ holds the local Emscripten toolchain (with its own test files)
    exclude: [...configDefaults.exclude, 'docs/**', 'release/**', 'dist-electron/**', 'native/**'],
  },
})
