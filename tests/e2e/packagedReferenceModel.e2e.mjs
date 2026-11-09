// E2E (macOS): the PACKAGED app launched with the PATH a Finder/Dock launch gets. img2threejs is
// not shipped (no Resources/agent-skills, no img2 prompt, no img2 tools); reference images are
// rebuilt with Linden's own tools, and hand-written factories compile with the packaged three addons.
//   npm run build && npm run build:electron && npx electron-builder --mac --dir --publish never
//   npm run test:e2e:packaged-reference-model
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeProject, runChecks } from './referenceModelChecks.mjs'

const repo = process.cwd()
const appPath = path.resolve('release/mac-arm64/Linden Engine.app/Contents/MacOS/Linden Engine')
const resources = path.resolve('release/mac-arm64/Linden Engine.app/Contents/Resources')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-pkg-ref-'))
const project = path.join(work, 'Ref')
const userData = path.join(work, 'userData')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

check('img2threejs skill is not shipped', !fs.existsSync(path.join(resources, 'agent-skills')))
check('img2threejs prompt is not shipped', !fs.existsSync(path.join(resources, 'agent/prompts/img2threejs.md')) && fs.existsSync(path.join(resources, 'agent/prompts/linden.md')))
const prompt = fs.readFileSync(path.join(resources, 'agent/prompts/linden.md'), 'utf-8')
check('shipped prompt has the native reference-image workflow', /## 7\. Rebuilding an object from a reference image\n/.test(prompt) && /linden_reference_view/.test(prompt) && !/linden_img2_/.test(prompt))
check('Resources/three-addons is shipped', fs.existsSync(path.join(resources, 'three-addons/geometries/RoundedBoxGeometry.js')))

makeProject(repo, project)
// What launchd gives an app opened from Finder; LINDEN_IMG2THREEJS is not set
const env = { HOME: os.homedir(), USER: os.userInfo().username, SHELL: process.env.SHELL || '/bin/zsh', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8', LINDEN_E2E: '1' }
const app = await electron.launch({ executablePath: appPath, args: [`--user-data-dir=${userData}`], env })
try {
  check('packaged', await app.evaluate(({ app }) => app.isPackaged))
  await runChecks({ app, repo, project, check })
  check('no skill runtime copied to userData', !fs.existsSync(path.join(userData, 'agent-skills')))
} catch (err) {
  check('no exception', false, err?.stack ?? String(err))
} finally {
  await app.close().catch(() => {})
  fs.rmSync(work, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
