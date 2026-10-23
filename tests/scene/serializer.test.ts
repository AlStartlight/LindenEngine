import { describe, it, expect } from 'vitest'
import { World } from '../../engine/ecs/World'
import { SceneSerializer, stableStringify, migrateSceneV1ToV2 } from '../../engine/scene/serializer'

describe('F0.4: Save / Open .lscene v2 (TC-F04-01 to TC-F04-05)', () => {
  it('TC-F04-01: Round-trip deserialize(serialize(world)) produces byte-identical output', () => {
    const world1 = new World()
    const parent = world1.createEntity('Parent')
    world1.setProperty(parent.id, 'Transform', 'position', [1, 2, 3])
    world1.addComponent(parent.id, 'MeshRenderer', { primitive: 'box', color: '#ff0000' })
    world1.addTag(parent.id, 'Main')

    const child = world1.createEntity('Child', parent.id)
    world1.setProperty(child.id, 'Transform', 'position', [0, 5, 0])
    world1.addComponent(child.id, 'BoxCollider', { isTrigger: true })

    const json1 = SceneSerializer.serialize(world1, 'TestScene')

    const world2 = new World()
    SceneSerializer.deserialize(json1, world2)
    const json2 = SceneSerializer.serialize(world2, 'TestScene')

    expect(json2).toBe(json1)
  })

  it('TC-F04-02: Serialize twice without changes produces identical output (stable key order)', () => {
    const world = new World()
    const e1 = world.createEntity('Object1')
    world.addComponent(e1.id, 'MeshRenderer', { primitive: 'sphere' })
    const e2 = world.createEntity('Object2')
    world.addComponent(e2.id, 'BoxCollider')

    const out1 = SceneSerializer.serialize(world, 'StableScene')
    const out2 = SceneSerializer.serialize(world, 'StableScene')
    expect(out1).toBe(out2)
  })

  it('TC-F04-03: Changing position of one object only modifies position lines in diff', () => {
    const world = new World()
    const e1 = world.createEntity('Object1')
    world.setProperty(e1.id, 'Transform', 'position', [0, 0, 0])
    const e2 = world.createEntity('Object2')
    world.setProperty(e2.id, 'Transform', 'position', [10, 10, 10])

    const jsonBefore = SceneSerializer.serialize(world, 'Scene')

    // Change only Object1 position
    world.setProperty(e1.id, 'Transform', 'position', [5, 0, 0])
    const jsonAfter = SceneSerializer.serialize(world, 'Scene')

    const parsedBefore = JSON.parse(jsonBefore)
    const parsedAfter = JSON.parse(jsonAfter)

    // Only Object1's Transform.position is changed
    expect(parsedBefore.entities[1]).toEqual(parsedAfter.entities[1])
    expect(parsedBefore.entities[0].components[0].data.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(parsedAfter.entities[0].components[0].data.position).toEqual({ x: 5, y: 0, z: 0 })
  })

  it('TC-F04-04: Opening v1 scene format migrates to v2; objects, transforms, materials preserved', () => {
    const v1Scene = {
      format: 'linden-scene',
      version: 1,
      name: 'LegacyScene',
      objects: [
        {
          id: 'obj-1',
          name: 'LegacyCube',
          kind: 'primitive',
          primitive: 'box',
          transform: {
            position: [1, 2, 3],
            rotation: [0, 45, 0],
            scale: [2, 2, 2],
          },
          material: {
            color: '#00ff00',
            roughness: 0.3,
            metalness: 0.8,
          },
          visible: true,
        },
      ],
    }

    const world = new World()
    const res = SceneSerializer.deserialize(JSON.stringify(v1Scene), world)

    expect(res.name).toBe('LegacyScene')
    expect(world.getEntities()).toHaveLength(1)

    const entity = world.getEntity('obj-1')!
    expect(entity.name).toBe('LegacyCube')
    expect(entity.getTransform().position).toEqual({ x: 1, y: 2, z: 3 })
    expect(entity.hasComponent('MeshRenderer')).toBe(true)

    const mr = entity.getComponent('MeshRenderer') as any
    expect(mr.color).toBe('#00ff00')
    expect(mr.roughness).toBe(0.3)
    expect(mr.metalness).toBe(0.8)
  })

  it('TC-F04-05: Missing script component is retained as generic placeholder and preserved on save', () => {
    const sceneWithUnknownScript = {
      format: 'linden-scene',
      version: 2,
      name: 'ScriptScene',
      entities: [
        {
          id: 'ent-1',
          name: 'Hero',
          active: true,
          static: false,
          tags: [],
          layer: 0,
          parentId: null,
          components: [
            {
              type: 'script:MissingHeroScript',
              data: {
                health: 100,
                mana: 50,
                weapon: 'Sword',
              },
            },
          ],
        },
      ],
    }

    const world = new World()
    SceneSerializer.deserialize(JSON.stringify(sceneWithUnknownScript), world)

    const hero = world.getEntity('ent-1')!
    expect(hero).toBeDefined()
    expect(hero.hasComponent('script:MissingHeroScript')).toBe(true)

    const comp = hero.getComponent('script:MissingHeroScript') as any
    expect(comp.health).toBe(100)
    expect(comp.mana).toBe(50)
    expect(comp.weapon).toBe('Sword')

    // Serialize back: data must be retained
    const savedJson = SceneSerializer.serialize(world, 'ScriptScene')
    const reloaded = JSON.parse(savedJson)
    const reloadedHero = reloaded.entities.find((e: any) => e.id === 'ent-1')
    const reloadedScript = reloadedHero.components.find((c: any) => c.type === 'script:MissingHeroScript')

    expect(reloadedScript).toBeDefined()
    expect(reloadedScript.data.health).toBe(100)
    expect(reloadedScript.data.mana).toBe(50)
    expect(reloadedScript.data.weapon).toBe('Sword')
  })
})
