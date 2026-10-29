import { describe, it, expect, vi } from 'vitest'
import { EventField } from '../../engine/events/EventField'
import { World } from '../../engine/ecs/World'
import { Component } from '../../engine/ecs/Component'

describe('F1.2: EventField & Signals', () => {
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

  it('TC-F12-09: serialized listener calls a component method with static args', () => {
    const world = new World()
    const door = world.createEntity('Door')
    const calls: unknown[][] = []
    class DoorComp extends Component {
      constructor() {
        super('Door')
      }
      open(...args: unknown[]) {
        calls.push(args)
      }
      clone() {
        return new DoorComp()
      }
    }
    door.addComponent(new DoorComp())

    const field = new EventField<[number]>()
    field.setWorldGetter(() => world)
    field.listeners = [
      { targetId: door.id, component: 'Door', method: 'open' },
      { targetId: door.id, component: 'Door', method: 'open', args: ['static'] },
    ]

    field.emit(7)
    expect(calls).toEqual([[7], ['static']])
  })

  it('TC-F12-12: listener left over from removed Blueprints only warns', () => {
    const world = new World()
    const door = world.createEntity('Door')

    const field = new EventField()
    field.setWorldGetter(() => world)
    field.listeners = [{ targetId: door.id, component: 'Blueprint', method: 'OpenDoor' }]

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => field.emit()).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has no component "Blueprint"'))
    warnSpy.mockRestore()
  })
})
