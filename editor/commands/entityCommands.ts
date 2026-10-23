import type { EditorCommand } from './CommandStack'
import { World } from '../../engine/ecs/World'
import { Entity } from '../../engine/ecs/Entity'
import { ComponentRegistry } from '../../engine/ecs/ComponentRegistry'
import { SceneSerializer } from '../../engine/scene/serializer'
import { generatePrefabChildId } from '../../engine/scene/prefab'

/**
 * Create Entity Command
 */
export function createEntityCommand(
  name: string = 'GameObject',
  parentId: string | null = null,
  index?: number
): EditorCommand {
  let createdId: string | null = null

  return {
    label: `Create ${name}`,
    do: (world: World) => {
      const ent = world.createEntity(name, parentId, index, createdId || undefined)
      createdId = ent.id
    },
    undo: (world: World) => {
      if (createdId) {
        world.destroyEntity(createdId)
      }
    },
  }
}

/**
 * Delete Entity Command
 */
export function deleteEntityCommand(entityId: string): EditorCommand {
  let snapshot: string | null = null
  let parentId: string | null = null
  let entityName: string = 'GameObject'

  return {
    label: 'Delete Entity',
    do: (world: World) => {
      const ent = world.getEntity(entityId)
      if (ent) {
        entityName = ent.name
        parentId = ent.parentId
        // Serialize subtree
        const tempWorld = new World()
        const clone = ent.clone(ent.name, ent.id)
        tempWorld.addEntity(clone)
        snapshot = SceneSerializer.serialize(tempWorld, 'Snapshot')
        world.destroyEntity(entityId)
      }
    },
    undo: (world: World) => {
      if (snapshot) {
        const tempWorld = new World()
        SceneSerializer.deserialize(snapshot, tempWorld)
        for (const restored of tempWorld.getEntities()) {
          world.addEntity(restored)
          if (restored.id === entityId) {
            world.setParent(restored.id, parentId)
          }
        }
      }
    },
  }
}

/**
 * Duplicate Entity Command
 */
export function duplicateEntityCommand(entityId: string): EditorCommand {
  let clonedId: string | null = null

  return {
    label: 'Duplicate Entity',
    do: (world: World) => {
      const source = world.getEntity(entityId)
      if (!source) return

      const clone = source.clone(undefined, clonedId || undefined)
      clonedId = clone.id
      world.addEntity(clone)
      if (source.parentId) {
        world.setParent(clone.id, source.parentId)
      }
    },
    undo: (world: World) => {
      if (clonedId) {
        world.destroyEntity(clonedId)
      }
    },
  }
}

/**
 * Set Property Command (with mergeKey for gizmo drag and number scrub)
 */
export function setPropertyCommand(
  entityId: string,
  componentType: string,
  path: string,
  newValue: any,
  oldValue?: any,
  mergeKey?: string
): EditorCommand {
  let actualOldValue: any = oldValue

  return {
    label: `Set ${componentType}.${path}`,
    mergeKey,
    do: (world: World) => {
      if (actualOldValue === undefined) {
        const current = world.getProperty(entityId, componentType, path)
        actualOldValue = current && typeof current === 'object' ? JSON.parse(JSON.stringify(current)) : current
      }
      world.setProperty(entityId, componentType, path, newValue)
    },
    undo: (world: World) => {
      world.setProperty(entityId, componentType, path, actualOldValue)
    },
  }
}

/**
 * Set Parent Command (reparenting)
 */
export function setParentCommand(
  entityId: string,
  newParentId: string | null,
  index?: number,
  keepWorldTransform: boolean = true
): EditorCommand {
  let oldParentId: string | null = null
  let oldIndex: number | undefined

  return {
    label: 'Reparent Entity',
    do: (world: World) => {
      const ent = world.getEntity(entityId)
      if (ent) {
        oldParentId = ent.parentId
        world.setParent(entityId, newParentId, index, keepWorldTransform)
      }
    },
    undo: (world: World) => {
      world.setParent(entityId, oldParentId, oldIndex, keepWorldTransform)
    },
  }
}

/**
 * Add Component Command
 */
export function addComponentCommand(entityId: string, componentType: string, data?: any): EditorCommand {
  return {
    label: `Add Component ${componentType}`,
    do: (world: World) => {
      world.addComponent(entityId, componentType, data)
    },
    undo: (world: World) => {
      world.removeComponent(entityId, componentType)
    },
  }
}

/**
 * Remove Component Command
 */
export function removeComponentCommand(entityId: string, componentType: string): EditorCommand {
  let savedData: any = null

  return {
    label: `Remove Component ${componentType}`,
    do: (world: World) => {
      const ent = world.getEntity(entityId)
      if (ent) {
        const comp = ent.getComponent(componentType)
        if (comp) {
          savedData = JSON.parse(JSON.stringify(comp))
          world.removeComponent(entityId, componentType)
        }
      }
    },
    undo: (world: World) => {
      if (savedData) {
        world.addComponent(entityId, componentType, savedData)
      }
    },
  }
}

/**
 * Reset Component Command
 */
export function resetComponentCommand(entityId: string, componentType: string): EditorCommand {
  let prevValues: any = null

  return {
    label: `Reset Component ${componentType}`,
    do: (world: World) => {
      const ent = world.getEntity(entityId)
      if (!ent) return
      const comp = ent.getComponent(componentType)
      if (!comp) return

      prevValues = JSON.parse(JSON.stringify(comp))
      const def = ComponentRegistry.get(componentType)
      if (def) {
        const fresh = def.create()
        Object.assign(comp, fresh)
        for (const p of def.properties) {
          world.setProperty(entityId, componentType, p.name, p.default)
        }
      }
    },
    undo: (world: World) => {
      const ent = world.getEntity(entityId)
      if (!ent || !prevValues) return
      const comp = ent.getComponent(componentType)
      if (!comp) return
      Object.assign(comp, prevValues)
    },
  }
}

/**
 * Paste Component Values Command
 */
export function pasteComponentValuesCommand(entityId: string, componentType: string, newValues: any): EditorCommand {
  let prevValues: any = null

  return {
    label: `Paste Values into ${componentType}`,
    do: (world: World) => {
      const ent = world.getEntity(entityId)
      if (!ent) return
      const comp = ent.getComponent(componentType)
      if (!comp) return
      prevValues = JSON.parse(JSON.stringify(comp))
      Object.assign(comp, newValues)
    },
    undo: (world: World) => {
      const ent = world.getEntity(entityId)
      if (!ent || !prevValues) return
      const comp = ent.getComponent(componentType)
      if (!comp) return
      Object.assign(comp, prevValues)
    },
  }
}

/**
 * Set Tags Command
 */
export function setTagsCommand(entityId: string, newTags: string[]): EditorCommand {
  let prevTags: string[] = []

  return {
    label: 'Set Tags',
    do: (world: World) => {
      const ent = world.getEntity(entityId)
      if (!ent) return
      prevTags = [...ent.tags]
      // Clear old tags from index
      for (const t of prevTags) {
        world.removeTag(entityId, t)
      }
      for (const t of newTags) {
        world.addTag(entityId, t)
      }
    },
    undo: (world: World) => {
      const ent = world.getEntity(entityId)
      if (!ent) return
      for (const t of newTags) {
        world.removeTag(entityId, t)
      }
      for (const t of prevTags) {
        world.addTag(entityId, t)
      }
    },
  }
}

/**
 * Set Layer Command
 */
export function setLayerCommand(entityId: string, newLayer: number, applyToChildren: boolean = false): EditorCommand {
  const previousLayers: Map<string, number> = new Map()

  return {
    label: 'Set Layer',
    do: (world: World) => {
      const apply = (entId: string) => {
        const ent = world.getEntity(entId)
        if (!ent) return
        if (!previousLayers.has(entId)) {
          previousLayers.set(entId, ent.layer)
        }
        ent.layer = newLayer
        if (applyToChildren) {
          for (const c of ent.childIds) {
            apply(c)
          }
        }
      }
      apply(entityId)
    },
    undo: (world: World) => {
      for (const [id, lyr] of previousLayers.entries()) {
        const ent = world.getEntity(id)
        if (ent) ent.layer = lyr
      }
    },
  }
}
