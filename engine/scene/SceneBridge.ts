import * as THREE from 'three'
import { World } from '../ecs/World'
import { Entity } from '../ecs/Entity'
import { Component, Transform } from '../ecs/Component'
import {
  createLightObject,
  createMeshRendererMesh,
  disposeObject3D,
  materialContext,
  meshRendererMaterialSpec,
  RenderContext,
  applyMeshSize,
  createPrimitiveGeometry,
} from '../renderer/sceneFactory'
import { createMaterial, disposeMaterial } from '../materials/createMaterial'
import { ModelSpecSchema, ModelSpec } from '../model/ModelSpec'
import { buildModelObject } from '../model/buildModel'
import { AnimationPlayer } from '../animation/AnimationPlayer'

const MESH = '__mesh__'
const MODEL = '__model__'
const LIGHT = '__light__'

/**
 * Mirrors the ECS World into a three.js scene: one Group per entity carrying its Transform, with
 * the renderables built by engine/renderer/sceneFactory.ts (MeshRenderer, Model, Light).
 */
export class SceneBridge {
  private world: World
  private scene: THREE.Scene | null = null
  private objectMap: Map<string, THREE.Object3D> = new Map()
  private cleanupFns: (() => void)[] = []
  private ctx: RenderContext = {}
  /** glTF animation per entity (Model.src with clips) */
  private animators: Map<string, AnimationPlayer> = new Map()
  /** Bumped per entity so a slow glTF load does not attach to a newer Model */
  private modelTokens: Map<string, number> = new Map()

  constructor(world: World) {
    this.world = world
    this.bindEvents()
  }

  attach(scene: THREE.Scene, ctx: RenderContext = {}): void {
    this.scene = scene
    this.ctx = ctx

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
      obj.parent?.remove(obj)
      disposeObject3D(obj)
    }
    for (const anim of this.animators.values()) anim.detachMixer()
    this.animators.clear()
    this.objectMap.clear()
    this.scene = null
  }

  /** Advance glTF animations */
  update(dt: number): void {
    for (const anim of this.animators.values()) anim.advance(dt)
  }

  getAnimationPlayer(entityId: string): AnimationPlayer | undefined {
    return this.animators.get(entityId)
  }

  /**
   * Push every entity Transform to its Object3D. Game scripts mutate transforms
   * directly (entity.getTransform().position.x += ...), which emits no event.
   */
  syncTransforms(): void {
    for (const [id, obj] of this.objectMap) {
      const entity = this.world.getEntity(id)
      if (entity) this.applyTransformToGroup(obj, entity.getTransform())
    }
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

    this.removeChild(obj, MESH)
    this.removeModel(entity.id, obj)
    this.removeChild(obj, LIGHT)
    if (obj.parent) {
      obj.parent.remove(obj)
    }
    this.objectMap.delete(entity.id)
  }

  /** Remove and free a renderable child by name (child entity groups are left alone) */
  private removeChild(parent: THREE.Object3D, name: string): void {
    const child = parent.children.find((c) => c.name === name)
    if (!child) return
    parent.remove(child)
    disposeObject3D(child)
  }

  private removeModel(entityId: string, parent: THREE.Object3D): void {
    this.modelTokens.set(entityId, (this.modelTokens.get(entityId) ?? 0) + 1)
    this.animators.get(entityId)?.detachMixer()
    this.animators.delete(entityId)
    this.removeChild(parent, MODEL)
  }

  private warn(message: string): void {
    if (this.ctx.warn) this.ctx.warn(message)
    else console.warn(`[Linden] ${message}`)
  }

  private buildMesh(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return
    this.removeChild(parentObj, MESH)
    const mesh = createMeshRendererMesh(comp as any, this.ctx)
    mesh.userData.entityId = entity.id
    parentObj.add(mesh)
  }

  private buildModel(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return
    this.removeModel(entity.id, parentObj)
    const raw = comp as any
    const parsed = ModelSpecSchema.safeParse({
      parts: raw.parts,
      src: raw.src || undefined,
      merge: raw.merge,
      instances: raw.instances,
      collider: raw.collider,
      category: raw.category || undefined,
      placement: raw.placement,
      animation: raw.animation || undefined,
    })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      this.warn(`Model pada "${entity.name}" tidak valid: ${issue.path.join('.')} ${issue.message}`)
      return
    }
    const spec: ModelSpec = parsed.data
    const castShadow = raw.castShadow ?? true
    const receiveShadow = raw.receiveShadow ?? true

    if (!spec.src) {
      const obj = buildModelObject(spec, { ...materialContext(this.ctx), castShadow, receiveShadow })
      obj.userData.entityId = entity.id
      parentObj.add(obj)
      return
    }

    if (!this.ctx.assets) return // headless / no asset access: physics uses the stored bounds
    const token = this.modelTokens.get(entity.id) ?? 0
    this.ctx.assets.loadModel(spec.src).then(
      ({ root, animations }) => {
        if (this.modelTokens.get(entity.id) !== token || this.objectMap.get(entity.id) !== parentObj) return
        root.name = MODEL
        root.userData.entityId = entity.id
        root.traverse((o) => {
          o.castShadow = castShadow
          o.receiveShadow = receiveShadow
        })
        parentObj.add(root)
        if (animations.length > 0) {
          const player = new AnimationPlayer(`${entity.name}:animation`)
          player.attachMixer(root, animations)
          const clip = spec.animation ?? animations[0].name
          if (spec.animation && !player.getClipNames().includes(spec.animation)) {
            this.warn(`Animasi "${spec.animation}" tidak ada di ${spec.src}; tersedia: ${player.getClipNames().join(', ')}`)
          } else player.play(clip)
          this.animators.set(entity.id, player)
        }
      },
      (err) => this.warn(err.message)
    )
  }

  private buildLight(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return
    this.removeChild(parentObj, LIGHT)
    const light = createLightObject(comp as any)
    parentObj.add(light)
  }

  private handleComponentAdded(entity: Entity, comp: Component): void {
    if (!this.objectMap.has(entity.id)) return
    if (comp.name === 'MeshRenderer') this.buildMesh(entity, comp)
    else if (comp.name === 'Model') this.buildModel(entity, comp)
    else if (comp.name === 'Light') this.buildLight(entity, comp)
  }

  private handleComponentRemoved(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return
    if (comp.name === 'MeshRenderer') this.removeChild(parentObj, MESH)
    else if (comp.name === 'Model') this.removeModel(entity.id, parentObj)
    else if (comp.name === 'Light') this.removeChild(parentObj, LIGHT)
  }

  private handlePropertyChanged(entity: Entity, compType: string, path: string, value: any): void {
    const obj = this.objectMap.get(entity.id)
    if (!obj) return

    if (compType === 'Transform') {
      this.applyTransformToGroup(obj, entity.getTransform())
      return
    }
    const comp = entity.getComponent(compType)
    if (!comp) return

    if (compType === 'MeshRenderer') {
      const mesh = obj.children.find((c) => c.name === MESH) as THREE.Mesh | undefined
      if (!mesh) return this.buildMesh(entity, comp)
      const key = path.split('.')[0]
      if (key === 'isVisible') mesh.visible = Boolean(value)
      else if (key === 'castShadow') mesh.castShadow = Boolean(value)
      else if (key === 'receiveShadow') mesh.receiveShadow = Boolean(value)
      else if (key === 'size') applyMeshSize(mesh, (comp as any).size)
      else if (key === 'primitive') {
        mesh.geometry.dispose()
        mesh.geometry = createPrimitiveGeometry(value)
      } else if (key === 'material' || key === 'color' || key === 'roughness' || key === 'metalness') {
        // Material edits (Inspector sliders) swap only the material; three reuses the compiled program
        const old = mesh.material
        mesh.material = createMaterial(meshRendererMaterialSpec(comp as any), materialContext(this.ctx))
        disposeMaterial(old)
      } else this.buildMesh(entity, comp)
    } else if (compType === 'Model') {
      this.buildModel(entity, comp)
    } else if (compType === 'Light') {
      this.buildLight(entity, comp)
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

  dispose(): void {
    this.detach()
    for (const cleanup of this.cleanupFns) {
      cleanup()
    }
    this.cleanupFns = []
  }
}
