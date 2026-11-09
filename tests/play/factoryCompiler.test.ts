import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as THREE from 'three'
import { compileFactory, compileFactories, compileScripts, listFactorySources } from '../../electron/play/ScriptCompiler'
import { compiledFactoryPath, factorySourceStem, isValidFactorySrc, pickFactoryExport } from '../../shared/modelFactory'

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'img2threejs', 'createCeramicMugModel.ts')

/** Minimal 2D canvas so CanvasTexture-based factories run in Node */
function installFakeDocument(): () => void {
  const g = globalThis as any
  const prev = g.document
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} })
        if (key === 'getImageData' || key === 'createImageData') return (x: number, y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)), width: w, height: h })
        if (key === 'measureText') return () => ({ width: 1 })
        return () => {}
      },
      set: () => true,
    }
  )
  g.document = { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) }
  return () => {
    g.document = prev
  }
}

describe('model factory compiler', () => {
  let project: string
  let out: string

  const write = (rel: string, code: string) => {
    const full = path.join(project, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, code)
  }

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-factory-'))
    out = path.join(project, '.out')
  })
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(project + '-outside.ts', { force: true })
  })

  it('maps sources to compiled paths and back', () => {
    expect(isValidFactorySrc('models/mug/createMugModel.ts')).toBe(true)
    expect(isValidFactorySrc('scripts/x.ts')).toBe(false)
    expect(isValidFactorySrc('models/../x.ts')).toBe(false)
    expect(isValidFactorySrc('models/a.d.ts')).toBe(false)
    expect(compiledFactoryPath('models/mug/createMugModel.ts')).toBe('game-models/mug/createMugModel.js')
    expect(factorySourceStem('game-models/mug/createMugModel.js')).toBe('models/mug/createMugModel')
    expect(factorySourceStem('game-models/../x.js')).toBeNull()
    expect(factorySourceStem('assets/x.js')).toBeNull()
  })

  it('picks the only create<Name>Model export, or the named one', () => {
    const f = () => 1
    expect(pickFactoryExport({ createMugModel: f, frameMugCamera: f })).toMatchObject({ name: 'createMugModel' })
    expect(pickFactoryExport({ createAModel: f, createBModel: f })).toHaveProperty('error')
    expect(pickFactoryExport({ createAModel: f, createBModel: f }, 'createBModel')).toMatchObject({ name: 'createBModel' })
    expect(pickFactoryExport({})).toHaveProperty('error')
  })

  it('compiles an img2threejs factory, bundling three addons and sharing the three global', async () => {
    fs.mkdirSync(path.join(project, 'models', 'mug'), { recursive: true })
    fs.copyFileSync(FIXTURE, path.join(project, 'models', 'mug', 'createCeramicMugModel.ts'))
    expect(listFactorySources(project)).toEqual(['models/mug/createCeramicMugModel.ts'])

    const res = await compileFactory(project, 'models/mug/createCeramicMugModel.ts', out)
    expect(res.errors).toEqual([])
    expect(res.ok).toBe(true)
    expect(res.file).toBe(path.join(out, 'game-models', 'mug', 'createCeramicMugModel.js'))
    const code = fs.readFileSync(res.file, 'utf-8')
    expect(code).toContain('__LINDEN_THREE__')
    expect(code).toContain('EffectComposer')
    expect(code).not.toMatch(/^import .* from ['"]three/m)

    const again = await compileFactory(project, 'models/mug/createCeramicMugModel.ts', out)
    expect(again.cached).toBe(true)

    // Run it: the module only needs the three global and a canvas
    ;(globalThis as any).__LINDEN_THREE__ = THREE
    const restore = installFakeDocument()
    try {
      const mod = await import(pathToFileURL(res.file).href)
      const picked = pickFactoryExport(mod)
      if ('error' in picked) throw new Error(picked.error)
      const group = picked.fn({}) as THREE.Group
      expect(group).toBeInstanceOf(THREE.Group)
      const runtime = group.userData.sculptRuntime
      expect(Object.keys(runtime.meshes).sort()).toEqual(['body', 'handle'])
      expect(new THREE.Box3().setFromObject(group).isEmpty()).toBe(false)
    } finally {
      restore()
    }
  })

  it('reports bare imports, missing addons and escapes with the factory file', async () => {
    write('models/a/createAModel.ts', "import _ from 'lodash'\nexport function createAModel() { return _ }\n")
    const bare = await compileFactory(project, 'models/a/createAModel.ts', out)
    expect(bare.ok).toBe(false)
    expect(bare.errors[0]).toMatchObject({ file: 'models/a/createAModel.ts', line: 1 })
    expect(bare.errors[0].message).toMatch(/factory model/)

    write('models/b/createBModel.ts', "import { Nope } from 'three/addons/does/not/exist.js'\nexport function createBModel() { return Nope }\n")
    const missing = await compileFactory(project, 'models/b/createBModel.ts', out)
    expect(missing.ok).toBe(false)
    expect(missing.errors[0].message).toMatch(/tidak tersedia/)

    fs.writeFileSync(path.join(path.dirname(project), path.basename(project) + '-outside.ts'), 'export const x = 1\n')
    write('models/c/createCModel.ts', `import { x } from '../../../${path.basename(project)}-outside'\nexport function createCModel() { return x }\n`)
    const escape = await compileFactory(project, 'models/c/createCModel.ts', out)
    expect(escape.ok).toBe(false)
    expect(escape.errors[0].message).toMatch(/keluar dari folder proyek/)

    const invalid = await compileFactory(project, 'scripts/x.ts', out)
    expect(invalid.ok).toBe(false)
  })

  it('compiles every factory for a web export', async () => {
    write('models/one/createOneModel.ts', "import * as THREE from 'three'\nexport function createOneModel() { return new THREE.Group() }\n")
    write('models/two/createTwoModel.ts', "import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'\nexport function createTwoModel() { return RoundedBoxGeometry }\n")
    const res = await compileFactories(project, out)
    expect(res.errors).toEqual([])
    expect(res.sources).toHaveLength(2)
    expect(fs.existsSync(path.join(out, 'game-models', 'one', 'createOneModel.js'))).toBe(true)
    expect(fs.readFileSync(path.join(out, 'game-models', 'two', 'createTwoModel.js'), 'utf-8')).toContain('RoundedBoxGeometry')
  })

  it('lets gameplay scripts import three addons too', async () => {
    write('scripts/Orbit.ts', "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'\nexport default class Orbit { c = OrbitControls }\n")
    const res = await compileScripts(project, path.join(out, 'game-scripts'))
    expect(res.errors).toEqual([])
    expect(fs.readFileSync(path.join(out, 'game-scripts', 'Orbit.js'), 'utf-8')).toContain('interceptControlDown')
  })
})
