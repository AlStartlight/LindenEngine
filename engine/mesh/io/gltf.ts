import { isEmpty, validateLindenMesh, type LindenMesh } from '../core/LindenMesh'
import { err, fromException, ok, type GeomResult } from '../core/result'
import { decodeDraco, encodeDraco, type DracoEncodeOptions } from './draco'

/*
 * Mesh-level glTF 2.0 / GLB import and export (geometry only: positions, normals, TEXCOORD_0, indices).
 * Scene import for the editor stays on three's GLTFLoader; this module exchanges LindenMesh data inside
 * the geometry worker, with optional KHR_draco_mesh_compression. UVs use the glTF convention unchanged.
 */

const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const DRACO_EXT = 'KHR_draco_mesh_compression'
const SUPPORTED_REQUIRED = new Set([DRACO_EXT, 'KHR_mesh_quantization'])

const FLOAT = 5126
const UNSIGNED_SHORT = 5123
const UNSIGNED_INT = 5125

interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  normalized?: boolean
  count: number
  type: string
  min?: number[]
  max?: number[]
  sparse?: unknown
}
interface GltfBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
  target?: number
}
interface GltfPrimitive {
  attributes: Record<string, number>
  indices?: number
  mode?: number
  extensions?: { [DRACO_EXT]?: { bufferView: number; attributes: Record<string, number> } }
}
interface GltfNode {
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}
interface GltfJson {
  asset: { version: string; generator?: string }
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes?: GltfNode[]
  meshes?: { name?: string; primitives: GltfPrimitive[] }[]
  accessors?: GltfAccessor[]
  bufferViews?: GltfBufferView[]
  buffers?: { byteLength: number; uri?: string }[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
}

// ---------------------------------------------------------------- export

class BinWriter {
  private parts: Uint8Array[] = []
  length = 0

  /** Appends bytes at a 4-byte aligned offset and returns that offset */
  add(view: ArrayBufferView): number {
    const pad = (4 - (this.length % 4)) % 4
    if (pad) {
      this.parts.push(new Uint8Array(pad))
      this.length += pad
    }
    const offset = this.length
    this.parts.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    this.length += view.byteLength
    return offset
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length + ((4 - (this.length % 4)) % 4))
    let o = 0
    for (const p of this.parts) {
      out.set(p, o)
      o += p.byteLength
    }
    return out
  }
}

function bounds(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}

export interface GlbExportOptions {
  /** true or encoder options: compress with KHR_draco_mesh_compression */
  draco?: boolean | DracoEncodeOptions
  name?: string
}

export async function exportGlb(mesh: LindenMesh, options: GlbExportOptions = {}): Promise<GeomResult<Uint8Array>> {
  const valid = validateLindenMesh(mesh)
  if (!valid.ok) return valid
  if (isEmpty(mesh)) return err('EMPTY_MESH', 'cannot export an empty mesh')
  try {
    const bin = new BinWriter()
    const json: GltfJson = {
      asset: { version: '2.0', generator: 'Linden Engine' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [],
      accessors: [],
      bufferViews: [],
      buffers: [],
    }
    const accessors = json.accessors as GltfAccessor[]
    const views = json.bufferViews as GltfBufferView[]
    const nv = mesh.positions.length / 3
    const { min, max } = bounds(mesh.positions)
    const primitive: GltfPrimitive = { attributes: {}, mode: 4 }

    if (options.draco) {
      const enc = await encodeDraco(mesh, options.draco === true ? {} : options.draco)
      if (!enc.ok) return enc
      const { data, attributes, pointCount, faceCount } = enc.value
      views.push({ buffer: 0, byteOffset: bin.add(data), byteLength: data.byteLength })
      // Accessors describe the decoded data; they have no bufferView of their own
      const add = (a: GltfAccessor): number => accessors.push(a) - 1
      primitive.attributes.POSITION = add({ componentType: FLOAT, count: pointCount, type: 'VEC3', min, max })
      if (attributes.NORMAL !== undefined) primitive.attributes.NORMAL = add({ componentType: FLOAT, count: pointCount, type: 'VEC3' })
      if (attributes.TEXCOORD_0 !== undefined) {
        primitive.attributes.TEXCOORD_0 = add({ componentType: FLOAT, count: pointCount, type: 'VEC2' })
      }
      primitive.indices = add({
        componentType: pointCount < 65536 ? UNSIGNED_SHORT : UNSIGNED_INT, count: faceCount * 3, type: 'SCALAR',
      })
      primitive.extensions = { [DRACO_EXT]: { bufferView: 0, attributes: { ...attributes } } }
      json.extensionsUsed = [DRACO_EXT]
      json.extensionsRequired = [DRACO_EXT]
    } else {
      const addView = (data: ArrayBufferView, target: number): number => {
        views.push({ buffer: 0, byteOffset: bin.add(data), byteLength: data.byteLength, target })
        return views.length - 1
      }
      const add = (a: GltfAccessor): number => accessors.push(a) - 1
      primitive.attributes.POSITION = add({
        bufferView: addView(mesh.positions, 34962), componentType: FLOAT, count: nv, type: 'VEC3', min, max,
      })
      if (mesh.normals) {
        primitive.attributes.NORMAL = add({ bufferView: addView(mesh.normals, 34962), componentType: FLOAT, count: nv, type: 'VEC3' })
      }
      if (mesh.uvs) {
        primitive.attributes.TEXCOORD_0 = add({ bufferView: addView(mesh.uvs, 34962), componentType: FLOAT, count: nv, type: 'VEC2' })
      }
      const small = nv < 65536
      const idx = small ? Uint16Array.from(mesh.indices) : mesh.indices
      primitive.indices = add({
        bufferView: addView(idx, 34963), componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT, count: mesh.indices.length, type: 'SCALAR',
      })
    }

    json.meshes = [{ name: options.name ?? 'mesh', primitives: [primitive] }]
    const binBytes = bin.bytes()
    json.buffers = [{ byteLength: binBytes.byteLength }]
    return ok(writeGlb(json, binBytes))
  } catch (e) {
    return fromException(e)
  }
}

function writeGlb(json: GltfJson, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonLen = text.byteLength + ((4 - (text.byteLength % 4)) % 4)
  const total = 12 + 8 + jsonLen + 8 + bin.byteLength
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, GLB_MAGIC, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonLen, true)
  dv.setUint32(16, CHUNK_JSON, true)
  out.set(text, 20)
  out.fill(0x20, 20 + text.byteLength, 20 + jsonLen) // JSON chunk is padded with spaces
  const b = 20 + jsonLen
  dv.setUint32(b, bin.byteLength, true)
  dv.setUint32(b + 4, CHUNK_BIN, true)
  out.set(bin, b + 8)
  return out
}

// ---------------------------------------------------------------- import

type Mat4 = Float64Array

function identity(): Mat4 {
  const m = new Float64Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = s
    }
  }
  return out
}

/** Column-major local matrix of a node (matrix, or translation * rotation * scale) */
function localMatrix(node: GltfNode): Mat4 {
  if (node.matrix && node.matrix.length === 16) return Float64Array.from(node.matrix)
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const m = new Float64Array(16)
  m[0] = (1 - 2 * (y * y + z * z)) * sx
  m[1] = 2 * (x * y + z * w) * sx
  m[2] = 2 * (x * z - y * w) * sx
  m[4] = 2 * (x * y - z * w) * sy
  m[5] = (1 - 2 * (x * x + z * z)) * sy
  m[6] = 2 * (y * z + x * w) * sy
  m[8] = 2 * (x * z + y * w) * sz
  m[9] = 2 * (y * z - x * w) * sz
  m[10] = (1 - 2 * (x * x + y * y)) * sz
  m[12] = tx
  m[13] = ty
  m[14] = tz
  m[15] = 1
  return m
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

interface ParsedGltf {
  json: GltfJson
  buffers: Uint8Array[]
}

function decodeBase64(data: string): Uint8Array {
  const raw = atob(data)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function parseContainer(bytes: Uint8Array): GeomResult<ParsedGltf> {
  let json: GltfJson
  let glbBin: Uint8Array | null = null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength >= 12 && dv.getUint32(0, true) === GLB_MAGIC) {
    if (dv.getUint32(4, true) !== 2) return err('INVALID_MESH', `unsupported GLB version ${dv.getUint32(4, true)}`)
    let offset = 12
    let jsonText: string | null = null
    while (offset + 8 <= bytes.byteLength) {
      const len = dv.getUint32(offset, true)
      const type = dv.getUint32(offset + 4, true)
      const start = offset + 8
      if (start + len > bytes.byteLength) return err('INVALID_MESH', 'GLB chunk extends past the end of the file')
      if (type === CHUNK_JSON) jsonText = new TextDecoder().decode(bytes.subarray(start, start + len))
      else if (type === CHUNK_BIN && !glbBin) glbBin = bytes.subarray(start, start + len)
      offset = start + len
    }
    if (jsonText === null) return err('INVALID_MESH', 'GLB has no JSON chunk')
    json = JSON.parse(jsonText) as GltfJson
  } else {
    json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson
  }
  if (!json.asset || !String(json.asset.version).startsWith('2.')) return err('INVALID_MESH', 'not a glTF 2.0 asset')
  for (const ext of json.extensionsRequired ?? []) {
    if (!SUPPORTED_REQUIRED.has(ext)) return err('NOT_IMPLEMENTED', `required glTF extension ${ext} is not supported`)
  }
  const buffers: Uint8Array[] = []
  for (const [i, b] of (json.buffers ?? []).entries()) {
    if (b.uri === undefined) {
      if (!glbBin) return err('INVALID_MESH', `buffer ${i} has no uri and there is no GLB BIN chunk`)
      buffers.push(glbBin)
    } else if (b.uri.startsWith('data:')) {
      const comma = b.uri.indexOf(',')
      buffers.push(decodeBase64(b.uri.slice(comma + 1)))
    } else {
      return err('NOT_IMPLEMENTED', `external buffer '${b.uri}' cannot be loaded; use GLB or embedded data URIs`)
    }
  }
  return ok({ json, buffers })
}

function viewBytes(p: ParsedGltf, index: number): GeomResult<{ bytes: Uint8Array; stride?: number }> {
  const view = p.json.bufferViews?.[index]
  if (!view) return err('INVALID_MESH', `bufferView ${index} does not exist`)
  const buffer = p.buffers[view.buffer]
  if (!buffer) return err('INVALID_MESH', `buffer ${view.buffer} does not exist`)
  const start = view.byteOffset ?? 0
  if (start + view.byteLength > buffer.byteLength) return err('INVALID_MESH', `bufferView ${index} is out of range`)
  return ok({ bytes: buffer.subarray(start, start + view.byteLength), stride: view.byteStride })
}

/** Reads an accessor as floats (normalized integers are converted) or, for indices, as uint32 */
function readAccessor(p: ParsedGltf, index: number, asIndices: boolean): GeomResult<{ data: Float32Array | Uint32Array; components: number }> {
  const acc = p.json.accessors?.[index]
  if (!acc) return err('INVALID_MESH', `accessor ${index} does not exist`)
  if (acc.sparse) return err('NOT_IMPLEMENTED', `sparse accessor ${index} is not supported`)
  const components = COMPONENTS[acc.type]
  if (!components) return err('INVALID_MESH', `accessor ${index} has unknown type ${acc.type}`)
  const out = asIndices ? new Uint32Array(acc.count * components) : new Float32Array(acc.count * components)
  if (acc.bufferView === undefined) return ok({ data: out, components }) // all zeros per spec
  const vb = viewBytes(p, acc.bufferView)
  if (!vb.ok) return vb
  const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  const size = sizes[acc.componentType]
  if (!size) return err('INVALID_MESH', `accessor ${index} has unknown componentType ${acc.componentType}`)
  const stride = vb.value.stride ?? size * components
  const base = acc.byteOffset ?? 0
  const bytes = vb.value.bytes
  if (acc.count > 0 && base + stride * (acc.count - 1) + size * components > bytes.byteLength) {
    return err('INVALID_MESH', `accessor ${index} reads past its bufferView`)
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const norm = !!acc.normalized && !asIndices
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < components; c++) {
      const o = base + i * stride + c * size
      let v: number
      switch (acc.componentType) {
        case 5120: v = dv.getInt8(o); if (norm) v = Math.max(v / 127, -1); break
        case 5121: v = dv.getUint8(o); if (norm) v /= 255; break
        case 5122: v = dv.getInt16(o, true); if (norm) v = Math.max(v / 32767, -1); break
        case 5123: v = dv.getUint16(o, true); if (norm) v /= 65535; break
        case 5125: v = dv.getUint32(o, true); break
        default: v = dv.getFloat32(o, true)
      }
      out[i * components + c] = v
    }
  }
  return ok({ data: out, components })
}

interface PrimitiveData {
  positions: Float32Array
  normals?: Float32Array
  uvs?: Float32Array
  indices: Uint32Array
}

async function readPrimitive(p: ParsedGltf, prim: GltfPrimitive): Promise<GeomResult<PrimitiveData>> {
  const draco = prim.extensions?.[DRACO_EXT]
  if (draco) {
    const vb = viewBytes(p, draco.bufferView)
    if (!vb.ok) return vb
    const a = draco.attributes
    if (a.POSITION === undefined) return err('INVALID_MESH', 'Draco primitive has no POSITION')
    const decoded = await decodeDraco(vb.value.bytes, { POSITION: a.POSITION, NORMAL: a.NORMAL, TEXCOORD_0: a.TEXCOORD_0 })
    if (!decoded.ok) return decoded
    return ok({ ...decoded.value, indices: decoded.value.indices })
  }
  if (prim.attributes.POSITION === undefined) return err('INVALID_MESH', 'primitive has no POSITION')
  const pos = readAccessor(p, prim.attributes.POSITION, false)
  if (!pos.ok) return pos
  if (pos.value.components !== 3) return err('INVALID_MESH', 'POSITION must be VEC3')
  const out: PrimitiveData = { positions: pos.value.data as Float32Array, indices: new Uint32Array(0) }
  const nv = out.positions.length / 3
  if (prim.attributes.NORMAL !== undefined) {
    const n = readAccessor(p, prim.attributes.NORMAL, false)
    if (!n.ok) return n
    out.normals = n.value.data as Float32Array
  }
  if (prim.attributes.TEXCOORD_0 !== undefined) {
    const uv = readAccessor(p, prim.attributes.TEXCOORD_0, false)
    if (!uv.ok) return uv
    out.uvs = uv.value.data as Float32Array
  }
  if (prim.indices !== undefined) {
    const idx = readAccessor(p, prim.indices, true)
    if (!idx.ok) return idx
    out.indices = idx.value.data as Uint32Array
  } else {
    out.indices = new Uint32Array(nv)
    for (let i = 0; i < nv; i++) out.indices[i] = i
  }
  for (let i = 0; i < out.indices.length; i++) {
    if (out.indices[i] >= nv) return err('INVALID_MESH', `index ${out.indices[i]} is out of range`)
  }
  return ok(out)
}

export interface GltfImportReport {
  primitives: number
  /** Points/lines/strips are not imported */
  skippedPrimitives: number
}

/**
 * Imports every triangle primitive of the default scene, with node transforms applied, merged into one mesh.
 * uv/normal channels are kept only when every primitive has them.
 */
export async function importGltf(bytes: Uint8Array): Promise<GeomResult<{ mesh: LindenMesh; report: GltfImportReport }>> {
  try {
    const parsed = parseContainer(bytes)
    if (!parsed.ok) return parsed
    const p = parsed.value
    const { json } = p
    const nodes = json.nodes ?? []

    const instances: { mesh: number; matrix: Mat4 }[] = []
    const visit = (n: number, parent: Mat4, depth: number): void => {
      const node = nodes[n]
      if (!node || depth > 256) return
      const m = multiply(parent, localMatrix(node))
      if (node.mesh !== undefined) instances.push({ mesh: node.mesh, matrix: m })
      for (const c of node.children ?? []) visit(c, m, depth + 1)
    }
    if (json.scenes && json.scenes.length) {
      for (const n of json.scenes[json.scene ?? 0]?.nodes ?? []) visit(n, identity(), 0)
    } else if (nodes.length) {
      const children = new Set(nodes.flatMap((n) => n.children ?? []))
      nodes.forEach((_, i) => { if (!children.has(i)) visit(i, identity(), 0) })
    } else {
      ;(json.meshes ?? []).forEach((_, i) => instances.push({ mesh: i, matrix: identity() }))
    }

    const report: GltfImportReport = { primitives: 0, skippedPrimitives: 0 }
    const parts: { data: PrimitiveData; matrix: Mat4 }[] = []
    for (const inst of instances) {
      const mesh = json.meshes?.[inst.mesh]
      if (!mesh) return err('INVALID_MESH', `mesh ${inst.mesh} does not exist`)
      for (const prim of mesh.primitives) {
        if ((prim.mode ?? 4) !== 4) {
          report.skippedPrimitives++
          continue
        }
        const data = await readPrimitive(p, prim)
        if (!data.ok) return data
        parts.push({ data: data.value, matrix: inst.matrix })
        report.primitives++
      }
    }
    if (!parts.length) return err('EMPTY_MESH', 'the file contains no triangle meshes')
    return ok({ mesh: mergeParts(parts), report })
  } catch (e) {
    return fromException(e, 'INVALID_MESH')
  }
}

function mergeParts(parts: { data: PrimitiveData; matrix: Mat4 }[]): LindenMesh {
  const withUv = parts.every((x) => x.data.uvs)
  const withNormal = parts.every((x) => x.data.normals)
  let nv = 0
  let ni = 0
  for (const { data } of parts) {
    nv += data.positions.length / 3
    ni += data.indices.length
  }
  const positions = new Float32Array(nv * 3)
  const normals = withNormal ? new Float32Array(nv * 3) : undefined
  const uvs = withUv ? new Float32Array(nv * 2) : undefined
  const indices = new Uint32Array(ni)
  let vo = 0
  let io = 0
  for (const { data, matrix: m } of parts) {
    const count = data.positions.length / 3
    // Normal matrix = cofactor(M) * sign(det M) = inverse-transpose up to a positive scale
    const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10]
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    const s = det < 0 ? -1 : 1
    const n = [
      (e * i - f * h) * s, (f * g - d * i) * s, (d * h - e * g) * s,
      (c * h - b * i) * s, (a * i - c * g) * s, (b * g - a * h) * s,
      (b * f - c * e) * s, (c * d - a * f) * s, (a * e - b * d) * s,
    ]
    for (let v = 0; v < count; v++) {
      const x = data.positions[v * 3], y = data.positions[v * 3 + 1], z = data.positions[v * 3 + 2]
      const o = (vo + v) * 3
      positions[o] = m[0] * x + m[4] * y + m[8] * z + m[12]
      positions[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
      positions[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
      if (normals && data.normals) {
        const nx = data.normals[v * 3], ny = data.normals[v * 3 + 1], nz = data.normals[v * 3 + 2]
        const tx = n[0] * nx + n[1] * ny + n[2] * nz
        const ty = n[3] * nx + n[4] * ny + n[5] * nz
        const tz = n[6] * nx + n[7] * ny + n[8] * nz
        const len = Math.hypot(tx, ty, tz) || 1
        normals[o] = tx / len
        normals[o + 1] = ty / len
        normals[o + 2] = tz / len
      }
      if (uvs && data.uvs) {
        uvs[(vo + v) * 2] = data.uvs[v * 2]
        uvs[(vo + v) * 2 + 1] = data.uvs[v * 2 + 1]
      }
    }
    // A mirroring transform flips the winding
    for (let t = 0; t < data.indices.length; t += 3) {
      indices[io + t] = data.indices[t] + vo
      indices[io + t + 1] = data.indices[t + (det < 0 ? 2 : 1)] + vo
      indices[io + t + 2] = data.indices[t + (det < 0 ? 1 : 2)] + vo
    }
    vo += count
    io += data.indices.length
  }
  const out: LindenMesh = { positions, indices }
  if (normals) out.normals = normals
  if (uvs) out.uvs = uvs
  return out
}
