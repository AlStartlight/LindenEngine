import { World } from '../../engine/ecs/World'
import { editablePrimitive, scaleMesh } from '../../engine/mesh/core/editablePrimitives'
import { encodeHalfEdgeMesh } from '../../engine/mesh/core/encoding'
import { normalizePrimitive } from '../../engine/renderer/primitives'
import type { EditorCommand } from './CommandStack'

const MATERIAL_FIELDS = ['material', 'color', 'roughness', 'metalness', 'castShadow', 'receiveShadow', 'isVisible'] as const

export function canConvertToEditableMesh(world: World, entityId: string): boolean {
  const e = world.getEntity(entityId)
  return !!e && e.hasComponent('MeshRenderer') && !e.hasComponent('EditableMesh')
}

/**
 * Replaces a primitive MeshRenderer by an EditableMesh with the same shape (quads/n-gons + uvs, mesh-only
 * size baked in) and the same material. Undo restores the original MeshRenderer exactly.
 */
export function convertToEditableMeshCommand(entityId: string): EditorCommand {
  let saved: Record<string, unknown> | null = null
  return {
    label: 'Convert to Editable Mesh',
    do: (world: World) => {
      const entity = world.getEntity(entityId)
      const mr = entity?.getComponent('MeshRenderer') as unknown as Record<string, unknown> | undefined
      if (!entity || !mr || entity.hasComponent('EditableMesh')) return
      saved = JSON.parse(JSON.stringify(mr))
      const mesh = editablePrimitive(normalizePrimitive(mr.primitive))
      scaleMesh(mesh, mr.size)
      const data: Record<string, unknown> = { mesh: encodeHalfEdgeMesh(mesh) }
      for (const k of MATERIAL_FIELDS) if (mr[k] !== undefined) data[k] = JSON.parse(JSON.stringify(mr[k]))
      world.removeComponent(entityId, 'MeshRenderer')
      world.addComponent(entityId, 'EditableMesh', data)
    },
    undo: (world: World) => {
      if (!saved) return
      world.removeComponent(entityId, 'EditableMesh')
      world.addComponent(entityId, 'MeshRenderer', saved)
    },
  }
}
