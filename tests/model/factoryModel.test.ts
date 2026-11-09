import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import '../../engine/ecs/ComponentRegistry'
import { World } from '../../engine/ecs/World'
import { SceneBridge, applyFactoryFit } from '../../engine/scene/SceneBridge'
import { QUALITY_CAPS } from '../../engine/scene/SceneSettings'
import { scriptModelApi } from '../../engine/scripting/ScriptRuntime'

/** A factory module like img2threejs emits: a group with sculptRuntime, sockets and an idle tick */
function fakeFactoryModule(opts: { fail?: boolean } = {}) {
  const calls: Record<string, unknown>[] = []
  const ticks: number[] = []
  return {
    calls,
    ticks,
    module: {
      createMugModel(options: Record<string, unknown>) {
        calls.push(options)
        if (opts.fail) throw new Error('boom')
        const root = new THREE.Group()
        const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
        const grip = new THREE.Object3D()
        grip.position.set(0.6, 0, 0)
        root.add(body, grip)
        root.userData.sculptRuntime = { nodes: { root, body }, meshes: { body }, sockets: { grip }, colliders: { body: { type: 'box' } }, destructionGroups: {} }
        root.userData.tick = (dt: number) => ticks.push(dt)
        return root
      },
      frameMugCamera() {},
    },
  }
}

function setup(model: Record<string, unknown>, factory = fakeFactoryModule()) {
  const world = new World()
  const e = world.createEntity('Mug')
  const loads: { src: string; version?: string }[] = []
  const warnings: string[] = []
  const assets = { loadFactory: async (src: string, version?: string) => (loads.push({ src, version }), factory.module) } as any
  const bridge = new SceneBridge(world)
  bridge.attach(new THREE.Scene(), { backend: 'webgl2', caps: QUALITY_CAPS.low, assets, warn: (m: string) => warnings.push(m) } as any)
  world.addComponent(e.id, 'Model', { factory: 'models/mug/createMugModel.ts', ...model })
  return { world, id: e.id, bridge, loads, warnings, factory }
}

describe('Model.factory in the SceneBridge', () => {
  it('loads the compiled factory, applies fit and shadows, and exposes its runtime', async () => {
    const { bridge, id, loads, factory } = setup({ fit: { scale: 0.1, offset: [0, 0.05, 0] }, bake: { hash: 'abc' }, castShadow: false, factoryOptions: { textureSize: 512 } })
    await bridge.whenIdle()
    expect(loads).toEqual([{ src: 'models/mug/createMugModel.ts', version: 'abc' }])
    expect(factory.calls[0]).toMatchObject({ textureSize: 512, castShadow: false, receiveShadow: true })
    const model = bridge.getObject(id)!.getObjectByName('__model__')!
    const box = new THREE.Box3().setFromObject(model)
    expect(box.min.y).toBeCloseTo(0)
    expect(box.max.y).toBeCloseTo(0.1)
    model.traverse((o) => expect(o.castShadow).toBe(false))

    const api = scriptModelApi(bridge.getModelRuntime(id))!
    expect(api.sockets).toEqual(['grip'])
    expect(api.socket('grip')).toBeInstanceOf(THREE.Object3D)
    expect(api.mesh('body')).toBeInstanceOf(THREE.Mesh)
    expect(api.socket('nope')).toBeNull()
    expect(scriptModelApi(undefined)).toBeNull()
  })

  it('runs the idle tick only when factory animation is on', async () => {
    const { bridge, factory } = setup({})
    await bridge.whenIdle()
    bridge.update(0.1)
    expect(factory.ticks).toEqual([])
    bridge.setAnimateFactories(true)
    bridge.update(0.1)
    bridge.update(0.2)
    expect(factory.ticks).toEqual([0.1, 0.2])
  })

  it('shows a red placeholder from the stored bounds when the factory throws', async () => {
    const { bridge, id, warnings } = setup({ bounds: [[-1, 0, -1], [1, 2, 1]] }, fakeFactoryModule({ fail: true }))
    await bridge.whenIdle()
    expect(warnings.join('\n')).toMatch(/gagal dijalankan: boom/)
    const placeholder = bridge.getObject(id)!.getObjectByName('__model__') as THREE.LineSegments
    expect(placeholder).toBeInstanceOf(THREE.LineSegments)
    expect(placeholder.position.y).toBeCloseTo(1)
    expect(bridge.getModelRuntime(id)).toBeUndefined()
  })

  it('draws one copy per instance', async () => {
    const { bridge, id } = setup({ instances: [{ position: [0, 0, 0] }, { position: [3, 0, 0] }] })
    await bridge.whenIdle()
    const model = bridge.getObject(id)!.getObjectByName('__model__')!
    expect(model.children).toHaveLength(2)
    expect(new THREE.Box3().setFromObject(model).max.x).toBeCloseTo(3.5)
  })

  it('rebuilds when the Model changes and drops the old runtime', async () => {
    const { world, bridge, id, loads } = setup({ bake: { hash: 'v1' } })
    await bridge.whenIdle()
    world.setProperty(id, 'Model', 'bake', { hash: 'v2' })
    await bridge.whenIdle()
    expect(loads.map((l) => l.version)).toEqual(['v1', 'v2'])
    expect(bridge.getObject(id)!.children.filter((c) => c.name === '__model__')).toHaveLength(1)
  })

  it('does nothing headless (no asset loader)', () => {
    const world = new World()
    const e = world.createEntity('Mug')
    const bridge = new SceneBridge(world)
    bridge.attach(new THREE.Scene(), {})
    world.addComponent(e.id, 'Model', { factory: 'models/mug/createMugModel.ts' })
    expect(bridge.getObject(e.id)!.getObjectByName('__model__')).toBeUndefined()
  })

  it('editor (isolated): never imports the module, attaches the GLB copy with fit, no runtime', async () => {
    const world = new World()
    const e = world.createEntity('Mug')
    const requests: any[] = []
    const assets = {
      isolatesFactories: true,
      loadFactory: () => {
        throw new Error('the editor must not import factory code')
      },
      loadIsolatedFactory: async (req: any) => {
        requests.push(req)
        const g = new THREE.Group()
        g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
        return g
      },
    } as any
    const bridge = new SceneBridge(world)
    bridge.attach(new THREE.Scene(), { backend: 'webgl2', caps: QUALITY_CAPS.low, assets, warn: () => {} } as any)
    world.addComponent(e.id, 'Model', { factory: 'models/mug/createMugModel.ts', factoryExport: 'createMugModel', factoryOptions: { textureSize: 256 }, fit: { scale: 0.1, offset: [0, 0.05, 0] }, bake: { hash: 'h1' } })
    await bridge.whenIdle()
    expect(requests).toEqual([{ factory: 'models/mug/createMugModel.ts', exportName: 'createMugModel', options: { textureSize: 256 }, version: 'h1' }])
    const model = bridge.getObject(e.id)!.getObjectByName('__model__')!
    const box = new THREE.Box3().setFromObject(model)
    expect(box.min.y).toBeCloseTo(0)
    expect(box.max.y).toBeCloseTo(0.1)
    expect(bridge.getModelRuntime(e.id)?.sculptRuntime).toBeUndefined()
  })

  it('editor (isolated): a sandbox failure shows the placeholder with the reason', async () => {
    const world = new World()
    const e = world.createEntity('Mug')
    const warnings: string[] = []
    const assets = { isolatesFactories: true, loadIsolatedFactory: async () => Promise.reject(new Error('Factory boom di sandbox')) } as any
    const bridge = new SceneBridge(world)
    bridge.attach(new THREE.Scene(), { backend: 'webgl2', caps: QUALITY_CAPS.low, assets, warn: (m: string) => warnings.push(m) } as any)
    world.addComponent(e.id, 'Model', { factory: 'models/mug/createMugModel.ts', bounds: [[-1, 0, -1], [1, 2, 1]] })
    await bridge.whenIdle()
    expect(warnings.join('\n')).toMatch(/gagal dimuat: Factory boom di sandbox/)
    expect(bridge.getObject(e.id)!.getObjectByName('__model__')).toBeInstanceOf(THREE.LineSegments)
  })

  it('fit scales positions as well as the group', () => {
    const g = new THREE.Group()
    g.position.set(1, 0, 0)
    applyFactoryFit(g, { scale: 0.5, offset: [0, 1, 0] })
    expect(g.scale.x).toBe(0.5)
    expect(g.position.toArray()).toEqual([0.5, 1, 0])
  })
})
