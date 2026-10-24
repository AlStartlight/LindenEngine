// Bundles the Electron main and preload scripts into single CommonJS files.
// tsc output kept one file per module with extensionless require() paths, which
// broke once files were renamed to .cjs ("Cannot find module './bridge/godotExec'").
// Bundling resolves every relative import (electron/, shared/, engine/) at build time.
import { build } from 'rolldown'
import { readFileSync, rmSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
// Runtime dependencies ship in node_modules, so load them from there instead of inlining
const external = ['electron', ...Object.keys(pkg.dependencies ?? {})]

rmSync('dist-electron', { recursive: true, force: true })

for (const entry of ['main', 'preload']) {
  await build({
    input: `electron/${entry}.ts`,
    platform: 'node',
    external: (id) => external.some((dep) => id === dep || id.startsWith(`${dep}/`)),
    output: {
      file: `dist-electron/${entry}.cjs`,
      format: 'cjs',
    },
  })
}
