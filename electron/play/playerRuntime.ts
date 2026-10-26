import fs from 'node:fs'
import path from 'node:path'
import { resolveAppResource } from '../resourcePaths'

/**
 * Locates the browser runtime (game.js, index.html template, linden-bridge.js).
 * Packaged: the prebuilt copy shipped as extraResources. Dev: rebuilt from player/ whenever
 * player/, engine/ or shared/ change, so Play never runs a stale dist-player/ or old build.
 */

const REQUIRED = ['game.js', 'index.html', 'linden-bridge.js']
const builds = new Map<string, { fingerprint: string; promise: Promise<string> }>()

/** Newest mtime of the sources that make up the runtime (dev rebuilds when it changes) */
function sourceFingerprint(roots: string[]): { key: string; newest: number } {
  let newest = 0
  let count = 0
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (/\.(ts|tsx|js|html)$/.test(ent.name)) {
        newest = Math.max(newest, fs.statSync(full).mtimeMs)
        count++
      }
    }
  }
  roots.forEach(walk)
  return { key: `${count}:${newest}`, newest }
}

function isComplete(dir: string): boolean {
  return REQUIRED.every((f) => fs.existsSync(path.join(dir, f)))
}

async function buildFromSource(playerDir: string, outDir: string): Promise<string> {
  const { build } = await import('rolldown')
  fs.rmSync(outDir, { recursive: true, force: true })
  await build({
    input: path.join(playerDir, 'main.ts'),
    platform: 'browser',
    logLevel: 'silent',
    output: { dir: outDir, format: 'esm', entryFileNames: 'game.js', sourcemap: true },
  } as any)
  await build({
    input: path.join(playerDir, 'htmlBridge.ts'),
    platform: 'browser',
    logLevel: 'silent',
    output: { file: path.join(outDir, 'linden-bridge.js'), format: 'iife', codeSplitting: false },
  } as any)
  fs.copyFileSync(path.join(playerDir, 'index.html'), path.join(outDir, 'index.html'))
  return outDir
}

export async function ensurePlayerRuntime(opts: { preferSource: boolean; cacheDir: string }): Promise<string> {
  const prebuilt = resolveAppResource('dist-player', 'player-runtime')
  const playerEntry = resolveAppResource('player/main.ts', 'player/main.ts')
  const hasSource = fs.existsSync(playerEntry)

  if (!hasSource) {
    if (isComplete(prebuilt)) return prebuilt
    throw new Error(`Runtime Linden Player tidak ditemukan (${prebuilt}). Jalankan "npm run build:player".`)
  }

  const playerDir = path.dirname(playerEntry)
  const repoRoot = path.dirname(playerDir)
  const sources = sourceFingerprint(['player', 'engine', 'shared'].map((d) => path.join(repoRoot, d)))

  // A prebuilt dist-player/ older than the sources (forgot `npm run build:player`) is never used
  if (!opts.preferSource && isComplete(prebuilt) && fs.statSync(path.join(prebuilt, 'game.js')).mtimeMs >= sources.newest) {
    return prebuilt
  }

  // Rebuild whenever player/, engine/ or shared/ changed, so Play never runs a stale or half-edited runtime
  const fingerprint = sources.key
  const cached = builds.get(opts.cacheDir)
  if (cached && cached.fingerprint === fingerprint) return cached.promise

  const promise = buildFromSource(playerDir, opts.cacheDir)
  promise.catch(() => builds.delete(opts.cacheDir))
  builds.set(opts.cacheDir, { fingerprint, promise })
  return promise
}
