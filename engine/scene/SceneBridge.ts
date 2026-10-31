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
  createEditableMeshObject,
  editableMeshGeometry,
  EDITABLE_MESH,
} from '../renderer/sceneFactory'
import { createMaterial, disposeMaterial } from '../materials/createMaterial'
import type { EditableMesh } from '../mesh/EditableMeshComponent'
import { toLindenMesh } from '../mesh/core/convert'
import { editablePrimitive, scaleMesh } from '../mesh/core/editablePrimitives'
import { decodeHalfEdgeMesh, encodeHalfEdgeMesh } from '../mesh/core/encoding'
import type { HalfEdgeMesh } from '../mesh/core/HalfEdgeMesh'
import type { LindenMesh } from '../mesh/core/LindenMesh'
import { canonicalJson, hashKey, modifierCacheKey, ModifierStack, parseModifiers } from '../mesh/modeling/modifiers'
import { normalizePrimitive } from '../renderer/primitives'
import { ModelSpecSchema, ModelSpec } from '../model/ModelSpec'
import { buildModelObject } from '../model/buildModel'
import { AnimationPlayer } from '../animation/AnimationPlayer'
import { WATER, createPlainWater, createWaterObject, sunDirection, updateWater } from '../renderer/water'
import { createParticleSystem, ParticleSystem } from '../vfx/particleRenderer'
import type { ParticleEmitter } from '../vfx/ParticleEmitter'

const MESH = '__mesh__'
const MODEL = '__model__'
const LIGHT = '__light__'

/**
 * Mirrors the ECS World into a three.js scene: one Group per entity carrying its Transform, with
 * the renderables built by engine/renderer/sceneFactory.ts (MeshRenderer, Model, Light) and
 * engine/renderer/water.ts (Water) and engine/vfx (ParticleEmitter).
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
  /** Water surface per entity; bumped tokens drop a reflective build that finished too late */
  private waters: Map<string, THREE.Mesh> = new Map()
  private waterTokens: Map<string, number> = new Map()
  /** Async builds (reflective water) still running; see whenIdle */
  private pending: Set<Promise<unknown>> = new Set()
  private sun = new THREE.Vector3()
  private particles: Map<string, ParticleSystem> = new Map()
  private particleTokens: Map<string, number> = new Map()
  /** Editor: only emitters passing the filter simulate (selected entities); null = all */
  private particleFilter: ((entityId: string) => boolean) | null = null

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
    for (const id of this.waters.keys()) this.waterTokens.set(id, (this.waterTokens.get(id) ?? 0) + 1)
    this.waters.clear()
    for (const id of [...this.particles.keys()]) this.removeParticles(id)
    this.objectMap.clear()
    this.scene = null
  }

  /** Advance glTF animations and water waves */
  update(dt: number): void {
    for (const anim of this.animators.values()) anim.advance(dt)
    if (this.waters.size > 0) {
      const sun = sunDirection(this.scene, this.sun)
      for (const mesh of this.waters.values()) updateWater(mesh, dt, sun)
    }
    for (const [id, system] of this.particles) {
      const shown = !this.particleFilter || this.particleFilter(id)
      system.object.visible = shown
      if (!shown) continue
      if (system.update(dt)) system.emitter.onFinished.emit(this.world.getEntity(id))
    }
  }

  /** Editor viewport: simulate only these emitters (e.g. the selection); null simulates all */
  setParticlePreview(filter: ((entityId: string) => boolean) | null): void {
    this.particleFilter = filter
  }

  /** Simulate every emitter ahead so a still preview is not empty */
  prewarmParticles(seconds: number): void {
    for (const system of this.particles.values()) system.prewarm(seconds)
  }

  getParticleSystem(entityId: string): ParticleSystem | undefined {
    return this.particles.get(entityId)
  }

  /** Resolves once async renderables (reflective water) are built; previews await it before rendering */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
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

  /** Rebuilds an entity's EditableMesh from its component (used when leaving Edit Mode) */
  rebuildEditableMesh(entityId: string): void {
    const entity = this.world.getEntity(entityId)
    const comp = entity?.getComponent('EditableMesh')
    if (entity && comp) this.buildEditableMesh(entity, comp)
  }

  /** Drops an entity's modifier state; a pending evaluation sees the new token and is discarded */
  private forgetEditableMesh(id: string): void {
    this.editableBuild.set(id, (this.editableBuild.get(id) ?? 0) + 1)
    this.modifierStacks.delete(id)
  }

  private handleEntityRemoved(entity: Entity): void {
    this.forgetEditableMesh(entity.id)
    const obj = this.objectMap.get(entity.id)
    if (!obj) return

    this.removeChild(obj, MESH)
    this.removeModel(entity.id, obj)
    this.removeChild(obj, LIGHT)
    this.removeWater(entity.id, obj)
    this.removeParticles(entity.id)
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

  private removeWater(entityId: string, parent: THREE.Object3D): void {
    this.waterTokens.set(entityId, (this.waterTokens.get(entityId) ?? 0) + 1)
    this.waters.delete(entityId)
    this.removeChild(parent, WATER)
  }

  private buildWater(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return
    this.removeWater(entity.id, parentObj)
    const water = comp as any
    // The plain plane shows at once; the reflective shader replaces it when its chunk has loaded
    const plain = createPlainWater(water)
    plain.userData.entityId = entity.id
    parentObj.add(plain)
    this.waters.set(entity.id, plain)
    if (water.reflections === false || this.ctx.caps?.waterReflections === false) return

    const token = this.waterTokens.get(entity.id) ?? 0
    const job = createWaterObject(water, { backend: this.ctx.backend, allowReflections: this.ctx.caps?.waterReflections }).then(
      (mesh) => {
        if (this.waterTokens.get(entity.id) !== token || this.objectMap.get(entity.id) !== parentObj) {
          disposeObject3D(mesh)
          return
        }
        this.removeChild(parentObj, WATER)
        mesh.userData.entityId = entity.id
        parentObj.add(mesh)
        this.waters.set(entity.id, mesh)
      },
      (err) => this.warn(`Water pada "${entity.name}": ${err?.message ?? err}`)
    )
    this.pending.add(job)
    job.finally(() => this.pending.delete(job))
  }

  private removeParticles(entityId: string): void {
    this.particleTokens.set(entityId, (this.particleTokens.get(entityId) ?? 0) + 1)
    this.particles.get(entityId)?.dispose()
    this.particles.delete(entityId)
  }

  private buildParticles(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return
    this.removeParticles(entity.id)
    const token = this.particleTokens.get(entity.id) ?? 0
    const attach = (system: ParticleSystem) => {
      if (this.particleTokens.get(entity.id) !== token || this.objectMap.get(entity.id) !== parentObj) {
        system.dispose()
        return
      }
      parentObj.add(system.object)
      this.particles.set(entity.id, system)
    }
    const created = createParticleSystem(comp as ParticleEmitter, {
      backend: this.ctx.backend,
      maxParticlesCap: this.ctx.caps?.maxParticlesPerEmitter,
      allowLights: this.ctx.caps?.particleLights,
      loadTexture: materialContext(this.ctx).loadTexture,
    })
    if (!(created instanceof Promise)) return attach(created)
    const job = created.then(attach, (err) => this.warn(`ParticleEmitter pada "${entity.name}": ${err?.message ?? err}`))
    this.pending.add(job)
    job.finally(() => this.pending.delete(job))
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

  /** Per-entity modifier stacks (editor) and build tokens that let stale async results be dropped */
  private modifierStacks = new Map<string, ModifierStack>()
  private editableBuild = new Map<string, number>()

  private buildEditableMesh(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return
    const token = (this.editableBuild.get(entity.id) ?? 0) + 1
    this.editableBuild.set(entity.id, token)
    const data = comp as unknown as EditableMesh
    const shading = data.shading === 'smooth' ? 'smooth' : 'flat'
    const warn = (m: string) => this.warn(`${m} pada "${entity.name}"`)

    const modifiers = parseModifiers(data.modifiers)
    if (!modifiers.ok) warn(`EditableMesh modifiers: ${modifiers.message}`)
    const specs = modifiers.ok ? modifiers.value : []
    const operands = new Map<string, { mesh: LindenMesh; version: string }>()
    for (const m of specs) {
      if (m.type !== 'boolean' || m.enabled === false || operands.has(m.operand)) continue
      const op = this.resolveOperand(entity, m.operand)
      if (op) operands.set(m.operand, op)
    }
    const key = specs.length ? modifierCacheKey(data.mesh, specs, [...operands.entries()].map(([id, o]) => `${id}:${o.version}`)) : ''

    // What to show right away: the cached modifier result when it is current, else the base mesh
    const cached = specs.length && data.modifierCache?.key === key ? decodeHalfEdgeMesh(data.modifierCache.mesh) : null
    this.removeChild(parentObj, EDITABLE_MESH)
    const shown = cached?.ok
      ? createEditableMeshObject({ ...data, mesh: data.modifierCache!.mesh }, this.ctx, warn)
      : createEditableMeshObject(data as unknown as Record<string, unknown>, this.ctx, warn)
    shown.userData.entityId = entity.id
    parentObj.add(shown)
    if (!specs.length || cached?.ok) return

    const geometry = this.ctx.geometry
    if (!geometry) {
      warn('EditableMesh: modifier results are out of date (open the scene in the editor to update them); showing the base mesh')
      return
    }
    const base = decodeHalfEdgeMesh(data.mesh)
    if (!base.ok) return
    let stack = this.modifierStacks.get(entity.id)
    if (!stack) {
      stack = new ModifierStack()
      this.modifierStacks.set(entity.id, stack)
    }
    const job = stack.evaluate(base.value, hashKey(canonicalJson(data.mesh)), specs, {
      geometry, resolveOperand: (id) => operands.get(id) ?? null,
    }).then((r) => {
      if (this.editableBuild.get(entity.id) !== token) return // a newer build replaced this one
      if (!r.ok) {
        warn(`EditableMesh: ${r.message}`)
        return
      }
      // Derived data: stored on the component without an undo step, saved with the scene for the player
      data.modifierCache = { key, mesh: encodeHalfEdgeMesh(r.value) }
      const obj = this.objectMap.get(entity.id)?.children.find((c) => c.name === EDITABLE_MESH) as THREE.Mesh | undefined
      if (!obj) return
      const old = obj.geometry
      obj.geometry = editableMeshGeometry(r.value, shading)
      old.dispose()
    })
    this.pending.add(job)
    job.finally(() => this.pending.delete(job))
  }

  /**
   * A boolean operand: another entity's EditableMesh (its base mesh) or MeshRenderer primitive, moved into
   * `target`'s local space. The version covers its data and the relative transform.
   */
  private resolveOperand(target: Entity, operandId: string): { mesh: LindenMesh; version: string } | null {
    const other = this.world.getEntity(operandId)
    const targetObj = this.objectMap.get(target.id)
    const otherObj = this.objectMap.get(operandId)
    if (!other || !targetObj || !otherObj || other.id === target.id) return null
    let he: HalfEdgeMesh | null = null
    let data: unknown = null
    const em = other.getComponent('EditableMesh') as unknown as EditableMesh | undefined
    const mr = other.getComponent('MeshRenderer') as unknown as Record<string, unknown> | undefined
    if (em) {
      const d = decodeHalfEdgeMesh(em.mesh)
      if (d.ok) he = d.value
      data = em.mesh
    } else if (mr) {
      he = editablePrimitive(normalizePrimitive(mr.primitive))
      scaleMesh(he, mr.size)
      data = [mr.primitive, mr.size]
    }
    if (!he) return null
    targetObj.updateWorldMatrix(true, false)
    otherObj.updateWorldMatrix(true, false)
    const rel = targetObj.matrixWorld.clone().invert().multiply(otherObj.matrixWorld)
    const mesh = toLindenMesh(he, { polygons: false })
    const v = new THREE.Vector3()
    for (let i = 0; i < mesh.positions.length; i += 3) {
      v.fromArray(mesh.positions, i).applyMatrix4(rel)
      v.toArray(mesh.positions, i)
    }
    if (rel.determinant() < 0) {
      for (let t = 0; t < mesh.indices.length; t += 3) [mesh.indices[t + 1], mesh.indices[t + 2]] = [mesh.indices[t + 2], mesh.indices[t + 1]]
    }
    delete mesh.normals
    return { mesh, version: hashKey(canonicalJson(data), rel.elements.map((x) => x.toFixed(6)).join(',')) }
  }

  /** Re-evaluates EditableMeshes whose boolean modifiers use `entityId`, or whose own transform moved */
  private refreshModifierDependents(entityId: string, transformChanged: boolean): void {
    for (const e of this.world.getEntities()) {
      const em = e.getComponent('EditableMesh') as unknown as EditableMesh | undefined
      if (!em || !Array.isArray(em.modifiers) || em.modifiers.length === 0) continue
      const usesIt = em.modifiers.some((m) => (m as { type?: string; operand?: string })?.type === 'boolean'
        && (m as { operand?: string }).operand === entityId)
      const ownMove = transformChanged && e.id === entityId && em.modifiers.some((m) => (m as { type?: string })?.type === 'boolean')
      if (usesIt || ownMove) this.buildEditableMesh(e, em as unknown as Component)
    }
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
    else if (comp.name === 'EditableMesh') this.buildEditableMesh(entity, comp)
    else if (comp.name === 'Model') this.buildModel(entity, comp)
    else if (comp.name === 'Light') this.buildLight(entity, comp)
    else if (comp.name === 'Water') this.buildWater(entity, comp)
    else if (comp.name === 'ParticleEmitter') this.buildParticles(entity, comp)
    // A mesh that just appeared may be a boolean operand that an earlier-built entity was waiting for
    if (comp.name === 'MeshRenderer' || comp.name === 'EditableMesh') this.refreshModifierDependents(entity.id, false)
  }

  private handleComponentRemoved(entity: Entity, comp: Component): void {
    const parentObj = this.objectMap.get(entity.id)
    if (!parentObj) return
    if (comp.name === 'MeshRenderer') this.removeChild(parentObj, MESH)
    else if (comp.name === 'EditableMesh') {
      this.forgetEditableMesh(entity.id)
      this.removeChild(parentObj, EDITABLE_MESH)
    }
    else if (comp.name === 'Model') this.removeModel(entity.id, parentObj)
    else if (comp.name === 'Light') this.removeChild(parentObj, LIGHT)
    else if (comp.name === 'Water') this.removeWater(entity.id, parentObj)
    else if (comp.name === 'ParticleEmitter') this.removeParticles(entity.id)
  }

  private handlePropertyChanged(entity: Entity, compType: string, path: string, value: any): void {
    const obj = this.objectMap.get(entity.id)
    if (!obj) return

    if (compType === 'Transform') {
      this.applyTransformToGroup(obj, entity.getTransform())
      this.refreshModifierDependents(entity.id, true)
      return
    }
    const comp = entity.getComponent(compType)
    if (!comp) return

    if (compType === 'MeshRenderer') {
      const key0 = path.split('.')[0]
      if (key0 === 'primitive' || key0 === 'size') this.refreshModifierDependents(entity.id, false)
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
    } else if (compType === 'EditableMesh') {
      const mesh = obj.children.find((c) => c.name === EDITABLE_MESH) as THREE.Mesh | undefined
      const key = path.split('.')[0]
      if (key === 'mesh') this.refreshModifierDependents(entity.id, false)
      if (!mesh || key === 'mesh' || key === 'modifiers' || key === 'shading') return this.buildEditableMesh(entity, comp)
      if (key === 'modifierCache') return
      if (key === 'isVisible') mesh.visible = Boolean(value)
      else if (key === 'castShadow') mesh.castShadow = Boolean(value)
      else if (key === 'receiveShadow') mesh.receiveShadow = Boolean(value)
      else if (key === 'material' || key === 'color' || key === 'roughness' || key === 'metalness') {
        const old = mesh.material
        mesh.material = createMaterial(meshRendererMaterialSpec(comp as any), materialContext(this.ctx))
        disposeMaterial(old)
      } else this.buildEditableMesh(entity, comp)
    } else if (compType === 'Model') {
      this.buildModel(entity, comp)
    } else if (compType === 'Light') {
      this.buildLight(entity, comp)
    } else if (compType === 'Water') {
      this.buildWater(entity, comp)
    } else if (compType === 'ParticleEmitter') {
      this.buildParticles(entity, comp)
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
