import { expect } from '@playwright/test'
import { MaterialGraph } from '../../../engine/materials/MaterialGraph'
import { MaterialDataType } from '../../../engine/materials/MaterialNode'
import type { Case } from '../lib/define'
import { mulberry32, pick, randInt, seedOf, quiet } from '../lib/util'

// Material — 80.000 cases
//   40.000 random acyclic graphs compile successfully
//   20.000 closing a chain into a loop is rejected (cycle detection)
//        K every (source type, output pin) x (target type, input pin) pair follows the type rules
//   20.000 - K serialize/deserialize keeps node types and positions (1.000 of them check ids)
export const COUNT = 80_000

export const MAT_TYPES = [
  'TextureSample', 'UV', 'VertexColor', 'WorldPosition', 'Normal', 'Time',
  'Constant', 'Constant2', 'Constant3', 'Constant4', 'Parameter',
  'Add', 'Subtract', 'Multiply', 'Divide', 'Power', 'Lerp', 'Clamp', 'Sin', 'Cos', 'Abs', 'Floor', 'Frac', 'OneMinus',
  'Normalize', 'Dot', 'Cross', 'ComponentMask', 'Append',
  'Fresnel', 'Panner', 'Rotator',
] as const

const SIZE: Record<string, number> = {
  [MaterialDataType.FLOAT]: 1, [MaterialDataType.FLOAT2]: 2, [MaterialDataType.FLOAT3]: 3, [MaterialDataType.FLOAT4]: 4,
  [MaterialDataType.MATRIX3]: 9, [MaterialDataType.MATRIX4]: 16, [MaterialDataType.BOOLEAN]: 1, [MaterialDataType.INTEGER]: 1,
}

/** Mirror of the documented connection rules */
function compatible(src: string, dst: string): boolean {
  if (src === dst) return true
  if (src === MaterialDataType.FLOAT) return [MaterialDataType.FLOAT2, MaterialDataType.FLOAT3, MaterialDataType.FLOAT4].includes(dst as MaterialDataType)
  const s = SIZE[src] || 0
  const d = SIZE[dst] || 0
  return s >= d && d > 0
}

function randomDag(seed: number) {
  const rng = mulberry32(seed)
  const graph = new MaterialGraph(`M${seed}`)
  const nodes = []
  const count = randInt(rng, 1, 20)
  for (let i = 0; i < count; i++) {
    const node = graph.createNode(pick(rng, MAT_TYPES))!
    node.position = { x: randInt(rng, -3000, 3000), y: randInt(rng, -3000, 3000) }
    nodes.push(node)
  }
  // Only connect earlier -> later so the graph is acyclic by construction
  for (let t = 1; t < nodes.length; t++) {
    for (const pin of nodes[t].inputPins) {
      if (rng() < 0.5) continue
      const src = nodes[randInt(rng, 0, t - 1)]
      const out = src.outputPins.find((o) => compatible(o.dataType, pin.dataType))
      if (out) graph.connect(src.id, out.id, nodes[t].id, pin.id)
    }
  }
  return graph
}

const typeSummary = (g: MaterialGraph) => g.getAllNodes().map((n) => `${n.constructor.name}@${n.position.x},${n.position.y}`).sort()

export function* cases(): Generator<Case> {
  for (let s = 0; s < 40_000; s++) {
    const seed = seedOf(201, s)
    yield {
      title: `random acyclic material graph compiles seed=${s} nodes=${randInt(mulberry32(seed), 1, 20)}`,
      run: () => quiet(() => {
        const result = randomDag(seed).compile()
        expect(result.errors).toEqual([])
        expect(result.success).toBe(true)
        expect(result.fragmentShader.length).toBeGreaterThan(0)
      }),
    }
  }

  for (let s = 0; s < 20_000; s++) {
    const seed = seedOf(202, s)
    const len = 2 + (s % 14)
    const type = MAT_TYPES[11 + (Math.floor(s / 14) % 13)] // math nodes Add..OneMinus
    yield {
      title: `closing a ${len}-node ${type} chain into a loop is rejected seed=${s}`,
      run: () => quiet(() => {
        const g = new MaterialGraph('Cycle')
        const chain = Array.from({ length: len }, () => g.createNode(type)!)
        const link = (a: any, b: any) => {
          const out = a.outputPins[0]
          const inp = b.inputPins.find((p: any) => compatible(out.dataType, p.dataType))
          return inp ? g.connect(a.id, out.id, b.id, inp.id) : null
        }
        let linked = 0
        for (let i = 1; i < chain.length; i++) if (link(chain[i - 1], chain[i])) linked++
        const before = g.connections.length
        expect(before).toBe(linked)
        if (linked === chain.length - 1) {
          expect(link(chain[chain.length - 1], chain[0])).toBeNull()
          expect(g.connections.length).toBe(before)
        }
      }),
    }
  }

  // Enumerate the pin-pair matrix once to know K
  const probe = quiet(() => new MaterialGraph('probe'))
  const pins = MAT_TYPES.map((t) => {
    const n = quiet(() => probe.createNode(t)!)
    return { t, outs: n.outputPins.map((p) => [p.name, p.dataType] as const), ins: n.inputPins.map((p) => [p.name, p.dataType] as const) }
  })
  let k = 0
  for (const src of pins) {
    for (let oi = 0; oi < src.outs.length; oi++) {
      for (const dst of pins) {
        for (let ii = 0; ii < dst.ins.length; ii++) {
          const [outName, outType] = src.outs[oi]
          const [inName, inType] = dst.ins[ii]
          const want = compatible(outType, inType)
          k++
          yield {
            title: `connect ${src.t}.${outName}(${outType}) -> ${dst.t}.${inName}(${inType}) ${want ? 'accepted' : 'rejected'}`,
            run: () => quiet(() => {
              const g = new MaterialGraph('Pair')
              const a = g.createNode(src.t)!
              const b = g.createNode(dst.t)!
              const conn = g.connect(a.id, a.outputPins[oi].id, b.id, b.inputPins[ii].id)
              expect(conn !== null).toBe(want)
              expect(g.connections.length).toBe(want ? 1 : 0)
              if (want) expect(b.inputPins[ii].connectedTo).toBe(a.outputPins[oi].id)
            }),
          }
        }
      }
    }
  }

  const remaining = 20_000 - k
  if (remaining < 1_000) throw new Error(`pin matrix too large: ${k}`)
  for (let s = 0; s < remaining - 1_000; s++) {
    const seed = seedOf(203, s)
    yield {
      title: `serialize/deserialize keeps node types and positions seed=${s}`,
      run: () => quiet(() => {
        const g = randomDag(seed)
        const copy = MaterialGraph.deserialize(JSON.parse(JSON.stringify(g.serialize())))
        expect(typeSummary(copy)).toEqual(typeSummary(g))
        expect(copy.connections.length).toBe(g.connections.length)
      }),
    }
  }
  for (let s = 0; s < 1_000; s++) {
    const seed = seedOf(204, s)
    yield {
      title: `deserialized material nodes are addressable by saved id seed=${s}`,
      run: () => quiet(() => {
        const g = randomDag(seed)
        const copy = MaterialGraph.deserialize(JSON.parse(JSON.stringify(g.serialize())))
        for (const n of g.getAllNodes()) expect(copy.getNode(n.id)?.constructor.name).toBe(n.constructor.name)
      }),
    }
  }
}
