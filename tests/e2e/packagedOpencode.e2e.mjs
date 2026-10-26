// E2E (macOS): launch the PACKAGED app with the PATH a Finder/Dock launch gets, then start the
// agent. Guards against "OpenCode CLI tidak ditemukan" in production builds.
// Needs `opencode` installed for the current user and a packaged build:
//   npm run build && npm run build:electron && npx electron-builder --mac --dir --publish never
//   npm run test:e2e:packaged-agent
// Creates a temporary project in ~/Documents/Linden Projects and removes it afterwards.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const app = path.resolve('release/mac-arm64/Linden Engine.app/Contents/MacOS/Linden Engine')
const projects = path.join(os.homedir(), 'Documents', 'Linden Projects')
const project = path.join(projects, `__linden-opencode-check-${Date.now()}`)
fs.mkdirSync(path.join(project, 'scenes'), { recursive: true })
fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'OpencodeCheck', version: '0.1.0' }))
fs.writeFileSync(path.join(project, 'scenes/Main.lscene'), JSON.stringify({ format: 'linden-scene', version: 2, name: 'Main', entities: [] }))
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-pkg-ud-'))

// What launchd gives an app opened from Finder: no nvm, Homebrew or npm folders
const env = { HOME: os.homedir(), USER: os.userInfo().username, SHELL: process.env.SHELL || '/bin/zsh', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8' }
console.log('launch PATH:', env.PATH)

const electronApp = await electron.launch({ executablePath: app, args: [`--user-data-dir=${userData}`], env })
let failed = false
try {
  const page = await electronApp.firstWindow()
  await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 30000 })
  console.log('packaged:', await electronApp.evaluate(({ app }) => app.isPackaged), '| main PATH:', await electronApp.evaluate(() => process.env.PATH))
  const t0 = Date.now()
  const status = await page.evaluate((p) => window.electronAPI.agentStart(p), project)
  console.log(`agentStart (${Date.now() - t0} ms):`, JSON.stringify({ installed: status.installed, version: status.version, running: status.running, serverUrl: status.serverUrl, error: status.error }))
  if (!status.installed || !status.running) failed = true
  const providers = await page.evaluate(() => window.electronAPI.agentGetProviders?.())
  console.log('providers from server:', Array.isArray(providers) ? providers.length : providers)
  await page.evaluate(() => window.electronAPI.agentStop())
} catch (e) {
  failed = true
  console.log('ERROR', e.message)
} finally {
  await electronApp.close()
  fs.rmSync(project, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
}
console.log(failed ? 'RESULT: FAIL' : 'RESULT: OPENCODE OK IN PACKAGED BUILD')
process.exit(failed ? 1 : 0)
