import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ModelPart, ModelSpec, PartShape } from './ModelSpec'
import { MaterialSpec } from '../materials/MaterialSpec'
import { resolveMaterialSpec } from '../materials/presets'
import { createMaterial, MaterialContext } from '../materials/createMaterial'

/**
 * Turns a ModelSpec into geometry. Runs in the browser (editor, player) and in Node (validator,
 * agent tools): no DOM access here.
 */

const DEG = Math.PI / 180

// ---- shapes ---------------------------------------------------------------

/** Rounded rim profile for a solid of revolution: bottom center → bottom rim → side → top rim → top center */
function bevelledRevolutionProfile(rBottom: number, rTop: number, h: number, bevel: number, steps = 4): THREE.Vector2[] {
  const y0 = -h / 2
  const y1 = h / 2
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, y0)]
  const bb = Math.min(bevel, rBottom / 2, h / 4)
  if (rBottom > 0) {
    if (bb > 0) {
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2)
        pts.push(new THREE.Vector2(rBottom - bb + Math.cos(a) * bb, y0 + bb + Math.sin(a) * bb))
      }
    } else pts.push(new THREE.Vector2(rBottom, y0))
  }
  const bt = Math.min(bevel, rTop / 2, h / 4)
  if (rTop > 0) {
    if (bt > 0) {
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * (Math.PI / 2)
        pts.push(new THREE.Vector2(rTop - bt + Math.cos(a) * bt, y1 - bt + Math.sin(a) * bt))
      }
    } else pts.push(new THREE.Vector2(rTop, y1))
  }
  pts.push(new THREE.Vector2(0, y1))
  return pts
}

/** Closed outline of a hollow vessel: outer wall up, rim, inner wall down (and floor if capped) */
export function vesselProfile(points: [number, number][], thickness: number, capBottom: boolean): THREE.Vector2[] {
  const outer = points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y))
  if (thickness <= 0) {
    return capBottom && outer[0].x > 0 ? [new THREE.Vector2(0, outer[0].y), ...outer] : outer
  }
  const yBottom = outer[0].y
  const floorY = capBottom ? yBottom + thickness : yBottom
  const inner: THREE.Vector2[] = []
  for (let i = outer.length - 1; i >= 0; i--) {
    const p = outer[i]
    if (p.y < floorY) continue
    inner.push(new THREE.Vector2(Math.max(0, p.x - thickness), p.y))
  }
  const profile = [...outer, ...inner]
  if (capBottom) {
    profile.unshift(new THREE.Vector2(0, yBottom))
    const last = profile[profile.length - 1]
    if (last.y > floorY) profile.push(new THREE.Vector2(Math.max(0, outerRadiusAt(outer, floorY) - thickness), floorY))
    profile.push(new THREE.Vector2(0, floorY))
  }
  return profile
}

/** Outer profile radius at height y (linear between profile points) */
function outerRadiusAt(outer: THREE.Vector2[], y: number): number {
  for (let i = 1; i < outer.length; i++) {
    const a = outer[i - 1]
    const b = outer[i]
    if ((y >= a.y && y <= b.y) || (y <= a.y && y >= b.y)) {
      const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y)
      return a.x + (b.x - a.x) * t
    }
  }
  return outer[0].x
}

function roundedOutline(points: [number, number][], radius: number): THREE.Shape {
  const shape = new THREE.Shape()
  const n = points.length
  if (radius <= 0) {
    shape.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < n; i++) shape.lineTo(points[i][0], points[i][1])
    shape.closePath()
    return shape
  }
  for (let i = 0; i < n; i++) {
    const prev = new THREE.Vector2(...points[(i - 1 + n) % n])
    const cur = new THREE.Vector2(...points[i])
    const next = new THREE.Vector2(...points[(i + 1) % n])
    const r = Math.min(radius, cur.distanceTo(prev) / 2, cur.distanceTo(next) / 2)
    const a = cur.clone().add(prev.clone().sub(cur).normalize().multiplyScalar(r))
    const b = cur.clone().add(next.clone().sub(cur).normalize().multiplyScalar(r))
    if (i === 0) shape.moveTo(a.x, a.y)
    else shape.lineTo(a.x, a.y)
    shape.quadraticCurveTo(cur.x, cur.y, b.x, b.y)
  }
  shape.closePath()
  return shape
}

function valueNoise2(x: number, y: number, seed: number): number {
  const h = (ix: number, iy: number) => {
    let v = Math.imul(ix * 374761393 + iy * 668265263 + seed * 97, 1274126177)
    v ^= v >>> 15
    return ((v >>> 0) % 10000) / 10000
  }
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = h(xi, yi)
  const b = h(xi + 1, yi)
  const c = h(xi, yi + 1)
  const d = h(xi + 1, yi + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/** Geometry of one part in its own local space (no part transform applied) */
export function createShapeGeometry(shape: PartShape): THREE.BufferGeometry {
  switch (shape.type) {
    case 'roundedBox': {
      const [w, h, d] = shape.size
      const min = Math.min(w, h, d)
      const r = Math.min(shape.radius ?? Math.min(0.02, min * 0.08), min / 2 - 1e-4)
      if (r <= 0) return new THREE.BoxGeometry(w, h, d)
      return new RoundedBoxGeometry(w, h, d, shape.segments ?? 3, r)
    }
    case 'sphere':
      return new THREE.SphereGeometry(shape.radius, shape.widthSegments ?? 48, shape.heightSegments ?? 32)
    case 'capsule':
      return new THREE.CapsuleGeometry(shape.radius, shape.length, 8, shape.radialSegments ?? 32)
    case 'cylinder': {
      const seg = shape.radialSegments ?? 48
      const minDim = Math.min(Math.max(shape.radiusTop, shape.radiusBottom), shape.height)
      const bevel = shape.bevel ?? Math.min(0.01, minDim * 0.05)
      if (shape.openEnded) return new THREE.CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, seg, 1, true)
      if (bevel <= 0) return new THREE.CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, seg)
      return new THREE.LatheGeometry(bevelledRevolutionProfile(shape.radiusBottom, shape.radiusTop, shape.height, bevel), seg)
    }
    case 'cone':
      return new THREE.LatheGeometry(
        bevelledRevolutionProfile(shape.radius, 0, shape.height, Math.min(0.005, shape.radius * 0.05)),
        shape.radialSegments ?? 48
      )
    case 'torus':
      return new THREE.TorusGeometry(shape.radius, shape.tube, shape.radialSegments ?? 24, shape.tubularSegments ?? 96, shape.arc ?? Math.PI * 2)
    case 'lathe':
      return new THREE.LatheGeometry(vesselProfile(shape.points, shape.thickness ?? 0, shape.capBottom ?? false), shape.segments ?? 64)
    case 'extrude': {
      const bevel = shape.bevel ?? Math.min(0.002, shape.depth / 4)
      const outline = roundedOutline(shape.shape, shape.cornerRadius ?? 0)
      for (const hole of shape.holes ?? []) outline.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))))
      const core = Math.max(1e-4, shape.depth - 2 * bevel)
      const geom = new THREE.ExtrudeGeometry(outline, {
        depth: core,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelOffset: -bevel,
        bevelSegments: shape.bevelSegments ?? 3,
        curveSegments: 12,
      })
      geom.translate(0, 0, -core / 2)
      return geom
    }
    case 'tube': {
      const curve = new THREE.CatmullRomCurve3(shape.path.map(([x, y, z]) => new THREE.Vector3(x, y, z)), shape.closed ?? false)
      const tube = new THREE.TubeGeometry(curve, shape.tubularSegments ?? Math.max(16, shape.path.length * 12), shape.radius, shape.radialSegments ?? 16, shape.closed ?? false)
      if (!shape.capped || shape.closed) return tube
      const caps = [curve.getPoint(0), curve.getPoint(1)].map((p) => new THREE.SphereGeometry(shape.radius, shape.radialSegments ?? 16, 8).translate(p.x, p.y, p.z))
      return mergeGeometries([tube, ...caps]) ?? tube
    }
    case 'plane': {
      const [w, d] = shape.size
      const seg = shape.segments ?? (shape.displacement ? 64 : 1)
      const geom = new THREE.PlaneGeometry(w, d, seg, seg)
      geom.rotateX(-Math.PI / 2)
      const disp = shape.displacement
      if (disp) {
        const pos = geom.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) / disp.scale
          const z = pos.getZ(i) / disp.scale
          const n = valueNoise2(x, z, disp.seed ?? 1) * 0.6 + valueNoise2(x * 2.1, z * 2.1, (disp.seed ?? 1) + 1) * 0.3 + valueNoise2(x * 4.3, z * 4.3, (disp.seed ?? 1) + 2) * 0.1
          pos.setY(i, n * disp.amplitude)
        }
        geom.computeVertexNormals()
      }
      return geom
    }
  }
}

/**
 * Box-projected UVs in meters (u, v = the two axes perpendicular to the dominant normal), so a
 * material's tileSize means the same physical size on every part. V follows Y on vertical faces,
 * which runs wood grain along legs and boards.
 */
export function applyBoxUV(geometry: THREE.BufferGeometry): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const nor = geometry.attributes.normal as THREE.BufferAttribute | undefined
  if (!nor) geometry.computeVertexNormals()
  const normal = geometry.attributes.normal as THREE.BufferAttribute
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(normal.getX(i))
    const ay = Math.abs(normal.getY(i))
    const az = Math.abs(normal.getZ(i))
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (ay >= ax && ay >= az) {
      uv[i * 2] = x
      uv[i * 2 + 1] = z
    } else if (ax >= az) {
      uv[i * 2] = z
      uv[i * 2 + 1] = y
    } else {
      uv[i * 2] = x
      uv[i * 2 + 1] = y
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

// ---- assembly -------------------------------------------------------------

export interface BuiltPart {
  part: ModelPart
  /** Geometry in model space (part hierarchy baked in) */
  geometry: THREE.BufferGeometry
  material: MaterialSpec
  /** Model-space transform of the part */
  matrix: THREE.Matrix4
}

export function partMaterial(part: ModelPart): MaterialSpec {
  const m = part.material
  if (m === undefined) return { preset: 'plastic_matte' }
  return typeof m === 'string' ? { preset: m } : m
}

function localMatrix(part: ModelPart, withScale: boolean): THREE.Matrix4 {
  const [px, py, pz] = part.position ?? [0, 0, 0]
  const [rx, ry, rz] = part.rotation ?? [0, 0, 0]
  const [sx, sy, sz] = withScale ? (part.scale ?? [1, 1, 1]) : [1, 1, 1]
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG)),
    new THREE.Vector3(sx, sy, sz)
  )
}

/** Each part's geometry in model space, in spec order */
export function buildPartGeometries(spec: Pick<ModelSpec, 'parts'>): BuiltPart[] {
  const byId = new Map(spec.parts.map((p) => [p.id, p]))
  const worldCache = new Map<string, THREE.Matrix4>()
  const worldOf = (p: ModelPart): THREE.Matrix4 => {
    const cached = worldCache.get(p.id)
    if (cached) return cached
    const parent = p.parent ? byId.get(p.parent) : undefined
    const m = parent ? worldOf(parent).clone().multiply(localMatrix(p, true)) : localMatrix(p, true)
    worldCache.set(p.id, m)
    return m
  }

  return spec.parts.map((part) => {
    const geometry = createShapeGeometry(part.shape)
    // Own scale first so UVs are in real meters, then the rest of the chain
    const [sx, sy, sz] = part.scale ?? [1, 1, 1]
    geometry.scale(sx, sy, sz)
    applyBoxUV(geometry)
    const parent = part.parent ? byId.get(part.parent) : undefined
    const rest = parent ? worldOf(parent).clone().multiply(localMatrix(part, false)) : localMatrix(part, false)
    geometry.applyMatrix4(rest)
    geometry.computeBoundingBox()
    return { part, geometry, material: partMaterial(part), matrix: worldOf(part) }
  })
}

/** Merge geometries that differ in index presence / groups */
export function mergeCompatible(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geoms.length === 1) return geoms[0]
  const anyNonIndexed = geoms.some((g) => !g.index)
  const prepared = geoms.map((g) => {
    let out = anyNonIndexed && g.index ? g.toNonIndexed() : g
    for (const name of Object.keys(out.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name)
    }
    out.clearGroups()
    return out
  })
  const merged = mergeGeometries(prepared, false)
  if (!merged) throw new Error('Gagal menggabungkan geometri part')
  return merged
}

export interface ModelStats {
  parts: number
  meshes: number
  triangles: number
}

function triangleCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3
}

/**
 * Build the renderable object for a part-based model. With merge (default), parts sharing a
 * material become one mesh; with instances, every mesh is an InstancedMesh.
 */
export function buildModelObject(spec: ModelSpec, ctx: MaterialContext & { castShadow?: boolean; receiveShadow?: boolean } = {}): THREE.Group {
  const group = new THREE.Group()
  group.name = '__model__'
  const parts = buildPartGeometries(spec)

  // Group by effective material (and shadow flags)
  const buckets = new Map<string, { material: MaterialSpec; parts: BuiltPart[]; cast: boolean; receive: boolean }>()
  for (const bp of parts) {
    const cast = bp.part.castShadow ?? ctx.castShadow ?? true
    const receive = bp.part.receiveShadow ?? ctx.receiveShadow ?? true
    const key = spec.merge ? `${JSON.stringify(resolveMaterialSpec(bp.material).spec)}|${cast}|${receive}` : bp.part.id
    let bucket = buckets.get(key)
    if (!bucket) buckets.set(key, (bucket = { material: bp.material, parts: [], cast, receive }))
    bucket.parts.push(bp)
  }

  const instances = spec.instances && spec.instances.length > 0 ? spec.instances : null
  const instanceMatrices = instances?.map((inst) => {
    const [rx, ry, rz] = inst.rotation ?? [0, 0, 0]
    return new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(inst.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG)),
      new THREE.Vector3().fromArray(inst.scale ?? [1, 1, 1])
    )
  })

  let triangles = 0
  for (const bucket of buckets.values()) {
    const geometry = mergeCompatible(bucket.parts.map((p) => p.geometry))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const material = createMaterial(bucket.material, ctx)
    let mesh: THREE.Mesh
    if (instanceMatrices) {
      const im = new THREE.InstancedMesh(geometry, material, instanceMatrices.length)
      instanceMatrices.forEach((m, i) => im.setMatrixAt(i, m))
      im.instanceMatrix.needsUpdate = true
      im.computeBoundingSphere()
      mesh = im
    } else {
      mesh = new THREE.Mesh(geometry, material)
    }
    mesh.name = bucket.parts.length === 1 ? `part:${bucket.parts[0].part.id}` : `parts:${bucket.parts.map((p) => p.part.id).join(',')}`
    mesh.castShadow = bucket.cast
    mesh.receiveShadow = bucket.receive
    group.add(mesh)
    triangles += triangleCount(geometry) * (instanceMatrices?.length ?? 1)
  }

  const stats: ModelStats = { parts: parts.length, meshes: group.children.length, triangles: Math.round(triangles) }
  group.userData.modelStats = stats
  return group
}
