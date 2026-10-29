import type { SceneV2Data, SerializedComponent, SerializedEntity } from './serializer'
import { DEFAULT_SCENE_SETTINGS } from './SceneSettings'

/**
 * Bounding size of each v1 primitive. v1 scenes (SceneSchema v1, the old editor format) used
 * these sizes; v2 primitives are 1 m (engine/renderer/primitives.ts). Migration stores the
 * difference in MeshRenderer.size, a mesh-only scale, so objects keep their size and child
 * objects are not scaled with them.
 */
export const V1_PRIMITIVE_SIZES: Record<string, [number, number, number]> = {
  box: [2, 2, 2],
  sphere: [2, 2, 2],
  cylinder: [1, 3, 1],
  // v1 torus: radius 1, tube 0.4 → 2.8 across, 0.8 thick; v2 torus is 1 across, 0.25 thick
  torus: [2.8, 2.8, 3.2],
  cone: [2, 2, 2],
  plane: [2, 2, 1],
}

/** Migrate Scene v1 format (objects + camera) to v2 (entities + components + settings) */
export function migrateSceneV1ToV2(v1Data: any): SceneV2Data {
  const entities: SerializedEntity[] = []

  if (Array.isArray(v1Data.objects)) {
    for (const obj of v1Data.objects) {
      const components: SerializedComponent[] = []

      if (obj.transform) {
        components.push({
          type: 'Transform',
          data: {
            position: obj.transform.position || [0, 0, 0],
            rotation: obj.transform.rotation || [0, 0, 0],
            scale: obj.transform.scale || [1, 1, 1],
          },
        })
      }

      if (obj.kind === 'primitive' || obj.primitive || obj.material) {
        const primitive = obj.primitive || 'box'
        components.push({
          type: 'MeshRenderer',
          data: {
            primitive,
            size: V1_PRIMITIVE_SIZES[primitive] ?? [1, 1, 1],
            color: obj.material?.color || '#3b82f6',
            roughness: obj.material?.roughness ?? 0.5,
            metalness: obj.material?.metalness ?? 0.1,
            castShadow: obj.castShadow ?? true,
            receiveShadow: obj.receiveShadow ?? true,
            isVisible: obj.visible ?? true,
          },
        })
      }

      entities.push({
        id: obj.id,
        name: obj.name || 'GameObject',
        active: obj.visible ?? true,
        static: false,
        tags: [],
        layer: 0,
        parentId: obj.parentId || null,
        components,
      })
    }
  }

  return {
    format: 'linden-scene',
    version: 2,
    name: v1Data.name || 'MigratedScene',
    settings: {
      ...structuredClone(DEFAULT_SCENE_SETTINGS),
      // The v1 editor camera, kept so the editor can restore the view
      ...(v1Data.camera ? { editorCamera: v1Data.camera } : {}),
    },
    entities,
  }
}
