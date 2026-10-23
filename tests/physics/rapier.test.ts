import { describe, it, expect, beforeAll } from 'vitest'
import { RapierBackend, loadRapier } from '../../engine/physics/RapierBackend'
import {
  Rigidbody,
  BoxCollider,
  SphereCollider,
  CapsuleCollider,
  Physics,
} from '../../engine/physics/components'
import { Transform } from '../../engine/ecs/Component'
import { Entity } from '../../engine/ecs/Entity'

describe('F1.3: Rapier 3D Physics Backend (TC-F13-01 to TC-F13-10, TC-RAP-04)', () => {
  beforeAll(async () => {
    await loadRapier()
  }, 10000)

  it('TC-F13-01: Dynamic sphere at y=10 above BoxCollider floor rests on floor after simulation', async () => {
    const backend = new RapierBackend()
    await backend.init()

    // 1. Static floor at y=0 (size 10x1x10, so top surface is at y = 0.5)
    const floorTransform = new Transform()
    floorTransform.position = { x: 0, y: 0, z: 0 }
    const floorCollider = new BoxCollider()
    floorCollider.size = { x: 10, y: 1, z: 10 }
    backend.createCollider('floor', floorCollider, floorTransform)

    // 2. Dynamic sphere at y=10 (radius = 0.5)
    const sphereTransform = new Transform()
    sphereTransform.position = { x: 0, y: 10, z: 0 }
    const sphereRb = new Rigidbody()
    sphereRb.bodyType = 'dynamic'
    sphereRb.useGravity = true

    const sphereCollider = new SphereCollider()
    sphereCollider.radius = 0.5

    backend.createBody('sphere', sphereRb, sphereTransform)
    backend.createCollider('sphere', sphereCollider, sphereTransform, sphereRb)

    // Simulate 3 seconds at 60Hz
    for (let i = 0; i < 180; i++) {
      backend.step(1 / 60)
    }

    const pos = backend.getTranslation('sphere')!
    // Top of floor is y=0.5, sphere radius is 0.5 -> sphere center rests at y ≈ 1.0
    expect(pos.y).toBeCloseTo(1.0, 1)

    backend.clear()
  })

  it('TC-F13-02: Dynamic sphere free fall for 1.0s without floor reaches y ≈ 10 - 0.5*9.81*1^2 ≈ 5.095', async () => {
    const backend = new RapierBackend()
    await backend.init()

    const sphereTransform = new Transform()
    sphereTransform.position = { x: 0, y: 10, z: 0 }
    const sphereRb = new Rigidbody()
    sphereRb.bodyType = 'dynamic'
    sphereRb.useGravity = true
    sphereRb.drag = 0

    const sphereCollider = new SphereCollider()
    sphereCollider.radius = 0.5

    backend.createBody('free-sphere', sphereRb, sphereTransform)
    backend.createCollider('free-sphere', sphereCollider, sphereTransform, sphereRb)

    // Simulate 1 second at 60Hz
    for (let i = 0; i < 60; i++) {
      backend.step(1 / 60)
    }

    const pos = backend.getTranslation('free-sphere')!
    expect(pos.y).toBeCloseTo(5.095, 1)

    backend.clear()
  })

  it('TC-F13-03: useGravity=false keeps body position unchanged', async () => {
    const backend = new RapierBackend()
    await backend.init()

    const sphereTransform = new Transform()
    sphereTransform.position = { x: 0, y: 10, z: 0 }
    const sphereRb = new Rigidbody()
    sphereRb.bodyType = 'dynamic'
    sphereRb.useGravity = false

    backend.createBody('no-grav', sphereRb, sphereTransform)

    for (let i = 0; i < 60; i++) {
      backend.step(1 / 60)
    }

    const pos = backend.getTranslation('no-grav')!
    expect(pos.y).toBeCloseTo(10, 4)

    backend.clear()
  })

  it('TC-F13-04: freezeRotation locks rotation on all axes', async () => {
    const backend = new RapierBackend()
    await backend.init()

    const transform = new Transform()
    transform.position = { x: 0, y: 5, z: 0 }
    transform.rotation = { x: 15, y: 30, z: 45 }

    const rb = new Rigidbody()
    rb.bodyType = 'dynamic'
    rb.freezeRotation = { x: true, y: true, z: true }

    backend.createBody('frozen-cube', rb, transform)

    for (let i = 0; i < 30; i++) {
      backend.step(1 / 60)
    }

    const rot = backend.getRotation('frozen-cube')!
    expect(rot.x).toBeCloseTo(15, 1)
    expect(rot.y).toBeCloseTo(30, 1)
    expect(rot.z).toBeCloseTo(45, 1)

    backend.clear()
  })

  it('TC-F13-05: Trigger collider fires onTriggerEnter and onTriggerExit when passed through by dynamic sphere', async () => {
    const entities = new Map<string, Entity>()
    const eTrigger = new Entity('TriggerZone', 'trigger-zone')
    const triggerCol = new BoxCollider()
    triggerCol.isTrigger = true
    triggerCol.size = { x: 4, y: 2, z: 4 } // Trigger box bounds: y from -1 to 1
    eTrigger.addComponent(triggerCol)
    entities.set(eTrigger.id, eTrigger)

    const eSphere = new Entity('Mover', 'sphere-mover')
    const sphereCol = new SphereCollider()
    sphereCol.radius = 0.5
    eSphere.addComponent(sphereCol)
    entities.set(eSphere.id, eSphere)

    const backend = new RapierBackend((id) => entities.get(id))
    await backend.init()

    let triggerEnterCount = 0
    let triggerExitCount = 0
    triggerCol.onTriggerEnter.on(() => triggerEnterCount++)
    triggerCol.onTriggerExit.on(() => triggerExitCount++)

    // Trigger box at (0, 0, 0)
    const triggerTrans = new Transform()
    backend.createCollider(eTrigger.id, triggerCol, triggerTrans)

    // Dynamic sphere dropping from y=3
    const sphereTrans = new Transform()
    sphereTrans.position = { x: 0, y: 3, z: 0 }
    const sphereRb = new Rigidbody()
    sphereRb.bodyType = 'dynamic'
    sphereRb.useGravity = true

    backend.createBody(eSphere.id, sphereRb, sphereTrans)
    backend.createCollider(eSphere.id, sphereCol, sphereTrans, sphereRb)

    // Simulate sphere falling through the trigger box
    for (let i = 0; i < 90; i++) {
      backend.step(1 / 60)
    }

    expect(triggerEnterCount).toBe(1)
    expect(triggerExitCount).toBe(1)

    // Sphere did not bounce off the trigger, continued falling below y = -1
    const pos = backend.getTranslation(eSphere.id)!
    expect(pos.y).toBeLessThan(-1)

    backend.clear()
  })

  it('TC-F13-06: Two dynamic cubes colliding trigger onCollisionEnter on both', async () => {
    const entities = new Map<string, Entity>()
    const e1 = new Entity('Cube1', 'cube-1')
    const col1 = new BoxCollider()
    e1.addComponent(col1)
    entities.set(e1.id, e1)

    const e2 = new Entity('Cube2', 'cube-2')
    const col2 = new BoxCollider()
    e2.addComponent(col2)
    entities.set(e2.id, e2)

    const backend = new RapierBackend((id) => entities.get(id))
    await backend.init()

    let c1HitOther: any = null
    let c2HitOther: any = null
    col1.onCollisionEnter.on((other) => { c1HitOther = other })
    col2.onCollisionEnter.on((other) => { c2HitOther = other })

    const t1 = new Transform()
    t1.position = { x: 0, y: 2, z: 0 }
    const rb1 = new Rigidbody()
    rb1.bodyType = 'dynamic'
    backend.createBody(e1.id, rb1, t1)
    backend.createCollider(e1.id, col1, t1, rb1)

    const t2 = new Transform()
    t2.position = { x: 0, y: 0, z: 0 }
    const rb2 = new Rigidbody()
    rb2.bodyType = 'fixed'
    backend.createBody(e2.id, rb2, t2)
    backend.createCollider(e2.id, col2, t2, rb2)

    // Simulate cubes dropping onto each other
    for (let i = 0; i < 40; i++) {
      backend.step(1 / 60)
      if (c1HitOther && c2HitOther) break
    }

    expect(c1HitOther).toBe(e2)
    expect(c2HitOther).toBe(e1)

    backend.clear()
  })

  it('TC-F13-07: Layer collision matrix filters out collisions between disabled layers', async () => {
    const entities = new Map<string, Entity>()
    const ePlayer = new Entity('Player', 'player-id')
    const colPlayer = new BoxCollider()
    ePlayer.addComponent(colPlayer)
    entities.set(ePlayer.id, ePlayer)

    const eEnemy = new Entity('Enemy', 'enemy-id')
    const colEnemy = new BoxCollider()
    eEnemy.addComponent(colEnemy)
    entities.set(eEnemy.id, eEnemy)

    const backend = new RapierBackend((id) => entities.get(id))
    await backend.init()

    // Disable collision between layer 1 (Player) and layer 2 (Enemy)
    const matrix: boolean[][] = Array(16).fill(null).map(() => Array(16).fill(true))
    matrix[1][2] = false
    matrix[2][1] = false
    backend.setLayerCollisionMatrix(matrix)

    let playerCollided = false
    colPlayer.onCollisionEnter.on(() => { playerCollided = true })

    const t1 = new Transform()
    t1.position = { x: 0, y: 2, z: 0 }
    const rb1 = new Rigidbody()
    rb1.bodyType = 'dynamic'
    backend.createBody(ePlayer.id, rb1, t1, 1)
    backend.createCollider(ePlayer.id, colPlayer, t1, rb1, 1)

    const t2 = new Transform()
    t2.position = { x: 0, y: 0, z: 0 }
    const rb2 = new Rigidbody()
    rb2.bodyType = 'fixed'
    backend.createBody(eEnemy.id, rb2, t2, 2)
    backend.createCollider(eEnemy.id, colEnemy, t2, rb2, 2)

    for (let i = 0; i < 60; i++) {
      backend.step(1 / 60)
    }

    // Since layer 1 and 2 don't collide, player falls straight through enemy
    expect(playerCollided).toBe(false)
    const playerPos = backend.getTranslation(ePlayer.id)!
    expect(playerPos.y).toBeLessThan(0)

    backend.clear()
  })

  it('TC-F13-08 & TC-F13-09: Physics.raycast hits floor and respects layerMask filtering', async () => {
    const backend = new RapierBackend()
    await backend.init()
    Physics.setBackend(backend)

    const floorTrans = new Transform()
    floorTrans.position = { x: 0, y: 0, z: 0 }
    const floorCol = new BoxCollider()
    floorCol.size = { x: 10, y: 0.1, z: 10 }
    backend.createCollider('floor', floorCol, floorTrans, undefined, 0) // Layer 0 (Default)
    backend.step(1 / 60)

    // Raycast straight down from (0, 5, 0)
    const hit = Physics.raycast([0, 5, 0], [0, -1, 0], 10)
    expect(hit).not.toBeNull()
    expect(hit!.entityId).toBe('floor')
    expect(hit!.point.y).toBeCloseTo(0.05, 1)
    expect(hit!.distance).toBeCloseTo(4.95, 1)

    // Raycast excluding layer 0 (mask = ~1)
    const maskedHit = Physics.raycast([0, 5, 0], [0, -1, 0], 10, ~1)
    expect(maskedHit).toBeNull()

    backend.clear()
    Physics.setBackend(null)
  })

  it('TC-F13-10: CharacterController.move moves and detects ground on floor', async () => {
    const backend = new RapierBackend()
    await backend.init()

    // Floor at y=0, size 10x1x10
    const floorTrans = new Transform()
    floorTrans.position = { x: 0, y: 0, z: 0 }
    const floorCol = new BoxCollider()
    floorCol.size = { x: 10, y: 1, z: 10 }
    backend.createCollider('floor', floorCol, floorTrans)

    // Character at y=1.5
    const charTrans = new Transform()
    charTrans.position = { x: 0, y: 1.5, z: 0 }
    const charCol = new CapsuleCollider()
    charCol.radius = 0.5
    charCol.height = 2
    const charRb = new Rigidbody()
    charRb.bodyType = 'kinematic'

    backend.createBody('char', charRb, charTrans)
    backend.createCollider('char', charCol, charTrans, charRb)

    backend.step(1 / 60)

    const moveRes = backend.moveCharacter('char', { x: 0, y: -0.5, z: 0 })
    expect(moveRes.isGrounded).toBe(true)

    backend.clear()
  })

  it('TC-RAP-04: Play -> Stop 20x consecutively does not leak: body count = 0 after each clear', async () => {
    const backend = new RapierBackend()

    for (let cycle = 0; cycle < 20; cycle++) {
      await backend.init()

      // Add bodies
      for (let i = 0; i < 5; i++) {
        const t = new Transform()
        t.position = { x: i, y: 1, z: 0 }
        const rb = new Rigidbody()
        backend.createBody(`body-${cycle}-${i}`, rb, t)
        backend.createCollider(`body-${cycle}-${i}`, new BoxCollider(), t, rb)
      }

      expect(backend.getBodyCount()).toBe(5)

      // Stop / clear
      backend.clear()
      expect(backend.getBodyCount()).toBe(0)
    }
  })
})
