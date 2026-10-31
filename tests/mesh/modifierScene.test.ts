import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import '../../engine/ecs/ComponentRegistry'
import { World } from '../../engine/ecs/World'
import { booleanMeshes } from '../../engine/mesh/boolean/manifoldAdapter'
import { encodeHalfEdgeMesh, decodeHalfEdgeMesh } from '../../engine/mesh/core/encoding'
import { editablePrimitive } from '../../engine/mesh/core/editablePrimitives'
import type { GeometryOps } from '../../engine/mesh/core/GeometryOps'
import { subdivideMesh } from '../../engine/mesh/subdiv/opensubdivAdapter'
import { EDITABLE_MESH } from '../../engine/renderer/sceneFactory'
import { SceneBridge } from '../../engine/scene/SceneBridge'
import { SceneSerializer } from '../../engine/scene/serializer'
import { QUALITY_CAPS } from '../../engine/scene/SceneSettings'

const geometry: Pick<GeometryOps, 'subdivide' | 'boolean'> = { subdivide: subdivideMesh, boolean: booleanMeshes }

function attach(world: World, withGeometry: boolean, warnings: string[] = []) {
  const bridge = new SceneBridge(world)
  bridge.attach(new THREE.Scene(), { backend: 'webgl2', caps: QUALITY_CAPS.low, warn: (m: string) => warnings.push(m), ...(withGeometry ? { geometry } : {}) })
  return bridge
}
const triangles = (bridge: SceneBridge, id: string) => {
  const g = (bridge.getObject(id)!.getObjectByName(EDITABLE_MESH) as THREE.Mesh).geometry
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3
}

describe('EditableMesh modifiers in the scene', () => {
  it('editor evaluates and caches; the player renders the saved cache without WASM', async () => {
    const world = new World()
    const e = world.createEntity('Box')
    world.addComponent(e.id, 'EditableMesh', { mesh: encodeHalfEdgeMesh(editablePrimitive('box')), modifiers: [{ type: 'subdivision', levels: 2 }] })
    const editor = attach(world, true)
    expect(triangles(editor, e.id)).toBe(12) // base shown first
    await editor.whenIdle()
    expect(triangles(editor, e.id)).toBe(96 * 2)
    const comp = e.getComponent('EditableMesh') as any
    expect(comp.modifierCache?.key).toBeTruthy()
    const cached = decodeHalfEdgeMesh(comp.modifierCache.mesh)
    expect(cached.ok && cached.value.faceCount).toBe(96)

    // Save, load into a fresh world, render like the player: no geometry ops at all
    const json = SceneSerializer.serialize(world, 'S')
    const loaded = new World()
    SceneSerializer.deserialize(json, loaded)
    const warnings: string[] = []
    const player = attach(loaded, false, warnings)
    const id = loaded.getEntities().find((x) => x.name === 'Box')!.id
    expect(triangles(player, id)).toBe(96 * 2)
    expect(warnings).toEqual([])
  })

  it('a stale cache in the player falls back to the base mesh and warns', () => {
    const world = new World()
    const e = world.createEntity('Box')
    world.addComponent(e.id, 'EditableMesh', {
      mesh: encodeHalfEdgeMesh(editablePrimitive('box')), modifiers: [{ type: 'subdivision', levels: 1 }],
      modifierCache: { key: 'outdated', mesh: encodeHalfEdgeMesh(editablePrimitive('sphere')) },
    })
    const warnings: string[] = []
    const player = attach(world, false, warnings)
    expect(triangles(player, e.id)).toBe(12)
    expect(warnings.join()).toMatch(/out of date/)
  })

  it('changing a modifier re-evaluates; smooth shading uses shared vertex normals', async () => {
    const world = new World()
    const e = world.createEntity('Box')
    world.addComponent(e.id, 'EditableMesh', { mesh: encodeHalfEdgeMesh(editablePrimitive('box')), modifiers: [{ type: 'subdivision', levels: 1 }] })
    const bridge = attach(world, true)
    await bridge.whenIdle()
    expect(triangles(bridge, e.id)).toBe(48)
    world.setProperty(e.id, 'EditableMesh', 'modifiers', [{ type: 'mirror', axis: 'x', merge: false }, { type: 'subdivision', levels: 1 }])
    await bridge.whenIdle()
    expect(triangles(bridge, e.id)).toBe(96)
    world.setProperty(e.id, 'EditableMesh', 'shading', 'smooth')
    await bridge.whenIdle()
    const g = (bridge.getObject(e.id)!.getObjectByName(EDITABLE_MESH) as THREE.Mesh).geometry
    expect(g.index).not.toBeNull()
    expect(g.getAttribute('normal')).toBeDefined()
  })

  it('boolean operand from another entity; moving the operand re-evaluates', async () => {
    const world = new World()
    const box = world.createEntity('Box')
    world.addComponent(box.id, 'EditableMesh', { mesh: encodeHalfEdgeMesh(editablePrimitive('box')) })
    const cutter = world.createEntity('Cutter')
    world.addComponent(cutter.id, 'MeshRenderer', { primitive: 'sphere' })
    world.setProperty(cutter.id, 'Transform', 'position', [0.5, 0.5, 0.5])
    world.setProperty(box.id, 'EditableMesh', 'modifiers', [{ type: 'boolean', op: 'subtract', operand: cutter.id }])
    const bridge = attach(world, true)
    await bridge.whenIdle()
    const comp = box.getComponent('EditableMesh') as any
    const firstKey = comp.modifierCache.key
    const firstTris = triangles(bridge, box.id)
    expect(firstTris).toBeGreaterThan(12)
    world.setProperty(cutter.id, 'Transform', 'position', [-0.5, -0.5, -0.5])
    await bridge.whenIdle()
    expect(comp.modifierCache.key).not.toBe(firstKey)
    // A missing operand is a warning, not a crash
    const warnings: string[] = []
    const w2 = new World()
    const b2 = w2.createEntity('B')
    w2.addComponent(b2.id, 'EditableMesh', { mesh: encodeHalfEdgeMesh(editablePrimitive('box')), modifiers: [{ type: 'boolean', op: 'union', operand: 'ghost' }] })
    const br2 = attach(w2, true, warnings)
    await br2.whenIdle()
    expect(warnings.join()).toMatch(/not found/)
    expect(triangles(br2, b2.id)).toBe(12)
  })

  it('removing the component while an evaluation runs does not crash or write a cache', async () => {
    const world = new World()
    const e = world.createEntity('Box')
    world.addComponent(e.id, 'EditableMesh', { mesh: encodeHalfEdgeMesh(editablePrimitive('box')), modifiers: [{ type: 'subdivision', levels: 3 }] })
    const comp = e.getComponent('EditableMesh') as any
    const bridge = attach(world, true)
    world.removeComponent(e.id, 'EditableMesh')
    await bridge.whenIdle()
    expect(comp.modifierCache).toBeNull()
    expect(bridge.getObject(e.id)!.getObjectByName(EDITABLE_MESH)).toBeUndefined()
  })
})
