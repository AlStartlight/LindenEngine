import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ParticleSim, parseGradient, sampleCurve, sampleGradient, type ParticleConfig } from '../../engine/vfx/ParticleSim'
import { ParticleEmitter } from '../../engine/vfx/ParticleEmitter'
import { PARTICLE_PRESETS, presetValues } from '../../engine/vfx/presets'
import { PARTICLES, createParticleSystem, createWebGPUParticleMaterial } from '../../engine/vfx/particleRenderer'
import { generateSprite } from '../../engine/vfx/sprites'
import { World } from '../../engine/ecs/World'
import { ComponentRegistry } from '../../engine/ecs/ComponentRegistry'
import { SceneSerializer } from '../../engine/scene/serializer'
import { SceneBridge } from '../../engine/scene/SceneBridge'
import { ScriptRuntime } from '../../engine/scripting/ScriptRuntime'
import { QUALITY_CAPS } from '../../engine/scene/SceneSettings'

function config(overrides: Partial<ParticleConfig> = {}): ParticleConfig {
  const e = new ParticleEmitter()
  return { ...e.toConfig(), seed: 42, ...overrides }
}

function run(sim: ParticleSim, seconds: number, dt = 1 / 60): boolean[] {
  const finished: boolean[] = []
  for (let t = 0; t < seconds - 1e-9; t += dt) finished.push(sim.step(dt))
  return finished
}

describe('M3: ParticleSim', () => {
  it('same seed gives the same particles', () => {
    const a = new ParticleSim(config())
    const b = new ParticleSim(config())
    a.play()
    b.play()
    run(a, 0.5)
    run(b, 0.5)
    expect(a.count).toBe(b.count)
    expect(Array.from(a.px.slice(0, a.count))).toEqual(Array.from(b.px.slice(0, b.count)))
    expect(Array.from(a.vy.slice(0, a.count))).toEqual(Array.from(b.vy.slice(0, b.count)))
  })

  it('rate 30 over 1 s spawns 30 ± 1', () => {
    const sim = new ParticleSim(config({ rate: 30, lifetime: { min: 10, max: 10 }, duration: 5 }))
    sim.play()
    run(sim, 1)
    expect(Math.abs(sim.count - 30)).toBeLessThanOrEqual(1)
  })

  it('never exceeds maxParticles', () => {
    const sim = new ParticleSim(config({ rate: 1000, maxParticles: 50, lifetime: { min: 10, max: 10 } }))
    sim.play()
    run(sim, 1)
    expect(sim.count).toBe(50)
    sim.burst(100)
    expect(sim.count).toBe(50)
  })

  it('fires bursts once per loop, including at time 0', () => {
    const sim = new ParticleSim(config({ rate: 0, duration: 1, loop: true, bursts: [{ time: 0, count: 10 }], lifetime: { min: 10, max: 10 } }))
    sim.play()
    sim.step(1 / 60)
    expect(sim.count).toBe(10)
    run(sim, 0.9)
    expect(sim.count).toBe(10)
    run(sim, 0.2) // crosses into the second loop
    expect(sim.count).toBe(20)
  })

  it('a non-looping emitter reports finished once, after its last particle died', () => {
    const sim = new ParticleSim(config({ loop: false, duration: 0.2, rate: 0, bursts: [{ time: 0, count: 5 }], lifetime: { min: 0.5, max: 0.5 } }))
    sim.play()
    const finished = run(sim, 2)
    expect(finished.filter(Boolean)).toHaveLength(1)
    // Not before the particles (0.5 s) are gone
    expect(finished.indexOf(true)).toBeGreaterThanOrEqual(Math.floor(0.5 * 60) - 1)
    expect(sim.count).toBe(0)
  })

  it('looping emitters keep emitting and never finish', () => {
    const sim = new ParticleSim(config())
    sim.play()
    expect(run(sim, 5).some(Boolean)).toBe(false)
    expect(sim.count).toBeGreaterThan(0)
  })

  it('stop() ends emission; stop(clear) also removes live particles', () => {
    const sim = new ParticleSim(config({ lifetime: { min: 10, max: 10 } }))
    sim.play()
    run(sim, 0.5)
    const n = sim.count
    sim.stop()
    run(sim, 0.5)
    expect(sim.count).toBe(n)
    sim.stop(true)
    expect(sim.count).toBe(0)
  })

  it('gravity pulls particles down; negative gravity lifts them (smoke)', () => {
    const down = new ParticleSim(config({ shape: 'point', speed: { min: 0, max: 0 }, gravity: 1, lifetime: { min: 5, max: 5 } }))
    const up = new ParticleSim(config({ shape: 'point', speed: { min: 0, max: 0 }, gravity: -0.5, lifetime: { min: 5, max: 5 } }))
    down.burst(1)
    up.burst(1)
    run(down, 1)
    run(up, 1)
    expect(down.py[0]).toBeLessThan(-4)
    expect(up.py[0]).toBeGreaterThan(2)
  })

  it('spawns relative to the emitter pose (world space)', () => {
    const sim = new ParticleSim(config({ shape: 'point', speed: { min: 0, max: 0 } }))
    sim.burst(3, { position: { x: 5, y: 1, z: -2 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } })
    expect([sim.px[0], sim.py[0], sim.pz[0]]).toEqual([5, 1, -2])
  })

  it('cone emits around the emitter up axis, rotated by the pose', () => {
    const sim = new ParticleSim(config({ shape: 'cone', coneAngle: 5, speed: { min: 1, max: 1 }, shapeSize: { x: 0, y: 0, z: 0 } }))
    // 90° about Z: local +Y becomes world -X
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
    sim.burst(20, { position: { x: 0, y: 0, z: 0 }, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w } })
    for (let i = 0; i < sim.count; i++) expect(sim.vx[i]).toBeLessThan(-0.99)
  })

  it('samples size curves and colour gradients over lifetime', () => {
    expect(sampleCurve([{ t: 0, v: 1 }, { t: 1, v: 3 }], 0.5)).toBe(2)
    expect(sampleCurve([{ t: 0.2, v: 1 }], 0)).toBe(1)
    const g = parseGradient([
      { t: 0, color: '#ffffff', alpha: 1 },
      { t: 1, color: '#000000', alpha: 0 },
    ])
    const c = sampleGradient(g, 0.5, { r: 0, g: 0, b: 0, a: 0 })
    expect(c.a).toBeCloseTo(0.5)
    expect(c.r).toBeCloseTo(0.5)
  })
})

describe('M3: ParticleEmitter component', () => {
  it('is registered with every preset', () => {
    const def = ComponentRegistry.get('ParticleEmitter')!
    expect(def.menuPath).toBe('Effects/Particle Emitter')
    expect(def.properties.find((p) => p.name === 'preset')!.options).toEqual(['custom', ...PARTICLE_PRESETS])
  })

  it('setting a preset fills the fields; other data fields win whatever their order', () => {
    const world = new World()
    const e = world.createEntity('Fire')
    const comp = world.addComponent(e.id, 'ParticleEmitter', { rate: 99, preset: 'fire' }) as unknown as ParticleEmitter
    expect(comp.preset).toBe('fire')
    expect(comp.rate).toBe(99)
    expect(comp.color).toEqual(presetValues('fire').color)
    expect(comp.light.enabled).toBe(true)
    // The preset's arrays are copied, not shared
    comp.color[0].alpha = 0
    expect(presetValues('fire').color[0].alpha).not.toBe(0)
  })

  it('a tweaked preset survives save and load (preset applies before the saved fields)', () => {
    const world = new World()
    const e = world.createEntity('Smoke')
    world.addComponent(e.id, 'ParticleEmitter', { preset: 'smoke' })
    world.setProperty(e.id, 'ParticleEmitter', 'rate', 3)
    const json = SceneSerializer.serialize(world, 's')
    const data = JSON.parse(json).entities[0].components.find((c: any) => c.type === 'ParticleEmitter').data
    expect(data.preset).toBe('smoke')
    expect(Object.keys(data).some((k) => k.startsWith('_'))).toBe(false)

    const loaded = new World()
    SceneSerializer.deserialize(json, loaded)
    const comp = loaded.getEntity(e.id)!.getComponent('ParticleEmitter') as ParticleEmitter
    expect(comp.preset).toBe('smoke')
    expect(comp.rate).toBe(3)
    expect(comp.blending).toBe('normal')
  })

  it('clone keeps the preset name and the tweaked values', () => {
    const comp = new ParticleEmitter()
    comp.preset = 'sparks'
    comp.rate = 7
    const c = comp.clone()
    expect(c.preset).toBe('sparks')
    expect(c.rate).toBe(7)
    expect(c.size).not.toBe(comp.size)
  })

  it('toConfig clamps maxParticles to the quality cap and sanitizes ranges', () => {
    const comp = new ParticleEmitter()
    comp.maxParticles = 5000
    comp.lifetime = { min: 3, max: 1 }
    const cfg = comp.toConfig(QUALITY_CAPS.low.maxParticlesPerEmitter)
    expect(cfg.maxParticles).toBe(200)
    expect(cfg.lifetime).toEqual({ min: 1, max: 3 })
  })

  it('queues play/stop/burst only while a renderer is attached', () => {
    const comp = new ParticleEmitter()
    comp.burst(5)
    expect(comp._commands).toHaveLength(0)
    comp._attached = true
    comp.burst(5)
    comp.stop({ clear: true })
    expect(comp._commands).toEqual([{ kind: 'burst', count: 5 }, { kind: 'stop', clear: true }])
  })
})

describe('M3: particle rendering', () => {
  it('sprites carry the shape in alpha', () => {
    const soft = generateSprite('soft', 16)
    const centre = ((8 * 16 + 8) * 4) + 3
    expect(soft[centre]).toBeGreaterThan(200)
    expect(soft[3]).toBeLessThan(10) // corner
    expect(generateSprite('square', 16)[centre]).toBe(255)
  })

  it('SceneBridge simulates emitters, applies quality caps and fires onFinished', () => {
    const world = new World()
    const boom = world.createEntity('Boom')
    const comp = world.addComponent(boom.id, 'ParticleEmitter', { preset: 'explosion', seed: 3 }) as unknown as ParticleEmitter
    let finished = 0
    comp.onFinished.on(() => finished++)
    const bridge = new SceneBridge(world)
    bridge.attach(new THREE.Scene(), { backend: 'webgl2', caps: QUALITY_CAPS.low })

    const system = bridge.getParticleSystem(boom.id)!
    expect(bridge.getObject(boom.id)!.getObjectByName(PARTICLES)).toBe(system.object)
    expect(system.sim.capacity).toBe(160)
    // Low profile: no particle light
    expect(system.object.children.some((c) => (c as THREE.PointLight).isPointLight)).toBe(false)

    bridge.update(1 / 60)
    expect(system.mesh.count).toBe(120)
    for (let i = 0; i < 120; i++) bridge.update(1 / 60)
    expect(finished).toBe(1)
    expect(system.mesh.count).toBe(0)
    bridge.dispose()
  })

  it('medium profile adds the flickering light; burst() from a script reaches the simulation', () => {
    const world = new World()
    const fire = world.createEntity('Fire')
    const comp = world.addComponent(fire.id, 'ParticleEmitter', { preset: 'fire', playOnStart: false }) as unknown as ParticleEmitter
    const bridge = new SceneBridge(world)
    bridge.attach(new THREE.Scene(), { backend: 'webgl2', caps: QUALITY_CAPS.medium })
    const system = bridge.getParticleSystem(fire.id)!
    const light = system.object.children.find((c) => (c as THREE.PointLight).isPointLight) as THREE.PointLight
    expect(light).toBeDefined()

    bridge.update(1 / 60)
    expect(system.sim.count).toBe(0)
    comp.burst(25)
    bridge.update(1 / 60)
    expect(system.sim.count).toBe(25)
    expect(light.intensity).toBeGreaterThan(0)
    comp.play()
    bridge.update(0.5)
    expect(system.sim.count).toBeGreaterThan(25)
    bridge.dispose()
    expect(comp._attached).toBe(false)
  })

  it('editor preview filter pauses and hides emitters that are not selected', () => {
    const world = new World()
    const a = world.createEntity('A')
    const b = world.createEntity('B')
    world.addComponent(a.id, 'ParticleEmitter', { preset: 'magic' })
    world.addComponent(b.id, 'ParticleEmitter', { preset: 'magic' })
    const bridge = new SceneBridge(world)
    bridge.attach(new THREE.Scene(), { backend: 'webgl2' })
    bridge.setParticlePreview((id) => id === a.id)
    bridge.update(0.5)
    expect(bridge.getParticleSystem(a.id)!.sim.count).toBeGreaterThan(0)
    expect(bridge.getParticleSystem(b.id)!.sim.count).toBe(0)
    expect(bridge.getParticleSystem(b.id)!.object.visible).toBe(false)
    bridge.dispose()
  })

  it('world-space emitters cancel the entity transform; local ones follow it', () => {
    const world = new World()
    const e = world.createEntity('Torch')
    e.getTransform().position = { x: 10, y: 0, z: 0 }
    world.addComponent(e.id, 'ParticleEmitter', { preset: 'sparks', shape: 'point', speed: { min: 0, max: 0 }, gravity: 0 })
    const scene = new THREE.Scene()
    const bridge = new SceneBridge(world)
    bridge.attach(scene, { backend: 'webgl2' })
    bridge.update(0.2)
    const system = bridge.getParticleSystem(e.id)!
    scene.updateMatrixWorld(true)
    // Particles were born at the entity (x = 10) and the group's world matrix is identity
    expect(system.sim.px[0]).toBeCloseTo(10)
    expect(system.object.matrixWorld.elements[12]).toBeCloseTo(0)
    bridge.dispose()
  })

  it('removing the component disposes its system', () => {
    const world = new World()
    const e = world.createEntity('Fire')
    const comp = world.addComponent(e.id, 'ParticleEmitter', { preset: 'fire' }) as unknown as ParticleEmitter
    const bridge = new SceneBridge(world)
    bridge.attach(new THREE.Scene(), { backend: 'webgl2' })
    world.removeComponent(e.id, 'ParticleEmitter')
    expect(bridge.getParticleSystem(e.id)).toBeUndefined()
    expect(bridge.getObject(e.id)!.getObjectByName(PARTICLES)).toBeUndefined()
    expect(comp._attached).toBe(false)
    bridge.dispose()
  })

  it('builds the WebGPU node material variant', async () => {
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(4), 1)
    const material: any = await createWebGPUParticleMaterial({ map: null, blending: 'additive', alpha })
    expect(material.isNodeMaterial).toBe(true)
    expect(material.opacityNode).toBeTruthy()
    const system = await createParticleSystem(new ParticleEmitter(), { backend: 'webgpu' })
    expect((system.mesh.material as any).isNodeMaterial).toBe(true)
    system.dispose()
  })

  it('prewarm fills a looping emitter at the entity position for still previews', () => {
    const world = new World()
    const e = world.createEntity('Fire')
    e.getTransform().position = { x: 10, y: 0, z: 0 }
    world.addComponent(e.id, 'ParticleEmitter', { preset: 'fire', seed: 1 })
    const bridge = new SceneBridge(world)
    bridge.attach(new THREE.Scene(), { backend: 'webgl2' })
    bridge.prewarmParticles(1)
    const system = bridge.getParticleSystem(e.id)!
    expect(system.mesh.count).toBeGreaterThan(20)
    // Born at the campfire, not at the world origin
    for (let i = 0; i < system.sim.count; i++) expect(Math.abs(system.sim.px[i] - 10)).toBeLessThan(1)
    bridge.dispose()
  })
})

describe('M3: ctx.vfx', () => {
  it('spawn() creates a temporary emitter that is destroyed after it played out', async () => {
    const world = new World()
    const hero = world.createEntity('Hero')
    world.addComponent(hero.id, 'Script', { src: 'scripts/Hit.ts' })
    let spawnedId = ''
    class Hit {
      onInit(ctx: any) {
        const fx = ctx.vfx.spawn('explosion', { x: 1, y: 2, z: 3 }, { overrides: { seed: 9 } })
        spawnedId = fx.id
      }
    }
    const rt = new ScriptRuntime({ world, loadModule: async () => ({ default: Hit }) })
    await rt.loadAll()
    const fx = world.getEntity(spawnedId)!
    expect(fx.getTransform().position).toEqual({ x: 1, y: 2, z: 3 })
    const comp = fx.getComponent('ParticleEmitter') as ParticleEmitter
    expect(comp.preset).toBe('explosion')
    expect(comp.seed).toBe(9)

    rt.update(0.5)
    expect(world.getEntity(spawnedId)).toBeDefined()
    rt.update(1.5) // explosion: 0.2 s emission + 1.1 s max lifetime
    expect(world.getEntity(spawnedId)).toBeUndefined()
    rt.destroyAll()
  })

  it('play/stop/burst target this entity by default and are no-ops headless', async () => {
    const world = new World()
    const torch = world.createEntity('Torch')
    world.addComponent(torch.id, 'ParticleEmitter', { preset: 'fire' })
    world.addComponent(torch.id, 'Script', { src: 'scripts/Torch.ts' })
    let ctxRef: any
    class Torch {
      onInit(ctx: any) {
        ctxRef = ctx
      }
    }
    const rt = new ScriptRuntime({ world, loadModule: async () => ({ default: Torch }) })
    await rt.loadAll()
    const comp = torch.getComponent('ParticleEmitter') as ParticleEmitter
    ctxRef.vfx.burst(10)
    expect(comp._commands).toHaveLength(0) // nothing renders it headless

    comp._attached = true
    ctxRef.vfx.stop(undefined, { clear: true })
    ctxRef.vfx.play()
    expect(comp._commands.map((c) => c.kind)).toEqual(['stop', 'play'])
    rt.destroyAll()
  })
})
