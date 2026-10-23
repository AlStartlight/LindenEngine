import type { EditorCommand } from './CommandStack'
import { World } from '../../engine/ecs/World'
import { Entity } from '../../engine/ecs/Entity'
import type { PrefabAsset, PropertyOverride } from '../../engine/scene/prefab'
import { generatePrefabChildId } from '../../engine/scene/prefab'
import type { EventListener } from '../../engine/events/EventField'

/**
 * Instantiate Prefab Command
 */
export function instantiatePrefabCommand(
  prefabAsset: PrefabAsset,
  assetPath: string,
  instanceName?: string,
  parentId: string | null = null
): EditorCommand {
  let createdRootId: string | null = null

  return {
    label: `Instantiate Prefab ${instanceName || prefabAsset.root}`,
    do: (world: World) => {
      // Find root entity in prefab
      const rootData = prefabAsset.entities.find((e) => e.id === prefabAsset.root)
      if (!rootData) return

      const rootName = instanceName || rootData.name || 'Prefab'
      const rootEntity = world.createEntity(rootName, parentId, undefined, createdRootId || undefined)
      createdRootId = rootEntity.id

      rootEntity.prefab = {
        asset: assetPath,
        overrides: [],
      }

      // Add components from prefab root
      for (const compData of rootData.components || []) {
        if (compData.type !== 'Transform') {
          world.addComponent(rootEntity.id, compData.type, compData.data)
        }
      }

      // Instantiate children with stable deterministic IDs
      for (const entData of prefabAsset.entities) {
        if (entData.id === prefabAsset.root) continue
        const stableChildId = generatePrefabChildId(rootEntity.id, entData.id)
        const childEnt = world.createEntity(entData.name, rootEntity.id, undefined, stableChildId)
        for (const compData of entData.components || []) {
          if (compData.type !== 'Transform') {
            world.addComponent(childEnt.id, compData.type, compData.data)
          }
        }
      }
    },
    undo: (world: World) => {
      if (createdRootId) {
        world.destroyEntity(createdRootId)
      }
    },
  }
}

/**
 * Unpack Prefab Command
 */
export function unpackPrefabCommand(entityId: string): EditorCommand {
  let previousPrefabLink: any = null

  return {
    label: 'Unpack Prefab Completely',
    do: (world: World) => {
      const ent = world.getEntity(entityId)
      if (ent && ent.prefab) {
        previousPrefabLink = JSON.parse(JSON.stringify(ent.prefab))
        ent.prefab = undefined
      }
    },
    undo: (world: World) => {
      const ent = world.getEntity(entityId)
      if (ent && previousPrefabLink) {
        ent.prefab = JSON.parse(JSON.stringify(previousPrefabLink))
      }
    },
  }
}

/**
 * Revert Prefab Overrides Command
 */
export function revertPrefabOverridesCommand(
  entityId: string,
  prefabAsset: PrefabAsset
): EditorCommand {
  let previousOverrides: PropertyOverride[] = []

  return {
    label: 'Revert All Overrides',
    do: (world: World) => {
      const ent = world.getEntity(entityId)
      if (!ent || !ent.prefab) return
      previousOverrides = [...ent.prefab.overrides]
      ent.prefab.overrides = []

      // Revert values to prefab asset definition
      const rootData = prefabAsset.entities.find((e) => e.id === prefabAsset.root)
      if (rootData) {
        for (const comp of rootData.components || []) {
          for (const [k, v] of Object.entries(comp.data || {})) {
            world.setProperty(entityId, comp.type, k, v)
          }
        }
      }
    },
    undo: (world: World) => {
      const ent = world.getEntity(entityId)
      if (!ent || !ent.prefab) return
      ent.prefab.overrides = [...previousOverrides]
      for (const ov of previousOverrides) {
        world.setProperty(entityId, ov.component, ov.path, ov.value)
      }
    },
  }
}

/**
 * Add / Remove Event Listener Commands
 */
export function addEventListenerCommand(
  sourceEntityId: string,
  componentType: string,
  eventFieldName: string,
  listener: EventListener
): EditorCommand {
  return {
    label: `Add Event Listener to ${eventFieldName}`,
    do: (world: World) => {
      const ent = world.getEntity(sourceEntityId)
      if (!ent) return
      const comp = ent.getComponent(componentType) as any
      if (comp && comp[eventFieldName]) {
        comp[eventFieldName].listeners.push({ ...listener })
      }
    },
    undo: (world: World) => {
      const ent = world.getEntity(sourceEntityId)
      if (!ent) return
      const comp = ent.getComponent(componentType) as any
      if (comp && comp[eventFieldName]) {
        const list = comp[eventFieldName].listeners
        const idx = list.findIndex(
          (l: EventListener) =>
            l.targetId === listener.targetId &&
            l.component === listener.component &&
            l.method === listener.method
        )
        if (idx !== -1) list.splice(idx, 1)
      }
    },
  }
}

export function removeEventListenerCommand(
  sourceEntityId: string,
  componentType: string,
  eventFieldName: string,
  index: number
): EditorCommand {
  let removedListener: EventListener | null = null

  return {
    label: `Remove Event Listener from ${eventFieldName}`,
    do: (world: World) => {
      const ent = world.getEntity(sourceEntityId)
      if (!ent) return
      const comp = ent.getComponent(componentType) as any
      if (comp && comp[eventFieldName]) {
        const list = comp[eventFieldName].listeners
        if (index >= 0 && index < list.length) {
          removedListener = list.splice(index, 1)[0]
        }
      }
    },
    undo: (world: World) => {
      const ent = world.getEntity(sourceEntityId)
      if (!ent || !removedListener) return
      const comp = ent.getComponent(componentType) as any
      if (comp && comp[eventFieldName]) {
        comp[eventFieldName].listeners.splice(index, 0, removedListener)
      }
    },
  }
}
