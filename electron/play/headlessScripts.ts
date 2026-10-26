import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileScripts, CompileResult } from './ScriptCompiler'
import { compiledScriptPath } from '../../shared/playProtocol'
import { Input } from '../../engine/input/InputActions'
import { Physics } from '../../engine/physics/components'
import { Tween, Easing } from '../../engine/time/Tween'

/**
 * Compile a project's scripts and return a module loader usable from Node (linden_play).
 * Globals mirror what the browser player sets up in player/main.ts.
 */
export async function prepareHeadlessScripts(projectPath: string): Promise<{
  compile: CompileResult
  loadModule: (src: string) => Promise<any>
}> {
  const outRoot = path.join(os.tmpdir(), 'linden-headless', Buffer.from(path.resolve(projectPath)).toString('base64url').slice(-48))
  const outDir = path.join(outRoot, 'game-scripts')
  const compile = await compileScripts(projectPath, outDir, { sourcemap: false })
  // Node treats .js as CommonJS without this
  if (fs.existsSync(outDir)) fs.writeFileSync(path.join(outDir, 'package.json'), '{"type":"module"}')

  const g = globalThis as any
  if (!g.__LINDEN_THREE__) g.__LINDEN_THREE__ = await import('three')
  g.__LINDEN_API__ = { Input, Physics, Tween, Easing }

  const version = Date.now()
  const loadModule = (src: string) => {
    const file = path.join(outRoot, compiledScriptPath(src))
    if (!fs.existsSync(file)) {
      return Promise.reject(new Error(`Script "${src}" tidak ditemukan (belum ada di scripts/ atau gagal dikompilasi)`))
    }
    return import(`${pathToFileURL(file).href}?v=${version}`)
  }
  return { compile, loadModule }
}
