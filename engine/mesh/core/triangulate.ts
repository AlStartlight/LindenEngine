/**
 * Triangulates one planar-ish polygon given as 3D points (xyz interleaved).
 * Convex polygons use a fan from the first vertex; non-convex ones use ear clipping in the plane
 * of the Newell normal. Output: local vertex indices, three per triangle, same winding as the input.
 */
export function triangulatePolygon(points: ArrayLike<number>, out: number[] = []): number[] {
  const n = points.length / 3
  if (n < 3) return out
  if (n === 3) {
    out.push(0, 1, 2)
    return out
  }

  // Newell normal picks the projection plane (drop its dominant axis)
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < n; i++) {
    const a = i * 3
    const b = ((i + 1) % n) * 3
    nx += (points[a + 1] - points[b + 1]) * (points[a + 2] + points[b + 2])
    ny += (points[a + 2] - points[b + 2]) * (points[a] + points[b])
    nz += (points[a] - points[b]) * (points[a + 1] + points[b + 1])
  }
  const ax = Math.abs(nx)
  const ay = Math.abs(ny)
  const az = Math.abs(nz)
  let u = 0
  let v = 1
  let sign = nz
  if (ax >= ay && ax >= az) {
    u = 1
    v = 2
    sign = nx
  } else if (ay >= az) {
    u = 2
    v = 0
    sign = ny
  }
  // Orient so the polygon is counter-clockwise in the (u, v) plane
  const flip = sign < 0 ? -1 : 1
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = points[i * 3 + u]
    ys[i] = points[i * 3 + v] * flip
  }

  const cross = (a: number, b: number, c: number): number =>
    (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a])

  let convex = true
  for (let i = 0; i < n && convex; i++) {
    if (cross(i, (i + 1) % n, (i + 2) % n) < 0) convex = false
  }
  if (convex) {
    for (let i = 1; i < n - 1; i++) out.push(0, i, i + 1)
    return out
  }

  // Ear clipping, O(n^2)
  const remaining: number[] = []
  for (let i = 0; i < n; i++) remaining.push(i)
  const inTriangle = (p: number, a: number, b: number, c: number): boolean =>
    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0

  let guard = 0
  while (remaining.length > 3 && guard < n * n) {
    guard++
    let clipped = false
    for (let i = 0; i < remaining.length; i++) {
      const m = remaining.length
      const a = remaining[(i + m - 1) % m]
      const b = remaining[i]
      const c = remaining[(i + 1) % m]
      if (cross(a, b, c) <= 0) continue
      let blocked = false
      for (const p of remaining) {
        if (p === a || p === b || p === c) continue
        if (inTriangle(p, a, b, c)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      out.push(a, b, c)
      remaining.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  // Degenerate or self-intersecting leftovers: fan what is left so every corner is still covered
  for (let i = 1; i < remaining.length - 1; i++) out.push(remaining[0], remaining[i], remaining[i + 1])
  return out
}
