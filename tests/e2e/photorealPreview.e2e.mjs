// E2E: the shipped Photoreal Studio scene renders through the real player runtime (hidden window,
// same World + SceneBridge + ScenePipeline as editor/player): GLB with embedded PBR textures and
// settings.colorGrade post pass in the real Electron app. Images land in docs/media/.
//   npm run test:e2e:photoreal
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-photoreal-e2e-'))
const project = path.join(work, 'Photoreal')
const outDir = path.join(repo, 'docs/media')
fs.mkdirSync(path.join(project, 'scenes'), { recursive: true })
fs.mkdirSync(path.join(project, 'assets/models'), { recursive: true })
fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'Photoreal', quality: 'high', scenesInBuild: ['scenes/Main.lscene'] }))
fs.copyFileSync(path.join(repo, 'scenes/PhotorealStudio.lscene'), path.join(project, 'scenes/Main.lscene'))
fs.copyFileSync(path.join(repo, 'assets/models/photoreal_vase.glb'), path.join(project, 'assets/models/photoreal_vase.glb'))
fs.mkdirSync(outDir, { recursive: true })

// DSH/CI shells sometimes export ELECTRON_RUN_AS_NODE=1, which turns Electron into plain Node
const env = { ...process.env, LINDEN_E2E: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`],
  env,
})
const runTool = (name, args) => app.evaluate(async (_electron, a) => globalThis.__lindenRunTool(a.project, a.name, a.args), { project, name, args })
try {
  for (let i = 0; i < 150 && !(await app.evaluate(() => typeof globalThis.__lindenRunTool === 'function')); i++) await new Promise((r) => setTimeout(r, 100))
  const res = await runTool('linden_render_preview', { views: ['front', 'threeQuarter'], size: 768 })
  if (!res.success) { console.error('FAIL render_preview:', res.error); process.exitCode = 1 }
  if (!res.images?.length) { console.error('FAIL no images'); process.exitCode = 1 }
  if (res.data) console.log('DATA', JSON.stringify({ size: res.data.size, triangles: res.data.triangles, warnings: res.data.warnings, files: res.data.files }))
  if (res.data?.warnings?.length) { console.error('FAIL warnings:', res.data.warnings.join(' | ')); process.exitCode = 1 }
  if ((res.data?.triangles ?? 0) < 40000) { console.error('FAIL GLB geometry missing:', res.data?.triangles); process.exitCode = 1 }
  for (const img of res.images ?? []) {
    const buf = Buffer.from(img.data, 'base64')
    const file = path.join(outDir, `engine-photoreal-${img.label}.png`)
    fs.writeFileSync(file, buf)
    console.log('PASS image', file, `${(buf.length / 1024).toFixed(0)} KB`)
    if (buf.length < 20000) { console.error('FAIL empty image'); process.exitCode = 1 }
  }
} finally {
  await app.close()
  fs.rmSync(work, { recursive: true, force: true })
}
console.log(process.exitCode ? 'FAILED' : 'PASS photoreal engine preview')
