// Bundles the Electron main and preload scripts into single CommonJS files.
// tsc output kept one file per module with extensionless require() paths, which
// broke once files were renamed to .cjs ("Cannot find module './bridge/godotExec'").
// Bundling resolves every relative import (electron/, shared/, engine/) at build time.
import { build } from 'rolldown'
import { readFileSync, rmSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
// Runtime dependencies ship in node_modules, so load them from there instead of inlining.
// Keep ESM-only packages like @opencode/client bundled so CJS require() doesn't fail.
// Keep three bundled too: electron-builder strips node_modules/**/examples, so
// three/examples/jsm/* would be missing from app.asar at runtime.
// rolldown ships native bindings and is loaded at runtime by WebBuildRunner, so it stays external.
const bundled = ['@opencode/client', 'three']
const external = [
  'electron',
  'rolldown',
  ...Object.keys(pkg.dependencies ?? {}).filter((d) => !bundled.includes(d)),
]

rmSync('dist-electron', { recursive: true, force: true })

// CJS has no import.meta. Bundled ESM deps in main (and rolldown's own __require helper,
// which calls createRequire(import.meta.url)) need a real file URL, not undefined.
const mainImportMeta = {
  define: {
    'import.meta.url': '__linden_import_meta_url',
    'import.meta.filename': '__filename',
    'import.meta.dirname': '__dirname',
  },
  banner: "const __linden_import_meta_url = require('node:url').pathToFileURL(__filename).href;",
}

for (const entry of ['main', 'preload']) {
  // The preload runs sandboxed: only 'electron' can be required there, so no banner
  const isMain = entry === 'main'
  await build({
    input: `electron/${entry}.ts`,
    platform: 'node',
    external: (id) => external.some((dep) => id === dep || id.startsWith(`${dep}/`)),
    transform: isMain ? { define: mainImportMeta.define } : undefined,
    output: {
      file: `dist-electron/${entry}.cjs`,
      banner: isMain ? mainImportMeta.banner : undefined,
      format: 'cjs',
      codeSplitting: false,
    },
  })
}
