// Renders the box-modeled elf (tests/mesh/modeling/elfModel.ts) through the player runtime with
// linden_render_preview: proves an EditableMesh shows up in the game, not only in the editor.
//   npm run build:electron && npm run build:player && node tests/e2e/elfPreview.e2e.mjs
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-elf-e2e-'))
const outDir = process.env.LINDEN_E2E_OUT ? path.resolve(process.env.LINDEN_E2E_OUT) : path.join(work, 'previews')
const project = path.join(work, 'ElfGame')
fs.mkdirSync(path.join(project, 'scenes'), { recursive: true })
fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'ElfGame', version: '0.1.0', scenesInBuild: ['scenes/Elf.lscene'] }, null, 2))

// Build the model with the real modeling code and write scenes/Elf.lscene
execFileSync('npx', ['vitest', 'run', 'tests/mesh/modeling/elfCharacter.test.ts', '-t', 'writes a scene'], {
  cwd: repo, env: { ...process.env, ELF_OUT: path.join(project, 'scenes') }, stdio: 'ignore',
})
if (!fs.existsSync(path.join(project, 'scenes/Elf.lscene'))) throw new Error('scene was not written')

let failed = 0
const app = await electron.launch({ args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`], env: { ...process.env, LINDEN_E2E: '1' } })
try {
  for (let i = 0; i < 100 && !(await app.evaluate(() => typeof globalThis.__lindenRunTool === 'function')); i++) await new Promise((r) => setTimeout(r, 100))
  const res = await app.evaluate(async (_e, a) => globalThis.__lindenRunTool(a.project, 'linden_render_preview', a.args), {
    project, args: { scenePath: 'scenes/Elf.lscene', entityId: 'elf', views: ['front', 'side', 'threeQuarter'], size: 768 },
  })
  console.log(`${res.success ? 'PASS' : 'FAIL'} render_preview ${res.error ?? (res.data?.warnings?.join('; ') || '')}`)
  if (!res.success) failed++
  fs.mkdirSync(outDir, { recursive: true })
  for (const img of res.images ?? []) {
    const file = path.join(outDir, `elf-${img.label}.png`)
    fs.writeFileSync(file, Buffer.from(img.data, 'base64'))
    console.log(`  ${file}`)
  }
} finally {
  await app.close().catch(() => {})
}
fs.copyFileSync(path.join(project, 'scenes/elf.glb'), path.join(outDir, 'elf.glb'))
process.exit(failed ? 1 : 0)
