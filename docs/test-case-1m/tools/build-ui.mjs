// Bundles the React editor UI with esbuild so it can be rendered with react-dom/server in Node
import { build } from 'esbuild'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: [join(root, 'ui', 'entry.ts')],
  outfile: join(root, 'ui', 'ui-bundle.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'three', 'zustand', 'zod', '@dimforge/*'],
  logLevel: 'warning',
})
console.log('ui/ui-bundle.mjs built')
