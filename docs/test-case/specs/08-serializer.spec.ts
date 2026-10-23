import { test, expect } from '@playwright/test'
import { World } from '../../../engine/ecs/World'
import { SceneSerializer, stableStringify } from '../../../engine/scene/serializer'
import { TAG_POOL, mulberry32, pick, randFloat, randInt, shuffle, tcId, type Rng } from './_helpers'

// 800 cases: 500 world round-trips + 300 stableStringify invariance checks

function randomWorld(rng: Rng): World {
  const world = new World()
  const ids: string[] = []
  const count = randInt(rng, 1, 25)
  for (let i = 0; i < count; i++) {
    const parentId = ids.length > 0 && rng() < 0.5 ? pick(rng, ids) : null
    const e = world.createEntity(`Obj ${i}`, parentId, undefined, `id-${i}`)
    e.layer = randInt(rng, 0, 31)
    e.active = rng() < 0.9
    e.isStatic = rng() < 0.2
    for (let t = randInt(rng, 0, 3); t > 0; t--) world.addTag(e.id, pick(rng, TAG_POOL))
    const tr = e.getTransform()
    tr.setPosition(randFloat(rng, -50, 50), randFloat(rng, -50, 50), randFloat(rng, -50, 50))
    tr.setRotation(randFloat(rng, -180, 180), randFloat(rng, -180, 180), randFloat(rng, -180, 180))
    tr.setScale(randFloat(rng, 0.1, 4), randFloat(rng, 0.1, 4), randFloat(rng, 0.1, 4))
    if (rng() < 0.4) world.addComponent(e.id, 'Health', { hp: randInt(rng, 1, 100), regen: rng() < 0.5 })
    ids.push(e.id)
  }
  return world
}

function randomValue(rng: Rng, depth: number): unknown {
  const r = rng()
  if (depth > 3 || r < 0.3) return pick(rng, [randInt(rng, -1e6, 1e6), randFloat(rng, -1, 1), `s${randInt(rng, 0, 99)}`, true, false, null])
  if (r < 0.5) return Array.from({ length: randInt(rng, 0, 4) }, () => randomValue(rng, depth + 1))
  const obj: Record<string, unknown> = {}
  for (let i = randInt(rng, 0, 6); i > 0; i--) obj[`k${randInt(rng, 0, 30)}`] = randomValue(rng, depth + 1)
  return obj
}

function reorderKeys(rng: Rng, v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => reorderKeys(rng, x))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of shuffle(rng, Object.keys(v))) out[k] = reorderKeys(rng, (v as any)[k])
    return out
  }
  return v
}

test.describe('SceneSerializer v2', () => {
  let n = 0

  for (let s = 0; s < 500; s++) {
    const seed = 11000 + s
    test(`${tcId('SER', ++n)} serialize → deserialize → serialize is byte-identical (seed ${s})`, () => {
      const first = SceneSerializer.serialize(randomWorld(mulberry32(seed)), `Scene${s}`)
      const copy = new World()
      const meta = SceneSerializer.deserialize(first, copy)
      expect(meta).toEqual({ name: `Scene${s}`, version: 2 })
      expect(SceneSerializer.serialize(copy, `Scene${s}`)).toBe(first)
    })
  }

  for (let s = 0; s < 300; s++) {
    const rng = mulberry32(12000 + s)
    const value = randomValue(rng, 0)
    const reordered = reorderKeys(rng, value)
    test(`${tcId('SER', ++n)} stableStringify ignores key insertion order (seed ${s})`, () => {
      const a = stableStringify(value)
      expect(stableStringify(reordered)).toBe(a)
      expect(JSON.parse(a)).toEqual(value)
    })
  }
})
