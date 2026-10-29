// Bundles scripts/showcase/generate.ts (engine + agent tools are TypeScript) and runs it.
import { build } from 'rolldown'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Inside the repo so the bundle resolves node_modules (Rapier stays external: it loads its wasm itself)
const out = path.resolve('node_modules/.cache/linden-showcase')
mkdirSync(out, { recursive: true })
try {
  await build({
    input: 'scripts/showcase/generate.ts',
    platform: 'node',
    logLevel: 'warn',
    external: [/^node:/, 'electron', 'rolldown', /^@dimforge\//],
    output: { file: path.join(out, 'generate.mjs'), format: 'esm', codeSplitting: false },
  })
  await import(pathToFileURL(path.join(out, 'generate.mjs')).href)
} finally {
  rmSync(out, { recursive: true, force: true })
}
