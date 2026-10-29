import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { migrateSceneV1ToV2, V1_PRIMITIVE_SIZES } from '../../engine/scene/migrations'
import { parseSceneFile } from '../../engine/scene/parseSceneFile'
import { buildSceneFromData } from '../../engine/scene/buildScene'
import { SceneFileSchema } from '../../engine/scene/SceneSchema'
import { World } from '../../engine/ecs/World'
import { SceneSerializer } from '../../engine/scene/serializer'
import { DEFAULT_SCENE_SETTINGS } from '../../engine/scene/SceneSettings'
import '../../engine/ecs/ComponentRegistry'

const v1 = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/valid-hierarchy.lscene'), 'utf-8'))

describe('scene migration v1 → v2', () => {
  it('produces a valid v2 scene with default render settings', () => {
    const v2 = migrateSceneV1ToV2(v1)
    expect(v2.version).toBe(2)
    expect(SceneFileSchema.safeParse(v2).success).toBe(true)
    expect(v2.settings).toMatchObject({ environment: DEFAULT_SCENE_SETTINGS.environment, toneMapping: DEFAULT_SCENE_SETTINGS.toneMapping })
  })

  it('keeps every object, parent, transform and material', () => {
    const v2 = migrateSceneV1ToV2(v1)
    expect(v2.entities.map((e) => e.id)).toEqual(v1.objects.map((o: any) => o.id))
    v1.objects.forEach((o: any, i: number) => {
      const e = v2.entities[i]
      expect(e.parentId).toBe(o.parentId ?? null)
      const t = e.components.find((c) => c.type === 'Transform')!.data
      expect(t).toEqual({ position: o.transform.position, rotation: o.transform.rotation, scale: o.transform.scale })
      const mr = e.components.find((c) => c.type === 'MeshRenderer')!.data
      expect(mr).toMatchObject({ primitive: o.primitive, color: o.material.color, roughness: o.material.roughness, metalness: o.material.metalness })
    })
  })

  it('objects keep their v1 world size although v2 primitives are 1 m', () => {
    for (const [primitive, size] of Object.entries(V1_PRIMITIVE_SIZES)) {
      const scene = { format: 'linden-scene', version: 1, name: 'S', camera: { position: [1, 1, 1], target: [0, 0, 0] }, objects: [{ id: 'o', name: 'O', parentId: null, kind: 'primitive', primitive, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: { color: '#ffffff', roughness: 0.5, metalness: 0 } }] }
      const res = parseSceneFile(JSON.stringify(scene))
      expect(res.ok).toBe(true)
      const obj = buildSceneFromData(new THREE.Scene(), (res as any).scene).get('o')!
      obj.updateMatrixWorld(true)
      const s = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3())
      // Same bounding size as the old v1 geometry (torus: within the tube approximation)
      const g = { box: [2, 2, 2], sphere: [2, 2, 2], cylinder: [1, 3, 1], torus: [2.8, 2.8, 0.8], cone: [2, 2, 2], plane: [2, 2, 0] }[primitive]!
      expect(s.x, primitive).toBeCloseTo(g[0], 2)
      expect(s.y, primitive).toBeCloseTo(g[1], 2)
      expect(s.z, primitive).toBeCloseTo(g[2], 2)
      expect(size).toBeDefined()
    }
  })

  it('migrated scenes survive a save/load round trip unchanged', () => {
    const world = new World()
    SceneSerializer.deserialize(JSON.stringify(v1), world)
    const saved = SceneSerializer.serialize(world, 'Hier')
    const again = new World()
    SceneSerializer.deserialize(saved, again)
    expect(SceneSerializer.serialize(again, 'Hier')).toBe(saved)
    expect(JSON.parse(saved).settings.editorCamera).toEqual(v1.camera)
  })
})
