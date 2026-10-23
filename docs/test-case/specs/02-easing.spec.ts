import { test, expect } from '@playwright/test'
import { Easing, type EasingType } from '../../../engine/time/Tween'
import { tcId } from './_helpers'

// 1.100 cases: 22 easing functions x (2 endpoints + 30 range samples + 18 symmetry samples)
const NAMES = Object.keys(Easing) as EasingType[]
const FAMILIES = ['quad', 'cubic', 'quart', 'sine', 'expo', 'circ', 'bounce'] as const

/** Out(t) = 1 - In(1 - t); InOut(t) + InOut(1 - t) = 1; linear satisfies both */
function dualOf(name: EasingType): ((t: number) => number) | null {
  if (name === 'linear') return (t) => 1 - Easing.linear(1 - t)
  for (const f of FAMILIES) {
    if (name === `${f}In`) return (t) => 1 - Easing[`${f}Out` as EasingType](1 - t)
    if (name === `${f}Out`) return (t) => 1 - Easing[`${f}In` as EasingType](1 - t)
    if (name === `${f}InOut`) return (t) => 1 - Easing[name](1 - t)
  }
  return null
}

test.describe('Easing (ported from Godot easing_equations.h)', () => {
  let n = 0
  for (const name of NAMES) {
    const fn = Easing[name]

    test(`${tcId('EAS', ++n)} ${name}(0) = 0`, () => {
      expect(fn(0)).toBeCloseTo(0, 9)
    })

    test(`${tcId('EAS', ++n)} ${name}(1) = 1`, () => {
      expect(fn(1)).toBeCloseTo(1, 9)
    })

    for (let i = 1; i <= 30; i++) {
      const t = i / 31
      test(`${tcId('EAS', ++n)} ${name}(${t.toFixed(4)}) stays within [0, 1]`, () => {
        const v = fn(t)
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(-1e-9)
        expect(v).toBeLessThanOrEqual(1 + 1e-9)
      })
    }

    const dual = dualOf(name)
    for (let i = 1; i <= 18; i++) {
      const t = i / 19
      test(`${tcId('EAS', ++n)} ${name}(${t.toFixed(4)}) matches its In/Out dual`, () => {
        expect(dual).not.toBeNull()
        expect(fn(t)).toBeCloseTo(dual!(t), 9)
      })
    }
  }
})
