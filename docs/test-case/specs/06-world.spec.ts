import { test, expect } from '@playwright/test'
import { World } from '../../../engine/ecs/World'
import type { Entity } from '../../../engine/ecs/Entity'
import { TAG_POOL, mulberry32, pick, randInt, tcId, type Rng } from './_helpers'

// 1.800 cases: 6 hierarchy/tag properties x 300 seeded worlds
const SEEDS = 300

function buildWorld(rng: Rng) {
  const world = new World()
  const count = randInt(rng, 5, 40)
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const parentId = ids.length > 0 && rng() < 0.6 ? pick(rng, ids) : null
    const e = world.createEntity(`E${i}`, parentId, undefined, `e${i}`)
    const tagCount = randInt(rng, 0, 3)
    for (let t = 0; t < tagCount; t++) world.addTag(e.id, pick(rng, TAG_POOL))
    ids.push(e.id)
  }
  return { world, ids }
}

function subtree(world: World, id: string): string[] {
  const out = [id]
  for (const c of world.getEntity(id)!.childIds) out.push(...subtree(world, c))
  return out
}

function assertConsistent(world: World) {
  const all = world.getEntities()
  const ordered = world.getEntitiesInHierarchyOrder()
  expect(new Set(ordered.map((e) => e.id))).toEqual(new Set(all.map((e) => e.id)))
  expect(ordered.length).toBe(all.length)
  const pos = new Map(ordered.map((e, i) => [e.id, i]))
  for (const e of all) {
    if (e.parentId) {
      const parent = world.getEntity(e.parentId)!
      expect(parent.childIds).toContain(e.id)
      expect(pos.get(parent.id)!).toBeLessThan(pos.get(e.id)!)
    } else {
      expect(world.getRootEntityIds()).toContain(e.id)
    }
  }
}

test.describe('ECS World', () => {
  let n = 0
  for (let s = 0; s < SEEDS; s++) {
    const seed = 7000 + s

    test(`${tcId('WLD', ++n)} hierarchy order lists every entity once, parents first (seed ${s})`, () => {
      const { world } = buildWorld(mulberry32(seed))
      assertConsistent(world)
    })

    test(`${tcId('WLD', ++n)} destroyEntity removes exactly its subtree (seed ${s})`, () => {
      const rng = mulberry32(seed)
      const { world, ids } = buildWorld(rng)
      const victim = pick(rng, ids)
      const doomed = subtree(world, victim)
      const before = world.getEntities().length
      const removed: string[] = []
      world.events.on('entityRemoved', (e: Entity) => removed.push(e.id))
      world.destroyEntity(victim)
      expect(world.getEntities().length).toBe(before - doomed.length)
      expect(new Set(removed)).toEqual(new Set(doomed))
      for (const id of doomed) expect(world.getEntity(id)).toBeUndefined()
      assertConsistent(world)
    })

    test(`${tcId('WLD', ++n)} parenting an entity under its own subtree throws PARENT_CYCLE (seed ${s})`, () => {
      const rng = mulberry32(seed)
      const { world, ids } = buildWorld(rng)
      const id = pick(rng, ids)
      const target = pick(rng, subtree(world, id))
      const snapshot = JSON.stringify(world.getEntitiesInHierarchyOrder().map((e) => [e.id, e.parentId, e.childIds]))
      expect(() => world.setParent(id, target)).toThrow(/PARENT_CYCLE/)
      expect(JSON.stringify(world.getEntitiesInHierarchyOrder().map((e) => [e.id, e.parentId, e.childIds]))).toBe(snapshot)
    })

    test(`${tcId('WLD', ++n)} valid reparenting keeps the hierarchy consistent (seed ${s})`, () => {
      const rng = mulberry32(seed)
      const { world, ids } = buildWorld(rng)
      for (let k = 0; k < 10; k++) {
        const id = pick(rng, ids)
        const banned = new Set(subtree(world, id))
        const candidates = ids.filter((x) => !banned.has(x))
        const parent = candidates.length > 0 && rng() < 0.8 ? pick(rng, candidates) : null
        world.setParent(id, parent)
        expect(world.getEntity(id)!.parentId).toBe(parent)
      }
      expect(world.getEntities().length).toBe(ids.length)
      assertConsistent(world)
    })

    test(`${tcId('WLD', ++n)} findByTag matches a full scan for every tag (seed ${s})`, () => {
      const { world } = buildWorld(mulberry32(seed))
      const ordered = world.getEntitiesInHierarchyOrder()
      for (const tag of TAG_POOL) {
        expect(world.findByTag(tag).map((e) => e.id)).toEqual(ordered.filter((e) => e.tags.includes(tag)).map((e) => e.id))
      }
    })

    test(`${tcId('WLD', ++n)} tag index stays correct after add/remove/destroy (seed ${s})`, () => {
      const rng = mulberry32(seed)
      const { world, ids } = buildWorld(rng)
      const alive = new Set(ids)
      for (let k = 0; k < 15 && alive.size > 0; k++) {
        const id = pick(rng, [...alive])
        const tag = pick(rng, TAG_POOL)
        const op = randInt(rng, 0, 2)
        if (op === 0) world.addTag(id, tag)
        else if (op === 1) world.removeTag(id, tag)
        else if (alive.size > 1) {
          for (const d of subtree(world, id)) alive.delete(d)
          world.destroyEntity(id)
        }
      }
      const ordered = world.getEntitiesInHierarchyOrder()
      for (const tag of TAG_POOL) {
        expect(world.findByTag(tag).map((e) => e.id)).toEqual(ordered.filter((e) => e.tags.includes(tag)).map((e) => e.id))
      }
      const pair = [TAG_POOL[0], TAG_POOL[1]]
      expect(world.findByAllTags(pair).map((e) => e.id)).toEqual(ordered.filter((e) => pair.every((t) => e.tags.includes(t))).map((e) => e.id))
      expect(world.findByAnyTag(pair).map((e) => e.id)).toEqual(ordered.filter((e) => pair.some((t) => e.tags.includes(t))).map((e) => e.id))
    })
  }
})
