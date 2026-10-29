// Prebuilds the browser runtime (player/) into dist-player/ so the packaged editor can
// export HTML5 games and run Play in the viewport without bundling engine sources at runtime.
import { build } from 'rolldown'
import { copyFileSync, rmSync } from 'node:fs'
import { copyDecoders } from './copy-decoders.mjs'

rmSync('dist-player', { recursive: true, force: true })

await build({
  input: 'player/main.ts',
  platform: 'browser',
  output: {
    dir: 'dist-player',
    format: 'esm',
    entryFileNames: 'game.js',
    minify: true,
    sourcemap: true,
  },
})

// Offscreen render preview (linden_render_preview), same engine code as the player
await build({
  input: 'player/preview.ts',
  platform: 'browser',
  output: {
    dir: 'dist-player',
    format: 'esm',
    entryFileNames: 'preview.js',
    minify: true,
    sourcemap: true,
  },
})

// Classic script injected into HTML Game pages (runtime 'html')
await build({
  input: 'player/htmlBridge.ts',
  platform: 'browser',
  output: {
    file: 'dist-player/linden-bridge.js',
    format: 'iife',
    minify: true,
    codeSplitting: false,
  },
})

copyFileSync('player/index.html', 'dist-player/index.html')
copyFileSync('player/preview.html', 'dist-player/preview.html')
// Draco/Basis decoders next to game.js: glTF models load offline in Play and in web exports
copyDecoders('dist-player/decoders')
