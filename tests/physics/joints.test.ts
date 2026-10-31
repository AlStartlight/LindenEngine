import { describe, it, expect, beforeAll } from 'vitest'
import { RapierBackend, loadRapier } from '../../engine/physics/RapierBackend'
import { Rigidbody, BoxCollider, SphereCollider, Joint } from '../../engine/physics/components'
import { Transform } from '../../engine/ecs/Component'
import { World } from '../../engine/ecs/World'
import { ComponentRegistry } from '../../engine/ecs/ComponentRegistry'
import { GameSimulation, FIXED_DT } from '../../engine/runtime/GameSimulation'
import { SceneSerializer } from '../../engine/scene/serializer'

function transformAt(x: number, y: number, z: number): Transform {
  const t = new Transform()
  t.position = { x, y, z }
  return t
}

function dynamicBox(backend: RapierBackend, id: string, t: Transform, mass = 1, size = 1): Rigidbody {
  const rb = new Rigidbody()
  rb.mass = mass
  backend.createBody(id, rb, t)
  const col = new BoxCollider()
  col.size = { x: size, y: size, z: size }
  backend.createCollider(id, col, t, rb)
  return rb
}

function step(backend: RapierBackend, n: number, onStep?: () => void): void {
  for (let i = 0; i < n; i++) {
    onStep?.()
    backend.step(FIXED_DT)
  }
}

describe('M1: Joint, forces and CCD', () => {
  beforeAll(async () => {
    await loadRapier()
  }, 10000)

  it('registers Joint and Rigidbody.ccd and round-trips them through the scene serializer', () => {
    const def = ComponentRegistry.get('Joint')
    expect(def?.menuPath).toBe('Physics/Joint')
    expect(ComponentRegistry.get('Rigidbody')?.properties.some((p) => p.name === 'ccd')).toBe(true)

    const world = new World()
    const door = world.createEntity('Door')
    world.addComponent(door.id, 'Rigidbody', { ccd: true })
    world.addComponent(door.id, 'Joint', { type: 'hinge', axis: { x: 0, y: 1, z: 0 }, limits: { enabled: true, min: 0, max: 90 }, breakForce: 50 })

    const json = SceneSerializer.serialize(world, 'test')
    const loaded = new World()
    SceneSerializer.deserialize(json, loaded)
    const ent = loaded.getEntity(door.id)!
    const joint = ent.getComponent('Joint') as Joint
    expect(joint.type).toBe('hinge')
    expect(joint.limits).toEqual({ enabled: true, min: 0, max: 90 })
    expect(joint.breakForce).toBe(50)
    expect((ent.getComponent('Rigidbody') as Rigidbody).ccd).toBe(true)
    expect(JSON.parse(json).entities[0].components.some((c: any) => '_broken' in c.data)).toBe(false)
  })

  it('applies Rigidbody.mass to the body', async () => {
    const backend = new RapierBackend()
    await backend.init()
    dynamicBox(backend, 'crate', transformAt(0, 0, 0), 7)
    expect(backend.getMass('crate')).toBeCloseTo(7, 3)
  })

  it('hinge with limits stays within its limits', async () => {
    const backend = new RapierBackend()
    await backend.init()
    // Door 2 m wide, hinged at its left edge around Y; a push would swing it past 30° without limits
    const t = transformAt(1, 1, 0)
    const rb = new Rigidbody()
    rb.useGravity = false
    backend.createBody('door', rb, t)
    const col = new BoxCollider()
    col.size = { x: 2, y: 2, z: 0.1 }
    backend.createCollider('door', col, t, rb)

    const joint = new Joint()
    joint.type = 'hinge'
    joint.anchor = { x: -1, y: 0, z: 0 }
    joint.axis = { x: 0, y: 1, z: 0 }
    joint.limits = { enabled: true, min: -30, max: 30 }
    expect(backend.createJoint('door', joint, null)).toBe(true)

    let maxYaw = 0
    step(backend, 120, () => {
      backend.addTorque('door', { x: 0, y: 20, z: 0 })
      maxYaw = Math.max(maxYaw, Math.abs(backend.getRotation('door')!.y))
    })
    expect(maxYaw).toBeGreaterThan(20)
    expect(maxYaw).toBeLessThan(33)
    // The hinge edge stays at its world anchor (0, 1, 0)
    const rot = backend.getRotation('door')!.y * (Math.PI / 180)
    const pos = backend.getTranslation('door')!
    expect(pos.x - Math.cos(rot)).toBeCloseTo(0, 1)
  })

  it('fixed joint keeps the relative offset between two bodies', async () => {
    const backend = new RapierBackend()
    await backend.init()
    const floor = new BoxCollider()
    floor.size = { x: 20, y: 1, z: 20 }
    backend.createCollider('floor', floor, transformAt(0, -0.5, 0))
    dynamicBox(backend, 'a', transformAt(0, 3, 0))
    dynamicBox(backend, 'b', transformAt(2, 3, 0))
    const joint = new Joint()
    joint.type = 'fixed'
    backend.createJoint('b', joint, 'a')

    step(backend, 180)
    const a = backend.getTranslation('a')!
    const b = backend.getTranslation('b')!
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeCloseTo(2, 1)
    expect(a.y).toBeLessThan(1)
  })

  it('ball joint hangs a body from the world like a pendulum', async () => {
    const backend = new RapierBackend()
    await backend.init()
    const t = transformAt(2, 5, 0)
    const rb = new Rigidbody()
    backend.createBody('bob', rb, t)
    const col = new SphereCollider()
    col.radius = 0.2
    backend.createCollider('bob', col, t, rb)
    const joint = new Joint()
    joint.type = 'ball'
    joint.anchor = { x: -2, y: 0, z: 0 } // pivot at world (0, 5, 0)
    backend.createJoint('bob', joint, null)

    let minY = Infinity
    step(backend, 240, () => {
      const p = backend.getTranslation('bob')!
      minY = Math.min(minY, p.y)
      expect(Math.hypot(p.x, p.y - 5, p.z)).toBeCloseTo(2, 1)
    })
    expect(minY).toBeLessThan(3.5)
  })

  it('breakForce breaks the joint and reports it once', async () => {
    const backend = new RapierBackend()
    await backend.init()
    dynamicBox(backend, 'lamp', transformAt(0, 5, 0), 10) // weight ≈ 98 N
    const joint = new Joint()
    joint.type = 'ball'
    joint.anchor = { x: 0, y: 0.5, z: 0 }
    joint.breakForce = 50
    backend.createJoint('lamp', joint, null)

    const broken: number[] = []
    step(backend, 30, () => {
      for (const b of backend.breakJoints(FIXED_DT)) broken.push(b.force)
    })
    expect(broken).toHaveLength(1)
    expect(joint._broken).toBe(true)
    expect(backend.getJointCount()).toBe(0)
    expect(backend.getTranslation('lamp')!.y).toBeLessThan(5)
  })

  it('unbreakable joint (breakForce 0) holds a heavy body', async () => {
    const backend = new RapierBackend()
    await backend.init()
    dynamicBox(backend, 'lamp', transformAt(0, 5, 0), 100)
    const joint = new Joint()
    joint.type = 'ball'
    joint.anchor = { x: 0, y: 0.5, z: 0 }
    backend.createJoint('lamp', joint, null)
    step(backend, 60, () => expect(backend.breakJoints(FIXED_DT)).toHaveLength(0))
    expect(backend.getTranslation('lamp')!.y).toBeCloseTo(5, 1)
  })

  it('removing a body removes its joints', async () => {
    const backend = new RapierBackend()
    await backend.init()
    dynamicBox(backend, 'a', transformAt(0, 3, 0))
    dynamicBox(backend, 'b', transformAt(2, 3, 0))
    const joint = new Joint()
    joint.type = 'fixed'
    backend.createJoint('b', joint, 'a')
    expect(backend.getJointCount()).toBe(1)
    backend.removeBody('a')
    expect(backend.getJointCount()).toBe(0)
    step(backend, 10)
  })

  it('hinge motor spins the body at the target velocity', async () => {
    const backend = new RapierBackend()
    await backend.init()
    const t = transformAt(0, 2, 0)
    const rb = new Rigidbody()
    rb.useGravity = false
    backend.createBody('wheel', rb, t)
    backend.createCollider('wheel', new SphereCollider(), t, rb)
    const joint = new Joint()
    joint.type = 'hinge'
    joint.axis = { x: 0, y: 1, z: 0 }
    joint.motor = { enabled: true, targetVelocity: 90, maxForce: 1000 }
    backend.createJoint('wheel', joint, null)
    step(backend, 60)
    expect(backend.getAngularVelocity('wheel')!.y).toBeCloseTo(Math.PI / 2, 1)

    expect(backend.setJointMotor('wheel', -180)).toBe(true)
    step(backend, 60)
    expect(backend.getAngularVelocity('wheel')!.y).toBeCloseTo(-Math.PI, 1)
  })

  it('addForce for 1 s on a 1 kg body gives Δv ≈ F', async () => {
    const backend = new RapierBackend()
    await backend.init()
    const t = transformAt(0, 0, 0)
    const rb = new Rigidbody()
    rb.useGravity = false
    rb.angularDrag = 0
    backend.createBody('ball', rb, t)
    backend.createCollider('ball', new SphereCollider(), t, rb)
    step(backend, 60, () => backend.addForce('ball', { x: 3, y: 0, z: 0 }))
    expect(backend.getLinearVelocity('ball')!.x).toBeCloseTo(3, 1)
  })

  it('ccd body at 200 m/s does not tunnel through a 0.1 m wall', async () => {
    {
      const backend = new RapierBackend()
      await backend.init()
      const wall = new BoxCollider()
      wall.size = { x: 0.1, y: 10, z: 10 }
      backend.createCollider('wall', wall, transformAt(5, 0, 0))
      const t = transformAt(0, 0, 0)
      const rb = new Rigidbody()
      rb.useGravity = false
      rb.ccd = true
      backend.createBody('bullet', rb, t)
      const col = new SphereCollider()
      col.radius = 0.05
      backend.createCollider('bullet', col, t, rb)
      backend.setLinearVelocity('bullet', { x: 200, y: 0, z: 0 })
      step(backend, 10)
      const x = backend.getTranslation('bullet')!.x
      expect(x).toBeLessThan(5)
    }
  })

  it('GameSimulation creates joints from components and fires onBreak + onJointBreak', async () => {
    const world = new World()
    const lamp = world.createEntity('Lamp')
    lamp.getTransform().position = { x: 0, y: 5, z: 0 }
    world.addComponent(lamp.id, 'Rigidbody', { mass: 10 })
    world.addComponent(lamp.id, 'BoxCollider')
    const joint = world.addComponent(lamp.id, 'Joint', { type: 'ball', anchor: { x: 0, y: 0.5, z: 0 }, breakForce: 50 }) as Joint
    const hooks: string[] = []
    joint.onBreak.on(() => hooks.push('onBreak'))

    const sim = new GameSimulation(world)
    sim.scripts = {
      notifyEntity: (id: string, hook: string) => hooks.push(`${hook}:${id === lamp.id}`),
      emit: (event: string) => hooks.push(event),
      fixedUpdate() {},
      update() {},
      lateUpdate() {},
      destroyAll() {},
    } as any
    await sim.initPhysics()
    expect(sim.physics!.getJointCount()).toBe(1)
    for (let i = 0; i < 10; i++) sim.frame(FIXED_DT)
    expect(hooks).toEqual(['onBreak', 'onJointBreak:true', 'joint:break'])
    sim.dispose()
  })
})
