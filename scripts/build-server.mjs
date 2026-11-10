// Bundles server/linden-server.ts (multiplayer room + static server) into one self-contained ESM
// file with ws and zod inlined, so `node linden-server.mjs` needs no npm install. ws's optional
// native helpers stay external; ws falls back to JavaScript without them.
import { build } from 'rolldown'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function buildServer(outFile) {
  await build({
    input: path.join(root, 'server/linden-server.ts'),
    platform: 'node',
    logLevel: 'silent',
    external: ['bufferutil', 'utf-8-validate'],
    output: {
      file: path.resolve(root, outFile),
      format: 'esm',
      codeSplitting: false,
      banner: "import { createRequire as __lindenCreateRequire } from 'node:module';\nconst require = __lindenCreateRequire(import.meta.url);",
    },
  })
  return path.resolve(root, outFile)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await buildServer(process.argv[2] ?? 'dist-electron/linden-server.mjs'))
}
