import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileScripts } from '../../electron/play/ScriptCompiler'
import { SourceMapLookup, findScriptFrame, normalizeMappedSource } from '../../shared/sourceMap'

describe('source map lookup', () => {
  it('maps a compiled script position back to the .ts line', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-map-'))
    try {
      fs.mkdirSync(path.join(project, 'scripts'))
      fs.writeFileSync(
        path.join(project, 'scripts/Crash.ts'),
        "type Hp = number\ninterface Foo { a: Hp }\n\nexport default class Crash {\n  hp: Hp = 3\n  onUpdate(): void {\n    throw new Error('boom')\n  }\n}\n"
      )
      const out = path.join(project, 'out')
      await compileScripts(project, out, { sourcemap: true })
      const js = fs.readFileSync(path.join(out, 'Crash.js'), 'utf-8').split('\n')
      const line = js.findIndex((l) => l.includes("throw new Error")) + 1
      const col = js[line - 1].indexOf('throw') + 1
      const lookup = new SourceMapLookup(JSON.parse(fs.readFileSync(path.join(out, 'Crash.js.map'), 'utf-8')))
      const pos = lookup.originalPositionFor(line, col)!
      expect(normalizeMappedSource(pos.source)).toBe('scripts/Crash.ts')
      expect(pos.line).toBe(7)
    } finally {
      fs.rmSync(project, { recursive: true, force: true })
    }
  })

  it('finds the first game-script frame in a Chromium stack', () => {
    const stack = [
      'Error: boom',
      '    at Crash.onUpdate (linden-game://play/abc/game-scripts/Crash.js:4:11)',
      '    at ScriptRuntime.invoke (linden-game://play/abc/__linden/runtime/game.js:100:5)',
    ].join('\n')
    expect(findScriptFrame(stack)).toEqual({ url: 'linden-game://play/abc/game-scripts/Crash.js', line: 4, col: 11 })
    expect(findScriptFrame('Error\n    at x (http://h/game.js:1:1)')).toBeNull()
  })
})
