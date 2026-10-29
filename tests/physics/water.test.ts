import { describe, it, expect, beforeAll } from 'vitest'
import * as THREE from 'three'
import { loadRapier } from '../../engine/physics/RapierBackend'
import { buoyancyForce, overWater, waterVolume } from '../../engine/physics/buoyancy'
import { World } from '../../engine/ecs/World'
import { ComponentRegistry } from '../../engine/ecs/ComponentRegistry'
import { GameSimulation, FIXED_DT } from '../../engine/runtime/GameSimulation'
import { SceneBridge } from '../../engine/scene/SceneBridge'
import { WATER, createWaterObject, generateWaterNormals, sunDirection } from '../../engine/renderer/water'
import { QUALITY_CAPS } from '../../engine/scene/SceneSettings'

const g = 9.81
const box = (minY: number, maxY: number) => ({ min: { x: -0.5, y: minY, z: -0.5 }, max: { x: 0.5, y: maxY, z: 0.5 } })

function scriptsSpy(log: string[]) {
  return {
    notifyEntity: (id: string, hook: string) => log.push(`${hook}:${id}`),
    emit: (event: string) => log.push(event),
    fixedUpdate() {},
    update() {},
    lateUpdate() {},
    destroyAll() {},
  } as any
}

describe('M2: buoyancyForce', () => {
  it('is zero when dry, half when half under, full when submerged', () => {
    const dry = buoyancyForce({ surfaceY: 0, bounds: box(1, 2), volume: 1, density: 1000, gravity: g })
    expect(dry.submerged).toBe(0)
    expect(dry.force).toBe(0)

    const half = buoyancyForce({ surfaceY: 0, bounds: box(-0.5, 0.5), volume: 1, density: 1000, gravity: g })
    expect(half.submerged).toBeCloseTo(0.5)
    expect(half.force).toBeCloseTo(1000 * g * 0.5)
    // Applied at the centre of the wet part: between -0.5 and 0
    expect(half.point.y).toBeCloseTo(-0.25)

    const under = buoyancyForce({ surfaceY: 10, bounds: box(-0.5, 0.5), volume: 1, density: 1025, gravity: g })
    expect(under.submerged).toBe(1)
    expect(under.force).toBeCloseTo(1025 * g)
  })

  it('waterVolume scales the plane with the Transform and overWater tests the body centre', () => {
    const w = waterVolume('lake', { size: { x: 10, y: 4 }, density: 1000, linearDrag: 1, angularDrag: 0.5 }, { x: 2, y: 1, z: 0 }, { x: 2, y: 1, z: 1 })
    expect([w.minX, w.maxX, w.minZ, w.maxZ, w.surfaceY]).toEqual([-8, 12, -2, 2, 1])
    expect(overWater(w, box(0, 1))).toBe(true)
    expect(overWater(w, { min: { x: 20, y: 0, z: 0 }, max: { x: 21, y: 1, z: 1 } })).toBe(false)
  })
})

describe('M2: Water in GameSimulation', () => {
  beforeAll(async () => {
    await loadRapier()
  }, 10000)

  function lakeWorld(density: number, y = 3) {
    const world = new World()
    const lake = world.createEntity('Lake')
    world.addComponent(lake.id, 'Water', { size: { x: 20, y: 20 } })
    const crate = world.createEntity('Crate')
    crate.getTransform().position = { x: 0, y, z: 0 }
    world.addComponent(crate.id, 'Rigidbody', { mass: density }) // 1 m³ box → density = mass
    world.addComponent(crate.id, 'BoxCollider')
    return { world, lake, crate }
  }

  it('a density-500 box floats about half submerged', async () => {
    const { world, crate } = lakeWorld(500)
    const sim = new GameSimulation(world)
    await sim.initPhysics()
    for (let i = 0; i < 600; i++) sim.frame(FIXED_DT)
    const y = crate.getTransform().position.y
    // Centre at 0 → half under the surface at y = 0
    expect(y).toBeGreaterThan(-0.12)
    expect(y).toBeLessThan(0.12)
    sim.dispose()
  })

  it('a density-2000 box sinks', async () => {
    const { world, crate } = lakeWorld(2000)
    const sim = new GameSimulation(world)
    await sim.initPhysics()
    for (let i = 0; i < 300; i++) sim.frame(FIXED_DT)
    expect(crate.getTransform().position.y).toBeLessThan(-3)
    sim.dispose()
  })

  it('fires onEnterWater / water:enter once and water:exit when the body leaves', async () => {
    // Placed at its floating depth so it does not bob in and out of the surface
    const { world, crate } = lakeWorld(500, 0)
    const sim = new GameSimulation(world)
    const log: string[] = []
    sim.scripts = scriptsSpy(log)
    await sim.initPhysics()
    for (let i = 0; i < 300; i++) sim.frame(FIXED_DT)
    expect(log.filter((e) => e === 'water:enter')).toHaveLength(1)
    expect(log).toContain(`onEnterWater:${crate.id}`)
    expect(log).not.toContain('water:exit')

    // Pull the crate out of the lake
    sim.physics!.setTranslation(crate.id, { x: 50, y: 3, z: 0 })
    sim.physics!.setLinearVelocity(crate.id, { x: 0, y: 0, z: 0 })
    // Collider positions follow the teleport on the next physics step
    sim.frame(FIXED_DT)
    sim.frame(FIXED_DT)
    expect(log.filter((e) => e === 'water:exit')).toHaveLength(1)
    expect(log).toContain(`onExitWater:${crate.id}`)
    sim.dispose()
  })

  it('CharacterMovement.inWater is true while the character centre is under the surface', async () => {
    const world = new World()
    const lake = world.createEntity('Lake')
    world.addComponent(lake.id, 'Water', { size: { x: 20, y: 20 } })
    const hero = world.createEntity('Hero')
    hero.getTransform().position = { x: 0, y: -0.5, z: 0 }
    world.addComponent(hero.id, 'CharacterMovement', { gravity: 0 })
    const log: string[] = []
    const sim = new GameSimulation(world)
    sim.scripts = scriptsSpy(log)
    await sim.initPhysics()
    sim.frame(FIXED_DT)
    const movement = hero.getComponent<any>('CharacterMovement')!
    expect(movement.inWater).toBe(true)
    expect(log).toContain(`onEnterWater:${hero.id}`)

    // Lower the lake below the character (a draining pool)
    lake.getTransform().position = { x: 0, y: -5, z: 0 }
    sim.frame(FIXED_DT)
    expect(movement.inWater).toBe(false)
    expect(log).toContain(`onExitWater:${hero.id}`)
    sim.dispose()
  })

  it('buoyancy: false turns the lake into scenery', async () => {
    const { world, lake, crate } = lakeWorld(500)
    world.getEntity(lake.id)!.getComponent<any>('Water')!.buoyancy = false
    const sim = new GameSimulation(world)
    await sim.initPhysics()
    for (let i = 0; i < 120; i++) sim.frame(FIXED_DT)
    expect(crate.getTransform().position.y).toBeLessThan(-3)
    sim.dispose()
  })
})

describe('M2: water rendering', () => {
  it('registers Water under Environment/', () => {
    expect(ComponentRegistry.get('Water')?.menuPath).toBe('Environment/Water')
  })

  it('generated normal map tiles seamlessly and points mostly up', () => {
    const size = 64
    const data = generateWaterNormals(size, 7)
    expect(data).toHaveLength(size * size * 4)
    // Column 0 continues column size-1 the way neighbouring columns do (no seam)
    const at = (x: number, y: number, c: number) => data[(y * size + x) * 4 + c]
    let seam = 0
    let inner = 0
    for (let y = 0; y < size; y++) {
      seam += Math.abs(at(0, y, 0) - at(size - 1, y, 0))
      inner += Math.abs(at(1, y, 0) - at(0, y, 0))
    }
    expect(seam).toBeLessThan(inner * 2 + size)
    let blue = 0
    for (let i = 2; i < data.length; i += 4) blue += data[i]
    expect(blue / (size * size)).toBeGreaterThan(200)
  })

  it('SceneBridge shows a plain plane at once, then the reflective WebGL shader', async () => {
    const world = new World()
    const lake = world.createEntity('Lake')
    world.addComponent(lake.id, 'Water', { size: { x: 8, y: 6 } })
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene, { backend: 'webgl2', caps: QUALITY_CAPS.medium })

    const group = bridge.getObject(lake.id)!
    const plain = group.getObjectByName(WATER) as THREE.Mesh
    expect(plain.userData.water.kind).toBe('plain')
    await bridge.whenIdle()
    const water = group.getObjectByName(WATER) as THREE.Mesh
    expect(water.userData.water.kind).toBe('webgl')
    expect(group.children.filter((c) => c.name === WATER)).toHaveLength(1)

    const before = (water.material as THREE.ShaderMaterial).uniforms.time.value
    bridge.update(0.5)
    expect((water.material as THREE.ShaderMaterial).uniforms.time.value).toBeCloseTo(before + 0.5)

    world.removeComponent(lake.id, 'Water')
    expect(group.getObjectByName(WATER)).toBeUndefined()
    bridge.dispose()
  })

  it('low quality keeps the plain plane (no reflection pass)', async () => {
    const world = new World()
    const lake = world.createEntity('Lake')
    world.addComponent(lake.id, 'Water')
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene, { backend: 'webgl2', caps: QUALITY_CAPS.low })
    await bridge.whenIdle()
    expect((bridge.getObject(lake.id)!.getObjectByName(WATER) as THREE.Mesh).userData.water.kind).toBe('plain')
    bridge.dispose()
  })

  it('removing Water before the shader loads drops the late build', async () => {
    const world = new World()
    const lake = world.createEntity('Lake')
    world.addComponent(lake.id, 'Water')
    const bridge = new SceneBridge(world)
    bridge.attach(new THREE.Scene(), { backend: 'webgl2', caps: QUALITY_CAPS.high })
    world.removeComponent(lake.id, 'Water')
    await bridge.whenIdle()
    expect(bridge.getObject(lake.id)!.getObjectByName(WATER)).toBeUndefined()
    bridge.dispose()
  })

  it('builds the WebGPU WaterMesh variant', async () => {
    const mesh = await createWaterObject({ size: { x: 4, y: 4 } }, { backend: 'webgpu' })
    expect(mesh.userData.water.kind).toBe('webgpu')
    expect((mesh as any).isWaterMesh).toBe(true)
  })

  it('sunDirection follows the first directional light', () => {
    const scene = new THREE.Scene()
    const sun = new THREE.DirectionalLight()
    sun.position.set(0, 10, 0)
    scene.add(sun, sun.target)
    scene.updateMatrixWorld(true)
    expect(sunDirection(scene).toArray().map((n) => Math.round(n * 1000) / 1000)).toEqual([0, 1, 0])
  })
})
