// Copies the glTF decoders (Draco, Basis/KTX2) from three's examples into a folder served next to
// the app, so models load offline and without a CDN. Used for the editor (public/decoders) and the
// player runtime (dist-player/decoders, also part of every web export).
import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const libs = path.join(root, 'node_modules/three/examples/jsm/libs')

export function copyDecoders(outDir) {
  mkdirSync(outDir, { recursive: true })
  cpSync(path.join(libs, 'draco/gltf'), path.join(outDir, 'draco'), { recursive: true })
  cpSync(path.join(libs, 'basis'), path.join(outDir, 'basis'), { recursive: true, filter: (src) => !src.endsWith('.md') })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const dir of process.argv.slice(2)) copyDecoders(path.resolve(root, dir))
}
