import { HalfEdgeMesh } from './HalfEdgeMesh'

/** Builds a half-edge mesh from positions and CCW vertex loops; throws only on programmer error */
export function meshFromPolygons(positions: ArrayLike<number>, loops: number[][]): HalfEdgeMesh {
  const mesh = new HalfEdgeMesh()
  for (let i = 0; i < positions.length; i += 3) mesh.addVertex(positions[i], positions[i + 1], positions[i + 2])
  for (const loop of loops) {
    const r = mesh.addFace(loop)
    if (!r.ok) throw new Error(`meshFromPolygons: ${r.message}`)
  }
  return mesh
}

/** Axis-aligned cube centred on the origin: 8 vertices, 6 quads, outward normals */
export function makeCube(size = 1): HalfEdgeMesh {
  const s = size / 2
  const pos: number[] = []
  for (let i = 0; i < 8; i++) pos.push(i & 1 ? s : -s, i & 2 ? s : -s, i & 4 ? s : -s)
  return meshFromPolygons(pos, [
    [0, 2, 3, 1], // -Z
    [4, 5, 7, 6], // +Z
    [0, 1, 5, 4], // -Y
    [2, 6, 7, 3], // +Y
    [0, 4, 6, 2], // -X
    [1, 3, 7, 5], // +X
  ])
}

/** Closed cylinder along Y with quad sides and n-gon caps */
export function makeCylinder(segments = 16, radius = 0.5, height = 1): HalfEdgeMesh {
  const pos: number[] = []
  const h = height / 2
  for (const y of [-h, h]) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pos.push(Math.cos(a) * radius, y, Math.sin(a) * radius)
    }
  }
  const loops: number[][] = []
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments
    loops.push([i, segments + i, segments + j, j])
  }
  const bottom: number[] = []
  const top: number[] = []
  for (let i = 0; i < segments; i++) {
    bottom.push(i)
    top.push(segments + (segments - 1 - i))
  }
  loops.push(bottom, top)
  return meshFromPolygons(pos, loops)
}

/** Single regular n-gon in the XY plane facing +Z (open mesh, all edges on the boundary) */
export function makeNgon(sides: number, radius = 1): HalfEdgeMesh {
  const pos: number[] = []
  const loop: number[] = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    pos.push(Math.cos(a) * radius, Math.sin(a) * radius, 0)
    loop.push(i)
  }
  return meshFromPolygons(pos, [loop])
}

/** Non-convex L-shaped hexagon in the XY plane facing +Z */
export function makeLShape(): HalfEdgeMesh {
  return meshFromPolygons([0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0], [[0, 1, 2, 3, 4, 5]])
}
