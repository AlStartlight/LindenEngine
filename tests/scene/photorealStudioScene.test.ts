import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { World } from '../../engine/ecs/World'
import { SceneSerializer } from '../../engine/scene/serializer'

const root = path.resolve(__dirname, '../..')
const scenePath = path.join(root, 'scenes/PhotorealStudio.lscene')

/** The shipped Blender -> Linden demo must stay a valid v2 scene with an embedded-texture GLB. */
describe('Photoreal Studio demo scene', () => {
  const json = fs.readFileSync(scenePath, 'utf-8')

  it('opens and keeps the graded studio settings', () => {
    const world = new World()
    SceneSerializer.deserialize(json, world)
    const settings = world.getSceneSettings()
    expect(settings.toneMapping).toBe('agx')
    expect(settings.colorGrade.enabled).toBe(true)
    expect(settings.colorGrade.contrast).toBeCloseTo(1.16, 3)
    expect(settings.colorGrade.vignette).toBeCloseTo(0.28, 3)
    expect(settings.postFx.enabled).toBe(true)
  })

  it('places the sculpted GLB and a camera', () => {
    const world = new World()
    SceneSerializer.deserialize(json, world)
    const entities = world.getEntities()
    const vase = entities.find((e) => e.name === 'Photoreal Vase')
    expect(vase).toBeTruthy()
    const model = vase!.getComponent<any>('Model')
    expect(model.src).toBe('assets/models/photoreal_vase.glb')
    expect(model.collider).toBe('box')
    expect(fs.existsSync(path.join(root, model.src))).toBe(true)
    const camera = entities.find((e) => e.name === 'Main Camera')
    expect(camera!.hasComponent('Camera')).toBe(true)
  })

  it('round-trips through the serializer', () => {
    const world = new World()
    SceneSerializer.deserialize(json, world)
    const again = SceneSerializer.deserialize(SceneSerializer.serialize(world, 'Photoreal Studio'), new World())
    expect(again).toBeTruthy()
  })
})
