import { test, expect } from '@playwright/test'
import { Vector3Utils, type Vector3 } from '../../../engine/utils/index'
import { mulberry32, randFloat, tcId } from './_helpers'

// 1.200 cases: 6 algebraic properties x 200 seeded vector pairs
const SEEDS = 200

const vec = (rng: () => number): Vector3 => ({
  x: randFloat(rng, -100, 100),
  y: randFloat(rng, -100, 100),
  z: randFloat(rng, -100, 100),
})

const close = (a: Vector3, b: Vector3) => {
  expect(a.x).toBeCloseTo(b.x, 9)
  expect(a.y).toBeCloseTo(b.y, 9)
  expect(a.z).toBeCloseTo(b.z, 9)
}

test.describe('Vector3Utils', () => {
  let n = 0
  for (let s = 0; s < SEEDS; s++) {
    const rng = mulberry32(1000 + s)
    const a = vec(rng)
    const b = vec(rng)
    const k = randFloat(rng, -10, 10)

    test(`${tcId('VEC', ++n)} add is commutative (seed ${s})`, () => {
      close(Vector3Utils.add(a, b), Vector3Utils.add(b, a))
    })

    test(`${tcId('VEC', ++n)} subtract inverts add (seed ${s})`, () => {
      close(Vector3Utils.subtract(Vector3Utils.add(a, b), b), a)
    })

    test(`${tcId('VEC', ++n)} normalize has unit length (seed ${s})`, () => {
      expect(Vector3Utils.magnitude(Vector3Utils.normalize(a))).toBeCloseTo(1, 9)
    })

    test(`${tcId('VEC', ++n)} cross product is orthogonal to both inputs (seed ${s})`, () => {
      const c = Vector3Utils.cross(a, b)
      const scale = Vector3Utils.magnitude(a) * Vector3Utils.magnitude(b) * 1e-9
      expect(Math.abs(Vector3Utils.dot(c, a))).toBeLessThanOrEqual(scale * Vector3Utils.magnitude(a) + 1e-9)
      expect(Math.abs(Vector3Utils.dot(c, b))).toBeLessThanOrEqual(scale * Vector3Utils.magnitude(b) + 1e-9)
    })

    test(`${tcId('VEC', ++n)} distance is symmetric and non-negative (seed ${s})`, () => {
      const d1 = Vector3Utils.distance(a, b)
      const d2 = Vector3Utils.distance(b, a)
      expect(d1).toBeGreaterThanOrEqual(0)
      expect(d1).toBeCloseTo(d2, 9)
    })

    test(`${tcId('VEC', ++n)} multiply scales magnitude by |k| (seed ${s})`, () => {
      const m = Vector3Utils.magnitude(Vector3Utils.multiply(a, k))
      expect(m).toBeCloseTo(Math.abs(k) * Vector3Utils.magnitude(a), 6)
    })
  }
})
