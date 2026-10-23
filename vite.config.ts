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
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'ES2020',
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
