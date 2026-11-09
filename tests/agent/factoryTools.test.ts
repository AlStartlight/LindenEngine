import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LINDEN_TOOLS, setFactoryProbe, simulateScene, factoryBakeWarnings } from '../../electron/agent/lindenTools'
import { computeFactoryFit, factoryHash, fittedBake, wrapGlbWithFit, type FactoryProbe } from '../../electron/agent/lindenTools/factoryTools'
import { ModelSpecSchema } from '../../engine/model/ModelSpec'
import { modelColliderShape } from '../../engine/model/modelCollider'
import { World } from '../../engine/ecs/World'
import { SceneSerializer } from '../../engine/scene/serializer'
import '../../engine/ecs/ComponentRegistry'

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'img2threejs', 'createCeramicMugModel.ts')

/** What player/factoryProbe.ts measures for the mug fixture (relative units, centred on the origin) */
const mugProbe = (): FactoryProbe => ({
  exportName: 'createCeramicMugModel',
  exports: ['createCeramicMugModel'],
  bounds: [
    [-0.5, -0.5, -0.5],
    [0.95, 0.5, 0.5],
  ],
  triangles: 9000,
  meshCount: 2,
  hull: [-0.5, -0.5, 0, 0.95, 0, 0, 0, 0.5, 0, 0, -0.5, 0.5, 0, -0.5, -0.5],
  boxes: [
    { id: 'body', center: [0, 0, 0], halfExtents: [0.5, 0.5, 0.5] },
    { id: 'handle', center: [0.7, 0, 0], halfExtents: [0.25, 0.3, 0.08] },
  ],
  sockets: [],
  nodes: ['root', 'body', 'handle'],
  hasTick: false,
  hasRig: false,
  materials: ['MeshStandardMaterial'],
  shaderMaterials: 0,
  meshes: [{ name: 'body', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [0, 1, 2] }],
  warnings: [],
})

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-factory-tools-'))
  fs.writeFileSync(path.join(dir, 'project.linden.json'), JSON.stringify({ name: 'T' }))
  fs.mkdirSync(path.join(dir, 'models', 'mug'), { recursive: true })
  fs.copyFileSync(FIXTURE, path.join(dir, 'models', 'mug', 'createCeramicMugModel.ts'))
})
afterEach(() => {
  setFactoryProbe(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

const run = (name: string, args: unknown) => LINDEN_TOOLS[name].execute(dir, args as any, {})

describe('Model.factory spec', () => {
  it('accepts a factory alone and rejects mixing or paths outside models/', () => {
    expect(ModelSpecSchema.safeParse({ factory: 'models/mug/createCeramicMugModel.ts' }).success).toBe(true)
    expect(ModelSpecSchema.safeParse({ factory: 'models/a.ts', src: 'assets/a.glb' }).success).toBe(false)
    expect(ModelSpecSchema.safeParse({ factory: 'scripts/a.ts' }).success).toBe(false)
    expect(ModelSpecSchema.safeParse({}).success).toBe(false)
    expect(ModelSpecSchema.safeParse({ factory: 'models/a.ts', fit: { scale: 0.1, offset: [0, 0.05, 0] } }).success).toBe(true)
  })
})

describe('factory fit', () => {
  const bounds: [[number, number, number], [number, number, number]] = [
    [-0.5, -0.5, -0.5],
    [0.95, 0.5, 0.5],
  ]
  it('scales from the category height and rests the model on the floor', () => {
    const fit = computeFactoryFit(bounds, { placement: 'floor', category: 'mug' })
    expect(fit.basis).toBe('category')
    expect(fit.scale).toBeCloseTo(0.095)
    expect(fit.size[1]).toBeCloseTo(0.095)
    // lowest point at 0, centred in x/z
    expect(-0.5 * fit.scale + fit.offset[1]).toBeCloseTo(0)
    expect(((-0.5 + 0.95) / 2) * fit.scale + fit.offset[0]).toBeCloseTo(0)
  })
  it('prefers an explicit height or scale and keeps 1 when nothing says the size', () => {
    expect(computeFactoryFit(bounds, { placement: 'floor', category: 'mug', height: 0.2 }).scale).toBeCloseTo(0.2)
    expect(computeFactoryFit(bounds, { placement: 'floor', scale: 2 }).scale).toBe(2)
    expect(computeFactoryFit(bounds, { placement: 'free' })).toMatchObject({ basis: 'none', scale: 1 })
    const ceiling = computeFactoryFit(bounds, { placement: 'ceiling', height: 1 })
    expect(0.5 * ceiling.scale + ceiling.offset[1]).toBeCloseTo(0)
    const wall = computeFactoryFit(bounds, { placement: 'wall', height: 1 })
    expect(-0.5 * wall.scale + wall.offset[2]).toBeCloseTo(0)
  })
  it('moves hull, boxes and bounds into meters', () => {
    const fit = computeFactoryFit(bounds, { placement: 'floor', height: 1 })
    const { bounds: b, bake } = fittedBake(mugProbe(), fit, 'h')
    expect(b[0][1]).toBeCloseTo(0)
    expect(b[1][1]).toBeCloseTo(1)
    expect(bake.boxes![0].center[1]).toBeCloseTo(0.5)
    expect(bake.hull!.length).toBe(15)
  })
})

describe('linden_model_build with a factory', () => {
  it('needs the editor to measure it', async () => {
    const res = await run('linden_model_build', { name: 'Mug', model: { factory: 'models/mug/createCeramicMugModel.ts' } })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/editor Linden/)
  })

  it('reports compile errors before measuring', async () => {
    fs.writeFileSync(path.join(dir, 'models', 'bad.ts'), "import x from 'lodash'\nexport function createBadModel() { return x }\n")
    setFactoryProbe(async () => mugProbe())
    const res = await run('linden_model_build', { name: 'Bad', model: { factory: 'models/bad.ts' } })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/lodash/)
  })

  it('stores fit, bounds and bake, and physics uses them headless', async () => {
    const calls: any[] = []
    setFactoryProbe(async (req) => {
      calls.push(req)
      return mugProbe()
    })
    const res = await run('linden_model_build', {
      name: 'Mug',
      entityId: 'mug',
      model: { factory: 'models/mug/createCeramicMugModel.ts', category: 'mug', collider: 'compound' },
      meshesOut: '.linden/img2threejs/mug/meshes.json',
    })
    expect(res.success).toBe(true)
    expect(calls[0]).toMatchObject({ factory: 'models/mug/createCeramicMugModel.ts', meshes: true })
    expect(res.data.validation.fit.basis).toBe('category')
    expect(res.data.stats.meshesFile).toBe('.linden/img2threejs/mug/meshes.json')
    const meshes = JSON.parse(fs.readFileSync(path.join(dir, '.linden/img2threejs/mug/meshes.json'), 'utf-8'))
    expect(meshes.meshes[0].indices).toEqual([0, 1, 2])

    const sceneText = fs.readFileSync(path.join(dir, 'scenes/Main.lscene'), 'utf-8')
    const scene = JSON.parse(sceneText)
    const model = scene.entities.find((e: any) => e.id === 'mug').components.find((c: any) => c.type === 'Model').data
    expect(model.factory).toBe('models/mug/createCeramicMugModel.ts')
    expect(model.parts).toBeUndefined()
    expect(model.fit.scale).toBeCloseTo(0.095)
    expect(model.bounds[0][1]).toBeCloseTo(0)
    expect(model.bake.hash).toBe(factoryHash(dir, 'models/mug/createCeramicMugModel.ts'))
    expect(model.bake.boxes).toHaveLength(2)

    const shape = modelColliderShape(model, { x: 1, y: 1, z: 1 })
    expect(shape?.kind).toBe('compound')
    expect(modelColliderShape({ ...model, collider: 'convexHull' }, { x: 1, y: 1, z: 1 })?.kind).toBe('hull')
    expect(modelColliderShape({ ...model, collider: 'box' }, { x: 2, y: 2, z: 2 })?.kind).toBe('box')

    const world = new World()
    SceneSerializer.deserialize(sceneText, world)
    expect(factoryBakeWarnings(world, dir)).toEqual([])

    // Editing the factory makes the bake stale; linden_play says so
    fs.appendFileSync(path.join(dir, 'models', 'mug', 'createCeramicMugModel.ts'), '\n// edited\n')
    const sim = await simulateScene(sceneText, 0.2, { projectPath: dir })
    expect(sim.warnings.join('\n')).toMatch(/berubah sejak diukur/)
  })

  it('warns when nothing gives the factory a real size', async () => {
    setFactoryProbe(async () => mugProbe())
    const res = await run('linden_model_build', { name: 'Thing', model: { factory: 'models/mug/createCeramicMugModel.ts' } })
    expect(res.data.validation.issues.map((i: any) => i.code)).toContain('NOT_SCALED')
  })
})

describe('GLB fit wrapping', () => {
  it('adds a root node with the fit and keeps the binary chunk', () => {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'a' }] }))
    const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
    const bin = Buffer.from([1, 2, 3, 4])
    const binChunk = Buffer.concat([Buffer.from([4, 0, 0, 0]), Buffer.from('BIN\0'), bin])
    const header = Buffer.alloc(20)
    header.writeUInt32LE(0x46546c67, 0)
    header.writeUInt32LE(2, 4)
    header.writeUInt32LE(20 + padded.length + binChunk.length, 8)
    header.writeUInt32LE(padded.length, 12)
    header.writeUInt32LE(0x4e4f534a, 16)
    const glb = Buffer.concat([header, padded, binChunk])

    const out = wrapGlbWithFit(glb, { scale: 0.1, offset: [0, 0.05, 0] })
    const len = out.readUInt32LE(12)
    const parsed = JSON.parse(out.subarray(20, 20 + len).toString())
    expect(parsed.scenes[0].nodes).toEqual([1])
    expect(parsed.nodes[1]).toMatchObject({ name: 'LindenFit', scale: [0.1, 0.1, 0.1], translation: [0, 0.05, 0], children: [0] })
    expect(out.readUInt32LE(8)).toBe(out.length)
    expect(out.subarray(out.length - 4)).toEqual(bin)
  })

  it('bake needs the editor and a factory entity', async () => {
    expect((await run('linden_model_bake_glb', { entityId: 'x' })).error).toMatch(/editor Linden/)
  })
})
