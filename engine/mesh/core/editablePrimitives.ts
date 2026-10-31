import { HalfEdgeMesh } from './HalfEdgeMesh'

/*
 * Quad/n-gon versions of the MeshRenderer primitives (engine/renderer/primitives.ts), with per-corner UVs,
 * used by "Convert to Editable Mesh". Same sizes as the three.js primitives in sceneFactory.ts, but with
 * fewer segments (easier to edit). Free of three.js so the component registry can import it.
 */

const SEGMENTS = 24
const TAU = Math.PI * 2

interface Builder {
  mesh: HalfEdgeMesh
  face(vertices: number[], uvs: number[]): void
}

function builder(): Builder {
  const mesh = new HalfEdgeMesh()
  mesh.enableCornerUvs()
  return {
    mesh,
    face(vertices, uvs) {
      const r = mesh.addFace(vertices)
      if (!r.ok) throw new Error(`editable primitive: ${r.message}`)
      mesh.faceHalfEdges(r.value).forEach((h, k) => {
        mesh.cornerUvs![h * 2] = uvs[k * 2]
        mesh.cornerUvs![h * 2 + 1] = uvs[k * 2 + 1]
      })
    },
  }
}

/**
 * Surface of revolution around Y from a profile of [radius, y] points, bottom to top. A point with
 * radius 0 is a pole: a flat cap (same y as its neighbour) becomes one n-gon, otherwise a triangle fan.
 */
function lathe(profile: [number, number][], segments = SEGMENTS): HalfEdgeMesh {
  const b = builder()
  const m = b.mesh
  const rings: number[][] = []
  for (const [r, y] of profile) {
    if (r === 0) rings.push([m.addVertex(0, y, 0)])
    else rings.push(Array.from({ length: segments }, (_, s) => m.addVertex(Math.cos((s / segments) * TAU) * r, y, Math.sin((s / segments) * TAU) * r)))
  }
  // v runs along the profile length
  const lengths = [0]
  for (let i = 1; i < profile.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]))
  }
  const v = (i: number) => lengths[i] / lengths[lengths.length - 1]
  const u = (s: number) => s / segments
  const capUv = (s: number): [number, number] => [0.5 + Math.cos((s / segments) * TAU) * 0.5, 0.5 + Math.sin((s / segments) * TAU) * 0.5]

  for (let i = 0; i + 1 < rings.length; i++) {
    const lo = rings[i]
    const up = rings[i + 1]
    if (lo.length === 1 && up.length === 1) continue
    if (lo.length === 1) {
      if (profile[i][1] === profile[i + 1][1]) {
        // Flat bottom cap: one n-gon facing -Y
        b.face([...up], up.flatMap((_, s) => capUv(s)))
        m.removeVertex(lo[0])
      } else {
        for (let s = 0; s < segments; s++) {
          b.face([lo[0], up[s], up[(s + 1) % segments]], [u(s + 0.5), v(i), u(s), v(i + 1), u(s + 1), v(i + 1)])
        }
      }
    } else if (up.length === 1) {
      if (profile[i][1] === profile[i + 1][1]) {
        // Flat top cap: one n-gon facing +Y
        const order = [...lo].reverse()
        b.face(order, order.map((_, k) => segments - 1 - k).flatMap((s) => capUv(s)))
        m.removeVertex(up[0])
      } else {
        for (let s = 0; s < segments; s++) {
          b.face([up[0], lo[(s + 1) % segments], lo[s]], [u(s + 0.5), v(i + 1), u(s + 1), v(i), u(s), v(i)])
        }
      }
    } else {
      for (let s = 0; s < segments; s++) {
        const t = (s + 1) % segments
        b.face([lo[s], up[s], up[t], lo[t]], [u(s), v(i), u(s), v(i + 1), u(s + 1), v(i + 1), u(s + 1), v(i)])
      }
    }
  }
  return m.compact().mesh
}

function box(): HalfEdgeMesh {
  const b = builder()
  for (let i = 0; i < 8; i++) b.mesh.addVertex(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5)
  const square = [0, 0, 1, 0, 1, 1, 0, 1]
  for (const loop of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) b.face(loop, square)
  return b.mesh
}

function plane(): HalfEdgeMesh {
  const b = builder()
  for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) b.mesh.addVertex(x, y, 0)
  b.face([0, 1, 2, 3], [0, 0, 1, 0, 1, 1, 0, 1])
  return b.mesh
}

/** Torus in the XY plane (hole along Z), like THREE.TorusGeometry(0.375, 0.125) */
function torus(major = SEGMENTS, minor = 12, R = 0.375, r = 0.125): HalfEdgeMesh {
  const b = builder()
  const id = (i: number, j: number) => (i % major) * minor + (j % minor)
  for (let i = 0; i < major; i++) {
    const a = (i / major) * TAU
    for (let j = 0; j < minor; j++) {
      const c = (j / minor) * TAU
      b.mesh.addVertex((R + r * Math.cos(c)) * Math.cos(a), (R + r * Math.cos(c)) * Math.sin(a), r * Math.sin(c))
    }
  }
  for (let i = 0; i < major; i++) {
    for (let j = 0; j < minor; j++) {
      const u0 = i / major, u1 = (i + 1) / major, v0 = j / minor, v1 = (j + 1) / minor
      b.face([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)], [u0, v0, u1, v0, u1, v1, u0, v1])
    }
  }
  return b.mesh
}

function hemisphereProfile(radius: number, centerY: number, rings: number, upper: boolean): [number, number][] {
  const out: [number, number][] = []
  for (let k = 0; k <= rings; k++) {
    const phi = upper ? (k / rings) * (Math.PI / 2) : -Math.PI / 2 + (k / rings) * (Math.PI / 2)
    out.push([Math.abs(Math.cos(phi)) < 1e-12 ? 0 : Math.cos(phi) * radius, centerY + Math.sin(phi) * radius])
  }
  return out
}

export const EDITABLE_PRIMITIVES = ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'torus', 'plane'] as const

/** Editable version of a MeshRenderer primitive (unknown kinds fall back to box, like normalizePrimitive) */
export function editablePrimitive(kind: string): HalfEdgeMesh {
  switch (kind) {
    case 'sphere':
      return lathe([...hemisphereProfile(0.5, 0, 6, false), ...hemisphereProfile(0.5, 0, 6, true).slice(1)])
    case 'cylinder':
      return lathe([[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]])
    case 'cone':
      return lathe([[0, -0.5], [0.5, -0.5], [0, 0.5]])
    case 'capsule':
      return lathe([...hemisphereProfile(0.5, -0.5, 4, false), ...hemisphereProfile(0.5, 0.5, 4, true)])
    case 'torus':
      return torus()
    case 'plane':
      return plane()
    default:
      return box()
  }
}

/** Mesh-only scale (MeshRenderer.size) baked into the vertices */
export function scaleMesh(mesh: HalfEdgeMesh, size: unknown): void {
  const s = Array.isArray(size) && size.length === 3 && size.every((n) => Number.isFinite(n)) ? (size as number[]) : null
  if (!s) return
  for (let v = 0; v < mesh.vertexSlots; v++) {
    for (let k = 0; k < 3; k++) mesh.positions[v * 3 + k] *= s[k]
  }
}
