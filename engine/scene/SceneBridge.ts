import * as THREE from 'three'
import { World } from '../ecs/World'
import { Entity } from '../ecs/Entity'
import { Component, Transform } from '../ecs/Component'
import { MeshRenderer } from '../renderer/Components'

export class SceneBridge {
  private world: World
  private scene: THREE.Scene | null = null
  private objectMap: Map<string, THREE.Object3D> = new Map()
  private cleanupFns: (() => void)[] = []

  constructor(world: World) {
    this.world = world
    this.bindEvents()
  }

  attach(scene: THREE.Scene): void {
    this.scene = scene

    // Sync all existing entities in world
    for (const entity of this.world.getEntities()) {
      this.handleEntityAdded(entity)
      for (const comp of entity.getComponents()) {
        this.handleComponentAdded(entity, comp)
      }
    }
  }

  detach(): void {
    for (const obj of this.objectMap.values()) {
      this.disposeObject(obj)
    }
    this.objectMap.clear()
    this.scene = null
  }

  getObject(entityId: string): THREE.Object3D | undefined {
    return this.objectMap.get(entityId)
  }

  getEntityId(object: THREE.Object3D | null): string | null {
    let cur: THREE.Object3D | null = object
    while (cur) {
      if (cur.userData && cur.userData.entityId) {
        return cur.userData.entityId
      }
      cur = cur.parent
    }
    return null
  }

  private bindEvents(): void {
    const onEntityAdded = (entity: Entity) => this.handleEntityAdded(entity)
    const onEntityRemoved = (entity: Entity) => this.handleEntityRemoved(entity)
    const onComponentAdded = (entity: Entity, comp: Component) => this.handleComponentAdded(entity, comp)
    const onComponentRemoved = (entity: Entity, comp: Component) => this.handleComponentRemoved(entity, comp)
    const onPropertyChanged = (entity: Entity, compType: string, path: string, val: any) =>
      this.handlePropertyChanged(entity, compType, path, val)
    const onParentChanged = (entity: Entity, oldPid: string | null, newPid: string | null, keepWorld: boolean = false) =>
      this.handleParentChanged(entity, oldPid, newPid, keepWorld)

    this.cleanupFns.push(
      this.world.events.on('entityAdded', onEntityAdded),
      this.world.events.on('entityRemoved', onEntityRemoved),
      this.world.events.on('componentAdded', onComponentAdded),
      this.world.events.on('componentRemoved', onComponentRemoved),
      this.world.events.on('propertyChanged', onPropertyChanged),
      this.world.events.on('parentChanged', onParentChanged)
    )
  }

  private handleEntityAdded(entity: Entity): void {
    if (this.objectMap.has(entity.id)) return

    const group = new THREE.Group()
    group.name = entity.name
    group.userData.entityId = entity.id

    this.applyTransformToGroup(group, entity.getTransform())

    this.objectMap.set(entity.id, group)

    if (this.scene) {
      if (entity.parentId && this.objectMap.has(entity.parentId)) {
        this.objectMap.get(entity.parentId)!.add(group)
      } else {
        this.scene.add(group)
      }
    }
  }

  private handleEntityRemoved(entity: Entity): void {
    const obj = this.objectMap.get(entity.id)
    if (!obj) return

    this.disposeObject(obj)
    if (obj.parent) {
      obj.parent.remove(obj)
    }
    this.objectMap.delete(entity.id)
  }

  private handleComponentAdded(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return

    if (comp.name === 'MeshRenderer') {
      const mr = comp as any
      // Remove any existing mesh child
      const existingMesh = parentObj.getObjectByName('__mesh__')
      if (existingMesh) {
        parentObj.remove(existingMesh)
        this.disposeObject(existingMesh)
      }

      const geom = this.createGeometry(mr.primitive || 'box')
      const mat = new THREE.MeshStandardMaterial({
        color: mr.color || '#3b82f6',
        roughness: mr.roughness ?? 0.5,
        metalness: mr.metalness ?? 0.1,
      })
      const mesh = new THREE.Mesh(geom, mat)
      mesh.name = '__mesh__'
      mesh.userData.entityId = entity.id
      mesh.castShadow = mr.castShadow ?? true
      mesh.receiveShadow = mr.receiveShadow ?? true
      mesh.visible = mr.isVisible ?? true

      parentObj.add(mesh)
    }
  }

  private handleComponentRemoved(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return

    if (comp.name === 'MeshRenderer') {
      const mesh = parentObj.getObjectByName('__mesh__')
      if (mesh) {
        parentObj.remove(mesh)
        this.disposeObject(mesh)
      }
    }
  }

  private handlePropertyChanged(entity: Entity, compType: string, path: string, value: any): void {
    const obj = this.objectMap.get(entity.id)
    if (!obj) return

    if (compType === 'Transform') {
      const transform = entity.getTransform()
      this.applyTransformToGroup(obj, transform)
    } else if (compType === 'MeshRenderer') {
      const mesh = obj.getObjectByName('__mesh__') as THREE.Mesh | undefined
      if (!mesh) {
        this.handleComponentAdded(entity, entity.getComponent('MeshRenderer')!)
        return
      }

      const mr = entity.getComponent('MeshRenderer') as any
      if (path.startsWith('color') && mesh.material instanceof THREE.MeshStandardMaterial) {
        mesh.material.color.set(value)
      } else if (path.startsWith('roughness') && mesh.material instanceof THREE.MeshStandardMaterial) {
        mesh.material.roughness = Number(value)
      } else if (path.startsWith('metalness') && mesh.material instanceof THREE.MeshStandardMaterial) {
        mesh.material.metalness = Number(value)
      } else if (path.startsWith('isVisible')) {
        mesh.visible = Boolean(value)
      } else if (path.startsWith('primitive')) {
        mesh.geometry.dispose()
        mesh.geometry = this.createGeometry(value)
      }
    }
  }

  private handleParentChanged(entity: Entity, _oldParentId: string | null, newParentId: string | null, keepWorldTransform: boolean): void {
    const obj = this.objectMap.get(entity.id)
    if (!obj || !this.scene) return

    const newParentObj = newParentId ? this.objectMap.get(newParentId) || this.scene : this.scene

    if (keepWorldTransform) {
      if (this.scene) {
        this.scene.updateMatrixWorld(true)
      }
      newParentObj.attach(obj)
      // Sync local transform back to entity Transform component
      const transform = entity.getTransform()
      transform.position = { x: obj.position.x, y: obj.position.y, z: obj.position.z }
      transform.rotation = {
        x: THREE.MathUtils.radToDeg(obj.rotation.x),
        y: THREE.MathUtils.radToDeg(obj.rotation.y),
        z: THREE.MathUtils.radToDeg(obj.rotation.z),
      }
      transform.scale = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
    } else {
      newParentObj.add(obj)
      this.applyTransformToGroup(obj, entity.getTransform())
    }
  }

  private applyTransformToGroup(group: THREE.Object3D, transform: Transform): void {
    group.position.set(transform.position.x, transform.position.y, transform.position.z)
    group.rotation.set(
      THREE.MathUtils.degToRad(transform.rotation.x),
      THREE.MathUtils.degToRad(transform.rotation.y),
      THREE.MathUtils.degToRad(transform.rotation.z)
    )
    group.scale.set(transform.scale.x, transform.scale.y, transform.scale.z)
  }

  private createGeometry(primitive: string): THREE.BufferGeometry {
    switch (primitive.toLowerCase()) {
      case 'box':
      case 'cube':
        return new THREE.BoxGeometry(1, 1, 1)
      case 'sphere':
        return new THREE.SphereGeometry(0.5, 32, 16)
      case 'cylinder':
        return new THREE.CylinderGeometry(0.5, 0.5, 2, 32)
      case 'capsule':
        return new THREE.CapsuleGeometry(0.5, 1, 16, 32)
      case 'plane':
        return new THREE.PlaneGeometry(1, 1)
      case 'torus':
        return new THREE.TorusGeometry(0.5, 0.2, 16, 32)
      default:
        return new THREE.BoxGeometry(1, 1, 1)
    }
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        if (mesh.geometry) {
          mesh.geometry.dispose()
        }
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose())
          } else {
            mesh.material.dispose()
          }
        }
      }
    })
  }

  dispose(): void {
    this.detach()
    for (const cleanup of this.cleanupFns) {
      cleanup()
    }
    this.cleanupFns = []
  }
}
