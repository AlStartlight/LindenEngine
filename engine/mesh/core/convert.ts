import { HalfEdgeMesh, MAX_VERTEX_SLOTS } from './HalfEdgeMesh'
import { validateLindenMesh, type LindenMesh } from './LindenMesh'
import { err, ok, type GeomResult } from './result'
import { triangulatePolygon } from './triangulate'

export interface FromLindenOptions {
  /** Merge vertices with exactly equal positions (seams split by uv/normal become shared vertices) */
  weld?: boolean
  /**
   * What to do with a face whose edge is already used in the same direction (non-manifold edge or
   * flipped neighbour): 'split' gives the face its own vertex copies, 'error' fails the conversion.
   */
  nonManifold?: 'split' | 'error'
}

export interface ConversionReport {
  degenerateFacesSkipped: number
  nonManifoldFacesSplit: number
  verticesWelded: number
}

export interface FromLindenResult {
  mesh: HalfEdgeMesh
  report: ConversionReport
}

/** LindenMesh -> HalfEdgeMesh. Uses `polygons` when present, else the triangles. */
export function fromLindenMesh(input: LindenMesh, options: FromLindenOptions = {}): GeomResult<FromLindenResult> {
  const valid = validateLindenMesh(input)
  if (!valid.ok) return valid
  const nv = input.positions.length / 3
  if (nv > MAX_VERTEX_SLOTS) return err('INVALID_MESH', `mesh has ${nv} vertices, the limit is ${MAX_VERTEX_SLOTS}`)

  const report: ConversionReport = { degenerateFacesSkipped: 0, nonManifoldFacesSplit: 0, verticesWelded: 0 }
  const mesh = new HalfEdgeMesh()
  const p = input.positions

  // Source vertex -> half-edge mesh vertex
  const remap = new Int32Array(nv)
  if (options.weld) {
    const seen = new Map<string, number>()
    for (let i = 0; i < nv; i++) {
      const key = `${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]}`
      const existing = seen.get(key)
      if (existing !== undefined) {
        remap[i] = existing
        report.verticesWelded++
      } else {
        const v = mesh.addVertex(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
        seen.set(key, v)
        remap[i] = v
      }
    }
  } else {
    for (let i = 0; i < nv; i++) remap[i] = mesh.addVertex(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
  }

  if (input.uvs) mesh.enableCornerUvs()
  if (input.normals) mesh.enableCornerNormals()

  const addSourceFace = (src: ArrayLike<number>): GeomResult<void> => {
    const loop = Array.from(src, (i) => remap[i])
    if (new Set(loop).size !== loop.length) {
      report.degenerateFacesSkipped++
      return ok(undefined)
    }
    let added = mesh.addFace(loop)
    if (!added.ok && added.code === 'NON_MANIFOLD_INPUT' && options.nonManifold !== 'error') {
      const copies = loop.map((v) =>
        mesh.addVertex(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]),
      )
      added = mesh.addFace(copies)
      report.nonManifoldFacesSplit++
    }
    if (!added.ok) return added
    // Corner attributes come from the source vertex of each corner
    const hs = mesh.faceHalfEdges(added.value)
    for (let k = 0; k < hs.length; k++) {
      const s = src[k]
      const h = hs[k]
      if (input.uvs && mesh.cornerUvs) {
        mesh.cornerUvs[h * 2] = input.uvs[s * 2]
        mesh.cornerUvs[h * 2 + 1] = input.uvs[s * 2 + 1]
      }
      if (input.normals && mesh.cornerNormals) {
        for (let c = 0; c < 3; c++) mesh.cornerNormals[h * 3 + c] = input.normals[s * 3 + c]
      }
    }
    return ok(undefined)
  }

  if (input.polygons) {
    const { sizes, indices } = input.polygons
    let offset = 0
    for (let i = 0; i < sizes.length; i++) {
      const r = addSourceFace(indices.subarray(offset, offset + sizes[i]))
      if (!r.ok) return r
      offset += sizes[i]
    }
  } else {
    const idx = input.indices
    for (let t = 0; t < idx.length; t += 3) {
      const r = addSourceFace(idx.subarray(t, t + 3))
      if (!r.ok) return r
    }
  }
  return ok({ mesh, report })
}

export interface ToLindenOptions {
  /** Include the n-gon loops so the mesh converts back without losing quads (default true) */
  polygons?: boolean
}

/**
 * HalfEdgeMesh -> LindenMesh. Alive vertices keep their relative order; a vertex whose corners carry
 * different uv/normal values (a seam) is split, with the extra copies appended after all vertices.
 * n-gons are triangulated (fan when convex, ear clipping otherwise).
 */
export function toLindenMesh(mesh: HalfEdgeMesh, options: ToLindenOptions = {}): LindenMesh {
  const uvs = mesh.cornerUvs
  const normals = mesh.cornerNormals
  const base = new Int32Array(mesh.vertexSlots).fill(-1)
  let count = 0
  for (let v = 0; v < mesh.vertexSlots; v++) if (mesh.vertexAlive[v]) base[v] = count++

  const outPos: number[] = []
  const outUv: number[] = []
  const outNormal: number[] = []
  for (let v = 0; v < mesh.vertexSlots; v++) {
    if (base[v] < 0) continue
    outPos.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
    if (uvs) outUv.push(0, 0)
    if (normals) outNormal.push(0, 0, 0)
  }

  // Output vertex per corner; the first corner seen defines the attributes of the base vertex
  const claimed = new Uint8Array(mesh.vertexSlots)
  const splits = new Map<string, number>()
  const cornerOut = new Int32Array(mesh.halfEdgeSlots)
  const attrsKey = (h: number): string => {
    let k = ''
    if (uvs) k += `${uvs[h * 2]},${uvs[h * 2 + 1]}`
    if (normals) k += `|${normals[h * 3]},${normals[h * 3 + 1]},${normals[h * 3 + 2]}`
    return k
  }
  const writeAttrs = (o: number, h: number): void => {
    if (uvs) {
      outUv[o * 2] = uvs[h * 2]
      outUv[o * 2 + 1] = uvs[h * 2 + 1]
    }
    if (normals) for (let c = 0; c < 3; c++) outNormal[o * 3 + c] = normals[h * 3 + c]
  }
  const baseKeys = new Map<number, string>()

  const polySizes: number[] = []
  const polyIndices: number[] = []
  const tris: number[] = []
  const scratch: number[] = []

  for (let f = 0; f < mesh.faceSlots; f++) {
    if (mesh.faceHalfEdge[f] < 0) continue
    const hs = mesh.faceHalfEdges(f)
    for (const h of hs) {
      const v = mesh.heVertex[h]
      if (!uvs && !normals) {
        cornerOut[h] = base[v]
        continue
      }
      const key = attrsKey(h)
      if (!claimed[v]) {
        claimed[v] = 1
        baseKeys.set(v, key)
        writeAttrs(base[v], h)
        cornerOut[h] = base[v]
      } else if (baseKeys.get(v) === key) {
        cornerOut[h] = base[v]
      } else {
        const splitKey = `${v}#${key}`
        let o = splits.get(splitKey)
        if (o === undefined) {
          o = count++
          splits.set(splitKey, o)
          outPos.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
          if (uvs) outUv.push(0, 0)
          if (normals) outNormal.push(0, 0, 0)
          writeAttrs(o, h)
        }
        cornerOut[h] = o
      }
    }

    polySizes.push(hs.length)
    for (const h of hs) polyIndices.push(cornerOut[h])
    const pts: number[] = []
    for (const h of hs) {
      const v = mesh.heVertex[h]
      pts.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
    }
    scratch.length = 0
    triangulatePolygon(pts, scratch)
    for (const local of scratch) tris.push(cornerOut[hs[local]])
  }

  const out: LindenMesh = { positions: new Float32Array(outPos), indices: new Uint32Array(tris) }
  if (uvs) out.uvs = new Float32Array(outUv)
  if (normals) out.normals = new Float32Array(outNormal)
  if (options.polygons !== false) {
    out.polygons = { sizes: new Uint32Array(polySizes), indices: new Uint32Array(polyIndices) }
  }
  return out
}
