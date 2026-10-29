// E2E: linden_render_preview renders fixtures/realistic-showcase.lscene offscreen in the real
// Electron app (hidden window, player runtime, same ScenePipeline as editor and player) and the
// PNGs are saved to docs/showcase/ for review.
//   npm run test:e2e:preview
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-preview-e2e-'))
const project = path.join(work, 'Showcase')
const outDir = path.join(repo, 'docs/showcase')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

fs.mkdirSync(path.join(project, 'scenes'), { recursive: true })
fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'Showcase', quality: 'high', scenesInBuild: ['scenes/Main.lscene'] }))
fs.copyFileSync(path.join(repo, 'fixtures/realistic-showcase.lscene'), path.join(project, 'scenes/Main.lscene'))
fs.cpSync(path.join(repo, 'fixtures/realistic-showcase/assets'), path.join(project, 'assets'), { recursive: true })

const app = await electron.launch({
  args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`],
  env: { ...process.env, LINDEN_E2E: '1' },
})
const runTool = (name, args) => app.evaluate(async (_electron, a) => globalThis.__lindenRunTool(a.project, a.name, a.args), { project, name, args })

try {
  // Wait until main registered the hook (app ready)
  for (let i = 0; i < 100 && !(await app.evaluate(() => typeof globalThis.__lindenRunTool === 'function')); i++) await new Promise((r) => setTimeout(r, 100))

  fs.mkdirSync(outDir, { recursive: true })
  const shots = [
    { label: 'scene', args: { views: ['front', 'side', 'top', 'threeQuarter'], size: 768 } },
    { label: 'chair', args: { entityId: 'chair', views: ['front', 'side', 'top', 'threeQuarter'], size: 512 } },
    { label: 'desk_lamp', args: { entityId: 'desk_lamp', views: ['threeQuarter'], size: 512 } },
    { label: 'glass', args: { entityId: 'glass', views: ['front'], size: 512 } },
  ]
  for (const shot of shots) {
    const t0 = Date.now()
    const res = await runTool('linden_render_preview', shot.args)
    check(`${shot.label}: render_preview succeeds`, res.success, res.error ?? `${Date.now() - t0} ms, ${res.data?.triangles} tris, size ${JSON.stringify(res.data?.size)}`)
    if (!res.success) continue
    if (res.data.warnings?.length) console.log('  warnings:', res.data.warnings)
    check(`${shot.label}: one image per view`, res.images.length === shot.args.views.length)
    const sizes = new Set()
    for (const img of res.images) {
      const buf = Buffer.from(img.data, 'base64')
      const file = path.join(outDir, `${shot.label}-${img.label}.png`)
      fs.writeFileSync(file, buf)
      sizes.add(buf.length)
      // An empty/black frame compresses to almost nothing
      check(`${shot.label} ${img.label}: has content`, buf.length > 20_000, `${(buf.length / 1024).toFixed(0)} KB → ${path.relative(repo, file)}`)
    }
    if (res.images.length > 1) check(`${shot.label}: views differ`, sizes.size === res.images.length)
    check(`${shot.label}: PNGs saved in the project`, res.data.files.every((f) => fs.existsSync(path.join(project, f))))
  }

  // Editor viewport: same pipeline, assets through linden-asset:// (needs `npm run dev`)
  const devUp = await fetch('http://127.0.0.1:5173').then((r) => r.ok, () => false)
  if (!devUp) console.log('SKIP editor viewport (start `npm run dev` to include it)')
  else {
    let page = null
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? null
      if (!page) await new Promise((r) => setTimeout(r, 200))
    }
    const errors = []
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()))
    await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 30000 })
    await page.evaluate((p) => window.electronAPI.addRecentProject({ name: 'Showcase', path: p, lastOpened: Date.now() }), project)
    await page.reload()
    await page.waitForFunction(() => !!window.electronAPI)
    await page.waitForTimeout(1500)
    await page.getByText('Showcase', { exact: true }).first().click()
    await page.waitForTimeout(6000)
    const consoleText = await page.evaluate(() => document.body.innerText)
    const assetErrors = [...errors, ...consoleText.split('\n')].filter((t) => /gagal dimuat|tidak valid|linden-asset|Content Security Policy|has been removed/i.test(t))
    check('editor: scene assets (HDR, GLB, textures) load without errors', assetErrors.length === 0, assetErrors.slice(0, 3).join(' | '))
    const canvas = page.locator('canvas').first()
    await canvas.screenshot({ path: path.join(outDir, 'editor-viewport.png') })
    check('editor: viewport screenshot saved', fs.statSync(path.join(outDir, 'editor-viewport.png')).size > 20_000, 'docs/showcase/editor-viewport.png')
    await page.getByText('Scene', { exact: true }).first().click()
    check('editor: Scene tab shows the HDR environment', await page.locator('select').filter({ hasText: 'studio_sky.hdr' }).count().then((n) => n > 0))
  }
} finally {
  await app.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; images in ${path.relative(repo, outDir)}`)
process.exit(failed.length ? 1 : 0)
