import { fromLindenMesh, toLindenMesh } from '../../engine/mesh/core/convert'
import type { HalfEdgeMesh } from '../../engine/mesh/core/HalfEdgeMesh'
import type { LindenMesh } from '../../engine/mesh/core/LindenMesh'
import { validateTopology } from '../../engine/mesh/core/validate'

export function linden(he: HalfEdgeMesh, polygons = false): LindenMesh {
  return toLindenMesh(he, { polygons })
}

/** Signed volume of a closed triangle mesh (positive for outward winding) */
export function signedVolume(m: LindenMesh): number {
  const p = m.positions
  let v = 0
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
  }
  return v / 6
}

export function surfaceArea(m: LindenMesh): number {
  const p = m.positions
  let area = 0
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return area
}

/**
 * Independent closed-manifold check: weld by position, refuse non-manifold edges, and require
 * every half-edge to have a twin (no boundary) with no topology errors.
 */
export function isClosedManifold(m: LindenMesh): boolean {
  const r = fromLindenMesh({ positions: m.positions, indices: m.indices }, { weld: true, nonManifold: 'error' })
  if (!r.ok) return false
  const he = r.value.mesh
  if (validateTopology(he).some((i) => i.severity === 'error' || i.code === 'NON_MANIFOLD_VERTEX')) return false
  for (let h = 0; h < he.halfEdgeSlots; h++) if (he.heFace[h] >= 0 && he.heTwin[h] < 0) return false
  return he.faceCount > 0
}

export function bbox(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  return { min, max }
}

/** Distance from point p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5) */
export function pointTriangleDistance(p: number[], a: number[], b: number[], c: number[]): number {
  const sub = (x: number[], y: number[]) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]]
  const dot = (x: number[], y: number[]) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2]
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a)
  const d1 = dot(ab, ap), d2 = dot(ac, ap)
  let q: number[]
  if (d1 <= 0 && d2 <= 0) q = a
  else {
    const bp = sub(p, b)
    const d3 = dot(ab, bp), d4 = dot(ac, bp)
    if (d3 >= 0 && d4 <= d3) q = b
    else {
      const vc = d1 * d4 - d3 * d2
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3)
        q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]
      } else {
        const cp = sub(p, c)
        const d5 = dot(ab, cp), d6 = dot(ac, cp)
        if (d6 >= 0 && d5 <= d6) q = c
        else {
          const vb = d5 * d2 - d1 * d6
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6)
            q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]
          } else {
            const va = d3 * d6 - d5 * d4
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
              q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]
            } else {
              const denom = 1 / (va + vb + vc)
              const v = vb * denom, w = vc * denom
              q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]
            }
          }
        }
      }
    }
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** One-sided Hausdorff distance: max over vertices of `from` of the distance to the surface of `to` (brute force) */
export function maxDeviation(from: LindenMesh, to: LindenMesh): number {
  const P = (m: LindenMesh, i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]
  let worst = 0
  for (let v = 0; v < from.positions.length / 3; v++) {
    const p = P(from, v)
    let best = Infinity
    for (let t = 0; t < to.indices.length && best > worst; t += 3) {
      best = Math.min(best, pointTriangleDistance(p, P(to, to.indices[t]), P(to, to.indices[t + 1]), P(to, to.indices[t + 2])))
    }
    if (best > worst) worst = best
  }
  return worst
}
