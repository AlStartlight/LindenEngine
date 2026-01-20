import { Component, Transform } from '../ecs/Component'

// Re-export Transform for convenience
export { Transform }

/**
 * MeshRenderer Component
 */
export class MeshRenderer extends Component {
  public meshId: string = ''
  public materialId: string = ''
  public castShadow: boolean = true
  public receiveShadow: boolean = true
  public isVisible: boolean = true

  constructor(meshId: string = '', materialId: string = '') {
    super('MeshRenderer')
    this.meshId = meshId
    this.materialId = materialId
  }

  clone(): MeshRenderer {
    const cloned = new MeshRenderer(this.meshId, this.materialId)
    cloned.castShadow = this.castShadow
    cloned.receiveShadow = this.receiveShadow
    cloned.isVisible = this.isVisible
    return cloned
  }
}

/**
 * Camera Component
 */
export class Camera extends Component {
  public fov: number = 45
  public aspect: number = 16 / 9
  public near: number = 0.1
  public far: number = 1000
  public isActive: boolean = true
  public backgroundColor = { r: 0.1, g: 0.1, b: 0.1, a: 1 }

  constructor() {
    super('Camera')
  }

  getProjectionMatrix(): Float32Array {
    // Implement perspective projection matrix
    const f = 1 / Math.tan(this.fov / 2)
    const nf = 1 / (this.near - this.far)

    return new Float32Array([
      f / this.aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (this.far + this.near) * nf,
      -1,
      0,
      0,
      2 * this.far * this.near * nf,
      0,
    ])
  }

  clone(): Camera {
    const cloned = new Camera()
    cloned.fov = this.fov
    cloned.aspect = this.aspect
    cloned.near = this.near
    cloned.far = this.far
    return cloned
  }
}

/**
 * Light Component
 */
export enum LightType {
  DIRECTIONAL = 'directional',
  POINT = 'point',
  SPOT = 'spot',
}

export class Light extends Component {
  public type: LightType = LightType.DIRECTIONAL
  public color = { r: 1, g: 1, b: 1 }
  public intensity: number = 1
  public range: number = 100
  public castShadow: boolean = true

  constructor(type: LightType = LightType.DIRECTIONAL) {
    super('Light')
    this.type = type
  }

  clone(): Light {
    const cloned = new Light(this.type)
    cloned.color = { ...this.color }
    cloned.intensity = this.intensity
    cloned.range = this.range
    cloned.castShadow = this.castShadow
    return cloned
  }
}

/**
 * RigidBody Component untuk physics
 */
export class RigidBody extends Component {
  public mass: number = 1
  public isStatic: boolean = false
  public useGravity: boolean = true
  public velocity = { x: 0, y: 0, z: 0 }
  public angularVelocity = { x: 0, y: 0, z: 0 }
  public drag: number = 0.1
  public angularDrag: number = 0.05

  constructor() {
    super('RigidBody')
  }

  applyForce(force: { x: number; y: number; z: number }, deltaTime: number): void {
    if (this.isStatic) return

    const acceleration = {
      x: force.x / this.mass,
      y: force.y / this.mass,
      z: force.z / this.mass,
    }

    this.velocity.x += acceleration.x * deltaTime
    this.velocity.y += acceleration.y * deltaTime
    this.velocity.z += acceleration.z * deltaTime

    // Apply drag
    this.velocity.x *= 1 - this.drag
    this.velocity.y *= 1 - this.drag
    this.velocity.z *= 1 - this.drag
  }

  clone(): RigidBody {
    const cloned = new RigidBody()
    cloned.mass = this.mass
    cloned.isStatic = this.isStatic
    cloned.useGravity = this.useGravity
    cloned.drag = this.drag
    cloned.angularDrag = this.angularDrag
    return cloned
  }
}

/**
 * Collider Component
 */
export enum ColliderType {
  BOX = 'box',
  SPHERE = 'sphere',
  CAPSULE = 'capsule',
  MESH = 'mesh',
}

export class Collider extends Component {
  public type: ColliderType = ColliderType.BOX
  public isTrigger: boolean = false
  public size = { x: 1, y: 1, z: 1 }
  public offset = { x: 0, y: 0, z: 0 }
  public radius: number = 0.5

  constructor(type: ColliderType = ColliderType.BOX) {
    super('Collider')
    this.type = type
  }

  clone(): Collider {
    const cloned = new Collider(this.type)
    cloned.isTrigger = this.isTrigger
    cloned.size = { ...this.size }
    cloned.offset = { ...this.offset }
    cloned.radius = this.radius
    return cloned
  }
}
