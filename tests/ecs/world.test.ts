import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { World } from '../../engine/ecs/World'
import { SceneBridge } from '../../engine/scene/SceneBridge'
import { LayerMask } from '../../engine/scene/LayerMask'
import { Component } from '../../engine/ecs/Component'

describe('F0.1 & F1.5: World & ECS (TC-F01-01 to TC-F01-08, TC-F15-01 to TC-F15-12)', () => {
  it('TC-F01-01: creates 1 THREE.Mesh with userData.entityId === id when adding MeshRenderer', () => {
    const world = new World()
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene)

    const cube = world.createEntity('Cube')
    world.addComponent(cube.id, 'MeshRenderer', { primitive: 'box' })

    const obj = bridge.getObject(cube.id)
    expect(obj).toBeDefined()
    expect(obj instanceof THREE.Group).toBe(true)

    const meshChild = obj!.getObjectByName('__mesh__') as THREE.Mesh
    expect(meshChild).toBeDefined()
    expect(meshChild.isMesh).toBe(true)
    expect(meshChild.userData.entityId).toBe(cube.id)

    bridge.detach()
  })

  it('TC-F01-02: setProperty on Transform.position updates object3D.position', () => {
    const world = new World()
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene)

    const entity = world.createEntity('TestEntity')
    world.setProperty(entity.id, 'Transform', 'position', [1, 2, 3])

    const obj = bridge.getObject(entity.id)!
    expect(obj.position.x).toBe(1)
    expect(obj.position.y).toBe(2)
    expect(obj.position.z).toBe(3)

    bridge.detach()
  })

  it('TC-F01-03: setProperty on Transform.rotation updates object3D.rotation.y to approx pi/2', () => {
    const world = new World()
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene)

    const entity = world.createEntity('RotatingEntity')
    world.setProperty(entity.id, 'Transform', 'rotation', [0, 90, 0])

    const obj = bridge.getObject(entity.id)!
    expect(obj.rotation.y).toBeCloseTo(Math.PI / 2, 5)

    bridge.detach()
  })

  it('TC-F01-04: setParent(B, null) with keepWorldTransform keeps world position and moves B to root', () => {
    const world = new World()
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene)

    const a = world.createEntity('ParentA')
    world.setProperty(a.id, 'Transform', 'position', [10, 0, 0])

    const b = world.createEntity('ChildB', a.id)
    world.setProperty(b.id, 'Transform', 'position', [5, 2, 0])

    // Before detach: B's world pos is (15, 2, 0)
    scene.updateMatrixWorld(true)
    const worldPosBefore = new THREE.Vector3()
    bridge.getObject(b.id)!.getWorldPosition(worldPosBefore)
    expect(worldPosBefore.x).toBeCloseTo(15)
    expect(worldPosBefore.y).toBeCloseTo(2)

    // Detach B to root with keepWorldTransform = true
    world.setParent(b.id, null, true)

    expect(b.parentId).toBeNull()
    expect(world.getRootEntityIds()).toContain(b.id)
    expect(a.childIds).not.toContain(b.id)

    // B's world position remains (15, 2, 0)
    scene.updateMatrixWorld(true)
    const worldPosAfter = new THREE.Vector3()
    bridge.getObject(b.id)!.getWorldPosition(worldPosAfter)
    expect(worldPosAfter.x).toBeCloseTo(15)
    expect(worldPosAfter.y).toBeCloseTo(2)

    bridge.detach()
  })

  it('TC-F01-05: destroyEntity(A) on A > B > C removes all 3 and disposes Three.js objects', () => {
    const world = new World()
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene)

    const a = world.createEntity('A')
    const b = world.createEntity('B', a.id)
    const c = world.createEntity('C', b.id)

    world.addComponent(a.id, 'MeshRenderer', { primitive: 'box' })
    world.addComponent(b.id, 'MeshRenderer', { primitive: 'box' })
    world.addComponent(c.id, 'MeshRenderer', { primitive: 'box' })

    const removedEntities: string[] = []
    world.events.on('entityRemoved', (ent) => {
      removedEntities.push(ent.id)
    })

    world.destroyEntity(a.id)

    expect(world.getEntity(a.id)).toBeUndefined()
    expect(world.getEntity(b.id)).toBeUndefined()
    expect(world.getEntity(c.id)).toBeUndefined()
    expect(removedEntities).toHaveLength(3)

    expect(bridge.getObject(a.id)).toBeUndefined()
    expect(bridge.getObject(b.id)).toBeUndefined()
    expect(bridge.getObject(c.id)).toBeUndefined()

    bridge.detach()
  })

  it('TC-F01-08: setParent(A, C) when C is descendant of A throws PARENT_CYCLE', () => {
    const world = new World()
    const a = world.createEntity('A')
    const b = world.createEntity('B', a.id)
    const c = world.createEntity('C', b.id)

    expect(() => {
      world.setParent(a.id, c.id)
    }).toThrow(/PARENT_CYCLE/)

    // Also setting parent to self
    expect(() => {
      world.setParent(a.id, a.id)
    }).toThrow(/PARENT_CYCLE/)
  })

  it('TC-F15-01: findByTag returns entities in hierarchy order', () => {
    const world = new World()
    const e1 = world.createEntity('E1')
    const e2 = world.createEntity('E2')
    const e3 = world.createEntity('E3')

    world.addTag(e1.id, 'Enemy')
    world.addTag(e2.id, 'Enemy')
    world.addTag(e3.id, 'Enemy')

    const enemies = world.findByTag('Enemy')
    expect(enemies.map((e) => e.name)).toEqual(['E1', 'E2', 'E3'])
  })

  it('TC-F15-05: LayerMask.getMask returns bitmask for layers', () => {
    const mask = LayerMask.getMask('Default', 'Water')
    expect(mask).toBe((1 << 0) | (1 << 4))
  })

  it('TC-F15-06: findByTag, findByAllTags, findByAnyTag work with multi-tag entities', () => {
    const world = new World()
    const a = world.createEntity('A')
    const b = world.createEntity('B')
    const c = world.createEntity('C')

    world.addTag(a.id, 'Enemy')
    world.addTag(a.id, 'Flying')
    world.addTag(b.id, 'Enemy')
    world.addTag(c.id, 'Flying')

    expect(world.findByTag('Enemy').map((e) => e.id)).toEqual([a.id, b.id])
    expect(world.findByAllTags(['Enemy', 'Flying']).map((e) => e.id)).toEqual([a.id])
    expect(world.findByAnyTag(['Enemy', 'Flying']).map((e) => e.id)).toEqual([a.id, b.id, c.id])
  })

  it('TC-F15-07: addTag twice on same entity deduplicates and does not duplicate', () => {
    const world = new World()
    const e = world.createEntity('E')
    world.addTag(e.id, 'Enemy')
    world.addTag(e.id, 'Enemy')

    expect(e.tags).toEqual(['Enemy'])
    expect(world.findByTag('Enemy')).toHaveLength(1)
  })

  it('TC-F15-08: removing tagged entity removes it from tag index', () => {
    const world = new World()
    const e = world.createEntity('E')
    world.addTag(e.id, 'Enemy')

    expect(world.findByTag('Enemy')).toHaveLength(1)
    world.destroyEntity(e.id)
    expect(world.findByTag('Enemy')).toHaveLength(0)
  })

  it('TC-F15-12: callTag invokes method across tagged entities and skips ones without it', () => {
    const world = new World()
    const e1 = world.createEntity('Enemy1')
    const e2 = world.createEntity('Enemy2')
    const e3 = world.createEntity('Enemy3')

    world.addTag(e1.id, 'Enemy')
    world.addTag(e2.id, 'Enemy')
    world.addTag(e3.id, 'Enemy')

    const mockDamage1 = vi.fn()
    const mockDamage2 = vi.fn()

    class Damageable1 extends Component {
      takeDamage(amount: number) {
        mockDamage1(amount)
      }
      clone() {
        return new Damageable1()
      }
    }
    class Damageable2 extends Component {
      takeDamage(amount: number) {
        mockDamage2(amount)
      }
      clone() {
        return new Damageable2()
      }
    }

    e1.addComponent(new Damageable1())
    e2.addComponent(new Damageable2())
    // e3 has no takeDamage component

    world.callTag('Enemy', 'takeDamage', 10)

    expect(mockDamage1).toHaveBeenCalledWith(10)
    expect(mockDamage2).toHaveBeenCalledWith(10)
  })
})
