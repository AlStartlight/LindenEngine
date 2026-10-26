import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileScripts, listScriptSources } from '../../electron/play/ScriptCompiler'

describe('ScriptCompiler', () => {
  let project: string
  let out: string

  const write = (rel: string, code: string) => {
    const full = path.join(project, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, code)
  }

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-compile-'))
    out = path.join(project, '.out', 'game-scripts')
  })
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }))

  it('compiles TS to browser ESM, keeping subfolders and shared modules', async () => {
    write('scripts/shared/state.ts', 'export const state = { coins: 0 }\n')
    write(
      'scripts/Player.ts',
      "import { Vector3 } from 'three'\nimport { state } from './shared/state'\n" +
        'export default class Player {\n  speed: number = 5\n  v = new Vector3()\n  onUpdate(dt: number) { state.coins += dt }\n}\n'
    )
    write('scripts/ai/Enemy.js', 'export default class Enemy {}\n')
    write('scripts/types.d.ts', 'declare const x: number\n')

    expect(listScriptSources(project)).toEqual(['scripts/Player.ts', 'scripts/ai/Enemy.js', 'scripts/shared/state.ts'])

    const res = await compileScripts(project, out, { sourcemap: true })
    expect(res.errors).toEqual([])
    expect(res.ok).toBe(true)
    const player = fs.readFileSync(path.join(out, 'Player.js'), 'utf-8')
    expect(player).not.toMatch(/: number/)
    expect(player).toContain('__LINDEN_THREE__')
    expect(fs.existsSync(path.join(out, 'ai', 'Enemy.js'))).toBe(true)
    expect(fs.existsSync(path.join(out, 'Player.js.map'))).toBe(true)
    const map = JSON.parse(fs.readFileSync(path.join(out, 'Player.js.map'), 'utf-8'))
    expect(map.sources.some((s: string) => s.endsWith('scripts/Player.ts'))).toBe(true)
  })

  it('reports syntax errors with file and line', async () => {
    write('scripts/Bad.ts', 'export default class Bad {\n  onUpdate() {\n    this.x += ;\n  }\n}\n')
    const res = await compileScripts(project, out)
    expect(res.ok).toBe(false)
    expect(res.errors[0]).toMatchObject({ file: 'scripts/Bad.ts', line: 3 })
  })

  it('rejects bare npm imports other than three/linden', async () => {
    write('scripts/UsesLodash.ts', "import _ from 'lodash'\nexport default class A { f = _ }\n")
    const res = await compileScripts(project, out)
    expect(res.ok).toBe(false)
    expect(res.errors[0]).toMatchObject({ file: 'scripts/UsesLodash.ts', line: 1 })
    expect(res.errors[0].message).toMatch(/lodash.*tidak didukung/)
  })

  it('rejects relative imports that escape the project', async () => {
    write('scripts/Escape.ts', "import x from '../../../etc/thing'\nexport default class A { x = x }\n")
    const res = await compileScripts(project, out)
    expect(res.ok).toBe(false)
    expect(res.errors[0].message).toMatch(/keluar dari folder proyek/)
  })

  it('reuses the previous output when nothing changed', async () => {
    write('scripts/A.ts', 'export default class A {}\n')
    const first = await compileScripts(project, out)
    const second = await compileScripts(project, out)
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    write('scripts/A.ts', 'export default class A { y = 1 }\n')
    fs.utimesSync(path.join(project, 'scripts/A.ts'), new Date(), new Date(Date.now() + 5000))
    const third = await compileScripts(project, out)
    expect(third.cached).toBe(false)
  })

  it('succeeds with no scripts folder', async () => {
    const res = await compileScripts(project, out)
    expect(res).toMatchObject({ ok: true, sources: [] })
  })
})
