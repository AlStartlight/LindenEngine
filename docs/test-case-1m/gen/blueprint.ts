import { expect } from '@playwright/test'
import { BlueprintGraph } from '../../../engine/blueprints/BlueprintGraph'
import type { Case } from '../lib/define'
import { mulberry32, pick, randInt, seedOf, quiet } from '../lib/util'

// Blueprint — 100.000 cases
//   70.000 binary math/compare nodes: 7 ops x a,b in [-50, 49]
//    8.000 Clamp: value [-20,19] x min [-10,9] x span [1,10]
//    8.000 Lerp:  a [-10,9] x b [-10,9] x alpha k/20
//    6.600 createNode: 33 node types x 0..199 pre-existing nodes
//    6.400 serialize/deserialize keeps node types, names, positions, connections
//    1.000 nodes stay addressable by id after deserialize
export const COUNT = 100_000

export const NODE_TYPES = [
  'EventBeginPlay', 'EventTick', 'EventInputAction', 'EventOnOverlapBegin',
  'Branch', 'Sequence', 'ForLoop', 'ForEachLoop', 'WhileLoop', 'Delay', 'Gate',
  'GetVariable', 'SetVariable',
  'Add', 'Subtract', 'Multiply', 'Divide', 'Clamp', 'Lerp', 'RandomFloat',
  'Equal', 'Greater', 'Less',
  'PrintString', 'SpawnActor', 'DestroyActor', 'SetActorLocation', 'GetActorLocation', 'AddMovementInput', 'Rotate', 'PlaySound',
  'GetAxisValue', 'IsInputKeyDown',
] as const

const BINARY: Array<[string, (a: number, b: number) => number | boolean]> = [
  ['Add', (a, b) => a + b],
  ['Subtract', (a, b) => a - b],
  ['Multiply', (a, b) => a * b],
  ['Divide', (a, b) => (b !== 0 ? a / b : 0)],
  ['Equal', (a, b) => a === b],
  ['Greater', (a, b) => a > b],
  ['Less', (a, b) => a < b],
]

function evalNode(type: string, inputs: Record<string, number>) {
  const graph = new BlueprintGraph('Eval')
  const node = graph.createNode(type)!
  return node.execute(null as any, new Map(Object.entries(inputs))).get('Result')
}

function randomGraph(seed: number) {
  const rng = mulberry32(seed)
  const graph = new BlueprintGraph(`BP ${seed}`)
  const nodes = []
  const count = randInt(rng, 1, 25)
  for (let i = 0; i < count; i++) {
    const node = graph.createNode(pick(rng, NODE_TYPES))!
    node.position = { x: randInt(rng, -2000, 2000), y: randInt(rng, -2000, 2000) }
    nodes.push(node)
  }
  // Chain float math nodes: Result -> A
  const math = nodes.filter((n) => ['Add', 'Subtract', 'Multiply', 'Divide'].includes(n.name))
  for (let i = 1; i < math.length; i++) {
    graph.connect(math[i - 1].id, math[i - 1].outputPins[0].id, math[i].id, math[i].inputPins[0].id)
  }
  return graph
}

export function* cases(): Generator<Case> {
  for (const [op, fn] of BINARY) {
    for (let a = -50; a < 50; a++) {
      for (let b = -50; b < 50; b++) {
        yield {
          title: `node ${op}(A=${a}, B=${b})`,
          run: () => {
            const got = evalNode(op, { A: a, B: b })
            const want = fn(a, b)
            if (typeof want === 'number') expect(got).toBeCloseTo(want, 12)
            else expect(got).toBe(want)
          },
        }
      }
    }
  }

  for (let v = -20; v < 20; v++) {
    for (let min = -10; min < 10; min++) {
      for (let span = 1; span <= 10; span++) {
        const max = min + span
        yield {
          title: `node Clamp(Value=${v}, Min=${min}, Max=${max})`,
          run: () => expect(evalNode('Clamp', { Value: v, Min: min, Max: max })).toBe(Math.max(min, Math.min(max, v))),
        }
      }
    }
  }

  for (let a = -10; a < 10; a++) {
    for (let b = -10; b < 10; b++) {
      for (let k = 0; k < 20; k++) {
        const alpha = k / 20
        yield {
          title: `node Lerp(A=${a}, B=${b}, Alpha=${alpha})`,
          run: () => expect(evalNode('Lerp', { A: a, B: b, Alpha: alpha })).toBeCloseTo(a + (b - a) * alpha, 12),
        }
      }
    }
  }

  for (const type of NODE_TYPES) {
    for (let existing = 0; existing < 200; existing++) {
      yield {
        title: `createNode ${type} after ${existing} existing nodes`,
        run: () => {
          const graph = new BlueprintGraph('Create')
          for (let i = 0; i < existing; i++) graph.createNode(NODE_TYPES[i % NODE_TYPES.length])
          const node = graph.createNode(type)
          expect(node).not.toBeNull()
          expect(node!.name).toBe(type)
          expect(graph.nodes.size).toBe(existing + 1)
          expect(graph.getNode(node!.id)).toBe(node)
        },
      }
    }
  }

  for (let s = 0; s < 6_400; s++) {
    const seed = seedOf(101, s)
    yield {
      title: `serialize/deserialize keeps nodes and connections seed=${s}`,
      run: () => quiet(() => {
        const graph = randomGraph(seed)
        const data = JSON.parse(JSON.stringify(graph.serialize()))
        const copy = BlueprintGraph.deserialize(data)
        const summary = (g: BlueprintGraph) => g.getAllNodes().map((n) => `${n.name}@${n.position.x},${n.position.y}`).sort()
        expect(summary(copy)).toEqual(summary(graph))
        expect(copy.connections.length).toBe(graph.connections.length)
        expect(copy.name).toBe(graph.name)
      }),
    }
  }

  for (let s = 0; s < 1_000; s++) {
    const seed = seedOf(102, s)
    yield {
      title: `deserialized nodes are addressable by their saved id seed=${s}`,
      run: () => quiet(() => {
        const graph = randomGraph(seed)
        const copy = BlueprintGraph.deserialize(JSON.parse(JSON.stringify(graph.serialize())))
        for (const n of graph.getAllNodes()) expect(copy.getNode(n.id)?.name).toBe(n.name)
      }),
    }
  }
}
