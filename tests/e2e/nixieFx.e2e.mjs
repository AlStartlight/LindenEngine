// E2E: a NixieFX effect (tests/fixtures/nixie-fx, exported by the nixie-fx CLI) rendered with Linden's
// three r186 in a real WebGL context (Electron). nixie-fx declares three <0.186; this guards the override.
//   node tests/e2e/nixieFx.e2e.mjs
import { _electron as electron } from 'playwright'
import { build } from 'vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-nixie-e2e-'))
const outDir = path.join(work, 'dist')
await build({ configFile: false, root: path.join(repo, 'tests/e2e/nixie-harness'), base: './', logLevel: 'warn', build: { outDir, emptyOutDir: true } })
const main = path.join(work, 'main.cjs')
fs.writeFileSync(main, `
const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } }).loadFile(${JSON.stringify(path.join(outDir, 'index.html'))}))
`)
const appHandle = await electron.launch({ args: [main] })
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
try {
  const page = await appHandle.firstWindow()
  await page.waitForFunction(() => typeof window.nixieSmoke === 'function', null, { timeout: 30000 })
  const r = await page.evaluate(() => window.nixieSmoke())
  check('three revision is the project one (r186)', r.three === '186', r.three)
  check('effect reports full three3d support', r.support === 'supported', r.support)
  check('particles are simulated', r.particles > 0, `${r.particles} active`)
  check('shaders compile under r186 (no WebGL errors)', r.errors.length === 0, r.errors.join(' | ').slice(0, 300))
  check('particles reach the framebuffer', r.litPixels > 50, `${r.litPixels} lit pixels, ${r.drawCalls} draw calls, ${r.programs} programs`)
} finally {
  await appHandle.close()
}
process.exit(failed ? 1 : 0)
