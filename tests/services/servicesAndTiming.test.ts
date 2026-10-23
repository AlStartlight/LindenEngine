import { describe, it, expect, vi } from 'vitest'
import { Services } from '../../engine/services/Services'
import { SceneManager } from '../../engine/scene/SceneManager'
import { World } from '../../engine/ecs/World'
import { DataAsset } from '../../engine/assets/DataAsset'
import { TimerComponent } from '../../engine/time/Timer'
import { Tween } from '../../engine/time/Tween'
import { SceneSerializer } from '../../engine/scene/serializer'

describe('F1.6–F1.9: Services, Data Assets, Timer/Tween & SceneManager', () => {
  it('TC-F16-01 & TC-F19-01: Service persists (===) across SceneManager.load and retains state', async () => {
    Services.clear()
    class ScoreService {
      public score = 0
    }
    const scoreInstance = new ScoreService()
    scoreInstance.score = 42
    Services.register('ScoreService', scoreInstance)

    const world = new World()
    SceneManager.setWorld(world)

    // Setup 2 scenes
    const world1 = new World()
    world1.createEntity('OldHero')
    const scene1Json = SceneSerializer.serialize(world1, 'Level1')

    const world2 = new World()
    world2.createEntity('NewHero')
    const scene2Json = SceneSerializer.serialize(world2, 'Level2')

    SceneManager.registerScene('Level1', scene1Json)
    SceneManager.registerScene('Level2', scene2Json)

    // Load Level1
    await SceneManager.load('Level1')
    expect(world.getEntities()[0].name).toBe('OldHero')

    // Transition to Level2
    await SceneManager.load('Level2')
    expect(world.getEntities()[0].name).toBe('NewHero')

    // Service remains identical instance and retains score
    const serviceAfter = Services.get<ScoreService>('ScoreService')
    expect(serviceAfter).toBe(scoreInstance)
    expect(serviceAfter.score).toBe(42)
  })

  it('TC-F16-02: Services awake() is called in order of definition', () => {
    Services.clear()
    const callOrder: string[] = []

    const serviceA = { awake: () => callOrder.push('A') }
    const serviceB = { awake: () => callOrder.push('B') }

    Services.register('ServiceA', serviceA)
    Services.register('ServiceB', serviceB)

    Services.setDefinitions([
      { name: 'ServiceA', source: 'scripts/A.ts', enabled: true },
      { name: 'ServiceB', source: 'scripts/B.ts', enabled: true },
    ])

    Services.initializeServices()
    expect(callOrder).toEqual(['A', 'B'])
  })

  it('TC-F17-02: DataAsset shared reference updates simultaneously; duplicate() produces independent clone', () => {
    class WeaponData extends DataAsset {
      public damage = 10
      public durability = 100
    }

    const original = new WeaponData('Sword')
    original.damage = 15

    // Shared reference
    const ref1 = original
    const ref2 = original
    ref1.damage = 25
    expect(ref2.damage).toBe(25)

    // Duplicate
    const clone = original.duplicate()
    expect(clone.name).toBe('Sword (Copy)')
    expect(clone.damage).toBe(25)
    expect(clone.id).not.toBe(original.id)

    // Modifying clone does not alter original
    clone.damage = 99
    expect(original.damage).toBe(25)
  })

  it('TC-F18-01: Timer waitTime=1, oneShot=true triggers onTimeout exactly once across 3 seconds', () => {
    const timer = new TimerComponent(1.0, true, true)
    let timeoutCount = 0
    timer.onTimeout.on(() => timeoutCount++)

    // Simulate 3 seconds at 60Hz
    for (let i = 0; i < 180; i++) {
      timer.onUpdate(1 / 60)
    }

    expect(timeoutCount).toBe(1)
    expect(timer.isRunning).toBe(false)
  })

  it('TC-F18-02: Timer waitTime=1, oneShot=false triggers onTimeout 3 times across 3.5 seconds', () => {
    const timer = new TimerComponent(1.0, false, true)
    let timeoutCount = 0
    timer.onTimeout.on(() => timeoutCount++)

    // Simulate 3.5 seconds at 60Hz (210 steps)
    for (let i = 0; i < 210; i++) {
      timer.onUpdate(1 / 60)
    }

    expect(timeoutCount).toBe(3)
    expect(timer.isRunning).toBe(true)
  })

  it('TC-F18-03: Tween linear interpolates target property halfway at t=0.5', () => {
    const world = new World()
    const entity = world.createEntity('TweenTarget')
    world.setProperty(entity.id, 'Transform', 'position', [0, 0, 0])

    Tween.clear()
    Tween.to(entity, 'Transform.position', [0, 5, 0], 1.0, { ease: 'linear' })

    // Update 0.5 seconds
    Tween.update(0.5)

    const transform = entity.getTransform()
    expect(transform.position.y).toBeCloseTo(2.5, 2)
  })

  it('TC-F18-04: Destroying entity during active tween halts tween and does not invoke then()', () => {
    const world = new World()
    Tween.clear()
    Tween.bindWorld(world)

    const entity = world.createEntity('Victim')
    world.setProperty(entity.id, 'Transform', 'position', [0, 0, 0])

    let thenCalled = false
    Tween.to(entity, 'Transform.position', [0, 10, 0], 1.0).then(() => {
      thenCalled = true
    })

    // Advance 0.3s
    Tween.update(0.3)
    expect(thenCalled).toBe(false)

    // Destroy entity
    world.destroyEntity(entity.id)

    // Advance past completion (1.0s more)
    Tween.update(1.0)
    expect(thenCalled).toBe(false)
  })

  it('TC-F19-02: SceneManager.load with scene not in build throws clear error', async () => {
    const world = new World()
    SceneManager.setWorld(world)
    SceneManager.setScenesInBuild([])

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(SceneManager.load('NotInBuild')).rejects.toThrow(/not found in Scenes In Build/)
    errSpy.mockRestore()
  })
})
