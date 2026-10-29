import type { PhysicsBackend } from './PhysicsBackend'
import type { Transform } from '../ecs/Component'
import type { Rigidbody, BaseCollider, RaycastHit, Joint } from './components'
import { BoxCollider, SphereCollider, CapsuleCollider } from './components'
import type { ModelColliderShape } from '../model/modelCollider'
import * as THREE from 'three'

let RAPIER: any = null

type Vec3 = { x: number; y: number; z: number }

interface JointRecord {
  raw: any
  ownerId: string
  connectedId: string | null
  comp: Joint
  /** Dynamic body whose acceleration estimates the joint force (breakable joints) */
  probeId: string | null
  prevVel: Vec3 | null
}

export interface BrokenJoint {
  ownerId: string
  joint: Joint
  force: number
}

const DEG = Math.PI / 180
/** Damping factor of velocity motors; maxForce caps the resulting force */
const MOTOR_FACTOR = 1e4

export async function loadRapier() {
  if (!RAPIER) {
    const mod = await import('@dimforge/rapier3d-compat')
    RAPIER = (mod as any).default || mod
    await RAPIER.init()
  }
  return RAPIER
}

export class RapierBackend implements PhysicsBackend {
  private rapierWorld: any = null
  private eventQueue: any = null
  private bodies: Map<string, any> = new Map() // entityId -> RigidBody
  private colliders: Map<string, any[]> = new Map() // entityId -> Collider[]
  private colliderToEntity: Map<number, string> = new Map() // colliderHandle -> entityId
  private colliderToIsTrigger: Map<number, boolean> = new Map() // colliderHandle -> isTrigger
  private characterControllers: Map<string, any> = new Map()
  private collisionMatrix: boolean[][] = [] // 16x16 boolean matrix
  private collisionPairs: Set<string> = new Set() // 'id1:id2' for tracking ongoing collisions
  private entityCallback?: (id: string) => any
  /** Rigidbody.mass of dynamic bodies, carried by the body's first collider */
  private pendingMass: Map<string, number> = new Map()
  private joints: JointRecord[] = []
  private worldBody: any = null
  private gravity: Vec3 = { x: 0, y: -9.81, z: 0 }
  /** Bodies with forces added this step; Rapier keeps forces until reset */
  private forced: Set<any> = new Set()

  constructor(entityLookup?: (id: string) => any) {
    this.entityCallback = entityLookup
    // Initialize default 16x16 matrix where all collide with all
    this.collisionMatrix = Array(16)
      .fill(null)
      .map(() => Array(16).fill(true))
  }

  isInitialized(): boolean {
    return this.rapierWorld !== null
  }

  async init(): Promise<void> {
    if (this.rapierWorld) return
    const rapier = await loadRapier()
    this.rapierWorld = new rapier.World(this.gravity)
    this.eventQueue = new rapier.EventQueue(true)
  }

  setLayerCollisionMatrix(matrix: boolean[][]): void {
    this.collisionMatrix = matrix
  }

  private getCollisionGroups(layer: number = 0): number {
    const l = Math.max(0, Math.min(15, layer))
    const membership = 1 << l
    let mask = 0
    if (this.collisionMatrix[l]) {
      for (let other = 0; other < 16; other++) {
        if (this.collisionMatrix[l][other]) {
          mask |= 1 << other
        }
      }
    } else {
      mask = 0xffff
    }
    return (membership << 16) | mask
  }

  createBody(entityId: string, rb: Rigidbody, transform: Transform, layer: number = 0): void {
    if (!this.rapierWorld) return
    if (this.bodies.has(entityId)) {
      this.removeBody(entityId)
    }

    let desc: any
    if (rb.bodyType === 'dynamic') {
      desc = RAPIER.RigidBodyDesc.dynamic()
    } else if (rb.bodyType === 'kinematic') {
      desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    } else {
      desc = RAPIER.RigidBodyDesc.fixed()
    }

    desc.setTranslation(transform.position.x, transform.position.y, transform.position.z)
    
    // Convert Euler angles (degrees) to quaternion
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(transform.rotation.x),
      THREE.MathUtils.degToRad(transform.rotation.y),
      THREE.MathUtils.degToRad(transform.rotation.z),
      'YXZ'
    )
    const q = new THREE.Quaternion().setFromEuler(euler)
    desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })

    if (!rb.useGravity && rb.bodyType === 'dynamic') {
      desc.setGravityScale(0, true)
    }

    if (rb.freezePosition.x || rb.freezePosition.y || rb.freezePosition.z) {
      desc.lockTranslations(rb.freezePosition.x, rb.freezePosition.y, rb.freezePosition.z)
    }

    if (rb.freezeRotation.x || rb.freezeRotation.y || rb.freezeRotation.z) {
      desc.lockRotations(rb.freezeRotation.x, rb.freezeRotation.y, rb.freezeRotation.z)
    }

    desc.setLinearDamping(rb.drag || 0)
    desc.setAngularDamping(rb.angularDrag || 0.05)
    if (rb.ccd) desc.setCcdEnabled(true)

    const body = this.rapierWorld.createRigidBody(desc)
    body.userData = { entityId }
    this.bodies.set(entityId, body)
    if (rb.bodyType === 'dynamic' && rb.mass > 0) this.pendingMass.set(entityId, rb.mass)
  }

  removeBody(entityId: string): void {
    if (!this.rapierWorld) return
    const body = this.bodies.get(entityId)
    if (body) {
      // Remove any colliders attached to body first
      const attached = this.colliders.get(entityId)
      if (attached) {
        for (const c of attached) {
          this.colliderToEntity.delete(c.handle)
          this.colliderToIsTrigger.delete(c.handle)
        }
        this.colliders.delete(entityId)
      }

      // Rapier removes the joints attached to the body with it
      this.joints = this.joints.filter((j) => j.ownerId !== entityId && j.connectedId !== entityId)
      this.forced.delete(body)
      this.pendingMass.delete(entityId)
      this.rapierWorld.removeRigidBody(body)
      this.bodies.delete(entityId)
    }
  }

  createCollider(entityId: string, collider: BaseCollider, transform: Transform, rb?: Rigidbody, layer: number = 0): void {
    if (!this.rapierWorld) return

    let colDesc: any
    if (collider instanceof BoxCollider) {
      colDesc = RAPIER.ColliderDesc.cuboid(
        Math.max((collider.size.x * transform.scale.x) / 2, 0.001),
        Math.max((collider.size.y * transform.scale.y) / 2, 0.001),
        Math.max((collider.size.z * transform.scale.z) / 2, 0.001)
      )
    } else if (collider instanceof SphereCollider) {
      const maxScale = Math.max(transform.scale.x, transform.scale.y, transform.scale.z)
      colDesc = RAPIER.ColliderDesc.ball(Math.max(collider.radius * maxScale, 0.001))
    } else if (collider instanceof CapsuleCollider) {
      const radius = Math.max(collider.radius * Math.max(transform.scale.x, transform.scale.z), 0.001)
      const halfHeight = Math.max((collider.height * transform.scale.y) / 2 - radius, 0.001)
      colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
    } else {
      colDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
    }

    colDesc.setTranslation(collider.center.x, collider.center.y, collider.center.z)
    if (collider.material) {
      colDesc.setFriction(collider.material.friction ?? 0.5)
      colDesc.setRestitution(collider.material.bounciness ?? 0.1)
    }
    this.attachCollider(entityId, colDesc, transform, collider.isTrigger, layer)
  }

  /** Auto collider of a Model component (bounding box or convex hull of its geometry) */
  createModelCollider(entityId: string, shape: ModelColliderShape, transform: Transform, layer: number = 0): void {
    if (!this.rapierWorld) return
    let colDesc: any
    if (shape.kind === 'hull') {
      colDesc = RAPIER.ColliderDesc.convexHull(shape.points)
      if (!colDesc) return // degenerate (flat) hull
    } else {
      colDesc = RAPIER.ColliderDesc.cuboid(...shape.halfExtents)
      colDesc.setTranslation(...shape.center)
    }
    colDesc.setFriction(0.5)
    colDesc.setRestitution(0.1)
    this.attachCollider(entityId, colDesc, transform, false, layer)
  }

  private attachCollider(entityId: string, colDesc: any, transform: Transform, isTrigger: boolean, layer: number): void {
    colDesc.setSensor(isTrigger)
    colDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    colDesc.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
    colDesc.setCollisionGroups(this.getCollisionGroups(layer))
    const mass = this.pendingMass.get(entityId)
    if (mass !== undefined) {
      colDesc.setMass(mass)
      this.pendingMass.delete(entityId)
    }

    const parentBody = this.bodies.get(entityId)
    let rapierCollider: any

    if (parentBody) {
      rapierCollider = this.rapierWorld.createCollider(colDesc, parentBody)
    } else {
      // Static standalone collider: attach to a static body
      const staticDesc = RAPIER.RigidBodyDesc.fixed()
      staticDesc.setTranslation(transform.position.x, transform.position.y, transform.position.z)
      const staticBody = this.rapierWorld.createRigidBody(staticDesc)
      staticBody.userData = { entityId, isAutoStatic: true }
      this.bodies.set(entityId, staticBody)
      rapierCollider = this.rapierWorld.createCollider(colDesc, staticBody)
    }

    if (!this.colliders.has(entityId)) {
      this.colliders.set(entityId, [])
    }
    this.colliders.get(entityId)!.push(rapierCollider)
    this.colliderToEntity.set(rapierCollider.handle, entityId)
    this.colliderToIsTrigger.set(rapierCollider.handle, isTrigger)
  }

  removeCollider(entityId: string): void {
    if (!this.rapierWorld) return
    const cols = this.colliders.get(entityId)
    if (cols) {
      for (const col of cols) {
        this.colliderToEntity.delete(col.handle)
        this.colliderToIsTrigger.delete(col.handle)
        this.rapierWorld.removeCollider(col, true)
      }
      this.colliders.delete(entityId)
    }
  }

  setTranslation(entityId: string, pos: { x: number; y: number; z: number }): void {
    const body = this.bodies.get(entityId)
    if (body) {
      if (body.bodyType() === RAPIER.RigidBodyType.KinematicPositionBased) {
        body.setNextKinematicTranslation(pos)
      } else {
        body.setTranslation(pos, true)
      }
    }
  }

  setLinearVelocity(entityId: string, vel: { x: number; y: number; z: number }): void {
    this.bodies.get(entityId)?.setLinvel(vel, true)
  }

  getLinearVelocity(entityId: string): { x: number; y: number; z: number } | null {
    const body = this.bodies.get(entityId)
    if (!body) return null
    const v = body.linvel()
    return { x: v.x, y: v.y, z: v.z }
  }

  applyImpulse(entityId: string, impulse: { x: number; y: number; z: number }): void {
    this.bodies.get(entityId)?.applyImpulse(impulse, true)
  }

  /** Continuous force (N) for the next step; call every fixed step to keep pushing */
  addForce(entityId: string, force: Vec3): void {
    this.forcedBody(entityId)?.addForce(force, true)
  }

  addForceAtPoint(entityId: string, force: Vec3, point: Vec3): void {
    this.forcedBody(entityId)?.addForceAtPoint(force, point, true)
  }

  addTorque(entityId: string, torque: Vec3): void {
    this.forcedBody(entityId)?.addTorque(torque, true)
  }

  private forcedBody(entityId: string): any {
    const body = this.bodies.get(entityId)
    if (body) this.forced.add(body)
    return body
  }

  setAngularVelocity(entityId: string, vel: Vec3): void {
    this.bodies.get(entityId)?.setAngvel(vel, true)
  }

  getAngularVelocity(entityId: string): Vec3 | null {
    const body = this.bodies.get(entityId)
    if (!body) return null
    const v = body.angvel()
    return { x: v.x, y: v.y, z: v.z }
  }

  getMass(entityId: string): number {
    return this.bodies.get(entityId)?.mass() ?? 0
  }

  isDynamic(entityId: string): boolean {
    const body = this.bodies.get(entityId)
    return !!body && body.bodyType() === RAPIER.RigidBodyType.Dynamic
  }

  /** World-space AABB over all colliders of an entity */
  getBounds(entityId: string): { min: Vec3; max: Vec3 } | null {
    const cols = this.colliders.get(entityId)
    if (!cols || cols.length === 0) return null
    const min = { x: Infinity, y: Infinity, z: Infinity }
    const max = { x: -Infinity, y: -Infinity, z: -Infinity }
    for (const col of cols) {
      const aabb = colliderAabb(col)
      min.x = Math.min(min.x, aabb.min.x)
      min.y = Math.min(min.y, aabb.min.y)
      min.z = Math.min(min.z, aabb.min.z)
      max.x = Math.max(max.x, aabb.max.x)
      max.y = Math.max(max.y, aabb.max.y)
      max.z = Math.max(max.z, aabb.max.z)
    }
    return { min, max }
  }

  /** Summed shape volume (m³) of an entity's colliders */
  getColliderVolume(entityId: string): number {
    const cols = this.colliders.get(entityId)
    if (!cols) return 0
    let volume = 0
    for (const col of cols) volume += col.volume()
    return volume
  }

  /**
   * Connect ownerId's body to connectedId's body, or to the world when connectedId is null.
   * Returns false when the owner has no body.
   */
  createJoint(ownerId: string, joint: Joint, connectedId: string | null): boolean {
    if (!this.rapierWorld) return false
    const body2 = this.bodies.get(ownerId)
    if (!body2) return false
    const body1 = connectedId ? this.bodies.get(connectedId) : this.getWorldBody()
    if (!body1) return false

    const rot1 = toQuat(body1.rotation())
    const rot2 = toQuat(body2.rotation())
    const inv1 = rot1.clone().invert()
    const pos1 = toVec(body1.translation())
    const pos2 = toVec(body2.translation())

    const anchor2 = toVec(joint.anchor)
    const worldAnchor = anchor2.clone().applyQuaternion(rot2).add(pos2)
    const anchor1 = joint.autoConnectAnchor ? worldAnchor.clone().sub(pos1).applyQuaternion(inv1) : toVec(joint.connectedAnchor)
    const axis2 = toVec(joint.axis)
    if (axis2.lengthSq() < 1e-12) axis2.set(0, 1, 0)
    axis2.normalize()
    // The same direction expressed in body1's frame
    const axis1 = axis2.clone().applyQuaternion(rot2).applyQuaternion(inv1)

    let data: any
    switch (joint.type) {
      case 'fixed': {
        const frame1 = inv1.clone().multiply(rot2)
        data = RAPIER.JointData.fixed(anchor1, plainQuat(frame1), anchor2, { x: 0, y: 0, z: 0, w: 1 })
        break
      }
      case 'ball':
        data = RAPIER.JointData.spherical(anchor1, anchor2)
        break
      case 'slider':
        data = RAPIER.JointData.prismatic(anchor1, anchor2, axis1)
        break
      case 'hinge':
      default:
        data = RAPIER.JointData.revoluteWithAxes(anchor1, anchor2, axis1, axis2)
        break
    }

    const raw = this.rapierWorld.createImpulseJoint(data, body1, body2, true)
    if (joint.type === 'hinge' || joint.type === 'slider') {
      const unit = joint.type === 'hinge' ? DEG : 1
      if (joint.limits?.enabled) raw.setLimits(joint.limits.min * unit, joint.limits.max * unit)
      if (joint.motor?.enabled) {
        raw.configureMotorVelocity(joint.motor.targetVelocity * unit, MOTOR_FACTOR)
        raw.setMotorMaxForce(Math.max(joint.motor.maxForce, 0))
      }
    }

    const probeId = this.isDynamic(ownerId) ? ownerId : connectedId && this.isDynamic(connectedId) ? connectedId : null
    this.joints.push({ raw, ownerId, connectedId, comp: joint, probeId, prevVel: null })
    return true
  }

  /** Change a hinge/slider motor at runtime (degrees/s for hinges, m/s for sliders) */
  setJointMotor(ownerId: string, targetVelocity: number, maxForce?: number): boolean {
    const rec = this.joints.find((j) => j.ownerId === ownerId)
    if (!rec || (rec.comp.type !== 'hinge' && rec.comp.type !== 'slider')) return false
    const unit = rec.comp.type === 'hinge' ? DEG : 1
    rec.comp.motor = { ...rec.comp.motor, enabled: true, targetVelocity, maxForce: maxForce ?? rec.comp.motor.maxForce }
    rec.raw.configureMotorVelocity(targetVelocity * unit, MOTOR_FACTOR)
    rec.raw.setMotorMaxForce(Math.max(rec.comp.motor.maxForce, 0))
    return true
  }

  removeJoints(ownerId: string): void {
    for (const rec of this.joints.filter((j) => j.ownerId === ownerId)) this.removeJointRecord(rec)
  }

  getJointCount(): number {
    return this.joints.length
  }

  private removeJointRecord(rec: JointRecord): void {
    if (this.rapierWorld && this.rapierWorld.impulseJoints.contains(rec.raw.handle)) {
      this.rapierWorld.removeImpulseJoint(rec.raw, true)
    }
    this.joints = this.joints.filter((j) => j !== rec)
  }

  private getWorldBody(): any {
    if (!this.worldBody) {
      this.worldBody = this.rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed())
      this.worldBody.userData = { isWorldAnchor: true }
    }
    return this.worldBody
  }

  /**
   * Remove breakable joints whose force exceeded breakForce during the last step.
   * Rapier's JS API does not expose joint impulses, so the force is estimated from the
   * acceleration of the jointed dynamic body against gravity: F = m * |a - g|. Contacts and
   * script forces on that body count toward it too.
   */
  breakJoints(dt: number): BrokenJoint[] {
    const broken: BrokenJoint[] = []
    for (const rec of [...this.joints]) {
      if (!(rec.comp.breakForce > 0) || !rec.probeId) continue
      const body = this.bodies.get(rec.probeId)
      if (!body) continue
      const v = body.linvel()
      const prev = rec.prevVel
      rec.prevVel = { x: v.x, y: v.y, z: v.z }
      if (!prev) {
        // First step: no previous velocity yet, assume the body started at rest
        if (dt <= 0) continue
      }
      const p = prev ?? { x: 0, y: 0, z: 0 }
      const g = this.gravity
      const scale = body.gravityScale()
      const ax = (v.x - p.x) / dt - g.x * scale
      const ay = (v.y - p.y) / dt - g.y * scale
      const az = (v.z - p.z) / dt - g.z * scale
      const force = body.mass() * Math.hypot(ax, ay, az)
      if (force > rec.comp.breakForce) {
        this.removeJointRecord(rec)
        rec.comp._broken = true
        broken.push({ ownerId: rec.ownerId, joint: rec.comp, force })
      }
    }
    return broken
  }

  hasBody(entityId: string): boolean {
    return this.bodies.has(entityId)
  }

  isKinematic(entityId: string): boolean {
    const body = this.bodies.get(entityId)
    return !!body && body.bodyType() === RAPIER.RigidBodyType.KinematicPositionBased
  }

  getTranslation(entityId: string): { x: number; y: number; z: number } | null {
    const body = this.bodies.get(entityId)
    if (body) {
      return body.translation()
    }
    return null
  }

  setRotation(entityId: string, rot: { x: number; y: number; z: number }): void {
    const body = this.bodies.get(entityId)
    if (!body) return

    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(rot.x),
      THREE.MathUtils.degToRad(rot.y),
      THREE.MathUtils.degToRad(rot.z),
      'YXZ'
    )
    const quat = new THREE.Quaternion().setFromEuler(euler)
    const q = { x: quat.x, y: quat.y, z: quat.z, w: quat.w }

    if (body.bodyType() === RAPIER.RigidBodyType.KinematicPositionBased) {
      body.setNextKinematicRotation(q)
    } else {
      body.setRotation(q, true)
    }
  }

  getRotation(entityId: string): { x: number; y: number; z: number } | null {
    const body = this.bodies.get(entityId)
    if (!body) return null
    const q = body.rotation()

    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w)
    const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ')

    return {
      x: THREE.MathUtils.radToDeg(euler.x),
      y: THREE.MathUtils.radToDeg(euler.y),
      z: THREE.MathUtils.radToDeg(euler.z),
    }
  }

  moveCharacter(entityId: string, delta: { x: number; y: number; z: number }): { isGrounded: boolean } {
    if (!this.rapierWorld) return { isGrounded: false }
    const body = this.bodies.get(entityId)
    const cols = this.colliders.get(entityId)
    if (!body || !cols || cols.length === 0) return { isGrounded: false }

    const collider = cols[0]
    let controller = this.characterControllers.get(entityId)
    if (!controller) {
      // Step height and climbable slope come from the entity's CharacterController
      const cc = this.entityCallback?.(entityId)?.getComponent?.('CharacterController')
      controller = this.rapierWorld.createCharacterController(0.01)
      controller.enableAutostep(cc?.stepOffset ?? 0.3, 0.2, true)
      controller.enableSnapToGround(0.5)
      controller.setMaxSlopeClimbAngle(((cc?.slopeLimit ?? 45) * Math.PI) / 180)
      this.characterControllers.set(entityId, controller)
    }

    // Triggers (doors, coins, checkpoints) must not block the character; they still report overlaps
    controller.computeColliderMovement(collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS)
    const movement = controller.computedMovement()
    const currentPos = body.translation()
    body.setTranslation(
      {
        x: currentPos.x + movement.x,
        y: currentPos.y + movement.y,
        z: currentPos.z + movement.z,
      },
      true
    )

    const isGrounded = controller.computedGrounded()
    return { isGrounded }
  }

  raycast(
    origin: [number, number, number] | { x: number; y: number; z: number },
    dir: [number, number, number] | { x: number; y: number; z: number },
    maxDist: number = 1000,
    layerMask: number = 0xffffffff,
    /** Ignore this entity's own body (ground checks from inside a character) */
    excludeEntityId?: string
  ): RaycastHit | null {
    if (!this.rapierWorld) return null

    const o = Array.isArray(origin) ? { x: origin[0], y: origin[1], z: origin[2] } : origin
    const d = Array.isArray(dir) ? { x: dir[0], y: dir[1], z: dir[2] } : dir

    // Normalize dir
    const len = Math.hypot(d.x, d.y, d.z)
    if (len === 0) return null
    const nd = { x: d.x / len, y: d.y / len, z: d.z / len }

    const ray = new RAPIER.Ray(o, nd)
    let filterGroups: number | undefined = undefined
    if (layerMask !== undefined && layerMask !== 0xffffffff && layerMask !== -1) {
      filterGroups = ((0xffff << 16) | (layerMask & 0xffff)) >>> 0
    }

    const hit = this.rapierWorld.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      filterGroups,
      undefined,
      excludeEntityId ? this.bodies.get(excludeEntityId) : undefined
    )

    if (!hit) return null

    const entityId = this.colliderToEntity.get(hit.collider.handle)
    if (!entityId) return null

    const toi = hit.timeOfImpact ?? (hit as any).toi ?? 0
    const point = {
      x: o.x + nd.x * toi,
      y: o.y + nd.y * toi,
      z: o.z + nd.z * toi,
    }

    const entity = this.entityCallback ? this.entityCallback(entityId) : undefined

    return {
      point,
      normal: hit.normal,
      distance: toi,
      entityId,
      entity,
    }
  }

  step(deltaTime: number): void {
    if (!this.rapierWorld) return
    this.rapierWorld.timestep = deltaTime
    this.rapierWorld.step(this.eventQueue)
    // Forces last one step, like Unity's AddForce in FixedUpdate
    for (const body of this.forced) {
      if (!body.isValid || body.isValid()) {
        body.resetForces(false)
        body.resetTorques(false)
      }
    }
    this.forced.clear()

    // Process collision events
    if (this.eventQueue) {
      this.eventQueue.drainCollisionEvents((h1: number, h2: number, started: boolean) => {
        const id1 = this.colliderToEntity.get(h1)
        const id2 = this.colliderToEntity.get(h2)
        if (!id1 || !id2 || id1 === id2) return

        const isTrigger1 = this.colliderToIsTrigger.get(h1) ?? false
        const isTrigger2 = this.colliderToIsTrigger.get(h2) ?? false
        const isTriggerEvent = isTrigger1 || isTrigger2

        const ent1 = this.entityCallback ? this.entityCallback(id1) : null
        const ent2 = this.entityCallback ? this.entityCallback(id2) : null
        if (!ent1 || !ent2) return

        const col1 = ent1.getComponent('BoxCollider') || ent1.getComponent('SphereCollider') || ent1.getComponent('CapsuleCollider')
        const col2 = ent2.getComponent('BoxCollider') || ent2.getComponent('SphereCollider') || ent2.getComponent('CapsuleCollider')

        if (isTriggerEvent) {
          if (started) {
            col1?.onTriggerEnter?.emit(ent2)
            col2?.onTriggerEnter?.emit(ent1)
          } else {
            col1?.onTriggerExit?.emit(ent2)
            col2?.onTriggerExit?.emit(ent1)
          }
        } else {
          if (started) {
            col1?.onCollisionEnter?.emit(ent2)
            col2?.onCollisionEnter?.emit(ent1)
          } else {
            col1?.onCollisionExit?.emit(ent2)
            col2?.onCollisionExit?.emit(ent1)
          }
        }
      })
    }
  }

  getBodyCount(): number {
    return this.bodies.size
  }

  clear(): void {
    if (this.characterControllers) {
      for (const ctrl of this.characterControllers.values()) {
        try {
          this.rapierWorld?.removeCharacterController(ctrl)
        } catch (_) {}
      }
      this.characterControllers.clear()
    }

    if (this.rapierWorld) {
      try {
        this.rapierWorld.free()
      } catch (_) {}
      this.rapierWorld = null
    }

    this.bodies.clear()
    this.joints = []
    this.forced.clear()
    this.worldBody = null
    this.pendingMass.clear()
    this.colliders.clear()
    this.colliderToEntity.clear()
    this.colliderToIsTrigger.clear()
    this.collisionPairs.clear()
  }
}

function toVec(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z)
}

function toQuat(q: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w)
}

function plainQuat(q: THREE.Quaternion): { x: number; y: number; z: number; w: number } {
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

function colliderAabb(col: any): { min: Vec3; max: Vec3 } {
  // Bounding sphere of the shape is enough for water overlap; exact for balls
  const t = col.translation()
  const shape = col.shape
  const he = shape.halfExtents
  let r: Vec3
  if (he) {
    // Rotated cuboid: project the half extents onto the world axes
    const q = toQuat(col.rotation())
    const m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)).elements
    r = {
      x: Math.abs(m[0]) * he.x + Math.abs(m[3]) * he.y + Math.abs(m[6]) * he.z,
      y: Math.abs(m[1]) * he.x + Math.abs(m[4]) * he.y + Math.abs(m[7]) * he.z,
      z: Math.abs(m[2]) * he.x + Math.abs(m[5]) * he.y + Math.abs(m[8]) * he.z,
    }
  } else if (typeof shape.halfHeight === 'number' && typeof shape.radius === 'number') {
    const q = toQuat(col.rotation())
    const up = new THREE.Vector3(0, shape.halfHeight, 0).applyQuaternion(q)
    r = { x: Math.abs(up.x) + shape.radius, y: Math.abs(up.y) + shape.radius, z: Math.abs(up.z) + shape.radius }
  } else if (typeof shape.radius === 'number') {
    r = { x: shape.radius, y: shape.radius, z: shape.radius }
  } else {
    // Convex hull / other: fall back to the volume-equivalent sphere
    const rr = Math.cbrt((3 * col.volume()) / (4 * Math.PI))
    r = { x: rr, y: rr, z: rr }
  }
  return { min: { x: t.x - r.x, y: t.y - r.y, z: t.z - r.z }, max: { x: t.x + r.x, y: t.y + r.y, z: t.z + r.z } }
}
