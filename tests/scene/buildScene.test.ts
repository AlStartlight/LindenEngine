import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createPrimitiveMesh, buildSceneFromData } from '../../engine/scene/buildScene'
import { SceneFile } from '../../engine/scene/SceneSchema'

describe('buildScene', () => {
  it('creates primitive mesh with correct transform in degrees converted to radians', () => {
    const mesh = createPrimitiveMesh({
      id: 'cube-1',
      name: 'Test Cube',
      parentId: null,
      kind: 'primitive',
      primitive: 'box',
      transform: {
        position: [2, 3, 4],
        rotation: [0, 90, 0],
        scale: [1, 2, 3],
      },
      material: {
        color: '#ff0000',
        roughness: 0.25,
        metalness: 0.75,
      },
      castShadow: true,
      receiveShadow: true,
      visible: true,
    })

    expect(mesh.position.x).toBe(2)
    expect(mesh.position.y).toBe(3)
    expect(mesh.position.z).toBe(4)
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(mesh.scale.x).toBe(1)
    expect(mesh.scale.y).toBe(2)
    expect(mesh.scale.z).toBe(3)
    expect(mesh.userData.id).toBe('cube-1')
    expect(mesh.userData.name).toBe('Test Cube')
    expect(mesh.userData.selectable).toBe(true)
    expect(mesh.userData.type).toBe('primitive')
    expect(mesh.userData.primitive).toBe('box')
    expect(mesh.castShadow).toBe(true)
    expect(mesh.receiveShadow).toBe(true)
    expect(mesh.visible).toBe(true)
  })

  it('buildSceneFromData attaches meshes and sets up parent-child relationships', () => {
    const scene = new THREE.Scene()
    const sceneData: SceneFile = {
      format: 'linden-scene',
      version: 1,
      name: 'TestHierarchy',
      camera: { position: [10, 10, 10], target: [0, 0, 0] },
      objects: [
        {
          id: 'parent',
          name: 'Parent Object',
          parentId: null,
          kind: 'primitive',
          primitive: 'box',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          material: { color: '#ffffff', roughness: 0.5, metalness: 0.5 },
          castShadow: true,
          receiveShadow: true,
          visible: true,
        },
        {
          id: 'child',
          name: 'Child Object',
          parentId: 'parent',
          kind: 'primitive',
          primitive: 'sphere',
          transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          material: { color: '#ffff00', roughness: 0.5, metalness: 0.5 },
          castShadow: true,
          receiveShadow: true,
          visible: true,
        },
      ],
    }

    const objectsMap = buildSceneFromData(scene, sceneData)
    expect(objectsMap.size).toBe(2)

    const parentMesh = objectsMap.get('parent')
    const childMesh = objectsMap.get('child')

    expect(parentMesh).toBeDefined()
    expect(childMesh).toBeDefined()

    // Parent is added to scene
    expect(parentMesh?.parent).toBe(scene)

    // Child is added to parent
    expect(childMesh?.parent).toBe(parentMesh)
  })
})
