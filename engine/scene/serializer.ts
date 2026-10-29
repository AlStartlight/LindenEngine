import { World } from '../ecs/World'
import { Entity } from '../ecs/Entity'
import { Component } from '../ecs/Component'
import { ComponentRegistry } from '../ecs/ComponentRegistry'
import { normalizeSceneSettings, SceneSettings } from './SceneSettings'
import { migrateSceneV1ToV2 } from './migrations'

export interface SerializedComponent {
  type: string
  data: Record<string, any>
}

export interface SerializedEntity {
  id: string
  name: string
  active: boolean
  static: boolean
  tags: string[]
  layer: number
  parentId: string | null
  prefab?: any
  components: SerializedComponent[]
}

export interface SceneV2Data {
  format: 'linden-scene'
  version: 2
  name: string
  /** Render settings, see SceneSettings.ts (unknown keys such as touchLayout are kept) */
  settings?: Partial<SceneSettings> & Record<string, unknown>
  entities: SerializedEntity[]
}

export { migrateSceneV1ToV2 }

/**
 * Deterministically sorts object keys for Git-friendly JSON output
 */
export function stableStringify(obj: any, space = 2): string {
  const allKeys = new Set<string>()
  JSON.stringify(obj, (key, value) => {
    allKeys.add(key)
    return value
  })

  function sortObject(val: any): any {
    if (val === null || typeof val !== 'object') {
      return val
    }
    if (Array.isArray(val)) {
      return val.map(sortObject)
    }
    const sorted: Record<string, any> = {}
    const keys = Object.keys(val).sort()
    for (const k of keys) {
      sorted[k] = sortObject(val[k])
    }
    return sorted
  }

  return JSON.stringify(sortObject(obj), null, space)
}

/**
 * Scene Serializer v2
 */
export class SceneSerializer {
  static serialize(world: World, sceneName: string = 'Untitled'): string {
    const orderedEntities = world.getEntitiesInHierarchyOrder()
    const serializedEntities: SerializedEntity[] = []

    for (const entity of orderedEntities) {
      const components: SerializedComponent[] = []

      for (const comp of entity.getComponents()) {
        const data: Record<string, any> = {}
        for (const [key, val] of Object.entries(comp)) {
          if (
            key === 'name' ||
            key === 'entityId' ||
            typeof val === 'function' ||
            key.startsWith('_') ||
            key === 'worldGetter'
          ) {
            continue
          }

          // Handle EventField
          if (val && typeof (val as any).listeners !== 'undefined') {
            data[key] = (val as any).listeners
          } else if (val && typeof val === 'object') {
            data[key] = JSON.parse(JSON.stringify(val))
          } else {
            data[key] = val
          }
        }

        components.push({
          type: comp.name,
          data,
        })
      }

      serializedEntities.push({
        id: entity.id,
        name: entity.name,
        active: entity.active,
        static: entity.isStatic,
        tags: [...entity.tags],
        layer: entity.layer,
        parentId: entity.parentId,
        prefab: entity.prefab ? JSON.parse(JSON.stringify(entity.prefab)) : undefined,
        components,
      })
    }

    const sceneData: SceneV2Data = {
      format: 'linden-scene',
      version: 2,
      name: sceneName,
      settings: structuredClone(world.getSceneSettings()),
      entities: serializedEntities,
    }

    return stableStringify(sceneData)
  }

  static deserialize(jsonString: string, world: World): { name: string; version: number } {
    let parsed: any
    try {
      parsed = JSON.parse(jsonString)
    } catch (e: any) {
      throw new Error(`INVALID_JSON: ${e.message}`)
    }

    if (parsed.format !== 'linden-scene') {
      throw new Error('SCHEMA_INVALID: Not a linden-scene format')
    }

    let sceneData: SceneV2Data
    if (parsed.version === 1) {
      sceneData = migrateSceneV1ToV2(parsed)
    } else if (parsed.version === 2) {
      sceneData = parsed
    } else {
      throw new Error(`FUTURE_VERSION: Unsupported scene version ${parsed.version}`)
    }

    world.clear()
    const { settings, warnings } = normalizeSceneSettings(sceneData.settings)
    for (const w of warnings) console.warn(`[Scene] ${w}`)
    world.setSceneSettings(settings, true)

    // Pass 1: Create all entities with their IDs and properties
    for (const entData of sceneData.entities) {
      const entity = new Entity(entData.name, entData.id)
      entity.active = entData.active ?? true
      entity.isStatic = entData.static ?? false
      entity.tags = entData.tags ? [...entData.tags] : []
      entity.layer = entData.layer ?? 0
      entity.parentId = entData.parentId || null
      if (entData.prefab) {
        entity.prefab = JSON.parse(JSON.stringify(entData.prefab))
      }

      world.addEntity(entity)

      // Add components
      for (const compData of entData.components) {
        if (compData.type === 'Transform') {
          const t = entity.getTransform()
          if (compData.data) {
            if (compData.data.position) {
              const p = compData.data.position
              t.position = Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { ...p }
            }
            if (compData.data.rotation) {
              const r = compData.data.rotation
              t.rotation = Array.isArray(r) ? { x: r[0], y: r[1], z: r[2] } : { ...r }
            }
            if (compData.data.scale) {
              const s = compData.data.scale
              t.scale = Array.isArray(s) ? { x: s[0], y: s[1], z: s[2] } : { ...s }
            }
          }
        } else {
          // Scenes saved before a component was removed (Blueprint, Animator) still open; the data is
          // kept as an inert component so a resave does not lose it
          if (!ComponentRegistry.get(compData.type)) {
            console.warn(`[Scene] Komponen tidak dikenal "${compData.type}" pada entity "${entData.name}" diabaikan`)
          }
          try {
            world.addComponent(entity.id, compData.type, compData.data)
          } catch (_) {
            // Missing script or unknown component: retain data as generic placeholder
            const missingComp = new (class extends Component {
              public missingType: string
              public rawData: Record<string, any>
              constructor(type: string, data: Record<string, any>) {
                super(type)
                this.missingType = type
                this.rawData = data
                Object.assign(this, data)
              }
              clone() {
                return new (this.constructor as any)(this.missingType, this.rawData)
              }
            })(compData.type, compData.data)
            entity.addComponent(missingComp)
          }
        }
      }
    }

    // Pass 2: Reconstruct parent-child relations
    for (const entData of sceneData.entities) {
      if (entData.parentId) {
        const parent = world.getEntity(entData.parentId)
        if (parent && !parent.childIds.includes(entData.id)) {
          parent.childIds.push(entData.id)
        }
      }
    }

    return {
      name: sceneData.name,
      version: sceneData.version,
    }
  }
}
