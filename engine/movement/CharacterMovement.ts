import { Component } from '../ecs/Component'
import type { Entity } from '../ecs/Entity'
import type { World } from '../ecs/World'
import type { InputManager } from '../input/InputActions'
import type { RapierBackend } from '../physics/RapierBackend'

type Vec3 = { x: number; y: number; z: number }

const DEG = Math.PI / 180
const GROUND_PROBE = 0.12

/**
 * Ready-made character movement driven by Input Actions: walk/run with analog speed, jump with
 * coyote time and jump buffer, Q/E turn (or fly up/down, or strafe), camera-relative direction.
 * Runs on a CharacterController (Rapier kinematic character), a dynamic Rigidbody, or a bare Transform.
 */
export class CharacterMovement extends Component {
  public moveAction = 'Move'
  public turnAction = 'Turn'
  public verticalAction = 'Vertical'
  public jumpAction = 'Jump'
  public sprintAction = 'Sprint'
  public crouchAction = 'Crouch'
  public lookAction = 'Look'
  public mode: 'walk' | 'fly' | 'topdown' = 'walk'
  public qeMode: 'turn' | 'vertical' | 'strafe' = 'turn'
  public walkSpeed = 4
  public sprintSpeed = 7
  public crouchSpeed = 2
  public acceleration = 30
  public deceleration = 40
  public airControl = 0.4
  public jumpHeight = 1.2
  public gravity = 20
  public coyoteTime = 0.1
  public jumpBuffer = 0.1
  public maxJumps = 1
  public turnSpeed = 180
  public lookSpeed = 180
  public orientToMovement = true
  public rotationSmoothing = 12
  public cameraRelative = true
  public analogWalk = true
  /** 2D games: keep the character on a plane */
  public lockAxis: 'none' | 'x' | 'z' = 'none'

  // Runtime state (underscore: not serialized into the scene)
  _velocity: Vec3 = { x: 0, y: 0, z: 0 }
  _grounded = false
  _sprinting = false
  _crouching = false
  _jumpsUsed = 0
  _coyote = 0
  _buffer = 0
  _yaw: number | null = null
  _impulse: Vec3 = { x: 0, y: 0, z: 0 }
  _teleport: Vec3 | null = null
  // Input sampled once per rendered frame, consumed by fixed steps
  _move = { x: 0, y: 0 }
  _turn = 0
  _vertical = 0
  /** A camera is parented to this character (first person / over the shoulder) */
  _cameraChild: Entity | null = null
  _cameraOnSelf = false
  /** Coordinate held by lockAxis, captured on the first step */
  _lockValue: number | null = null
  /** Set by GameSimulation while the character's centre is below a Water surface */
  _inWater = false

  constructor() {
    super('CharacterMovement')
  }

  get isGrounded(): boolean {
    return this._grounded
  }
  get velocity(): Vec3 {
    return { ...this._velocity }
  }
  get speed(): number {
    return Math.hypot(this._velocity.x, this._velocity.z)
  }
  get isSprinting(): boolean {
    return this._sprinting
  }
  get isCrouching(): boolean {
    return this._crouching
  }
  get jumpsUsed(): number {
    return this._jumpsUsed
  }
  get inWater(): boolean {
    return this._inWater
  }

  /** Knockback, jump pads... applied on the next fixed step */
  addImpulse(v: Vec3): void {
    this._impulse = { x: this._impulse.x + v.x, y: this._impulse.y + v.y, z: this._impulse.z + v.z }
  }

  teleport(pos: Vec3): void {
    this._teleport = { ...pos }
    this._velocity = { x: 0, y: 0, z: 0 }
  }

  clone(): CharacterMovement {
    const c = new CharacterMovement()
    for (const key of Object.keys(this) as (keyof this)[]) {
      const k = key as string
      if (k.startsWith('_') || k === 'name' || k === 'entityId') continue
      ;(c as any)[k] = (this as any)[k]
    }
    c.isEnabled = this.isEnabled
    return c
  }
}

export interface MovementEvents {
  onJump(entity: Entity): void
  onLand(entity: Entity, fallSpeed: number): void
  onSprint(entity: Entity, sprinting: boolean): void
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target
  return current + Math.sign(target - current) * maxDelta
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** Distance from the entity origin down to the bottom of its collider */
function footOffset(entity: Entity): number {
  const t = entity.getTransform()
  const capsule = entity.getComponent('CapsuleCollider') as any
  if (capsule) return (capsule.height * t.scale.y) / 2 - (capsule.center?.y ?? 0)
  const box = entity.getComponent('BoxCollider') as any
  if (box) return (box.size.y * t.scale.y) / 2 - (box.center?.y ?? 0)
  const sphere = entity.getComponent('SphereCollider') as any
  if (sphere) return sphere.radius * Math.max(t.scale.x, t.scale.y, t.scale.z) - (sphere.center?.y ?? 0)
  return (t.scale.y || 1) / 2
}

/**
 * Drives every CharacterMovement in a world. sampleInput() once per rendered frame,
 * fixedStep() at the physics rate before the physics step.
 */
export class CharacterMovementSystem {
  /** Yaw of the game camera (radians); W is "away from the camera" when cameraRelative */
  viewYaw = 0

  constructor(
    private world: World,
    private input: InputManager,
    private getPhysics: () => RapierBackend | null,
    private events?: Partial<MovementEvents>
  ) {}

  private movers(): { entity: Entity; cm: CharacterMovement }[] {
    const out: { entity: Entity; cm: CharacterMovement }[] = []
    for (const entity of this.world.getEntities()) {
      const cm = entity.getComponent<CharacterMovement>('CharacterMovement')
      if (cm && cm.getEnabled() && entity.active) out.push({ entity, cm })
    }
    return out
  }

  sampleInput(frameDt: number): void {
    for (const { entity, cm } of this.movers()) {
      cm._move = this.input.getVector(cm.moveAction)
      cm._turn = this.input.getAxis(cm.turnAction)
      cm._vertical = this.input.getAxis(cm.verticalAction)
      if (this.input.isActionJustPressed(cm.jumpAction)) cm._buffer = cm.jumpBuffer
      const sprinting = this.input.isActionPressed(cm.sprintAction)
      if (sprinting !== cm._sprinting) {
        cm._sprinting = sprinting
        this.events?.onSprint?.(entity, sprinting)
      }
      cm._crouching = this.input.isActionPressed(cm.crouchAction)
      cm._cameraChild =
        this.world.getEntities().find((e) => e.parentId === entity.id && e.hasComponent('Camera') && e.active) ?? null
      // A camera on the character itself also follows its yaw: same first-person rules
      cm._cameraOnSelf = entity.hasComponent('Camera')
      this.applyLook(entity, cm, frameDt)
    }
  }

  /** Look (mouse, right stick, touch drag) turns the character and pitches a camera parented to it */
  private applyLook(entity: Entity, cm: CharacterMovement, dt: number): void {
    if (!cm._cameraChild) return
    const look = this.input.getVector(cm.lookAction)
    if (look.x === 0 && look.y === 0) return
    cm._yaw = (cm._yaw ?? entity.getTransform().rotation.y * DEG) - look.x * cm.lookSpeed * DEG * dt
    const ct = cm._cameraChild.getTransform()
    ct.rotation = { ...ct.rotation, x: Math.max(-80, Math.min(80, ct.rotation.x + look.y * cm.lookSpeed * dt)) }
  }

  fixedStep(dt: number): void {
    const physics = this.getPhysics()
    for (const { entity, cm } of this.movers()) this.stepOne(entity, cm, dt, physics)
  }

  private stepOne(entity: Entity, cm: CharacterMovement, dt: number, physics: RapierBackend | null): void {
    const t = entity.getTransform()
    if (cm._yaw === null) cm._yaw = t.rotation.y * DEG
    const cc = entity.getComponent('CharacterController') as any
    const body = physics?.hasBody(entity.id) ? physics : null
    const kinematic = !!body && physics!.isKinematic(entity.id)
    const dynamic = !!body && !kinematic

    if (cm._teleport) {
      t.position = { ...cm._teleport }
      physics?.setTranslation(entity.id, cm._teleport)
      cm._teleport = null
    }

    // --- input -> desired horizontal velocity ---
    let mx = cm._move.x
    let my = cm._move.y
    let turning = false
    const flying = cm.mode === 'fly'
    const qe = flying ? 'vertical' : cm.qeMode
    if (qe === 'turn' && cm._turn !== 0) {
      cm._yaw -= cm._turn * cm.turnSpeed * DEG * dt // E (+1) turns right = clockwise from above
      turning = true
    } else if (qe === 'strafe') {
      mx = Math.max(-1, Math.min(1, mx + cm._turn))
    }

    // On a locked plane only one axis survives; undo the circular diagonal normalization
    // (keys: W+D still means full speed sideways; a joystick keeps its analog length)
    if (cm.lockAxis !== 'none') {
      const peak = Math.max(Math.abs(mx), Math.abs(my))
      if (peak > 0) {
        const k = Math.hypot(mx, my) / peak
        mx *= k
        my *= k
      }
    }

    // Directions are relative to: the character itself when the camera rides on it (first person)
    // or for tank controls without camera-relative movement; otherwise the camera, or the world.
    const firstPerson = !!cm._cameraChild || cm._cameraOnSelf
    const basisYaw = firstPerson || (!cm.cameraRelative && qe === 'turn') ? cm._yaw : cm.cameraRelative ? this.viewYaw : 0
    const fwd = { x: -Math.sin(basisYaw), z: -Math.cos(basisYaw) }
    const right = { x: Math.cos(basisYaw), z: -Math.sin(basisYaw) }
    let wishX = fwd.x * my + right.x * mx
    let wishZ = fwd.z * my + right.z * mx
    if (cm.lockAxis === 'z') wishZ = 0
    if (cm.lockAxis === 'x') wishX = 0
    const inputMag = Math.min(1, Math.hypot(wishX, wishZ))
    if (inputMag > 0) {
      const len = Math.hypot(wishX, wishZ)
      wishX /= len
      wishZ /= len
    }
    const maxSpeed = cm._crouching ? cm.crouchSpeed : cm._sprinting ? cm.sprintSpeed : cm.walkSpeed
    const targetSpeed = maxSpeed * (cm.analogWalk ? inputMag : inputMag > 0 ? 1 : 0)

    const v = cm._velocity
    if (dynamic) {
      const lv = physics!.getLinearVelocity(entity.id)
      if (lv) {
        v.x = lv.x
        v.y = lv.y
        v.z = lv.z
      }
    }
    const control = cm._grounded || flying ? 1 : cm.airControl
    const rate = (targetSpeed > 0 ? cm.acceleration : cm.deceleration) * control * dt
    v.x = moveTowards(v.x, wishX * targetSpeed, rate)
    v.z = moveTowards(v.z, wishZ * targetSpeed, rate)

    // --- vertical: gravity, jump, fly ---
    cm._coyote = cm._grounded ? cm.coyoteTime : Math.max(0, cm._coyote - dt)
    cm._buffer = Math.max(0, cm._buffer - dt)
    let jumped = false
    if (flying) {
      v.y = moveTowards(v.y, cm._vertical * maxSpeed, cm.acceleration * dt)
    } else {
      const g = dynamic ? 9.81 : cm.gravity
      if (!dynamic) v.y -= g * dt
      const canJump = cm.mode !== 'topdown' && (cm._coyote > 0 || (cm._jumpsUsed > 0 && cm._jumpsUsed < cm.maxJumps))
      if (cm._buffer > 0 && canJump) {
        v.y = Math.sqrt(2 * g * cm.jumpHeight)
        cm._jumpsUsed = cm._coyote > 0 ? 1 : cm._jumpsUsed + 1
        cm._coyote = 0
        cm._buffer = 0
        jumped = true
      }
    }

    v.x += cm._impulse.x
    v.y += cm._impulse.y
    v.z += cm._impulse.z
    cm._impulse = { x: 0, y: 0, z: 0 }
    if (cm.lockAxis === 'z') v.z = 0
    if (cm.lockAxis === 'x') v.x = 0

    // --- move ---
    const wasGrounded = cm._grounded
    const fallSpeed = -v.y
    if (kinematic && cc) {
      const res = cc.move({ x: v.x * dt, y: v.y * dt, z: v.z * dt })
      const pos = physics!.getTranslation(entity.id)
      if (pos) t.position = { x: pos.x, y: pos.y, z: pos.z }
      cm._grounded = !!res.isGrounded && v.y <= 0
    } else if (dynamic) {
      physics!.setLinearVelocity(entity.id, v)
      cm._grounded = v.y <= 0.5 && this.probeGround(entity, physics) !== false
    } else {
      t.position = { x: t.position.x + v.x * dt, y: t.position.y + v.y * dt, z: t.position.z + v.z * dt }
      const hit = this.probeGround(entity, physics, true)
      cm._grounded = v.y <= 0 && hit !== false
      if (cm._grounded && typeof hit === 'number') t.position = { ...t.position, y: hit + footOffset(entity) }
    }
    // The character controller can nudge the capsule sideways on contacts; pin the locked axis
    if (cm.lockAxis !== 'none') {
      const axis = cm.lockAxis
      if (cm._lockValue === null) cm._lockValue = t.position[axis]
      if (t.position[axis] !== cm._lockValue) {
        t.position = { ...t.position, [axis]: cm._lockValue }
        if (body) physics!.setTranslation(entity.id, t.position)
      }
    }
    if (cm._grounded && !flying) {
      if (!jumped) cm._jumpsUsed = 0
      if (!dynamic) v.y = -1 // keep pressing into the ground so slopes/steps stay grounded
      if (!wasGrounded) this.events?.onLand?.(entity, Math.max(0, fallSpeed))
    }
    if (jumped) this.events?.onJump?.(entity)

    // --- facing ---
    const horiz = Math.hypot(v.x, v.z)
    if (cm.orientToMovement && !firstPerson && !turning && horiz > 0.1 && cm.lockAxis === 'none') {
      const target = Math.atan2(-v.x, -v.z)
      const k = 1 - Math.exp(-cm.rotationSmoothing * dt)
      cm._yaw = cm._yaw + wrapAngle(target - cm._yaw) * k
    }
    cm._yaw = wrapAngle(cm._yaw)
    const yawDeg = cm._yaw / DEG
    t.rotation = { x: 0, y: yawDeg, z: 0 }
    if (dynamic) physics!.setRotation(entity.id, t.rotation)
  }

  /**
   * Ground under the character. Returns the ground height, true (hit, height unknown), or false.
   * Without physics a flat ground at y = 0 is assumed.
   */
  private probeGround(entity: Entity, physics: RapierBackend | null, wantHeight = false): number | boolean {
    const t = entity.getTransform()
    const foot = footOffset(entity)
    if (!physics) {
      return t.position.y - foot <= 0 ? (wantHeight ? 0 : true) : false
    }
    const hit = physics.raycast(t.position, { x: 0, y: -1, z: 0 }, foot + GROUND_PROBE, undefined, entity.id)
    if (!hit) return false
    return wantHeight ? hit.point.y : true
  }
}
