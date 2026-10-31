import { HalfEdgeMesh } from './HalfEdgeMesh'
import { err, ok, type GeomResult } from './result'

/**
 * Compact JSON form of a HalfEdgeMesh for scene files: typed arrays as base64 (little-endian), faces as
 * n-gon vertex loops, uv per face corner. Decoding rebuilds the exact topology (no welding, no
 * triangulation). Scene files cannot hold typed arrays and are pretty-printed, so base64 keeps them small.
 */
export interface EncodedMesh {
  format: 'linden-mesh'
  version: 1
  /** Float32 xyz per vertex */
  positions: string
  /** Uint32 corner count per face */
  faceSizes: string
  /** Uint32 vertex index per face corner, faces concatenated */
  faceVertices: string
  /** Float32 uv per face corner (same order as faceVertices) */
  cornerUvs?: string
}

const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(s)
}

export function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const encodeArray = (a: Float32Array | Uint32Array): string => bytesToBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))

function decodeArray<T extends Float32Array | Uint32Array>(b64: unknown, ctor: new (buf: ArrayBuffer) => T, name: string): GeomResult<T> {
  if (typeof b64 !== 'string') return err('INVALID_MESH', `${name} is missing`)
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(b64)
  } catch {
    return err('INVALID_MESH', `${name} is not valid base64`)
  }
  if (bytes.byteLength % 4 !== 0) return err('INVALID_MESH', `${name} has ${bytes.byteLength} bytes, not a multiple of 4`)
  return ok(new ctor(bytes.slice().buffer))
}

export function encodeHalfEdgeMesh(input: HalfEdgeMesh): EncodedMesh {
  const { mesh } = input.compact()
  const sizes: number[] = []
  const verts: number[] = []
  const uvs: number[] = []
  for (let f = 0; f < mesh.faceSlots; f++) {
    const hs = mesh.faceHalfEdges(f)
    sizes.push(hs.length)
    for (const h of hs) {
      verts.push(mesh.heVertex[h])
      if (mesh.cornerUvs) uvs.push(mesh.cornerUvs[h * 2], mesh.cornerUvs[h * 2 + 1])
    }
  }
  const out: EncodedMesh = {
    format: 'linden-mesh',
    version: 1,
    positions: encodeArray(mesh.positions.slice(0, mesh.vertexSlots * 3)),
    faceSizes: encodeArray(Uint32Array.from(sizes)),
    faceVertices: encodeArray(Uint32Array.from(verts)),
  }
  if (mesh.cornerUvs) out.cornerUvs = encodeArray(Float32Array.from(uvs))
  return out
}

export function decodeHalfEdgeMesh(data: unknown): GeomResult<HalfEdgeMesh> {
  const d = data as Partial<EncodedMesh> | null
  if (!d || d.format !== 'linden-mesh') return err('INVALID_MESH', 'not a linden-mesh')
  if (d.version !== 1) return err('INVALID_MESH', `unsupported linden-mesh version ${String(d.version)}`)
  const positions = decodeArray(d.positions, Float32Array, 'positions')
  if (!positions.ok) return positions
  const sizes = decodeArray(d.faceSizes, Uint32Array, 'faceSizes')
  if (!sizes.ok) return sizes
  const verts = decodeArray(d.faceVertices, Uint32Array, 'faceVertices')
  if (!verts.ok) return verts
  if (positions.value.length % 3 !== 0) return err('INVALID_MESH', 'positions length is not a multiple of 3')
  let total = 0
  for (const s of sizes.value) total += s
  if (total !== verts.value.length) return err('INVALID_MESH', `face sizes sum to ${total} but there are ${verts.value.length} corners`)
  let uvs: Float32Array | null = null
  if (d.cornerUvs !== undefined) {
    const u = decodeArray(d.cornerUvs, Float32Array, 'cornerUvs')
    if (!u.ok) return u
    if (u.value.length !== total * 2) return err('INVALID_MESH', `cornerUvs has ${u.value.length / 2} corners, expected ${total}`)
    uvs = u.value
  }

  const mesh = new HalfEdgeMesh()
  const p = positions.value
  const nv = p.length / 3
  for (let i = 0; i < nv; i++) {
    if (!Number.isFinite(p[i * 3]) || !Number.isFinite(p[i * 3 + 1]) || !Number.isFinite(p[i * 3 + 2])) {
      return err('INVALID_MESH', `vertex ${i} is not finite`)
    }
    mesh.addVertex(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
  }
  if (uvs) mesh.enableCornerUvs()
  let offset = 0
  for (let f = 0; f < sizes.value.length; f++) {
    const loop = verts.value.subarray(offset, offset + sizes.value[f])
    for (const v of loop) if (v >= nv) return err('INVALID_MESH', `face ${f} uses missing vertex ${v}`)
    const r = mesh.addFace(loop)
    if (!r.ok) return err('INVALID_MESH', `face ${f}: ${r.message}`)
    if (uvs && mesh.cornerUvs) {
      mesh.faceHalfEdges(r.value).forEach((h, k) => {
        mesh.cornerUvs![h * 2] = uvs![(offset + k) * 2]
        mesh.cornerUvs![h * 2 + 1] = uvs![(offset + k) * 2 + 1]
      })
    }
    offset += sizes.value[f]
  }
  return ok(mesh)
}
