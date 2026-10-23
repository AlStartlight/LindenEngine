import { test, expect } from '@playwright/test'
import { Tween, Easing, type EasingType } from '../../../engine/time/Tween'
import { World } from '../../../engine/ecs/World'
import { tcId } from './_helpers'

// 276 cases: 22 easings x 12 progress points + 12 lifecycle cases.
// Tween is a module singleton, so every case starts from Tween.clear().
const NAMES = Object.keys(Easing) as EasingType[]
const FRACTIONS = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

test.describe('Tween', () => {
  test.beforeEach(() => Tween.clear())
  let n = 0

  for (const ease of NAMES) {
    for (const f of FRACTIONS) {
      test(`${tcId('TWN', ++n)} ${ease} at ${Math.round(f * 100)}% interpolates from -3 to 7`, () => {
        const target = { value: -3 }
        Tween.to(target, 'value', 7, 2, { ease })
        Tween.update(2 * f)
        expect(target.value).toBeCloseTo(-3 + 10 * Easing[ease](f), 9)
      })
    }
  }

  test(`${tcId('TWN', ++n)} vector arrays interpolate component-wise`, () => {
    const t = { pos: [0, 0, 0] }
    Tween.to(t, 'pos', [2, 4, 6], 1)
    Tween.update(0.5)
    expect(t.pos).toEqual([1, 2, 3])
  })

  test(`${tcId('TWN', ++n)} {x,y,z} objects interpolate from an array target`, () => {
    const t = { position: { x: 0, y: 0, z: 0 } }
    Tween.to(t, 'position', [10, 0, -10], 1)
    Tween.update(0.25)
    expect(t.position).toEqual({ x: 2.5, y: 0, z: -2.5 })
  })

  test(`${tcId('TWN', ++n)} nested path a.b.c is resolved`, () => {
    const t = { a: { b: { c: 1 } } }
    Tween.to(t, 'a.b.c', 3, 1)
    Tween.update(1)
    expect(t.a.b.c).toBe(3)
  })

  test(`${tcId('TWN', ++n)} then() fires once on completion`, () => {
    let calls = 0
    Tween.to({ v: 0 }, 'v', 1, 1).then(() => calls++)
    Tween.update(0.5)
    expect(calls).toBe(0)
    Tween.update(0.6)
    Tween.update(1)
    expect(calls).toBe(1)
  })

  test(`${tcId('TWN', ++n)} then() on a finished tween fires immediately`, () => {
    let calls = 0
    const h = Tween.to({ v: 0 }, 'v', 1, 1)
    Tween.update(1)
    h.then(() => calls++)
    expect(calls).toBe(1)
  })

  test(`${tcId('TWN', ++n)} kill() stops further updates`, () => {
    const t = { v: 0 }
    const h = Tween.to(t, 'v', 10, 1)
    Tween.update(0.5)
    h.kill()
    Tween.update(0.5)
    expect(t.v).toBe(5)
  })

  test(`${tcId('TWN', ++n)} delay postpones the start`, () => {
    const t = { v: 0 }
    Tween.to(t, 'v', 10, 1, { delay: 0.5 })
    Tween.update(0.4)
    expect(t.v).toBe(0)
    Tween.update(0.2)
    expect(t.v).toBeGreaterThan(0)
  })

  test(`${tcId('TWN', ++n)} loops = 3 completes after three cycles`, () => {
    let done = 0
    Tween.to({ v: 0 }, 'v', 1, 1, { loops: 3 }).then(() => done++)
    Tween.update(1)
    Tween.update(1)
    expect(done).toBe(0)
    Tween.update(1)
    expect(done).toBe(1)
  })

  test(`${tcId('TWN', ++n)} killForEntity removes tweens bound to that entity id`, () => {
    const t = { id: 'ent-1', v: 0 }
    Tween.to(t, 'v', 10, 1)
    Tween.killForEntity('ent-1')
    Tween.update(1)
    expect(t.v).toBe(0)
  })

  test(`${tcId('TWN', ++n)} killForEntity leaves other entities running`, () => {
    const a = { id: 'a', v: 0 }
    const b = { id: 'b', v: 0 }
    Tween.to(a, 'v', 10, 1)
    Tween.to(b, 'v', 10, 1)
    Tween.killForEntity('a')
    Tween.update(1)
    expect(a.v).toBe(0)
    expect(b.v).toBe(10)
  })

  test(`${tcId('TWN', ++n)} bindWorld kills a tween when its entity is destroyed`, () => {
    const world = new World()
    const unbind = Tween.bindWorld(world)
    const e = world.createEntity('Mover')
    const tr = e.getTransform()
    Tween.to(e, 'Transform.position', [0, 5, 0], 1)
    Tween.update(0.5)
    expect(tr.position.y).toBeCloseTo(2.5, 9)
    world.destroyEntity(e.id)
    Tween.update(0.5)
    expect(tr.position.y).toBeCloseTo(2.5, 9)
    unbind()
  })

  test(`${tcId('TWN', ++n)} zero duration completes on the first update`, () => {
    const t = { v: 0 }
    Tween.to(t, 'v', 5, 0)
    Tween.update(0.001)
    expect(t.v).toBe(5)
  })
})
