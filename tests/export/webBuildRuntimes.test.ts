import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WebBuildRunner } from '../../electron/build/WebBuildRunner'
import { ExportPreset } from '../../shared/types/project'

const preset = (over: Partial<ExportPreset> = {}): ExportPreset => ({
  id: 'web',
  name: 'Web',
  platform: 'web',
  backend: 'linden',
  arch: ['wasm'],
  output: 'build/web',
  mode: 'release',
  zipOutput: false,
  ...over,
})

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-webrt-'))
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

describe('web build: scripts and HTML UI (scene runtime)', () => {
  let dir = ''
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }))

  it('ships compiled scripts and ui fragments', async () => {
    dir = makeProject({
      'project.linden.json': JSON.stringify({ name: 'S', version: '1', scenesInBuild: ['scenes/Main.lscene'] }),
      'scenes/Main.lscene': JSON.stringify({ format: 'linden-scene', version: 2, name: 'Main', entities: [] }),
      'scripts/Player.ts': 'export default class Player { speed: number = 3 }\n',
      'ui/hud.html': '<div id="coins">0</div>',
    })
    const res = await WebBuildRunner.runBuild({ projectPath: dir, preset: preset() })
    expect(res.error).toBeUndefined()
    const out = path.join(dir, 'build/web')
    const js = fs.readFileSync(path.join(out, 'game-scripts/Player.js'), 'utf-8')
    expect(js).not.toContain(': number')
    expect(fs.existsSync(path.join(out, 'ui/hud.html'))).toBe(true)
    expect(fs.existsSync(path.join(out, 'linden-bridge.js'))).toBe(false)
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf-8')
    expect(html).toContain('data-canvas-mode="responsive"')
    expect(html).not.toContain('{{')
  })

  it('fails the build on script compile errors with file:line', async () => {
    dir = makeProject({
      'project.linden.json': JSON.stringify({ name: 'S', version: '1' }),
      'scripts/Broken.ts': 'export default class B {\n  x = \n}\n',
    })
    const res = await WebBuildRunner.runBuild({ projectPath: dir, preset: preset() })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/scripts\/Broken\.ts:3/)
  })
})

describe('web build: HTML Game runtime', () => {
  let dir = ''
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }))

  it('copies the entry folder, injects the bridge and reports missing refs', async () => {
    dir = makeProject({
      'project.linden.json': JSON.stringify({
        name: 'H',
        version: '1',
        runtime: 'html',
        html: { entry: 'web/game.html' },
        input: { actions: [{ name: 'Jump', type: 'button', bindings: ['Keyboard/Space'] }] },
      }),
      'web/game.html': '<!doctype html><html><head><title>t</title><script type="module" src="main.js"></script><script src="missing.js"></script></head><body></body></html>',
      'web/main.js': 'console.log(1)',
      'scenes/Main.lscene': '{}',
    })
    const res = await WebBuildRunner.runBuild({ projectPath: dir, preset: preset() })
    expect(res.error).toBeUndefined()
    const out = path.join(dir, 'build/web')
    const page = fs.readFileSync(path.join(out, 'game.html'), 'utf-8')
    expect(page).toMatch(/<head><script src="linden-runtime\/bridge\.js"><\/script>/)
    expect(fs.existsSync(path.join(out, 'main.js'))).toBe(true)
    expect(fs.existsSync(path.join(out, 'linden-runtime/bridge.js'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(out, 'linden-runtime/project.json'), 'utf-8')).input.actions[0].name).toBe('Jump')
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf-8')).toContain('url=game.html')
    expect(fs.existsSync(path.join(out, 'game.js'))).toBe(false)
    expect(fs.existsSync(path.join(out, 'scenes'))).toBe(false)
    expect(res.report?.warnings.join(' ')).toMatch(/missing\.js/)
  })
})
