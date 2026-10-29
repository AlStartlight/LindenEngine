import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { World } from '../../engine/ecs/World'
import { SceneBridge } from '../../engine/scene/SceneBridge'
import { SceneSerializer } from '../../engine/scene/serializer'
import { buildSceneFromData } from '../../engine/scene/buildScene'
import { createPrimitiveGeometry, PRIMITIVE_KINDS, PRIMITIVE_SIZES, ScenePipeline } from '../../engine/renderer/sceneFactory'
import { DEFAULT_SCENE_SETTINGS, SceneSettingsSchema } from '../../engine/scene/SceneSettings'
import '../../engine/ecs/ComponentRegistry'

const root = path.resolve(__dirname, '../..')

function sizeOf(obj: THREE.Object3D): number[] {
  obj.updateMatrixWorld(true)
  const s = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).toArray()
  return s.map((n) => Math.round(n * 1000) / 1000)
}

function sceneWith(primitive: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: 'linden-scene',
    version: 2,
    name: 'S',
    entities: [
      {
        id: 'e',
        name: 'E',
        parentId: null,
        components: [
          { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
          { type: 'MeshRenderer', data: { primitive, ...extra } },
        ],
      },
    ],
  })
}

/** The player and the editor viewport both render through World + SceneBridge + sceneFactory */
function renderThroughBridge(json: string): THREE.Object3D {
  const world = new World()
  SceneSerializer.deserialize(json, world)
  const scene = new THREE.Scene()
  new SceneBridge(world).attach(scene)
  return scene.getObjectByName('E')!
}

describe('sceneFactory primitives (1 unit = 1 m)', () => {
  it('every primitive has its documented size', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const g = createPrimitiveGeometry(kind)
      g.computeBoundingBox()
      const s = g.boundingBox!.getSize(new THREE.Vector3()).toArray().map((n) => Math.round(n * 1000) / 1000)
      expect(s, kind).toEqual(PRIMITIVE_SIZES[kind])
    }
  })

  it('a primitive is the same size in the player path, the editor path and the scene builder', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const json = sceneWith(kind)
      const viaBridge = sizeOf(renderThroughBridge(json))
      const scene = new THREE.Scene()
      const viaBuilder = sizeOf(buildSceneFromData(scene, JSON.parse(json)).get('e')!)
      expect(viaBridge, kind).toEqual(PRIMITIVE_SIZES[kind])
      expect(viaBuilder, kind).toEqual(viaBridge)
    }
  })

  it('the editor viewport and the player build their scene with sceneFactory, not their own geometry or lights', () => {
    for (const file of ['editor/viewport/SceneViewport.tsx', 'player/player.ts', 'engine/scene/SceneBridge.ts', 'engine/scene/buildScene.ts']) {
      const src = fs.readFileSync(path.join(root, file), 'utf-8')
      expect(src, file).not.toMatch(/new THREE\.(Box|Sphere|Cylinder|Capsule|Plane|Torus|Cone)Geometry/)
      expect(src, file).not.toMatch(/new THREE\.(Ambient|Directional|Hemisphere)Light/)
      expect(src, file).not.toMatch(/function createGeometry/)
    }
    for (const file of ['editor/viewport/SceneViewport.tsx', 'player/player.ts']) {
      expect(fs.readFileSync(path.join(root, file), 'utf-8'), file).toMatch(/new ScenePipeline\(/)
    }
  })

  it('MeshRenderer.size scales the mesh only, not child entities', () => {
    const world = new World()
    SceneSerializer.deserialize(sceneWith('box', { size: [2, 3, 4] }), world)
    const child = world.createEntity('Child', 'e')
    world.addComponent(child.id, 'MeshRenderer', { primitive: 'sphere' })
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene)
    expect(sizeOf(bridge.getObject('e')!.getObjectByName('__mesh__')!)).toEqual([2, 3, 4])
    expect(sizeOf(bridge.getObject(child.id)!)).toEqual([1, 1, 1])
  })

  it('MeshRenderer.material presets produce PBR materials and update in place', () => {
    const world = new World()
    SceneSerializer.deserialize(sceneWith('box', { material: { preset: 'car_paint', color: '#0044ff' } }), world)
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene)
    const mesh = bridge.getObject('e')!.getObjectByName('__mesh__') as THREE.Mesh
    const mat = mesh.material as THREE.MeshPhysicalMaterial
    expect(mat.type).toBe('MeshPhysicalMaterial')
    expect(mat.clearcoat).toBe(1)
    expect('#' + mat.color.getHexString()).toBe('#0044ff')
    world.setProperty('e', 'MeshRenderer', 'material', { preset: 'wood_walnut' })
    const next = mesh.material as THREE.MeshStandardMaterial
    expect(next).not.toBe(mat)
    expect(next.map).toBeTruthy()
  })

  it('Model parts render through the bridge', () => {
    const world = new World()
    const e = world.createEntity('Lamp')
    world.addComponent(e.id, 'Model', {
      parts: [
        { id: 'base', shape: { type: 'cylinder', radiusTop: 0.07, radiusBottom: 0.075, height: 0.02 }, position: [0, 0.01, 0], material: 'metal_black_matte' },
        { id: 'stem', shape: { type: 'cylinder', radiusTop: 0.008, radiusBottom: 0.008, height: 0.35 }, position: [0, 0.195, 0], material: 'metal_black_matte' },
      ],
    })
    const scene = new THREE.Scene()
    new SceneBridge(world).attach(scene)
    const model = scene.getObjectByName('__model__')!
    expect(model.children).toHaveLength(1) // merged: one material
    expect(sizeOf(model)[1]).toBeCloseTo(0.37, 2)
  })
})

describe('ScenePipeline settings', () => {
  function fakeRenderer() {
    return {
      domElement: {} as HTMLCanvasElement,
      shadowMap: { enabled: false, type: THREE.BasicShadowMap as THREE.ShadowMapType },
      info: { render: {} },
      setSize() {},
      setPixelRatio() {},
      render() {},
      dispose() {},
    } as any
  }

  it('applies tone mapping, exposure, ambient, fog and shadow quality, capped by the quality profile', () => {
    const renderer = fakeRenderer()
    const scene = new THREE.Scene()
    const pipeline = new ScenePipeline(renderer, scene, { backend: 'webgl2', quality: 'low' })
    pipeline.applySettings(
      SceneSettingsSchema.parse({
        environment: 'none',
        toneMapping: 'aces',
        exposure: 1.4,
        ambientColor: '#204060',
        fog: { enabled: true, type: 'linear', near: 5, far: 50 },
        shadowQuality: 'high',
        skybox: '#112233',
      })
    )
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping)
    expect(renderer.toneMappingExposure).toBe(1.4)
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace)
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap)
    expect(scene.fog).toBeInstanceOf(THREE.Fog)
    expect((scene.background as THREE.Color).getHexString()).toBe('112233')
    const ambient = scene.getObjectByName('__ambient__') as THREE.AmbientLight
    expect(ambient.color.getHexString()).toBe(new THREE.Color('#204060').getHexString())
    // Low profile: 1024 shadow map even though the scene asks for high
    expect((scene.getObjectByName('__sun__') as THREE.DirectionalLight).shadow.mapSize.x).toBe(1024)
    expect(pipeline.caps.postFx).toBe(false)
    expect(pipeline.caps.transmission).toBe(false)
    pipeline.dispose()
  })

  it('fits the sun shadow camera to the casters and ignores terrain-sized ones', () => {
    const scene = new THREE.Scene()
    const pipeline = new ScenePipeline(fakeRenderer(), scene, { backend: 'webgl2' })
    pipeline.applySettings({ ...DEFAULT_SCENE_SETTINGS, environment: 'none' })
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))
    box.castShadow = true
    box.position.set(3, 1, 0)
    const ground = new THREE.Mesh(new THREE.BoxGeometry(200, 1, 200))
    ground.castShadow = true
    scene.add(box, ground)
    pipeline.fitShadows()
    const sun = scene.getObjectByName('__sun__') as THREE.DirectionalLight
    const cam = sun.shadow.camera
    expect(cam.right).toBeGreaterThan(1.7)
    expect(cam.right).toBeLessThan(5)
    expect(sun.target.position.toArray()).toEqual([3, 1, 0])
    expect(sun.shadow.normalBias).toBeGreaterThan(0)
    expect(sun.shadow.bias).toBeLessThan(0)
    pipeline.dispose()
  })
})
