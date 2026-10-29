import type { World } from '../ecs/World'
import { RapierBackend } from '../physics/RapierBackend'
import { Physics, Rigidbody } from '../physics/components'
import { CharacterMovementSystem } from '../movement/CharacterMovement'
import { Input } from '../input/InputActions'
import { Tween } from '../time/Tween'
import type { ScriptRuntime } from '../scripting/ScriptRuntime'

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
  private offEntityRemoved: () => void
  readonly movement: CharacterMovementSystem

  constructor(readonly world: World) {
    this.offEntityRemoved = world.events.on('entityRemoved', (entity: { id: string }) => {
      if (this.physics) this.pendingRemovals.push(entity.id)
    })
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
      for (const comp of ent.getComponents()) {
        if (COLLIDER_TYPES.includes(comp.name)) {
          backend.createCollider(ent.id, comp as any, transform, rb, ent.layer)
        }
        if (comp.name === 'CharacterController') {
          ;(comp as any).moveCallback = (delta: any) => backend.moveCharacter(ent.id, delta)
        }
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
      physics.step(FIXED_DT)
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

  private flushRemovals(): void {
    if (this.pendingRemovals.length === 0 || !this.physics) return
    const removed = new Set(this.pendingRemovals)
    this.pendingRemovals = []
    for (const id of removed) {
      this.physics.removeCollider(id)
      this.physics.removeBody(id)
    }
    this.dynamicIds = this.dynamicIds.filter((id) => !removed.has(id))
    this.kinematicIds = this.kinematicIds.filter((id) => !removed.has(id))
  }

  dispose(): void {
    this.offEntityRemoved()
    this.scripts?.destroyAll()
    this.physics?.clear()
    Tween.clear()
  }
}
