import { expect } from '@playwright/test'
import { parseSceneFile } from '../../../engine/scene/parseSceneFile'
import { SceneSerializer } from '../../../engine/scene/serializer'
import { World } from '../../../engine/ecs/World'
import type { Case } from '../lib/define'
import { TAGS, mulberry32, pick, randFloat, randInt, round3, seedOf, type Rng } from '../lib/util'

// Scene — 100.000 cases
//   40.000 valid .lscene v1 files            (one seed each)
//   30.000 invalid files: 12 defects x 2.500  (one seed each)
//   20.000 serializer v2 round-trips          (one seed each)
//   10.000 world hierarchy properties: 5 x 2.000
export const COUNT = 100_000

const PRIMITIVES = ['box', 'sphere', 'cylinder', 'torus', 'cone', 'plane'] as const
const v3 = (rng: Rng, lo: number, hi: number) => [round3(randFloat(rng, lo, hi)), round3(randFloat(rng, lo, hi)), round3(randFloat(rng, lo, hi))]
const hex = (rng: Rng) => '#' + randInt(rng, 0, 0xffffff).toString(16).padStart(6, '0')

function makeScene(seed: number, minObjects = 0) {
  const rng = mulberry32(seed)
  const count = randInt(rng, minObjects, 30)
  const objects: any[] = []
  for (let i = 0; i < count; i++) {
    const parentId = i > 0 && rng() < 0.5 ? objects[randInt(rng, 0, i - 1)].id : null
    objects.push({
      id: `obj-${i}`,
      name: `Object ${i}`,
      parentId,
      kind: 'primitive',
      primitive: pick(rng, PRIMITIVES),
      transform: { position: v3(rng, -50, 50), rotation: v3(rng, -180, 180), scale: v3(rng, 0.1, 5) },
      material: { color: hex(rng), roughness: round3(rng()), metalness: round3(rng()) },
    })
  }
  return { rng, scene: { format: 'linden-scene', version: 1, name: `Scene ${seed}`, camera: { position: v3(rng, -20, 20), target: v3(rng, -5, 5) }, objects } as any }
}

const objectCount = (seed: number, min = 0) => randInt(mulberry32(seed), min, 30)

type Defect = { name: string; code: string; apply: (s: any, rng: Rng) => string }
const DEFECTS: Defect[] = [
  { name: 'truncated JSON', code: 'INVALID_JSON', apply: (s, r) => { const j = JSON.stringify(s); return j.slice(0, randInt(r, 1, j.length - 1)) } },
  { name: 'wrong format tag', code: 'NOT_A_SCENE', apply: (s) => JSON.stringify({ ...s, format: 'unity-scene' }) },
  { name: 'top-level array', code: 'NOT_A_SCENE', apply: (s) => JSON.stringify([s]) },
  { name: 'future version', code: 'UNSUPPORTED_VERSION', apply: (s, r) => JSON.stringify({ ...s, version: randInt(r, 2, 99) }) },
  { name: 'version zero', code: 'SCHEMA_INVALID', apply: (s) => JSON.stringify({ ...s, version: 0 }) },
  { name: 'invalid color', code: 'SCHEMA_INVALID', apply: (s, r) => { pick(r, s.objects as any[]).material.color = 'red'; return JSON.stringify(s) } },
  { name: 'roughness above 1', code: 'SCHEMA_INVALID', apply: (s, r) => { pick(r, s.objects as any[]).material.roughness = 1.001 + r(); return JSON.stringify(s) } },
  { name: 'unknown primitive', code: 'SCHEMA_INVALID', apply: (s, r) => { pick(r, s.objects as any[]).primitive = 'teapot'; return JSON.stringify(s) } },
  { name: 'duplicate id', code: 'SCHEMA_INVALID', apply: (s) => { s.objects.push({ ...s.objects[0], parentId: null }); return JSON.stringify(s) } },
  { name: 'missing parent', code: 'SCHEMA_INVALID', apply: (s, r) => { pick(r, s.objects as any[]).parentId = 'ghost'; return JSON.stringify(s) } },
  { name: 'self parent', code: 'SCHEMA_INVALID', apply: (s, r) => { const o = pick(r, s.objects as any[]); o.parentId = o.id; return JSON.stringify(s) } },
  { name: 'parent cycle', code: 'SCHEMA_INVALID', apply: (s) => { s.objects.push({ ...s.objects[0], id: 'cyc-a', parentId: 'cyc-b' }, { ...s.objects[0], id: 'cyc-b', parentId: 'cyc-a' }); return JSON.stringify(s) } },
]

export function randomWorld(seed: number): World {
  const rng = mulberry32(seed)
  const world = new World()
  const ids: string[] = []
  const count = randInt(rng, 1, 20)
  for (let i = 0; i < count; i++) {
    const parentId = ids.length > 0 && rng() < 0.5 ? pick(rng, ids) : null
    const e = world.createEntity(`Obj ${i}`, parentId, undefined, `id-${i}`)
    e.layer = randInt(rng, 0, 31)
    e.active = rng() < 0.9
    e.isStatic = rng() < 0.2
    for (let t = randInt(rng, 0, 3); t > 0; t--) world.addTag(e.id, pick(rng, TAGS))
    const tr = e.getTransform()
    tr.setPosition(round3(randFloat(rng, -50, 50)), round3(randFloat(rng, -50, 50)), round3(randFloat(rng, -50, 50)))
    tr.setRotation(round3(randFloat(rng, -180, 180)), round3(randFloat(rng, -180, 180)), round3(randFloat(rng, -180, 180)))
    tr.setScale(round3(randFloat(rng, 0.1, 4)), round3(randFloat(rng, 0.1, 4)), round3(randFloat(rng, 0.1, 4)))
    if (rng() < 0.4) world.addComponent(e.id, 'Health', { hp: randInt(rng, 1, 100) })
    ids.push(e.id)
  }
  return world
}

function subtree(world: World, id: string): string[] {
  const out = [id]
  for (const c of world.getEntity(id)!.childIds) out.push(...subtree(world, c))
  return out
}

function hierarchyIsConsistent(world: World) {
  const ordered = world.getEntitiesInHierarchyOrder()
  expect(ordered.length).toBe(world.getEntities().length)
  const pos = new Map(ordered.map((e, i) => [e.id, i]))
  for (const e of ordered) {
    if (e.parentId) {
      expect(world.getEntity(e.parentId)!.childIds).toContain(e.id)
      expect(pos.get(e.parentId)!).toBeLessThan(pos.get(e.id)!)
    } else {
      expect(world.getRootEntityIds()).toContain(e.id)
    }
  }
}

export function* cases(): Generator<Case> {
  for (let s = 0; s < 40_000; s++) {
    const seed = seedOf(1, s)
    yield {
      title: `parse valid .lscene seed=${s} objects=${objectCount(seed)}`,
      run: () => {
        const { scene } = makeScene(seed)
        const res = parseSceneFile(JSON.stringify(scene))
        expect(res.ok).toBe(true)
        if (!res.ok) return
        expect(res.scene.objects.map((o) => o.id)).toEqual(scene.objects.map((o: any) => o.id))
        expect(res.scene.objects.every((o) => o.visible && o.castShadow && o.receiveShadow)).toBe(true)
      },
    }
  }

  for (let d = 0; d < DEFECTS.length; d++) {
    const defect = DEFECTS[d]
    for (let s = 0; s < 2_500; s++) {
      const seed = seedOf(2 + d, s)
      yield {
        title: `reject ${defect.name} as ${defect.code} seed=${s}`,
        run: () => {
          const { scene, rng } = makeScene(seed, 1)
          const res = parseSceneFile(defect.apply(scene, rng))
          expect(res.ok).toBe(false)
          if (!res.ok) expect(res.code).toBe(defect.code)
        },
      }
    }
  }

  for (let s = 0; s < 20_000; s++) {
    const seed = seedOf(20, s)
    yield {
      title: `serializer v2 round-trip is byte-identical seed=${s}`,
      run: () => {
        const first = SceneSerializer.serialize(randomWorld(seed), `S${s}`)
        const copy = new World()
        SceneSerializer.deserialize(first, copy)
        expect(SceneSerializer.serialize(copy, `S${s}`)).toBe(first)
      },
    }
  }

  const props: Array<[string, (seed: number) => void]> = [
    ['hierarchy order lists each entity once, parents first', (seed) => hierarchyIsConsistent(randomWorld(seed))],
    ['destroyEntity removes exactly its subtree', (seed) => {
      const w = randomWorld(seed)
      const ids = w.getEntities().map((e) => e.id)
      const victim = pick(mulberry32(seed + 7), ids)
      const doomed = subtree(w, victim)
      w.destroyEntity(victim)
      expect(w.getEntities().length).toBe(ids.length - doomed.length)
      hierarchyIsConsistent(w)
    }],
    ['parenting under own subtree throws PARENT_CYCLE', (seed) => {
      const w = randomWorld(seed)
      const rng = mulberry32(seed + 11)
      const id = pick(rng, w.getEntities().map((e) => e.id))
      expect(() => w.setParent(id, pick(rng, subtree(w, id)))).toThrow(/PARENT_CYCLE/)
    }],
    ['10 valid reparents keep the hierarchy consistent', (seed) => {
      const w = randomWorld(seed)
      const rng = mulberry32(seed + 13)
      const ids = w.getEntities().map((e) => e.id)
      for (let k = 0; k < 10; k++) {
        const id = pick(rng, ids)
        const banned = new Set(subtree(w, id))
        const options = ids.filter((x) => !banned.has(x))
        w.setParent(id, options.length && rng() < 0.8 ? pick(rng, options) : null)
      }
      hierarchyIsConsistent(w)
    }],
    ['findByTag equals a full scan for every tag', (seed) => {
      const w = randomWorld(seed)
      const ordered = w.getEntitiesInHierarchyOrder()
      for (const t of TAGS) expect(w.findByTag(t).map((e) => e.id)).toEqual(ordered.filter((e) => e.tags.includes(t)).map((e) => e.id))
    }],
  ]
  for (let p = 0; p < props.length; p++) {
    const [name, check] = props[p]
    for (let s = 0; s < 2_000; s++) {
      const seed = seedOf(30 + p, s)
      yield { title: `world: ${name} seed=${s}`, run: () => check(seed) }
    }
  }
}
