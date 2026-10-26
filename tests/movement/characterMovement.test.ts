import { describe, it, expect, afterEach } from 'vitest'
import { World } from '../../engine/ecs/World'
import { GameSimulation } from '../../engine/runtime/GameSimulation'
import { Input } from '../../engine/input/InputActions'
import { CharacterMovement } from '../../engine/movement/CharacterMovement'
import '../../engine/ecs/ComponentRegistry'

const DT = 1 / 60

async function setup(opts: { ground?: boolean; physics?: boolean; props?: Partial<CharacterMovement>; y?: number } = {}) {
  const world = new World()
  if (opts.ground !== false) {
    const ground = world.createEntity('Ground')
    ground.getTransform().position = { x: 0, y: -0.5, z: 0 }
    world.addComponent(ground.id, 'BoxCollider', { size: { x: 200, y: 1, z: 200 } })
  }
  const player = world.createEntity('Player')
  player.getTransform().position = { x: 0, y: opts.y ?? 1.05, z: 0 }
  const cm = world.addComponent<CharacterMovement>(player.id, 'CharacterMovement')
  Object.assign(cm, opts.props ?? {})
  const sim = new GameSimulation(world)
  if (opts.physics !== false) await sim.initPhysics()
  // settle onto the ground
  for (let i = 0; i < 20; i++) sim.frame(DT)
  return { world, sim, player, cm }
}

function run(sim: GameSimulation, seconds: number, each?: () => void) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    each?.()
    sim.frame(DT)
  }
}

afterEach(() => Input.releaseAll())

describe('CharacterMovement', () => {
  it('requires a CharacterController and lands on the ground', async () => {
    const { player, cm } = await setup()
    expect(player.hasComponent('CharacterController')).toBe(true)
    expect(player.hasComponent('CapsuleCollider')).toBe(true)
    expect(cm.isGrounded).toBe(true)
    expect(player.getTransform().position.y).toBeGreaterThan(0.9)
    expect(player.getTransform().position.y).toBeLessThan(1.2)
  })

  it('walks forward (W = -Z) at about walkSpeed and sprints faster', async () => {
    const { sim, player } = await setup()
    Input.setBindingDown('Keyboard/KeyW')
    run(sim, 1)
    const walked = -player.getTransform().position.z
    expect(walked).toBeGreaterThan(3.5)
    expect(walked).toBeLessThan(4.05)

    const z0 = player.getTransform().position.z
    Input.setBindingDown('Keyboard/ShiftLeft')
    run(sim, 1)
    expect(z0 - player.getTransform().position.z).toBeGreaterThan(6.5)
  })

  it('moves slower with a half-tilted joystick (analog)', async () => {
    const { sim, player } = await setup()
    Input.setVirtualAxis('Touch/Joystick', 0, 0.5)
    run(sim, 1)
    const d = -player.getTransform().position.z
    const expected = 4 * ((0.5 - 0.15) / 0.85)
    expect(d).toBeGreaterThan(expected * 0.85)
    expect(d).toBeLessThan(expected * 1.05)
    Input.setVirtualAxis('Touch/Joystick', 0, 0)
  })

  it('jumps to jumpHeight and cannot jump again in the air with maxJumps = 1', async () => {
    const { sim, player, cm } = await setup()
    const y0 = player.getTransform().position.y
    let maxY = y0
    Input.setBindingDown('Keyboard/Space')
    sim.frame(DT)
    Input.setBindingUp('Keyboard/Space')
    let pressedAgain = false
    run(sim, 1.5, () => {
      maxY = Math.max(maxY, player.getTransform().position.y)
      if (!pressedAgain && player.getTransform().position.y > y0 + 0.8) {
        pressedAgain = true
        Input.setBindingDown('Keyboard/Space')
      } else if (pressedAgain) Input.setBindingUp('Keyboard/Space')
    })
    expect(maxY - y0).toBeGreaterThan(1.2 * 0.92)
    expect(maxY - y0).toBeLessThan(1.2 * 1.08)
    expect(cm.isGrounded).toBe(true)
  })

  it('double jumps with maxJumps = 2', async () => {
    const { sim, player } = await setup({ props: { maxJumps: 2 } })
    const y0 = player.getTransform().position.y
    let maxY = y0
    const tap = () => {
      Input.setBindingDown('Keyboard/Space')
      sim.frame(DT)
      Input.setBindingUp('Keyboard/Space')
    }
    tap()
    run(sim, 0.3, () => (maxY = Math.max(maxY, player.getTransform().position.y)))
    tap()
    run(sim, 1, () => (maxY = Math.max(maxY, player.getTransform().position.y)))
    expect(maxY - y0).toBeGreaterThan(1.6)
  })

  it('turns with Q/E at turnSpeed', async () => {
    const { sim, player } = await setup()
    Input.setBindingDown('Keyboard/KeyE')
    run(sim, 0.5)
    expect(player.getTransform().rotation.y).toBeCloseTo(-90, 0)
    Input.setBindingUp('Keyboard/KeyE')
    Input.setBindingDown('Keyboard/KeyQ')
    run(sim, 0.5)
    expect(Math.abs(player.getTransform().rotation.y)).toBeLessThan(2)
  })

  it('flies up with E and down with Q in fly mode', async () => {
    const { sim, player } = await setup({ props: { mode: 'fly' } })
    const y0 = player.getTransform().position.y
    Input.setBindingDown('Keyboard/KeyE')
    run(sim, 1)
    expect(player.getTransform().position.y - y0).toBeGreaterThan(3)
    Input.setBindingUp('Keyboard/KeyE')
    const y1 = player.getTransform().position.y
    Input.setBindingDown('Keyboard/KeyQ')
    run(sim, 0.5)
    expect(player.getTransform().position.y).toBeLessThan(y1 - 0.5)
  })

  it('moves relative to the camera yaw and faces the movement direction', async () => {
    const { sim, player } = await setup()
    sim.viewYaw = Math.PI / 2 // camera looking down -X
    Input.setBindingDown('Keyboard/KeyW')
    run(sim, 1)
    const p = player.getTransform().position
    expect(p.x).toBeLessThan(-3)
    expect(Math.abs(p.z)).toBeLessThan(0.1)
    expect(player.getTransform().rotation.y).toBeCloseTo(90, 0)
  })

  it('keeps 2D characters on their plane (lockAxis z)', async () => {
    const { sim, player } = await setup({ props: { lockAxis: 'z' } })
    Input.setBindingDown('Keyboard/KeyW')
    Input.setBindingDown('Keyboard/KeyD')
    run(sim, 1)
    const p = player.getTransform().position
    expect(Math.abs(p.z)).toBeLessThan(0.001)
    expect(p.x).toBeGreaterThan(3)
  })

  it('allows a jump shortly after walking off a ledge (coyote time)', async () => {
    const world = new World()
    const ledge = world.createEntity('Ledge')
    ledge.getTransform().position = { x: 0, y: -0.5, z: 0 }
    world.addComponent(ledge.id, 'BoxCollider', { size: { x: 4, y: 1, z: 4 } })
    const player = world.createEntity('Player')
    player.getTransform().position = { x: 0, y: 1.05, z: 0 }
    const cm = world.addComponent<CharacterMovement>(player.id, 'CharacterMovement')
    const sim = new GameSimulation(world)
    await sim.initPhysics()
    run(sim, 0.3)
    expect(cm.isGrounded).toBe(true)

    // Walk off the edge; jump on the first frame the character is no longer grounded
    Input.setBindingDown('Keyboard/KeyW')
    let airborneFrames = 0
    for (let i = 0; i < 120 && cm.isGrounded; i++) sim.frame(DT)
    expect(cm.isGrounded).toBe(false)
    Input.setBindingDown('Keyboard/Space')
    sim.frame(DT)
    airborneFrames++
    expect(cm.velocity.y).toBeGreaterThan(5)
    expect(cm.jumpsUsed).toBe(1)
    void airborneFrames
  })

  it('works without physics on a flat y = 0 ground', async () => {
    const { sim, player, cm } = await setup({ ground: false, physics: false, y: 3 })
    run(sim, 1)
    expect(cm.isGrounded).toBe(true)
    expect(player.getTransform().position.y).toBeCloseTo(1, 1)
  })
})

describe('CharacterMovement and triggers', () => {
  it('walks through trigger colliders and reports enter/exit', async () => {
    const world = new World()
    const ground = world.createEntity('Ground')
    ground.getTransform().position = { x: 0, y: -0.5, z: 0 }
    world.addComponent(ground.id, 'BoxCollider', { size: { x: 100, y: 1, z: 100 } })
    const door = world.createEntity('Door')
    door.getTransform().position = { x: 0, y: 1, z: -3 }
    world.addComponent(door.id, 'BoxCollider', { size: { x: 3, y: 2, z: 1 }, isTrigger: true })
    const player = world.createEntity('Player')
    player.getTransform().position = { x: 0, y: 1.05, z: 0 }
    world.addComponent(player.id, 'CharacterMovement')
    const events: string[] = []
    const capsule = player.getComponent('CapsuleCollider') as any
    capsule.onTriggerEnter.on((other: any) => events.push(`enter:${other.name}`))
    capsule.onTriggerExit.on((other: any) => events.push(`exit:${other.name}`))
    const sim = new GameSimulation(world)
    await sim.initPhysics()
    run(sim, 0.3)
    Input.setBindingDown('Keyboard/KeyW')
    run(sim, 2)
    expect(player.getTransform().position.z).toBeLessThan(-6)
    expect(events).toEqual(['enter:Door', 'exit:Door'])
  })
})

describe('scene round trip keeps collider events', () => {
  it('EventFields survive serialize -> deserialize (listeners restored, field still subscribable)', async () => {
    const { SceneSerializer } = await import('../../engine/scene/serializer')
    const world = new World()
    const e = world.createEntity('Box')
    world.addComponent(e.id, 'BoxCollider', { isTrigger: true })
    ;(e.getComponent('BoxCollider') as any).onTriggerEnter.listeners.push({ targetId: 'x', method: 'open' })
    const json = SceneSerializer.serialize(world, 'S')
    const world2 = new World()
    SceneSerializer.deserialize(json, world2)
    const field = (world2.getEntities()[0].getComponent('BoxCollider') as any).onTriggerEnter
    expect(typeof field.on).toBe('function')
    expect(field.listeners).toEqual([{ targetId: 'x', method: 'open' }])
  })
})
