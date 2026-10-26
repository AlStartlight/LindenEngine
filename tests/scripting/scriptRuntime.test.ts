import { describe, it, expect } from 'vitest'
import { World } from '../../engine/ecs/World'
import { ScriptRuntime, ScriptErrorInfo } from '../../engine/scripting/ScriptRuntime'
import '../../engine/ecs/ComponentRegistry'

function worldWithScript(src: string, props: Record<string, unknown> = {}) {
  const world = new World()
  const ent = world.createEntity('Hero')
  world.addComponent(ent.id, 'Script', { src, props })
  return { world, ent }
}

describe('ScriptRuntime', () => {
  it('applies props before onInit and runs lifecycle in order', async () => {
    const calls: string[] = []
    class Hero {
      speed = 1
      onInit(ctx: any) {
        calls.push(`init:${this.speed}:${ctx.entity.name}`)
      }
      onFixedUpdate() {
        calls.push('fixed')
      }
      onUpdate() {
        calls.push('update')
      }
      onLateUpdate() {
        calls.push('late')
      }
      onDestroy() {
        calls.push('destroy')
      }
    }
    const { world } = worldWithScript('scripts/Hero.ts', { speed: 7 })
    const rt = new ScriptRuntime({ world, loadModule: async () => ({ default: Hero }) })
    await rt.loadAll()
    rt.fixedUpdate(1 / 60)
    rt.update(1 / 60)
    rt.lateUpdate(1 / 60)
    rt.destroyAll()
    expect(calls).toEqual(['init:7:Hero', 'fixed', 'update', 'late', 'destroy'])
  })

  it('disables only the failing script and reports where it failed', async () => {
    const errors: ScriptErrorInfo[] = []
    let goodUpdates = 0
    const world = new World()
    const a = world.createEntity('Broken')
    const b = world.createEntity('Fine')
    world.addComponent(a.id, 'Script', { src: 'scripts/Broken.ts' })
    world.addComponent(b.id, 'Script', { src: 'scripts/Fine.ts' })
    const modules: Record<string, any> = {
      'scripts/Broken.ts': {
        default: class {
          onUpdate() {
            throw new Error('boom')
          }
        },
      },
      'scripts/Fine.ts': {
        default: class {
          onUpdate() {
            goodUpdates++
          }
        },
      },
    }
    const rt = new ScriptRuntime({ world, loadModule: async (src) => modules[src], onError: (e) => errors.push(e) })
    await rt.loadAll()
    for (let i = 0; i < 3; i++) rt.update(1 / 60)
    expect(goodUpdates).toBe(3)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ src: 'scripts/Broken.ts', entityName: 'Broken', phase: 'update' })
    expect(rt.activeCount).toBe(1)
  })

  it('reports invalid paths and modules without a default export', async () => {
    const errors: ScriptErrorInfo[] = []
    const world = new World()
    world.addComponent(world.createEntity('A').id, 'Script', { src: '../evil.ts' })
    world.addComponent(world.createEntity('B').id, 'Script', { src: 'scripts/Empty.ts' })
    const rt = new ScriptRuntime({ world, loadModule: async () => ({}), onError: (e) => errors.push(e) })
    await rt.loadAll()
    expect(errors.map((e) => e.phase)).toEqual(['load', 'load'])
    expect(rt.count).toBe(0)
  })

  it('delivers events between scripts', async () => {
    const got: unknown[] = []
    const world = new World()
    world.addComponent(world.createEntity('Coin').id, 'Script', { src: 'scripts/Coin.ts' })
    world.addComponent(world.createEntity('Hud').id, 'Script', { src: 'scripts/Hud.ts' })
    const modules: Record<string, any> = {
      'scripts/Coin.ts': { default: class { onInit(ctx: any) { ctx.emit('coin', 5) } } },
      'scripts/Hud.ts': { default: class { onEvent(name: string, data: unknown) { got.push([name, data]) } } },
    }
    const rt = new ScriptRuntime({ world, loadModule: async (src) => modules[src] })
    await rt.loadAll()
    expect(got).toEqual([['coin', 5]])
  })
})

describe('ScriptRuntime hot reload', () => {
  it('swaps the class, keeps field state, calls onReload and releases old subscriptions', async () => {
    const world = new World()
    world.addComponent(world.createEntity('Hero').id, 'Script', { src: 'scripts/Hero.ts' })
    const bindings: string[] = []
    const createUi = () => ({
      root: () => null,
      query: () => null,
      queryAll: () => [],
      bind: (sel: string) => {
        bindings.push(sel)
        return () => bindings.splice(bindings.indexOf(sel), 1)
      },
      on: () => () => {},
      show: () => {},
      hide: () => {},
    })
    const calls: string[] = []
    let version = 1
    const make = (v: number) =>
      class Hero {
        coins = 0
        onInit(ctx: any) {
          calls.push(`init:v${v}`)
          ctx.ui.bind('#coins', () => this.coins)
        }
        onReload(ctx: any) {
          calls.push(`reload:v${v}:${this.coins}`)
          ctx.ui.bind('#coins', () => this.coins)
        }
        onUpdate() {
          this.coins += v
        }
        onDestroy() {
          calls.push(`destroy:v${v}`)
        }
      }
    const rt = new ScriptRuntime({ world, loadModule: async () => ({ default: make(version) }), createUi: createUi as any })
    await rt.loadAll()
    rt.update(1 / 60)
    rt.update(1 / 60)
    version = 2
    const res = await rt.reload()
    rt.update(1 / 60)
    expect(res).toEqual({ reloaded: 1, failed: 0 })
    expect(calls).toEqual(['init:v1', 'destroy:v1', 'reload:v2:2'])
    expect(bindings).toEqual(['#coins']) // the v1 binding was released
    expect(rt.activeCount).toBe(1)
  })

  it('keeps the old version running when the new module fails, and revives failed scripts once fixed', async () => {
    const world = new World()
    world.addComponent(world.createEntity('A').id, 'Script', { src: 'scripts/A.ts' })
    let updates = 0
    let mode: 'ok' | 'broken' | 'throws' = 'ok'
    const loadModule = async () => {
      if (mode === 'broken') throw new SyntaxError('bad module')
      return {
        default: class {
          onUpdate() {
            if (mode === 'throws') throw new Error('x')
            updates++
          }
        },
      }
    }
    const rt = new ScriptRuntime({ world, loadModule, onError: () => {} })
    await rt.loadAll()
    mode = 'broken'
    expect(await rt.reload()).toEqual({ reloaded: 0, failed: 1 })
    rt.update(1 / 60)
    expect(updates).toBe(1)

    mode = 'throws'
    await rt.reload()
    rt.update(1 / 60)
    expect(rt.activeCount).toBe(0)
    mode = 'ok'
    await rt.reload()
    rt.update(1 / 60)
    expect(rt.activeCount).toBe(1)
    expect(updates).toBe(2)
  })
})
