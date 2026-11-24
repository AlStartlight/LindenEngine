import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { World } from '../../engine/ecs/World'
import { SceneSerializer } from '../../engine/scene/serializer'

const root = path.resolve(__dirname, '../..')
const scenePath = path.join(root, 'scenes/CosmicRift.lscene')
const sceneJson = fs.readFileSync(scenePath, 'utf-8')

/** GLB JSON chunk: proves the demo character really ships a skeleton and animation clips */
function glbJson(file: string): any {
  const buf = fs.readFileSync(file)
  expect(buf.subarray(0, 4).toString('latin1')).toBe('glTF')
  const jsonLength = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf-8'))
}

describe('Cosmic Rift demo world', () => {
  it('opens with an environment, lights, portal and a playable rigged character', () => {
    const world = new World()
    SceneSerializer.deserialize(sceneJson, world)
    const entities = world.getEntities()
    const byName = (name: string) => entities.find((e) => e.name === name)

    expect(byName('Rift Ground')).toBeTruthy()
    expect(byName('Rift Gate')).toBeTruthy()
    expect(byName('Portal Energy')).toBeTruthy()
    expect(byName('Ringed Planet')).toBeTruthy()

    const warden = byName('Astral Warden')!
    expect(warden.hasTag('Player')).toBe(true)
    expect(warden.getComponent('CharacterController')).toBeTruthy()
    expect(warden.getComponent('CharacterMovement')).toBeTruthy()
    expect(warden.getComponent('CharacterAnimator')).toBeTruthy()
    const model = warden.getComponent<any>('Model')
    expect(model.src).toBe('assets/models/astral_warden.glb')
    expect(model.animation).toBe('Idle')
    expect(fs.existsSync(path.join(root, model.src))).toBe(true)

    const lights = entities.filter((e) => e.hasComponent('Light'))
    expect(lights.length).toBeGreaterThanOrEqual(3)
    expect(entities.some((e) => e.hasComponent('ParticleEmitter'))).toBe(true)

    const settings = world.getSceneSettings()
    expect(settings.environment).toBe('assets/hdri/cosmic_rift.hdr')
    expect(fs.existsSync(path.join(root, 'assets/sky/cosmic_sky.png'))).toBe(true)
    expect(settings.skybox).toBe('assets/sky/cosmic_sky.png')
    expect(settings.colorGrade.enabled).toBe(true)
    expect(settings.postFx.enabled).toBe(true)
    expect(settings.fog.enabled).toBe(true)
  })

  it('ships a skinned character with the full locomotion clip set', () => {
    const json = glbJson(path.join(root, 'assets/models/astral_warden.glb'))
    expect(json.skins?.length ?? 0).toBeGreaterThan(0)
    expect(json.nodes?.some((n: any) => n.skin !== undefined)).toBe(true)
    const clips = (json.animations ?? []).map((a: any) => a.name).sort()
    expect(clips).toEqual(
      expect.arrayContaining(['Idle', 'Walk', 'Run', 'Jump_Start', 'Fall', 'Land', 'Crouch_Idle', 'Crouch_Walk', 'Attack'])
    )
    // The HDR sky is the real Radiance file, not a placeholder
    const hdr = fs.readFileSync(path.join(root, 'assets/hdri/cosmic_rift.hdr'))
    expect(hdr.subarray(0, 10).toString('latin1')).toBe('#?RADIANCE')
  })

  it('round-trips through the serializer without losing the character or grade', () => {
    const world = new World()
    SceneSerializer.deserialize(sceneJson, world)
    const again = new World()
    SceneSerializer.deserialize(SceneSerializer.serialize(world, 'Cosmic Rift'), again)
    const warden = again.getEntities().find((e) => e.name === 'Astral Warden')!
    expect(warden.getComponent('CharacterAnimator')).toBeTruthy()
    expect(again.getSceneSettings().colorGrade.contrast).toBeCloseTo(1.18, 3)
  })
})
