import { describe, expect, it } from 'vitest'
import { booleanMeshes } from '../../../engine/mesh/boolean/manifoldAdapter'
import { toLindenMesh } from '../../../engine/mesh/core/convert'
import type { GeometryOps } from '../../../engine/mesh/core/GeometryOps'
import { editablePrimitive } from '../../../engine/mesh/core/editablePrimitives'
import { makeCube, makeUvSphere } from '../../../engine/mesh/core/primitives'
import { err } from '../../../engine/mesh/core/result'
import { validateTopology } from '../../../engine/mesh/core/validate'
import { deleteElements } from '../../../engine/mesh/modeling/ops'
import { mirrorMesh, ModifierStack, parseModifiers, type ModifierSpec } from '../../../engine/mesh/modeling/modifiers'
import { subdivideMesh } from '../../../engine/mesh/subdiv/opensubdivAdapter'
import { isClosedManifold, signedVolume } from '../helpers'

/** Right half of a 2x1x1 box: a unit cube on x in [0, 1] without its face on the x = 0 plane */
function halfBox() {
  const m = makeCube(1)
  for (let v = 0; v < m.vertexSlots; v++) m.positions[v * 3] += 0.5
  const onPlane = [...Array(m.faceSlots).keys()].find((f) => m.faceNormal(f)[0] < -0.5)!
  const r = deleteElements(m, 'faces', [onPlane])
  if (!r.ok) throw new Error(r.message)
  // Vertices on the plane stay because other faces use them
  return m.compact().mesh
}

/** Real adapters with call counters */
function spyOps() {
  const calls = { subdivide: 0, boolean: 0 }
  const ops: Pick<GeometryOps, 'subdivide' | 'boolean'> = {
    subdivide: async (m, l, s) => {
      calls.subdivide++
      return subdivideMesh(m, l, s)
    },
    boolean: async (a, b, op) => {
      calls.boolean++
      return booleanMeshes(a, b, op)
    },
  }
  return { ops, calls }
}

describe('parseModifiers', () => {
  it('accepts valid stacks with defaults and rejects bad data with typed errors', () => {
    const r = parseModifiers([{ type: 'mirror', axis: 'x' }, { type: 'subdivision', levels: 2 }, { type: 'boolean', op: 'subtract', operand: 'cutter' }])
    expect(r.ok && r.value).toEqual([
      { type: 'mirror', axis: 'x', merge: true, mergeThreshold: 1e-4, enabled: undefined },
      { type: 'subdivision', levels: 2, scheme: 'catmull-clark', enabled: undefined },
      { type: 'boolean', op: 'subtract', operand: 'cutter', enabled: undefined },
    ])
    expect(parseModifiers(undefined)).toEqual({ ok: true, value: [] })
    for (const bad of [{}, [{ type: 'twist' }], [{ type: 'subdivision', levels: 9 }], [{ type: 'mirror', axis: 'w' }], [{ type: 'boolean', op: 'xor', operand: 'a' }], [{ type: 'boolean', op: 'union' }]]) {
      const p = parseModifiers(bad)
      expect(p.ok || p.code).toBe('INVALID_MESH')
    }
  })
})

describe('mirror', () => {
  it('merges on the plane: a half box becomes a closed 2x1x1 box', () => {
    const r = mirrorMesh(halfBox(), 'x')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect([r.value.vertexCount, r.value.faceCount]).toEqual([12, 10])
    expect(validateTopology(r.value)).toEqual([])
    const l = toLindenMesh(r.value, { polygons: false })
    expect(isClosedManifold(l)).toBe(true)
    expect(signedVolume(l)).toBeCloseTo(2, 6)
  })

  it('without merge the halves stay separate; uvs are copied', () => {
    const box = editablePrimitive('box')
    for (let v = 0; v < box.vertexSlots; v++) box.positions[v * 3] += 2
    const r = mirrorMesh(box, 'x', false)
    expect(r.ok && r.value.vertexCount).toBe(16)
    expect(r.ok && r.value.cornerUvs).not.toBeNull()
    expect(r.ok && signedVolume(toLindenMesh(r.value, { polygons: false }))).toBeCloseTo(2, 6)
  })
})

describe('ModifierStack', () => {
  it('evaluates in order and caches every step', async () => {
    const { ops, calls } = spyOps()
    const stack = new ModifierStack()
    const specs: ModifierSpec[] = [{ type: 'mirror', axis: 'x' }, { type: 'subdivision', levels: 1 }]
    const r = await stack.evaluate(halfBox(), 'v1', specs, { geometry: ops })
    expect(r.ok && r.value.faceCount).toBe(40)
    expect(r.ok && isClosedManifold(toLindenMesh(r.value, { polygons: false }))).toBe(true)
    expect([stack.evaluations, calls.subdivide]).toEqual([2, 1])

    await stack.evaluate(halfBox(), 'v1', specs, { geometry: ops })
    expect([stack.evaluations, calls.subdivide]).toEqual([2, 1]) // all cached

    const r2 = await stack.evaluate(halfBox(), 'v1', [specs[0], { type: 'subdivision', levels: 2 }], { geometry: ops })
    expect(r2.ok && r2.value.faceCount).toBe(160)
    expect([stack.evaluations, calls.subdivide]).toEqual([3, 2]) // mirror reused, subdivision re-run

    await stack.evaluate(halfBox(), 'v2', [specs[0], { type: 'subdivision', levels: 2 }], { geometry: ops })
    expect(stack.evaluations).toBe(5) // new source: everything re-runs
  })

  it('a disabled modifier passes its input through; an empty stack returns the source', async () => {
    const { ops } = spyOps()
    const stack = new ModifierStack()
    const src = halfBox()
    const r = await stack.evaluate(src, 'v', [{ type: 'subdivision', levels: 2, enabled: false }], { geometry: ops })
    expect(r.ok && r.value).toBe(src)
    const e = await new ModifierStack().evaluate(src, 'v', [])
    expect(e.ok && e.value).toBe(src)
  })

  it('boolean modifier re-runs only when the operand changes', async () => {
    const { ops, calls } = spyOps()
    const stack = new ModifierStack()
    let version = 'a'
    const sphere = toLindenMesh(makeUvSphere(0.6, 24, 12), { polygons: false })
    const ctx = { geometry: ops, resolveOperand: (id: string) => (id === 'cutter' ? { mesh: sphere, version } : null) }
    const specs: ModifierSpec[] = [{ type: 'boolean', op: 'subtract', operand: 'cutter' }]
    const r = await stack.evaluate(makeCube(1), 's', specs, ctx)
    expect(r.ok).toBe(true)
    if (r.ok) expect(signedVolume(toLindenMesh(r.value, { polygons: false }))).toBeLessThan(0.5)
    await stack.evaluate(makeCube(1), 's', specs, ctx)
    expect(calls.boolean).toBe(1)
    version = 'b'
    await stack.evaluate(makeCube(1), 's', specs, ctx)
    expect(calls.boolean).toBe(2)
    const missing = await stack.evaluate(makeCube(1), 's', [{ type: 'boolean', op: 'union', operand: 'nope' }], ctx)
    expect(missing.ok || missing.message).toMatch(/modifier 1 \(boolean\).*not found/)
  })

  it('errors name the failing modifier and are not cached', async () => {
    let fail = true
    const ops: Pick<GeometryOps, 'subdivide' | 'boolean'> = {
      subdivide: async (m, l, s) => (fail ? err('INTERNAL', 'boom') : subdivideMesh(m, l, s)),
      boolean: async () => err('NOT_IMPLEMENTED', ''),
    }
    const stack = new ModifierStack()
    const specs: ModifierSpec[] = [{ type: 'mirror', axis: 'x' }, { type: 'subdivision', levels: 1 }]
    const r = await stack.evaluate(halfBox(), 'v', specs, { geometry: ops })
    expect(r.ok || r.message).toMatch(/modifier 2 \(subdivision\): boom/)
    fail = false
    const r2 = await stack.evaluate(halfBox(), 'v', specs, { geometry: ops })
    expect(r2.ok).toBe(true)
    expect(stack.evaluations).toBe(2) // mirror was cached from the first run
    const none = await new ModifierStack().evaluate(halfBox(), 'v', [{ type: 'subdivision', levels: 1 }])
    expect(none.ok || none.code).toBe('NOT_IMPLEMENTED')
  })
})
