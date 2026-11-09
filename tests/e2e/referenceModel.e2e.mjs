// E2E: rebuild an object from a reference image with Linden's own tools (img2threejs is off).
// The attached image is visible to the agent, a hand-written three.js factory is written,
// compiled, measured in the sandboxed probe, rendered, compared, simulated and baked to GLB.
//   npm run test:e2e:reference-model
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeProject, runChecks } from './referenceModelChecks.mjs'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-ref-e2e-'))
const project = path.join(work, 'Ref')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

makeProject(repo, project)
const env = { ...process.env, LINDEN_E2E: '1' }
delete env.LINDEN_IMG2THREEJS
const app = await electron.launch({ args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`], env })
try {
  await runChecks({ app, repo, project, check })
} catch (err) {
  check('no exception', false, err?.stack ?? String(err))
} finally {
  await app.close().catch(() => {})
  fs.rmSync(work, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
