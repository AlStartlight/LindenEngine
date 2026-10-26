import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveGameRequest, buildGameCsp, injectHeadScript, GameSession } from '../../electron/play/GameProtocol'
import { startPlaySession, stopPlaySession, getPlaySession } from '../../electron/play/PlaySession'

describe('linden-game:// protocol', () => {
  let tmp: string
  let project: string
  let runtime: string
  let compiled: string
  let outside: string
  const sessions = new Map<string, GameSession>()
  const get = (id: string) => sessions.get(id)

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linden-proto-')))
    project = path.join(tmp, 'project')
    runtime = path.join(tmp, 'runtime')
    compiled = path.join(tmp, 'compiled')
    outside = path.join(tmp, 'secret.txt')
    for (const d of [project, runtime, compiled, path.join(project, 'web'), path.join(project, 'assets'), path.join(project, '.git')]) {
      fs.mkdirSync(d, { recursive: true })
    }
    fs.writeFileSync(outside, 'top secret')
    fs.writeFileSync(path.join(project, 'assets/tex.png'), 'png')
    fs.writeFileSync(path.join(project, '.git/config'), 'git')
    fs.writeFileSync(path.join(project, 'web/index.html'), '<!doctype html><html><head><title>x</title></head><body></body></html>')
    fs.symlinkSync(outside, path.join(project, 'assets/link.txt'))
    fs.writeFileSync(path.join(runtime, 'index.html'), '<title>{{APP_NAME}}</title><body data-canvas-mode="{{CANVAS_MODE}}"><script type="module" src="game.js"></script>')
    fs.writeFileSync(path.join(runtime, 'game.js'), 'console.log(1)')
    fs.writeFileSync(path.join(runtime, 'linden-bridge.js'), '/*bridge*/')
    fs.writeFileSync(path.join(compiled, 'Player.js'), 'export default class {}')

    const base = { runtimeDir: runtime, injectBridge: true, allowNetwork: [], projectRoot: project }
    sessions.set('s1', { ...base, id: 's1', mode: 'scene', compiledDir: compiled, projectConfig: { name: 'My <Game>' } })
    sessions.set('h1', { ...base, id: 'h1', mode: 'html', compiledDir: null, htmlEntry: 'web/index.html', projectConfig: { name: 'H', input: { actions: [] } } })
  })
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('serves the player template with the runtime path rewritten and CSP', () => {
    const res = resolveGameRequest('linden-game://play/s1/index.html?embedded=1', get)
    expect(res.status).toBe(200)
    expect(String(res.body)).toContain('src="__linden/runtime/game.js"')
    expect(String(res.body)).toContain('My &lt;Game&gt;')
    expect(res.headers['Content-Security-Policy']).toContain("script-src 'self' 'wasm-unsafe-eval'")
    const scriptSrc = res.headers['Content-Security-Policy'].split('; ').find((d) => d.startsWith('script-src'))
    expect(scriptSrc).not.toContain('unsafe-inline')
  })

  it('serves runtime files, compiled scripts and project assets', () => {
    expect(resolveGameRequest('linden-game://play/s1/__linden/runtime/game.js', get).filePath).toBe(path.join(runtime, 'game.js'))
    const script = resolveGameRequest('linden-game://play/s1/game-scripts/Player.js', get)
    expect(script.filePath).toBe(path.join(compiled, 'Player.js'))
    expect(script.headers['Content-Type']).toMatch(/javascript/)
    expect(resolveGameRequest('linden-game://play/s1/assets/tex.png', get).headers['Content-Type']).toBe('image/png')
  })

  it('refuses traversal, dot folders, symlinks out of the project and unknown sessions', () => {
    expect(resolveGameRequest('linden-game://play/s1/..%2Fsecret.txt', get).status).toBe(403)
    expect(resolveGameRequest('linden-game://play/s1/assets/..%2F..%2Fsecret.txt', get).status).toBe(403)
    expect(resolveGameRequest('linden-game://play/s1/../secret.txt', get).status).toBe(404) // URL normalizes into another "session"
    expect(resolveGameRequest('linden-game://play/s1/.git/config', get).status).toBe(403)
    expect(resolveGameRequest('linden-game://play/s1/assets/link.txt', get).status).toBe(403)
    expect(resolveGameRequest('linden-game://play/s1/__linden/runtime/..%2F..%2Fsecret.txt', get).status).toBe(403)
    expect(resolveGameRequest('linden-game://play/nope/index.html', get).status).toBe(404)
    expect(resolveGameRequest('linden-game://other/s1/index.html', get).status).toBe(404)
    expect(resolveGameRequest('linden-game://play/s1/missing.png', get).status).toBe(404)
  })

  it('injects the bridge into the HTML Game entry page only', () => {
    const entry = resolveGameRequest('linden-game://play/h1/web/index.html?embedded=1', get)
    expect(String(entry.body)).toMatch(/<head><script src="\/h1\/__linden\/bridge\.js"><\/script><title>/)
    expect(resolveGameRequest('linden-game://play/h1/__linden/bridge.js', get).filePath).toBe(path.join(runtime, 'linden-bridge.js'))
    expect(JSON.parse(String(resolveGameRequest('linden-game://play/h1/__linden/project.json', get).body))).toEqual({ name: 'H', input: { actions: [] } })
    // compiled scripts are a scene-mode route
    expect(resolveGameRequest('linden-game://play/h1/game-scripts/Player.js', get).status).toBe(404)
  })

  it('allows inline script only for HTML Games', () => {
    const html = resolveGameRequest('linden-game://play/h1/web/index.html', get)
    expect(html.headers['Content-Security-Policy']).toContain("script-src 'self' 'unsafe-inline'")
    expect(buildGameCsp(['https://cdn.example.com'], 'html')).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.example.com")
    expect(buildGameCsp(['https://cdn.example.com'], 'scene')).toContain("script-src 'self' 'wasm-unsafe-eval';")
  })

  it('only lets safe origins into connect-src', () => {
    const csp = buildGameCsp(['https://api.example.com', "https://x.com; script-src 'unsafe-eval'", 'wss://ws.example.com:8443'])
    expect(csp).toContain("connect-src 'self' data: blob: https://api.example.com wss://ws.example.com:8443")
    expect(csp).not.toContain('x.com')
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('injectHeadScript handles pages without <head>', () => {
    expect(injectHeadScript('<html><body></body></html>', 'b.js')).toBe('<html><head><script src="b.js"></script></head><body></body></html>')
    expect(injectHeadScript('<canvas></canvas>', 'b.js')).toBe('<script src="b.js"></script><canvas></canvas>')
  })
})

describe('Play sessions', () => {
  it('compiles scripts, exposes the session, and forgets it on stop', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-session-'))
    const project = path.join(tmp, 'p')
    const runtime = path.join(tmp, 'rt')
    fs.mkdirSync(path.join(project, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'P', version: '1' }))
    fs.writeFileSync(path.join(project, 'scripts/A.ts'), 'export default class A { x: number = 1 }\n')
    try {
      const res = await startPlaySession({ projectPath: project, cacheRoot: path.join(tmp, 'cache'), preferSourceRuntime: false })
      expect(res.status).toBe('ok')
      expect(res.url).toMatch(/^linden-game:\/\/play\/[0-9a-f-]+\/index\.html\?embedded=1$/)
      const session = getPlaySession(res.sessionId!)!
      expect(fs.existsSync(path.join(session.compiledDir!, 'A.js'))).toBe(true)
      expect(fs.existsSync(path.join(session.compiledDir!, 'A.js.map'))).toBe(true)
      expect(stopPlaySession(res.sessionId!)).toBe(true)
      expect(getPlaySession(res.sessionId!)).toBeUndefined()

      fs.writeFileSync(path.join(project, 'scripts/A.ts'), 'export default class A { x = }\n')
      const bad = await startPlaySession({ projectPath: project, cacheRoot: path.join(tmp, 'cache'), preferSourceRuntime: false })
      expect(bad.status).toBe('error')
      expect(bad.errors?.[0]).toMatchObject({ file: 'scripts/A.ts', line: 1 })

      fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'P', version: '1', runtime: 'html', html: { entry: 'web/missing.html' } }))
      const html = await startPlaySession({ projectPath: project, cacheRoot: path.join(tmp, 'cache'), preferSourceRuntime: false })
      expect(html).toMatchObject({ status: 'error' })
      expect(html.message).toMatch(/tidak ditemukan/)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('Play session hot reload watcher', () => {
  it('recompiles scripts and reports ui changes', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-watch-'))
    const project = path.join(tmp, 'p')
    fs.mkdirSync(path.join(project, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(project, 'ui'), { recursive: true })
    fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'P', version: '1' }))
    fs.writeFileSync(path.join(project, 'scripts/A.ts'), 'export default class A { v = 1 }\n')
    fs.writeFileSync(path.join(project, 'ui/hud.html'), '<b>1</b>')
    const changes: any[] = []
    const waitFor = async (pred: () => boolean) => {
      for (let i = 0; i < 60 && !pred(); i++) await new Promise((r) => setTimeout(r, 100))
      return pred()
    }
    const res = await startPlaySession({
      projectPath: project,
      cacheRoot: path.join(tmp, 'cache'),
      preferSourceRuntime: false,
      onFilesChanged: (c) => changes.push(c),
    })
    try {
      const compiledDir = getPlaySession(res.sessionId!)!.compiledDir!
      await new Promise((r) => setTimeout(r, 200))
      fs.writeFileSync(path.join(project, 'scripts/A.ts'), 'export default class A { v = 2 }\n')
      expect(await waitFor(() => changes.some((c) => c.kind === 'scripts' && c.version))).toBe(true)
      expect(fs.readFileSync(path.join(compiledDir, 'A.js'), 'utf-8')).toContain('2')

      fs.writeFileSync(path.join(project, 'scripts/A.ts'), 'export default class A { v = }\n')
      expect(await waitFor(() => changes.some((c) => c.kind === 'scripts' && c.errors))).toBe(true)
      expect(changes.find((c) => c.errors).errors[0].file).toBe('scripts/A.ts')

      fs.writeFileSync(path.join(project, 'ui/hud.html'), '<b>2</b>')
      expect(await waitFor(() => changes.some((c) => c.kind === 'ui'))).toBe(true)
      expect(changes.find((c) => c.kind === 'ui').files).toEqual(['ui/hud.html'])
    } finally {
      stopPlaySession(res.sessionId!)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }, 20000)
})
