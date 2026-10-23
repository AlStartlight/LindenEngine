/**
 * 2D Physics Nodes (GF-11)
 * StaticBody2D, RigidBody2D, CharacterBody2D, Area2D
 */

import { Node2D } from '../scene/Node'

export class CollisionShape2D extends Node2D {
  public shapeType: 'box' | 'circle' = 'box'
  public extents = { x: 16, y: 16 }
  public radius = 16

  constructor(name: string = 'CollisionShape2D', id?: string) {
    super(name, id)
  }
}

export class StaticBody2D extends Node2D {
  public constantLinearVelocity = { x: 0, y: 0 }
  public constantAngularVelocity = 0

  constructor(name: string = 'StaticBody2D', id?: string) {
    super(name, id)
  }
}

export class RigidBody2D extends Node2D {
  public mass: number = 1.0
  public linearVelocity = { x: 0, y: 0 }
  public angularVelocity: number = 0
  public gravityScale: number = 1.0

  constructor(name: string = 'RigidBody2D', id?: string) {
    super(name, id)
  }
}

export class CharacterBody2D extends Node2D {
  public velocity = { x: 0, y: 0 }
  public upDirection = { x: 0, y: -1 }
  public floorStopOnSlope: boolean = true
  public maxSlides: number = 4
  private onFloor: boolean = false

  constructor(name: string = 'CharacterBody2D', id?: string) {
    super(name, id)
  }

  isOnFloor(): boolean {
    return this.onFloor
  }

  is_on_floor(): boolean {
    return this.isOnFloor()
  }

  moveAndSlide(delta: number = 1 / 60): boolean {
    // Check collision with static bodies in the same scene
    const parent = this.getParent()
    let collided = false
    this.onFloor = false

    if (parent) {
      const statics = parent.getChildren().filter((c) => c instanceof StaticBody2D) as StaticBody2D[]
      for (const sb of statics) {
        // Simple bounding box floor check (assuming 32x32)
        const nextY = this.position.y + this.velocity.y * delta
        if (nextY >= sb.position.y - 32 && this.position.y <= sb.position.y) {
          this.position.y = sb.position.y - 32
          this.velocity.y = 0
          this.onFloor = true
          collided = true
          break
        }
      }
    }

    if (!this.onFloor) {
      this.position.x += this.velocity.x * delta
      this.position.y += this.velocity.y * delta
    } else {
      this.position.x += this.velocity.x * delta
    }

    return collided
  }

  move_and_slide(): boolean {
    return this.moveAndSlide()
  }
}

export class Area2D extends Node2D {
  constructor(name: string = 'Area2D', id?: string) {
    super(name, id)
    this.registerSignal('body_entered')
    this.registerSignal('body_exited')
  }

  notifyBodyEntered(body: Node): void {
    this.emitSignal('body_entered', body)
  }

  notifyBodyExited(body: Node): void {
    this.emitSignal('body_exited', body)
  }
}
