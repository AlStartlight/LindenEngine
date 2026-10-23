import { expect } from '@playwright/test'
import { formatFloat, formatVariant, parseVariant, eulerDegreesToTransform3D, transform3DToEulerDegrees} from '../../../engine/godot/tscn/Variant'
import { TscnParser, type TscnDocument } from '../../../engine/godot/tscn/TscnParser'
import { TscnWriter, sanitizeNodeName } from '../../../engine/godot/tscn/TscnWriter'
import { ComponentMap } from '../../../engine/godot/mapping/ComponentMap'
import { CompatReport } from '../../../engine/godot/report/CompatReport'
import { World } from '../../../engine/ecs/World'
import type { Case } from '../lib/define'
import { mulberry32, pick, randFloat, randInt, round3, seedOf, quiet, type Rng } from '../lib/util'

// Godot Bridge — 100.000 cases
//   30.000 number literals: 20.000 integers + 10.000 decimals survive format -> parse
//   30.000 Vector2 / Vector3 / Vector4 / Color literals survive format -> parse (7.500 each)
//   10.000 node names are sanitized for Godot (one seed each)
//   10.000 Euler <-> Transform3D round-trip reproduces the basis (one seed each)
//   13.000 .tscn write -> parse -> write is byte-stable and keeps nodes (one seed each)
//    2.000 node groups (Linden tags) survive write -> parse
//    5.000 Linden world -> .tscn -> Linden world keeps every entity name (one seed each)
export const COUNT = 100_000

const NODE_TYPES = ['Node3D', 'MeshInstance3D', 'Camera3D', 'DirectionalLight3D', 'RigidBody3D', 'StaticBody3D', 'Area3D', 'CollisionShape3D', 'Sprite2D', 'Timer']
const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.:@/"%'

function propValue(rng: Rng): unknown {
  switch (randInt(rng, 0, 5)) {
    case 0: return round3(randFloat(rng, -1000, 1000))
    case 1: return randInt(rng, -100000, 100000)
    case 2: return rng() < 0.5
    case 3: return `text_${randInt(rng, 0, 99999)}`
    case 4: return { x: round3(randFloat(rng, -100, 100)), y: round3(randFloat(rng, -100, 100)), z: round3(randFloat(rng, -100, 100)) }
    default: return { r: round3(rng()), g: round3(rng()), b: round3(rng()), a: round3(rng()) }
  }
}

function randomDoc(seed: number, withGroups = false): TscnDocument {
  const rng = mulberry32(seed)
  const nodes: TscnDocument['nodes'] = [{ name: 'Root', type: 'Node3D', properties: {} }]
  const paths = ['.']
  for (let i = randInt(rng, 0, 15); i > 0; i--) {
    const name = `Node${nodes.length}`
    const parent = pick(rng, paths)
    const props: Record<string, unknown> = {}
    for (let p = randInt(rng, 0, 5); p > 0; p--) props[`prop_${randInt(rng, 0, 50)}`] = propValue(rng)
    const node: any = { name, type: pick(rng, NODE_TYPES), parent, properties: props }
    if (withGroups) node.groups = [`group_${randInt(rng, 0, 9)}`, `tag_${randInt(rng, 10, 19)}`]
    nodes.push(node)
    paths.push(parent === '.' ? name : `${parent}/${name}`)
  }
  return { descriptor: { type: 'gd_scene', attributes: { format: 3 } }, extResources: [], subResources: [], nodes, connections: [] }
}

export function* cases(): Generator<Case> {
  for (let n = -10_000; n < 10_000; n++) {
    yield { title: `integer literal ${n} survives formatVariant -> parseVariant`, run: () => expect(parseVariant(formatVariant(n))).toBe(n) }
  }
  for (let k = -5_000; k < 5_000; k++) {
    const x = (2 * k + 1) / 2000
    yield { title: `decimal literal ${x} survives formatVariant -> parseVariant`, run: () => {
      expect(formatFloat(x)).toBe(String(x))
      expect(parseVariant(formatVariant(x))).toBe(x)
    } }
  }

  const VECTORS: Array<[string, (rng: Rng) => any]> = [
    ['Vector2', (r) => ({ x: round3(randFloat(r, -1e4, 1e4)), y: round3(randFloat(r, -1e4, 1e4)) })],
    ['Vector3', (r) => ({ x: round3(randFloat(r, -1e4, 1e4)), y: round3(randFloat(r, -1e4, 1e4)), z: round3(randFloat(r, -1e4, 1e4)) })],
    ['Vector4', (r) => ({ x: round3(randFloat(r, -1e4, 1e4)), y: round3(randFloat(r, -1e4, 1e4)), z: round3(randFloat(r, -1e4, 1e4)), w: round3(randFloat(r, -1e4, 1e4)) })],
    ['Color', (r) => ({ r: round3(r()), g: round3(r()), b: round3(r()), a: round3(r()) })],
  ]
  for (let v = 0; v < VECTORS.length; v++) {
    const [kind, make] = VECTORS[v]
    for (let s = 0; s < 7_500; s++) {
      const seed = seedOf(501 + v, s)
      yield { title: `${kind} literal survives format -> parse seed=${s}`, run: () => {
        const value = make(mulberry32(seed))
        const text = formatVariant(value)
        expect(text.startsWith(`${kind}(`)).toBe(true)
        expect(parseVariant(text)).toEqual(value)
      } }
    }
  }

  for (let s = 0; s < 10_000; s++) {
    const seed = seedOf(510, s)
    yield { title: `sanitizeNodeName replaces . : @ / " % seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      const name = Array.from({ length: randInt(rng, 1, 24) }, () => pick(rng, NAME_CHARS.split(''))).join('')
      const res = sanitizeNodeName(name)
      expect(res.sanitized).toBe(name.replace(/[.:@/"%]/g, '_'))
      expect(res.sanitized).not.toMatch(/[.:@/"%]/)
      expect(res.changed).toBe(/[.:@/"%]/.test(name))
      expect(res.original).toBe(name)
    } }
  }

  for (let s = 0; s < 10_000; s++) {
    const seed = seedOf(511, s)
    yield { title: `Euler -> Transform3D -> Euler -> Transform3D keeps the basis seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      const pos = { x: round3(randFloat(rng, -100, 100)), y: round3(randFloat(rng, -100, 100)), z: round3(randFloat(rng, -100, 100)) }
      const rot = { x: round3(randFloat(rng, -80, 80)), y: round3(randFloat(rng, -80, 80)), z: round3(randFloat(rng, -170, 170)) }
      const scale = { x: round3(randFloat(rng, 0.2, 5)), y: round3(randFloat(rng, 0.2, 5)), z: round3(randFloat(rng, 0.2, 5)) }
      const t1 = eulerDegreesToTransform3D(pos, rot, scale)
      const back = transform3DToEulerDegrees(t1)
      const t2 = eulerDegreesToTransform3D(back.position, back.rotation, back.scale)
      t1.basis.forEach((b, i) => expect(t2.basis[i]).toBeCloseTo(b, 6))
      expect(t2.origin.x).toBeCloseTo(pos.x, 9)
      expect(t2.origin.y).toBeCloseTo(pos.y, 9)
      expect(t2.origin.z).toBeCloseTo(pos.z, 9)
    } }
  }

  const writer = new TscnWriter()
  const parser = new TscnParser()
  for (let s = 0; s < 13_000; s++) {
    const seed = seedOf(512, s)
    yield { title: `.tscn write -> parse -> write is byte-stable seed=${s}`, run: () => {
      const doc = randomDoc(seed)
      const text = writer.write(doc)
      const parsed = parser.parse(text)
      expect(writer.write(parsed)).toBe(text)
      expect(parsed.nodes.map((n) => [n.name, n.type, n.parent ?? null])).toEqual(doc.nodes.map((n) => [n.name, n.type, n.parent ?? null]))
    } }
  }
  for (let s = 0; s < 2_000; s++) {
    const seed = seedOf(513, s)
    yield { title: `.tscn node groups (Linden tags) survive write -> parse seed=${s}`, run: () => {
      const doc = randomDoc(seed, true)
      const parsed = parser.parse(writer.write(doc))
      expect(parsed.nodes.map((n) => n.groups ?? [])).toEqual(doc.nodes.map((n) => n.groups ?? []))
    } }
  }

  for (let s = 0; s < 5_000; s++) {
    const seed = seedOf(514, s)
    yield { title: `Linden world -> .tscn -> Linden world keeps entity names seed=${s}`, run: () => quiet(() => {
      const rng = mulberry32(seed)
      const world = new World()
      const ids: string[] = []
      for (let i = randInt(rng, 1, 12); i > 0; i--) {
        const parent = ids.length && rng() < 0.5 ? pick(rng, ids) : null
        ids.push(world.createEntity(`Ent_${i}_${randInt(rng, 0, 999)}`, parent).id)
      }
      const doc = ComponentMap.exportWorld(world, new CompatReport())
      const reimported = ComponentMap.importWorld(parser.parse(writer.write(doc)), new CompatReport())
      const names = new Set(reimported.getEntities().map((e) => e.name))
      for (const e of world.getEntities()) expect(names.has(sanitizeNodeName(e.name).sanitized)).toBe(true)
    }) }
  }
}
