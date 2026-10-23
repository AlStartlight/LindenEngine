import { test, expect } from '@playwright/test'
import { parseSceneFile } from '../../../engine/scene/parseSceneFile'
import { mulberry32, pick, randFloat, randInt, tcId, type Rng } from './_helpers'

// 1.800 cases: 600 valid generated scenes + 12 invalid mutation kinds x 100
const PRIMITIVES = ['box', 'sphere', 'cylinder', 'torus', 'cone', 'plane'] as const

const v3 = (rng: Rng, min = -50, max = 50) => [randFloat(rng, min, max), randFloat(rng, min, max), randFloat(rng, min, max)]
const hex = (rng: Rng) => '#' + randInt(rng, 0, 0xffffff).toString(16).padStart(6, '0')

function makeScene(rng: Rng, minObjects = 0) {
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
      transform: { position: v3(rng), rotation: v3(rng, -180, 180), scale: v3(rng, 0.1, 5) },
      material: { color: hex(rng), roughness: rng(), metalness: rng() },
    })
  }
  return {
    format: 'linden-scene',
    version: 1,
    name: `Scene ${randInt(rng, 1, 9999)}`,
    camera: { position: v3(rng), target: v3(rng) },
    objects,
  }
}

type Mutation = { label: string; code: string; apply: (scene: any, rng: Rng) => string }

const MUTATIONS: Mutation[] = [
  { label: 'truncated JSON', code: 'INVALID_JSON', apply: (s, rng) => { const j = JSON.stringify(s); return j.slice(0, randInt(rng, 1, j.length - 1)) } },
  { label: 'wrong format tag', code: 'NOT_A_SCENE', apply: (s) => JSON.stringify({ ...s, format: 'unity-scene' }) },
  { label: 'top-level array', code: 'NOT_A_SCENE', apply: (s) => JSON.stringify([s]) },
  { label: 'future version', code: 'UNSUPPORTED_VERSION', apply: (s, rng) => JSON.stringify({ ...s, version: randInt(rng, 2, 99) }) },
  { label: 'version 0', code: 'SCHEMA_INVALID', apply: (s) => JSON.stringify({ ...s, version: 0 }) },
  { label: 'invalid color', code: 'SCHEMA_INVALID', apply: (s, rng) => { s.objects[randInt(rng, 0, s.objects.length - 1)].material.color = 'red'; return JSON.stringify(s) } },
  { label: 'roughness above 1', code: 'SCHEMA_INVALID', apply: (s, rng) => { s.objects[randInt(rng, 0, s.objects.length - 1)].material.roughness = 1 + rng() + 0.01; return JSON.stringify(s) } },
  { label: 'unknown primitive', code: 'SCHEMA_INVALID', apply: (s, rng) => { s.objects[randInt(rng, 0, s.objects.length - 1)].primitive = 'teapot'; return JSON.stringify(s) } },
  { label: 'duplicate id', code: 'SCHEMA_INVALID', apply: (s) => { s.objects.push({ ...s.objects[0], parentId: null }); return JSON.stringify(s) } },
  { label: 'missing parent', code: 'SCHEMA_INVALID', apply: (s, rng) => { s.objects[randInt(rng, 0, s.objects.length - 1)].parentId = 'ghost'; return JSON.stringify(s) } },
  { label: 'self parent', code: 'SCHEMA_INVALID', apply: (s, rng) => { const o = s.objects[randInt(rng, 0, s.objects.length - 1)]; o.parentId = o.id; return JSON.stringify(s) } },
  { label: 'parent cycle', code: 'SCHEMA_INVALID', apply: (s) => { s.objects.push({ ...s.objects[0], id: 'cyc-a', parentId: 'cyc-b' }, { ...s.objects[0], id: 'cyc-b', parentId: 'cyc-a' }); return JSON.stringify(s) } },
]

test.describe('parseSceneFile (.lscene v1)', () => {
  let n = 0

  for (let s = 0; s < 600; s++) {
    const rng = mulberry32(5000 + s)
    const scene = makeScene(rng)
    test(`${tcId('SCN', ++n)} valid scene with ${scene.objects.length} objects parses`, () => {
      const res = parseSceneFile(JSON.stringify(scene))
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.scene.name).toBe(scene.name)
      expect(res.scene.objects.map((o) => o.id)).toEqual(scene.objects.map((o: any) => o.id))
      for (const o of res.scene.objects) {
        // Defaults filled by the schema
        expect(o.castShadow).toBe(true)
        expect(o.receiveShadow).toBe(true)
        expect(o.visible).toBe(true)
      }
    })
  }

  for (const m of MUTATIONS) {
    for (let s = 0; s < 100; s++) {
      const rng = mulberry32(6000 + s * 31 + m.label.length)
      const content = m.apply(makeScene(rng, 1), rng)
      test(`${tcId('SCN', ++n)} ${m.label} is rejected with ${m.code} (seed ${s})`, () => {
        const res = parseSceneFile(content)
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.code).toBe(m.code)
        expect(res.message.length).toBeGreaterThan(0)
      })
    }
  }
})
