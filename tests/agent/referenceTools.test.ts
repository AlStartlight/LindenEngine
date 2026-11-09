import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REFERENCE_TOOLS } from '../../electron/agent/lindenTools/referenceTools'
import { LINDEN_TOOLS } from '../../electron/agent/lindenTools'

const PNG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'img2threejs', 'mug.png'))
const STOOL = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'reference-model', 'createStoolModel.ts'), 'utf-8')

describe('reference-image tools (Linden-native, no third-party skill)', () => {
  let project: string
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-ref-'))
    fs.mkdirSync(path.join(project, 'references'), { recursive: true })
    fs.writeFileSync(path.join(project, 'project.linden.json'), '{"name":"t"}')
  })
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }))

  const view = (args: any) => REFERENCE_TOOLS.linden_reference_view.execute(project, args)
  const write = (args: any, onDiff?: (d: any) => void) => REFERENCE_TOOLS.linden_factory_write.execute(project, args, { onDiff })

  it('are given to the agent', () => {
    expect(LINDEN_TOOLS.linden_reference_view).toBeDefined()
    expect(LINDEN_TOOLS.linden_factory_write).toBeDefined()
  })

  it('reference_view lists references, returns the image and the renders that exist', async () => {
    expect((await view({})).data.references).toEqual([])
    fs.writeFileSync(path.join(project, 'references', 'kursi.png'), PNG)
    expect((await view({})).data.references).toEqual(['references/kursi.png'])

    const one = await view({ reference: 'references/kursi.png' })
    expect(one.success).toBe(true)
    expect(one.images).toHaveLength(1)
    expect(one.images![0].mimeType).toBe('image/png')

    fs.mkdirSync(path.join(project, '.linden', 'previews'), { recursive: true })
    fs.writeFileSync(path.join(project, '.linden', 'previews', 'kursi-front.png'), PNG)
    const cmp = await view({ reference: 'references/kursi.png', entityId: 'kursi', views: ['front', 'side'] })
    expect(cmp.images!.map((i) => i.label)).toEqual(['referensi references/kursi.png', 'render kursi front'])
    expect(cmp.data.missingViews).toEqual(['side'])
    expect(cmp.data.hint).toMatch(/linden_render_preview/)
  })

  it('reference_view refuses files outside references/ and assets/, non-images and bad entity ids', async () => {
    fs.writeFileSync(path.join(project, 'references', 'fake.png'), 'not an image')
    fs.writeFileSync(path.join(project, 'secret.txt'), 'x')
    for (const reference of ['../secret.txt', 'secret.txt', 'references/../secret.txt', '/etc/passwd', 'references/fake.png', 'references/missing.png']) {
      expect((await view({ reference })).success, reference).toBe(false)
    }
    fs.writeFileSync(path.join(project, 'references', 'a.png'), PNG)
    expect((await view({ reference: 'references/a.png', entityId: '../../x' })).success).toBe(false)
  })

  it('factory_write writes models/**.ts, compile-checks it and emits a diff', async () => {
    const diffs: any[] = []
    const ok = await write({ path: 'models/stool/createStoolModel.ts', content: STOOL }, (d) => diffs.push(d))
    expect(ok.error).toBeUndefined()
    expect(ok.success).toBe(true)
    expect(ok.data.next).toMatch(/linden_model_build/)
    expect(fs.readFileSync(path.join(project, 'models/stool/createStoolModel.ts'), 'utf-8')).toBe(STOOL)
    expect(diffs[0]).toMatchObject({ file: 'models/stool/createStoolModel.ts', action: 'create' })

    const broken = await write({ path: 'models/stool/createStoolModel.ts', content: STOOL.replace('new THREE.Group()', 'new THREE.Group(') })
    expect(broken.success).toBe(false)
    expect(broken.error).toMatch(/Kompilasi factory gagal/)
    expect(diffs).toHaveLength(1) // no callback passed the second time
  })

  it('factory_write refuses other paths, missing exports and bare imports', async () => {
    for (const p of ['scripts/x.ts', 'models/../x.ts', '../models/x.ts', 'models/x.js', 'models/x.d.ts']) {
      expect((await write({ path: p, content: STOOL })).success, p).toBe(false)
    }
    expect((await write({ path: 'models/a/createAModel.ts', content: 'export const x = 1' })).error).toMatch(/create<Nama>Model/)
    const fsImport = await write({ path: 'models/a/createAModel.ts', content: "import fs from 'node:fs'\nexport function createAModel() { return fs }" })
    expect(fsImport.success).toBe(false)
  })
})

describe('linden_model_build fit arguments', () => {
  it('accepts fitHeight/fitScale inside model as well', async () => {
    const { hoistFitArgs } = await import('../../electron/agent/lindenTools/modelTools')
    expect(hoistFitArgs({ model: { factory: 'models/a.ts', fitHeight: 0.65 } })).toEqual({ model: { factory: 'models/a.ts' }, fitHeight: 0.65, fitScale: undefined })
    expect(hoistFitArgs({ fitHeight: 1, model: { factory: 'models/a.ts', fitHeight: 0.65 } }).fitHeight).toBe(1)
    const plain = { model: { parts: [] } }
    expect(hoistFitArgs(plain)).toBe(plain)
  })
})
