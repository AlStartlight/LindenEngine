import { it } from 'vitest'
import { booleanMeshes } from '../../../engine/mesh/boolean/manifoldAdapter'
import { simplifyMesh } from '../../../engine/mesh/optimize/meshoptAdapter'
import { makeUvSphere } from '../../../engine/mesh/core/primitives'
import { toLindenMesh } from '../../../engine/mesh/core/convert'
import type { LindenMesh } from '../../../engine/mesh/core/LindenMesh'

/*
 * Heavy-operation timings (run with `npm run bench:mesh`, not part of `npm test`).
 * Each case: 1 warm-up, then the median of 5 runs. Times are main-thread, without worker transfer.
 */

/** UV sphere with roughly `tris` triangles (2 * segments * (rings - 1)) */
function sphereWithTriangles(tris: number, center: [number, number, number] = [0, 0, 0]): LindenMesh {
  const rings = Math.round(Math.sqrt(tris / 4))
  const segments = Math.round(tris / (2 * (rings - 1)))
  return toLindenMesh(makeUvSphere(1, segments, rings, center), { polygons: false })
}

async function time(fn: () => Promise<void>, runs = 5): Promise<number> {
  await fn()
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    await fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(runs / 2)]
}

const rows: { operation: string; triangles: number; 'median ms': string }[] = []

for (const size of [10_000, 100_000]) {
  it(`boolean + simplify at ${size / 1000}k triangles`, async () => {
    const a = sphereWithTriangles(size)
    const b = sphereWithTriangles(size, [0.7, 0.2, 0.1])
    const tris = a.indices.length / 3
    rows.push({ operation: 'boolean subtract (Manifold)', triangles: tris, 'median ms': (await time(async () => {
      const r = await booleanMeshes(a, b, 'subtract')
      if (!r.ok) throw new Error(r.message)
    })).toFixed(1) })
    rows.push({ operation: 'simplify 50%, err 1% (meshopt)', triangles: tris, 'median ms': (await time(async () => {
      const r = await simplifyMesh(a, 0.5, 0.01)
      if (!r.ok) throw new Error(r.message)
    })).toFixed(1) })
  }, 120_000)
}

it('report', () => {
  console.table(rows)
})
