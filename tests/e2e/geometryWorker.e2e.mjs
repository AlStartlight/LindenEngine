// E2E: the geometry Web Worker in a real Chromium (Electron), from a production Vite build. Covers what Node
// unit tests cannot: module-worker bundling, lazy WASM fetches, draco3d's CommonJS build with wasmBinary.
// Two passes over the same build:
//   file://  - exactly how the packaged editor loads dist/index.html (functional checks)
//   http://  - Chromium records no resource timing for file://, so lazy loading is verified over HTTP
//   npm run test:e2e:geometry
import { _electron as electron } from 'playwright'
import { build } from 'vite'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-geometry-e2e-'))
const outDir = path.join(work, 'dist')

await build({
  configFile: false,
  root: path.join(repo, 'tests/e2e/geometry-harness'),
  base: './',
  logLevel: 'warn',
  worker: { format: 'es' },
  build: { outDir, emptyOutDir: true, target: 'es2020' },
})

// Minimal static server for the HTTP pass
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const file = path.join(outDir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(outDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const httpUrl = `http://127.0.0.1:${server.address().port}/index.html`

const mainScript = path.join(work, 'main.cjs')
fs.writeFileSync(mainScript, `
const { app, BrowserWindow } = require('electron')
const target = process.env.GEOMETRY_E2E_URL
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  if (target) win.loadURL(target)
  else win.loadFile(${JSON.stringify(path.join(outDir, 'index.html'))})
})
`)

let failed = 0
const report = (mode, c) => {
  if (!c.ok) failed++
  console.log(`${c.ok ? 'PASS' : 'FAIL'} [${mode}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
}
const names = (urls) => urls.map((u) => decodeURIComponent(u.split('/').pop() ?? ''))
const lazyAssets = (list) => list.filter((n) => /\.wasm$|geometry\.worker|manifoldAdapter|meshoptAdapter|gltf|draco/.test(n))

async function pass(mode, url) {
  const appHandle = await electron.launch({ args: [mainScript], env: { ...process.env, GEOMETRY_E2E_URL: url ?? '' } })
  try {
    const page = await appHandle.firstWindow()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.waitForFunction(() => typeof window.geometrySmoke === 'object', null, { timeout: 30_000 })
    const pageResources = async () => names(await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name)))

    const started = await page.evaluate(() => window.geometrySmoke.prepare())
    report(mode, { name: 'createGeometryOps() starts no worker', ok: started === false && page.workers().length === 0 })
    const before = lazyAssets(await pageResources())
    for (const c of await page.evaluate(() => window.geometrySmoke.run())) report(mode, c)
    const workers = page.workers()
    report(mode, {
      name: 'exactly one geometry worker, started on first use',
      ok: workers.length === 1 && /geometry\.worker/.test(workers[0]?.url() ?? ''),
      detail: names(workers.map((w) => w.url())).join(', '),
    })
    if (mode === 'http') {
      report(mode, { name: 'nothing lazy requested before the first call', ok: before.length === 0, detail: before.join(', ') })
      const inWorker = workers.length ? names(await workers[0].evaluate(() => performance.getEntriesByType('resource').map((e) => e.name))) : []
      const has = (re) => inWorker.some((n) => re.test(n))
      report(mode, { name: 'manifold.wasm fetched by the worker', ok: has(/^manifold.*\.wasm$/) })
      report(mode, { name: 'Draco encoder + decoder .wasm fetched by the worker', ok: has(/^draco_encoder.*\.wasm$/) && has(/^draco_decoder.*\.wasm$/) })
      report(mode, { name: 'adapters arrive as separate lazy chunks', ok: inWorker.filter((n) => n.endsWith('.js')).length >= 2, detail: inWorker.filter((n) => n.endsWith('.js')).join(', ') })
      report(mode, { name: 'page itself never fetched WASM', ok: !(await pageResources()).some((n) => n.endsWith('.wasm')) })
    }
    await page.evaluate(() => window.geometrySmoke.dispose())
    if (errors.length) report(mode, { name: 'no page errors', ok: false, detail: errors.join(' | ') })
  } finally {
    await appHandle.close()
  }
}

try {
  await pass('file', null)
  await pass('http', httpUrl)
} finally {
  server.close()
}
for (const f of fs.readdirSync(path.join(outDir, 'assets')).filter((n) => n.endsWith('.wasm'))) {
  console.log(`  asset ${f}: ${(fs.statSync(path.join(outDir, 'assets', f)).size / 1024).toFixed(0)} KiB`)
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall geometry worker checks passed')
process.exit(failed ? 1 : 0)
