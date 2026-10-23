import { Component } from '../ecs/Component'
import { EventField } from '../events/EventField'

export interface RaycastHit {
  point: { x: number; y: number; z: number }
  normal: { x: number; y: number; z: number }
  distance: number
  entityId: string
  entity?: any
}

export class Rigidbody extends Component {
  public bodyType: 'dynamic' | 'kinematic' | 'static' = 'dynamic'
  public mass: number = 1
  public drag: number = 0
  public angularDrag: number = 0.05
  public useGravity: boolean = true
  public freezePosition = { x: false, y: false, z: false }
  public freezeRotation = { x: false, y: false, z: false }
  public velocity = { x: 0, y: 0, z: 0 }
  public angularVelocity = { x: 0, y: 0, z: 0 }

  constructor() {
    super('Rigidbody')
  }

  clone(): Rigidbody {
    const c = new Rigidbody()
    c.bodyType = this.bodyType
    c.mass = this.mass
    c.drag = this.drag
    c.angularDrag = this.angularDrag
    c.useGravity = this.useGravity
    c.freezePosition = { ...this.freezePosition }
    c.freezeRotation = { ...this.freezeRotation }
    c.velocity = { ...this.velocity }
    c.angularVelocity = { ...this.angularVelocity }
    return c
  }
}

export abstract class BaseCollider extends Component {
  public isTrigger: boolean = false
  public center = { x: 0, y: 0, z: 0 }
  public material = { friction: 0.5, bounciness: 0.1 }

  public onTriggerEnter = new EventField()
  public onTriggerExit = new EventField()
  public onCollisionEnter = new EventField()
  public onCollisionExit = new EventField()
}

export class BoxCollider extends BaseCollider {
  public size = { x: 1, y: 1, z: 1 }

  constructor() {
    super('BoxCollider')
  }

  clone(): BoxCollider {
    const c = new BoxCollider()
    c.isTrigger = this.isTrigger
    c.center = { ...this.center }
    c.size = { ...this.size }
    c.material = { ...this.material }
    c.onTriggerEnter = this.onTriggerEnter.clone()
    c.onTriggerExit = this.onTriggerExit.clone()
    c.onCollisionEnter = this.onCollisionEnter.clone()
    c.onCollisionExit = this.onCollisionExit.clone()
    return c
  }
}

export class SphereCollider extends BaseCollider {
  public radius: number = 0.5

  constructor() {
    super('SphereCollider')
  }

  clone(): SphereCollider {
    const c = new SphereCollider()
    c.isTrigger = this.isTrigger
    c.center = { ...this.center }
    c.radius = this.radius
    c.material = { ...this.material }
    c.onTriggerEnter = this.onTriggerEnter.clone()
    c.onTriggerExit = this.onTriggerExit.clone()
    c.onCollisionEnter = this.onCollisionEnter.clone()
    c.onCollisionExit = this.onCollisionExit.clone()
    return c
  }
}

export class CapsuleCollider extends BaseCollider {
  public radius: number = 0.5
  public height: number = 2

  constructor() {
    super('CapsuleCollider')
  }

  clone(): CapsuleCollider {
    const c = new CapsuleCollider()
    c.isTrigger = this.isTrigger
    c.center = { ...this.center }
    c.radius = this.radius
    c.height = this.height
    c.material = { ...this.material }
    c.onTriggerEnter = this.onTriggerEnter.clone()
    c.onTriggerExit = this.onTriggerExit.clone()
    c.onCollisionEnter = this.onCollisionEnter.clone()
    c.onCollisionExit = this.onCollisionExit.clone()
    return c
  }
}

export class MeshCollider extends BaseCollider {
  public convex: boolean = false

  constructor() {
    super('MeshCollider')
  }

  clone(): MeshCollider {
    const c = new MeshCollider()
    c.isTrigger = this.isTrigger
    c.center = { ...this.center }
    c.convex = this.convex
    c.material = { ...this.material }
    return c
  }
}

export class CharacterController extends Component {
  public stepOffset: number = 0.3
  public slopeLimit: number = 45
  public skinWidth: number = 0.08
  public radius: number = 0.5
  public height: number = 2
  public isGrounded: boolean = false
  public moveCallback?: (delta: { x: number; y: number; z: number }) => { isGrounded: boolean }

  constructor() {
    super('CharacterController')
  }

  move(delta: [number, number, number] | { x: number; y: number; z: number }): { isGrounded: boolean } {
    const d = Array.isArray(delta) ? { x: delta[0], y: delta[1], z: delta[2] } : delta
    if (this.moveCallback) {
      const res = this.moveCallback(d)
      this.isGrounded = res.isGrounded
      return res
    }
    return { isGrounded: this.isGrounded }
  }

  clone(): CharacterController {
    const c = new CharacterController()
    c.stepOffset = this.stepOffset
    c.slopeLimit = this.slopeLimit
    c.skinWidth = this.skinWidth
    c.radius = this.radius
    c.height = this.height
    c.isGrounded = this.isGrounded
    return c
  }
}

// Global physics accessor
export class Physics {
  private static backend: any = null

  static setBackend(backend: any): void {
    Physics.backend = backend
  }

  static getBackend(): any {
    return Physics.backend
  }

  static raycast(
    origin: [number, number, number] | { x: number; y: number; z: number },
    dir: [number, number, number] | { x: number; y: number; z: number },
    maxDist: number = 1000,
    layerMask: number = 0xffffffff
  ): RaycastHit | null {
    if (!Physics.backend) return null
    return Physics.backend.raycast(origin, dir, maxDist, layerMask)
  }
}
