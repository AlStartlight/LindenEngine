import { defineConfig } from 'vitest/config'

// Benchmarks (`npm run bench:mesh`): timing runs kept out of the regular unit test suite
export default defineConfig({
  test: {
    include: ['tests/**/*.bench.ts'],
    fileParallelism: false,
  },
})
