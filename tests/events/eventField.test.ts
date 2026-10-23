import { describe, it, expect, vi } from 'vitest'
import { EventField } from '../../engine/events/EventField'
import { World } from '../../engine/ecs/World'
import { Component } from '../../engine/ecs/Component'
import { BlueprintComponent } from '../../engine/blueprints/BlueprintComponent'
import { EventCustom, InvokeEventNode } from '../../engine/blueprints/BlueprintNode'

describe('F1.2: EventField & Signals (TC-F12-01 to TC-F12-14)', () => {
  it('TC-F12-01: field.on(fn); emit(1) calls fn once with 1', () => {
    const field = new EventField<[number]>()
    const fn = vi.fn()
    field.on(fn)
    field.emit(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(1)
  })

  it('TC-F12-02: const off = field.on(fn); off(); emit() does not call fn', () => {
    const field = new EventField<[number]>()
    const fn = vi.fn()
    const off = field.on(fn)
    off()
    field.emit(1)
    expect(fn).not.toHaveBeenCalled()
  })

  it('TC-F12-03: 3 listeners, 2nd throws -> 1 and 3 still called, error logged', () => {
    const field = new EventField<[number]>()
    const fn1 = vi.fn()
    const fn2 = vi.fn().mockImplementation(() => {
      throw new Error('Listener 2 exploded')
    })
    const fn3 = vi.fn()

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    field.on(fn1)
    field.on(fn2)
    field.on(fn3)
    field.emit(42)

    expect(fn1).toHaveBeenCalledWith(42)
    expect(fn2).toHaveBeenCalledWith(42)
    expect(fn3).toHaveBeenCalledWith(42)
    expect(errSpy).toHaveBeenCalled()

    errSpy.mockRestore()
  })

  it('TC-F12-04: serialized listener pointing to deleted entity is skipped with warning without crashing', () => {
    const world = new World()
    const target = world.createEntity('Target')

    const field = new EventField()
    field.setWorldGetter(() => world)
    field.listeners = [
      {
        targetId: target.id,
        component: 'Door',
        method: 'open',
      },
    ]

    // Destroy target entity
    world.destroyEntity(target.id)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => {
      field.emit()
    }).not.toThrow()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Target entity'))
    warnSpy.mockRestore()
  })

  it('TC-F12-09: Blueprint Custom Event execution via EventField serialized listener', () => {
    const world = new World()
    const door = world.createEntity('Door')

    const bpComp = new BlueprintComponent()
    door.addComponent(bpComp)
    const bp = bpComp.getBlueprint()

    let opened = false
    const customEvent = new EventCustom('OpenDoor')
    bp.addNode(customEvent)

    // Wire custom event to mark opened = true
    const originalExecute = customEvent.execute.bind(customEvent)
    customEvent.execute = (ctx, inputs) => {
      opened = true
      return originalExecute(ctx, inputs)
    }

    const field = new EventField()
    field.setWorldGetter(() => world)
    field.listeners = [
      {
        targetId: door.id,
        component: 'Blueprint',
        method: 'OpenDoor',
      },
    ]

    field.emit()
    expect(opened).toBe(true)
  })

  it('TC-F12-12: listener targeting missing custom event logs warning and does not crash', () => {
    const world = new World()
    const door = world.createEntity('Door')
    const bpComp = new BlueprintComponent()
    door.addComponent(bpComp)

    const field = new EventField()
    field.setWorldGetter(() => world)
    field.listeners = [
      {
        targetId: door.id,
        component: 'Blueprint',
        method: 'NonExistentEvent',
      },
    ]

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => {
      field.emit()
    }).not.toThrow()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found in graph'))
    warnSpy.mockRestore()
  })

  it('TC-F12-13: Custom Event with argument passes data through execution', () => {
    const world = new World()
    const ent = world.createEntity('DamageTarget')
    const bpComp = new BlueprintComponent()
    ent.addComponent(bpComp)
    const bp = bpComp.getBlueprint()

    let receivedDamage = 0
    const damageEvent = new EventCustom('TakeDamage', 'number')
    bp.addNode(damageEvent)

    damageEvent.execute = (_ctx, _inputs) => {
      receivedDamage = damageEvent.currentArg
      return new Map([['Param', receivedDamage]])
    }

    const field = new EventField<[number]>()
    field.setWorldGetter(() => world)
    field.listeners = [
      {
        targetId: ent.id,
        component: 'Blueprint',
        method: 'TakeDamage',
        args: [25],
      },
    ]

    field.emit(10) // overridden by static arg 25
    expect(receivedDamage).toBe(25)
  })

  it('TC-F12-14: Blueprint InvokeEventNode triggers event on entity', () => {
    const world = new World()
    const ent = world.createEntity('Actor')

    let scriptCalled = false
    class ScriptComp extends Component {
      constructor() {
        super('ScriptComp')
      }
      onDied() {
        scriptCalled = true
      }
      clone() {
        return new ScriptComp()
      }
    }
    const script = new ScriptComp()
    ent.addComponent(script)

    const bpComp = new BlueprintComponent()
    ent.addComponent(bpComp)
    const bp = bpComp.getBlueprint()

    const invokeNode = new InvokeEventNode()
    invokeNode.componentName = 'ScriptComp'
    invokeNode.eventName = 'onDied'
    bp.addNode(invokeNode)

    bp.initializeContext(ent, world)
    invokeNode.execute(bp.getExecutionContext()!, new Map())

    expect(scriptCalled).toBe(true)
  })
})
