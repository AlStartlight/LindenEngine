import * as THREE from 'three'
import { SceneFile, SceneObjectData } from './SceneSchema'

export function createPrimitiveGeometry(primitive: SceneObjectData['primitive']): THREE.BufferGeometry {
  switch (primitive) {
    case 'box':
      return new THREE.BoxGeometry(2, 2, 2)
    case 'sphere':
      return new THREE.SphereGeometry(1, 32, 32)
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 3, 32)
    case 'torus':
      return new THREE.TorusGeometry(1, 0.4, 16, 100)
    case 'cone':
      return new THREE.ConeGeometry(1, 2, 32)
    case 'plane':
      return new THREE.PlaneGeometry(2, 2)
  }
}

export function createPrimitiveMesh(obj: SceneObjectData): THREE.Mesh {
  const geometry = createPrimitiveGeometry(obj.primitive)
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(obj.material.color),
    roughness: obj.material.roughness,
    metalness: obj.material.metalness,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = obj.name

  mesh.position.set(
    obj.transform.position[0],
    obj.transform.position[1],
    obj.transform.position[2]
  )

  mesh.rotation.set(
    THREE.MathUtils.degToRad(obj.transform.rotation[0]),
    THREE.MathUtils.degToRad(obj.transform.rotation[1]),
    THREE.MathUtils.degToRad(obj.transform.rotation[2])
  )

  mesh.scale.set(
    obj.transform.scale[0],
    obj.transform.scale[1],
    obj.transform.scale[2]
  )

  mesh.castShadow = obj.castShadow
  mesh.receiveShadow = obj.receiveShadow
  mesh.visible = obj.visible

  mesh.userData = {
    id: obj.id,
    name: obj.name,
    selectable: true,
    type: 'primitive',
    primitive: obj.primitive,
  }

  return mesh
}

export function buildSceneFromData(scene: THREE.Scene, data: SceneFile): Map<string, THREE.Object3D> {
  const objectsMap = new Map<string, THREE.Object3D>()

  // 1. Create all meshes
  for (const objData of data.objects) {
    const mesh = createPrimitiveMesh(objData)
    objectsMap.set(objData.id, mesh)
  }

  // 2. Add to scene or parent
  for (const objData of data.objects) {
    const mesh = objectsMap.get(objData.id)!
    if (objData.parentId && objectsMap.has(objData.parentId)) {
      const parent = objectsMap.get(objData.parentId)!
      parent.add(mesh)
    } else {
      scene.add(mesh)
    }
  }

  return objectsMap
}
