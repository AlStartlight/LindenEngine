import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFactoryPreviews, validateFactoryPreviewRequest } from '../../electron/agent/factoryPreview'

const GLB = Buffer.from('glTF-fake-bytes')

describe('factory:preview (editor gets factory output as GLB from the sandbox)', () => {
  let project: string
  let cacheDir: string
  let calls: any[]
  const probe = async (req: any) => {
    calls.push(req)
    return { glb: GLB.toString('base64') } as any
  }

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-fprev-'))
    cacheDir = path.join(project, '..', `${path.basename(project)}-cache`)
    fs.mkdirSync(path.join(project, 'models', 'mug'), { recursive: true })
    fs.writeFileSync(path.join(project, 'models/mug/createMugModel.ts'), 'export function createMugModel() {}')
    calls = []
  })
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  it('runs the probe with glb once and serves later requests from the cache', async () => {
    const previews = createFactoryPreviews({ cacheDir, probe: () => probe })
    const a = await previews(project, { factory: 'models/mug/createMugModel.ts', options: { textureSize: 512 } })
    expect(Buffer.from(a).toString()).toBe(GLB.toString())
    expect(calls).toEqual([{ projectPath: project, factory: 'models/mug/createMugModel.ts', exportName: undefined, options: { textureSize: 512 }, glb: true }])
    await previews(project, { factory: 'models/mug/createMugModel.ts', options: { textureSize: 512 } })
    expect(calls).toHaveLength(1)
    // Concurrent requests share one probe run
    const [x, y] = await Promise.all([
      previews(project, { factory: 'models/mug/createMugModel.ts', options: { textureSize: 256 } }),
      previews(project, { factory: 'models/mug/createMugModel.ts', options: { textureSize: 256 } }),
    ])
    expect(x.length).toBe(y.length)
    expect(calls).toHaveLength(2)
  })

  it('runs again when any models/ file changes', async () => {
    const previews = createFactoryPreviews({ cacheDir, probe: () => probe })
    await previews(project, { factory: 'models/mug/createMugModel.ts' })
    fs.writeFileSync(path.join(project, 'models/mug/helpers.ts'), 'export const k = 2')
    await previews(project, { factory: 'models/mug/createMugModel.ts' })
    expect(calls).toHaveLength(2)
  })

  it('refuses requests outside models/, bad exports and oversized options', () => {
    for (const factory of ['../x.ts', 'models/../../etc/passwd.ts', '/abs/models/x.ts', 'scripts/x.ts', 'models/x.d.ts', 42]) {
      expect(() => validateFactoryPreviewRequest({ factory }), String(factory)).toThrow()
    }
    expect(() => validateFactoryPreviewRequest({ factory: 'models/a.ts', exportName: 'x; alert(1)' })).toThrow()
    expect(() => validateFactoryPreviewRequest({ factory: 'models/a.ts', options: [] })).toThrow()
    expect(() => validateFactoryPreviewRequest({ factory: 'models/a.ts', options: { s: 'x'.repeat(20_000) } })).toThrow()
    expect(validateFactoryPreviewRequest({ factory: 'models/a.ts', exportName: 'createAModel' })).toEqual({ factory: 'models/a.ts', exportName: 'createAModel', options: {} })
  })

  it('fails clearly without a probe or a factory file, and does not cache failures', async () => {
    await expect(createFactoryPreviews({ cacheDir, probe: () => null })(project, { factory: 'models/mug/createMugModel.ts' })).rejects.toThrow(/tidak tersedia/)
    await expect(createFactoryPreviews({ cacheDir, probe: () => probe })(project, { factory: 'models/mug/missing.ts' })).rejects.toThrow(/tidak ada/)
    let fail = true
    const flaky = createFactoryPreviews({
      cacheDir,
      probe: () => async () => {
        if (fail) throw new Error('Factory boom')
        return { glb: GLB.toString('base64') } as any
      },
    })
    await expect(flaky(project, { factory: 'models/mug/createMugModel.ts' })).rejects.toThrow(/boom/)
    fail = false
    await expect(flaky(project, { factory: 'models/mug/createMugModel.ts' })).resolves.toBeInstanceOf(Uint8Array)
  })
})
