import * as THREE from 'three'
import { SceneFile, SceneFileV1, SceneObjectDataV1 } from './SceneSchema'
import { createMeshRendererMesh, RenderContext } from '../renderer/sceneFactory'
import { migrateSceneV1ToV2, V1_PRIMITIVE_SIZES } from './migrations'
import { World } from '../ecs/World'
import { SceneSerializer } from './serializer'
import { SceneBridge } from './SceneBridge'
import '../ecs/ComponentRegistry'

/**
 * A single v1 object as a mesh (legacy helper). Geometry comes from sceneFactory; the v1 size is
 * baked into the geometry so the mesh scale stays the object's own scale.
 */
export function createPrimitiveMesh(obj: SceneObjectDataV1): THREE.Mesh {
  const mesh = createMeshRendererMesh({ primitive: obj.primitive, ...obj.material, castShadow: obj.castShadow, receiveShadow: obj.receiveShadow, isVisible: obj.visible })
  const [sx, sy, sz] = V1_PRIMITIVE_SIZES[obj.primitive] ?? [1, 1, 1]
  mesh.geometry.scale(sx, sy, sz)
  mesh.name = obj.name
  mesh.position.fromArray(obj.transform.position)
  mesh.rotation.set(
    THREE.MathUtils.degToRad(obj.transform.rotation[0]),
    THREE.MathUtils.degToRad(obj.transform.rotation[1]),
    THREE.MathUtils.degToRad(obj.transform.rotation[2])
  )
  mesh.scale.fromArray(obj.transform.scale)
  mesh.userData = { id: obj.id, name: obj.name, selectable: true, type: 'primitive', primitive: obj.primitive }
  return mesh
}

/**
 * Build a scene file (v2, or v1 migrated) into a three.js scene through the same World +
 * SceneBridge path as the editor and the player. Returns the entity groups by id.
 */
export function buildSceneFromData(scene: THREE.Scene, data: SceneFile | SceneFileV1, ctx: RenderContext = {}): Map<string, THREE.Object3D> {
  const v2 = data.version === 1 ? migrateSceneV1ToV2(data) : data
  const world = new World()
  SceneSerializer.deserialize(JSON.stringify(v2), world)
  const bridge = new SceneBridge(world)
  bridge.attach(scene, ctx)
  const map = new Map<string, THREE.Object3D>()
  for (const e of world.getEntities()) {
    const obj = bridge.getObject(e.id)
    if (obj) map.set(e.id, obj)
  }
  return map
}
