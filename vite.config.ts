import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the packaged app loads dist/index.html over file://, where /assets/... would point at the disk root
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@engine': path.resolve(__dirname, './engine'),
      '@editor': path.resolve(__dirname, './editor'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  // ES-module workers: the geometry worker lazy-loads its WASM adapters with dynamic import()
  worker: {
    format: 'es',
  },
  // Pre-bundle from the editor entry only: the default scans every HTML file under the root, which
  // includes player/index.html (unresolvable game.js) and native/.emsdk (the local Emscripten toolchain)
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    port: 5173,
    strictPort: false,
    // native/ holds ~40k toolchain files (native/build.sh); nothing there is served
    watch: { ignored: ['**/native/**'] },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
