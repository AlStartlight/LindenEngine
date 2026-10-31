import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import '../../engine/ecs/ComponentRegistry'
import { World } from '../../engine/ecs/World'
import { CommandStack } from '../../editor/commands/CommandStack'
import { canConvertToEditableMesh, convertToEditableMeshCommand } from '../../editor/commands/meshCommands'
import { setPropertyCommand } from '../../editor/commands/entityCommands'
import { decodeHalfEdgeMesh, encodeHalfEdgeMesh } from '../../engine/mesh/core/encoding'
import { editablePrimitive } from '../../engine/mesh/core/editablePrimitives'
import { MeshEditor } from '../../engine/mesh/modeling/MeshEditor'
import { EDITABLE_MESH } from '../../engine/renderer/sceneFactory'
import { SceneBridge } from '../../engine/scene/SceneBridge'
import { SceneSerializer } from '../../engine/scene/serializer'
import { QUALITY_CAPS } from '../../engine/scene/SceneSettings'

function setup(primitive = 'cylinder', extra: Record<string, unknown> = {}) {
  const world = new World()
  const e = world.createEntity('Thing')
  world.addComponent(e.id, 'MeshRenderer', { primitive, color: '#ff0000', roughness: 0.3, ...extra })
  const bridge = new SceneBridge(world)
  bridge.attach(new THREE.Scene(), { backend: 'webgl2', caps: QUALITY_CAPS.low })
  return { world, id: e.id, bridge, stack: new CommandStack(world) }
}

const editableObject = (bridge: SceneBridge, id: string) => bridge.getObject(id)!.getObjectByName(EDITABLE_MESH) as THREE.Mesh | undefined

describe('EditableMesh in the scene', () => {
  it('Convert to Editable swaps the components, keeps the material and renders flat-shaded geometry', () => {
    const { world, id, bridge, stack } = setup()
    expect(canConvertToEditableMesh(world, id)).toBe(true)
    stack.execute(convertToEditableMeshCommand(id))
    const entity = world.getEntity(id)!
    expect(entity.hasComponent('MeshRenderer')).toBe(false)
    const comp = entity.getComponent('EditableMesh') as any
    expect(comp.color).toBe('#ff0000')
    expect(comp.roughness).toBe(0.3)
    expect(canConvertToEditableMesh(world, id)).toBe(false)
    const obj = editableObject(bridge, id)!
    expect(obj).toBeDefined()
    expect(obj.userData.entityId).toBe(id)
    // 24 quads + 2 caps of 24 -> 48 + 2 * 22 = 92 triangles, non-indexed
    expect(obj.geometry.getAttribute('position').count).toBe(92 * 3)
    expect(obj.geometry.getAttribute('uv')).toBeDefined()
    expect(bridge.getObject(id)!.getObjectByName('__mesh__')).toBeUndefined()
  })

  it('undo restores the original MeshRenderer exactly', () => {
    const { world, id, bridge, stack } = setup('box', { size: [2, 1, 1] })
    const before = JSON.parse(JSON.stringify(world.getEntity(id)!.getComponent('MeshRenderer')))
    stack.execute(convertToEditableMeshCommand(id))
    stack.undo()
    expect(JSON.parse(JSON.stringify(world.getEntity(id)!.getComponent('MeshRenderer')))).toEqual(before)
    expect(world.getEntity(id)!.hasComponent('EditableMesh')).toBe(false)
    expect(editableObject(bridge, id)).toBeUndefined()
    stack.redo()
    const mesh = decodeHalfEdgeMesh((world.getEntity(id)!.getComponent('EditableMesh') as any).mesh)
    // Mesh-only size baked into the vertices
    expect(mesh.ok && Math.max(...Array.from(mesh.value.positions.subarray(0, 24)).filter((_, i) => i % 3 === 0))).toBe(1)
  })

  it('an edit session commits as one undoable property change; the bridge rebuilds the geometry', () => {
    const { world, id, bridge, stack } = setup('box')
    stack.execute(convertToEditableMeshCommand(id))
    const comp = world.getEntity(id)!.getComponent('EditableMesh') as any
    const decoded = decodeHalfEdgeMesh(comp.mesh)
    if (!decoded.ok) throw new Error(decoded.message)
    const editor = new MeshEditor(decoded.value)
    editor.selection.setMode('face')
    editor.selection.click(0)
    return editor.extrude(0.5).then(() => {
      stack.execute(setPropertyCommand(id, 'EditableMesh', 'mesh', encodeHalfEdgeMesh(editor.mesh)))
      expect(editableObject(bridge, id)!.geometry.getAttribute('position').count).toBe((10 * 2) * 3)
      stack.undo()
      expect(editableObject(bridge, id)!.geometry.getAttribute('position').count).toBe(12 * 3)
    })
  })

  it('survives scene save/load with identical topology', () => {
    const { world, id, stack } = setup('torus')
    stack.execute(convertToEditableMeshCommand(id))
    const json = SceneSerializer.serialize(world, 'S')
    const loaded = new World()
    SceneSerializer.deserialize(json, loaded)
    const entity = loaded.getEntities().find((e) => e.name === 'Thing')!
    const a = decodeHalfEdgeMesh((world.getEntity(id)!.getComponent('EditableMesh') as any).mesh)
    const b = decodeHalfEdgeMesh((entity.getComponent('EditableMesh') as any).mesh)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(b.value.toData()).toEqual(a.value.toData())
    expect(b.ok && b.value.toData()).toEqual(editablePrimitive('torus').toData())
  })

  it('material changes swap only the material; corrupt mesh data warns and renders empty', () => {
    const { world, id, bridge, stack } = setup('box')
    stack.execute(convertToEditableMeshCommand(id))
    const obj = editableObject(bridge, id)!
    const geometry = obj.geometry
    stack.execute(setPropertyCommand(id, 'EditableMesh', 'color', '#00ff00'))
    expect(editableObject(bridge, id)!.geometry).toBe(geometry)
    const warnings: string[] = []
    const w2 = new World()
    const e2 = w2.createEntity('Bad')
    const b2 = new SceneBridge(w2)
    b2.attach(new THREE.Scene(), { backend: 'webgl2', caps: QUALITY_CAPS.low, warn: (m: string) => warnings.push(m) })
    w2.addComponent(e2.id, 'EditableMesh', { mesh: { format: 'linden-mesh', version: 1, positions: '%' } })
    expect(editableObject(b2, e2.id)!.geometry.getAttribute('position')).toBeUndefined()
    expect(warnings.join()).toMatch(/EditableMesh/)
    expect(world.getEntity(id)).toBeDefined()
  })
})
