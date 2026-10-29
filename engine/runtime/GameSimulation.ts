import type { World } from '../ecs/World'
import { RapierBackend } from '../physics/RapierBackend'
import { Physics, Rigidbody, type Joint } from '../physics/components'
import { CharacterMovementSystem } from '../movement/CharacterMovement'
import { Input } from '../input/InputActions'
import { Tween } from '../time/Tween'
import type { ScriptRuntime } from '../scripting/ScriptRuntime'
import { modelColliderShape } from '../model/modelCollider'
import { buoyancyForce, overWater, waterVolume, type WaterVolume } from '../physics/buoyancy'

export const FIXED_DT = 1 / 60
/** Cap catch-up after a long frame (tab switch, breakpoint) so physics doesn't spiral */
const MAX_FRAME_DT = 0.25

const COLLIDER_TYPES = ['BoxCollider', 'SphereCollider', 'CapsuleCollider', 'MeshCollider']

/**
 * Game loop shared by LindenPlayer (browser, editor Game Frame) and linden_play (headless),
 * so a scene behaves the same everywhere. Simulation speed doesn't depend on refresh rate.
 */
export class GameSimulation {
  physics: RapierBackend | null = null
  scripts: ScriptRuntime | null = null
  timeScale = 1
  private accumulator = 0
  private dynamicIds: string[] = []
  private kinematicIds: string[] = []
  /** Entities destroyed by scripts (often inside a collision callback); bodies go after the step */
  private pendingRemovals: string[] = []
  /** Entity id -> id of the Water entity it is in (dynamic bodies and characters) */
  private wet: Map<string, string> = new Map()
  /** Entities with a Water component; null = rescan on the next fixed step */
  private waterIds: string[] | null = null
  private offWorldEvents: (() => void)[]
  readonly movement: CharacterMovementSystem

  constructor(readonly world: World) {
    const invalidateWater = () => {
      this.waterIds = null
    }
    this.offWorldEvents = [
      world.events.on('entityRemoved', (entity: { id: string }) => {
        if (this.physics) this.pendingRemovals.push(entity.id)
        this.waterIds = null
      }),
      world.events.on('entityAdded', invalidateWater),
      world.events.on('componentAdded', invalidateWater),
      world.events.on('componentRemoved', invalidateWater),
    ]
    this.movement = new CharacterMovementSystem(world, Input, () => this.physics, {
      onJump: (entity) => this.notify(entity.id, 'onJump', 'movement:jump'),
      onLand: (entity, fallSpeed) => this.notify(entity.id, 'onLand', 'movement:land', fallSpeed),
      onSprint: (entity, on) => this.notify(entity.id, on ? 'onStartSprint' : 'onStopSprint', on ? 'movement:sprint' : 'movement:stopSprint'),
    })
  }

  /** Yaw (radians) of the game camera; CharacterMovement moves relative to it */
  get viewYaw(): number {
    return this.movement.viewYaw
  }
  set viewYaw(value: number) {
    this.movement.viewYaw = value
  }

  private notify(entityId: string, hook: string, event: string, value?: number): void {
    this.scripts?.notifyEntity(entityId, hook, value)
    this.scripts?.emit(event, value === undefined ? { entityId } : { entityId, value })
  }

  async initPhysics(collisionMatrix?: boolean[][]): Promise<void> {
    const backend = new RapierBackend((id) => this.world.getEntity(id))
    await backend.init()
    if (collisionMatrix) backend.setLayerCollisionMatrix(collisionMatrix)
    Physics.setBackend(backend)
    this.physics = backend

    for (const ent of this.world.getEntities()) {
      let rb = ent.getComponent('Rigidbody') as any
      const transform = ent.getTransform()
      // A CharacterController needs a kinematic body for Rapier's character controller
      if (!rb && ent.hasComponent('CharacterController')) {
        rb = new Rigidbody()
        rb.bodyType = 'kinematic'
      }
      if (rb) {
        backend.createBody(ent.id, rb, transform, ent.layer)
        if (rb.bodyType === 'dynamic') this.dynamicIds.push(ent.id)
        else if (rb.bodyType === 'kinematic') this.kinematicIds.push(ent.id)
      }
      // Model auto collider, only when the entity has no collider of its own
      const model = ent.getComponent('Model') as any
      if (model && !ent.getComponents().some((c) => COLLIDER_TYPES.includes(c.name))) {
        const shape = modelColliderShape(model, transform.scale)
        if (shape) backend.createModelCollider(ent.id, shape, transform, ent.layer)
      }
      for (const comp of ent.getComponents()) {
        if (COLLIDER_TYPES.includes(comp.name)) {
          backend.createCollider(ent.id, comp as any, transform, rb, ent.layer)
        }
        if (comp.name === 'CharacterController') {
          ;(comp as any).moveCallback = (delta: any) => backend.moveCharacter(ent.id, delta)
        }
      }
    }
    this.createJoints(backend)
  }

  /** Joints go after every body exists, since they can point at any entity */
  private createJoints(backend: RapierBackend): void {
    for (const ent of this.world.getEntities()) {
      const joint = ent.getComponent('Joint') as Joint | undefined
      if (!joint) continue
      joint._broken = false
      let connectedId: string | null = joint.connectedEntity || null
      if (connectedId && !backend.hasBody(connectedId)) {
        const target = this.world.getEntity(connectedId)
        console.warn(
          `[Physics] Joint pada "${ent.name}": entity "${target?.name ?? connectedId}" tidak punya Rigidbody/Collider; joint dipasang ke world`
        )
        connectedId = null
      }
      if (!backend.createJoint(ent.id, joint, connectedId)) {
        console.warn(`[Physics] Joint pada "${ent.name}" butuh Rigidbody; joint diabaikan`)
      }
    }
  }

  get dynamicBodyIds(): readonly string[] {
    return this.dynamicIds
  }

  /** Call onBeginPlay/start on built-in components (Timer, ...) */
  startComponents(): void {
    for (const ent of this.world.getEntities()) {
      for (const comp of ent.getComponents()) {
        if (typeof (comp as any).onBeginPlay === 'function') (comp as any).onBeginPlay(this.world)
        if (typeof (comp as any).start === 'function') (comp as any).start()
      }
    }
  }

  /**
   * Advance one rendered frame. Runs 0..n fixed steps, then variable-rate updates.
   * Returns the number of fixed steps taken.
   */
  frame(frameDt: number): number {
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT) * this.timeScale
    Input.update()
    this.movement.sampleInput(dt)

    this.accumulator += dt
    let steps = 0
    while (this.accumulator >= FIXED_DT) {
      this.fixedStep()
      this.accumulator -= FIXED_DT
      steps++
    }

    this.scripts?.update(dt)
    Tween.update(dt)
    this.world.update(dt)
    this.scripts?.lateUpdate(dt)
    return steps
  }

  private fixedStep(): void {
    this.scripts?.fixedUpdate(FIXED_DT)
    this.movement.fixedStep(FIXED_DT)
    const physics = this.physics
    if (physics) {
      this.flushRemovals()
      // Kinematic bodies follow their Transform (moved by scripts); dynamic bodies drive theirs
      for (const id of this.kinematicIds) {
        const t = this.world.getEntity(id)?.getTransform()
        if (t) {
          physics.setTranslation(id, t.position)
          physics.setRotation(id, t.rotation)
        }
      }
      this.applyWater(physics)
      physics.step(FIXED_DT)
      for (const b of physics.breakJoints(FIXED_DT)) {
        const entity = this.world.getEntity(b.ownerId)
        b.joint.onBreak.emit(entity, b.force)
        this.scripts?.notifyEntity(b.ownerId, 'onJointBreak', b.force)
        this.scripts?.emit('joint:break', { entityId: b.ownerId, force: b.force })
      }
      this.flushRemovals()
      for (const id of this.dynamicIds) {
        const pos = physics.getTranslation(id)
        const rot = physics.getRotation(id)
        const t = this.world.getEntity(id)?.getTransform()
        if (!t) continue
        if (pos) t.position = { x: pos.x, y: pos.y, z: pos.z }
        if (rot) t.rotation = { x: rot.x, y: rot.y, z: rot.z }
      }
    }
    this.world.fixedUpdate(FIXED_DT)
  }

  private waterVolumes(): WaterVolume[] {
    this.waterIds ??= this.world.getEntities().filter((e) => e.hasComponent('Water')).map((e) => e.id)
    const volumes: WaterVolume[] = []
    for (const id of this.waterIds) {
      const ent = this.world.getEntity(id)
      const water = ent?.getComponent('Water') as any
      if (!ent || !water || water.buoyancy === false || !ent.active) continue
      const t = ent.getTransform()
      volumes.push(waterVolume(ent.id, water, t.position, t.scale))
    }
    return volumes
  }

  /** Buoyancy and water drag on dynamic bodies, inWater for characters, water:enter / water:exit */
  private applyWater(physics: RapierBackend): void {
    const waters = this.waterVolumes()
    if (waters.length === 0 && this.wet.size === 0) return
    const gravity = 9.81
    const now = new Map<string, string>()

    for (const id of this.dynamicIds) {
      const bounds = physics.getBounds(id)
      if (!bounds) continue
      const water = waters.find((w) => bounds.min.y < w.surfaceY && overWater(w, bounds))
      if (!water) continue
      const r = buoyancyForce({ surfaceY: water.surfaceY, bounds, volume: physics.getColliderVolume(id), density: water.density, gravity })
      if (r.submerged <= 0) continue
      now.set(id, water.id)
      physics.addForceAtPoint(id, { x: 0, y: r.force, z: 0 }, r.point)
      const k = physics.getMass(id) * r.submerged
      const v = physics.getLinearVelocity(id)
      const w = physics.getAngularVelocity(id)
      if (v) physics.addForce(id, { x: -v.x * water.linearDrag * k, y: -v.y * water.linearDrag * k, z: -v.z * water.linearDrag * k })
      if (w) physics.addTorque(id, { x: -w.x * water.angularDrag * k, y: -w.y * water.angularDrag * k, z: -w.z * water.angularDrag * k })
    }

    for (const id of this.kinematicIds) {
      const ent = this.world.getEntity(id)
      const movement = ent?.getComponent('CharacterMovement') as any
      if (!ent || !movement) continue
      const p = ent.getTransform().position
      const point = { min: p, max: p }
      const water = waters.find((w) => p.y < w.surfaceY && overWater(w, point))
      movement._inWater = !!water
      if (water) now.set(id, water.id)
    }

    for (const [id, waterId] of this.wet) {
      if (now.get(id) !== waterId) this.notifyWater(id, waterId, 'exit')
    }
    for (const [id, waterId] of now) {
      if (this.wet.get(id) !== waterId) this.notifyWater(id, waterId, 'enter')
    }
    this.wet = now
  }

  private notifyWater(entityId: string, waterId: string, kind: 'enter' | 'exit'): void {
    const water = this.world.getEntity(waterId) ?? null
    this.scripts?.notifyEntity(entityId, kind === 'enter' ? 'onEnterWater' : 'onExitWater', water)
    this.scripts?.emit(`water:${kind}`, { entityId, waterId })
  }

  private flushRemovals(): void {
    if (this.pendingRemovals.length === 0 || !this.physics) return
    const removed = new Set(this.pendingRemovals)
    this.pendingRemovals = []
    for (const id of removed) {
      this.physics.removeCollider(id)
      this.physics.removeBody(id)
    }
    this.dynamicIds = this.dynamicIds.filter((id) => !removed.has(id))
    for (const id of removed) this.wet.delete(id)
    this.kinematicIds = this.kinematicIds.filter((id) => !removed.has(id))
  }

  dispose(): void {
    for (const off of this.offWorldEvents) off()
    this.scripts?.destroyAll()
    this.physics?.clear()
    Tween.clear()
  }
}
