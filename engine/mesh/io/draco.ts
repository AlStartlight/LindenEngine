import type { LindenMesh } from '../core/LindenMesh'
import { err, fromException, ok, type GeomResult } from '../core/result'
import { withWasmScope, type Deletable, type WasmScope } from '../wasm/WasmScope'

/*
 * Minimal typings for the parts of draco3d's Emscripten/WebIDL API we use. draco3d ships no types;
 * these describe the binding boundary only. Every WebIDL object is freed with `module.destroy(obj)`.
 */
interface DracoObject {
  readonly ptr: number
}
interface DracoInt8Array extends DracoObject {
  size(): number
  GetValue(i: number): number
}
interface DracoMesh extends DracoObject {
  num_faces(): number
  num_points(): number
}
interface DracoAttribute extends DracoObject {}
interface DracoHeaps {
  HEAPU8: Uint8Array
  HEAPF32: Float32Array
  HEAPU32: Uint32Array
  _malloc(bytes: number): number
  _free(ptr: number): void
  destroy(obj: DracoObject): void
}
export interface DracoEncoderModule extends DracoHeaps {
  Encoder: new () => DracoObject & {
    SetAttributeQuantization(type: number, bits: number): void
    SetSpeedOptions(encodeSpeed: number, decodeSpeed: number): void
    SetTrackEncodedProperties(flag: boolean): void
    EncodeMeshToDracoBuffer(mesh: DracoMesh, out: DracoInt8Array): number
    GetNumberOfEncodedPoints(): number
    GetNumberOfEncodedFaces(): number
  }
  MeshBuilder: new () => DracoObject & {
    AddFacesToMesh(mesh: DracoMesh, numFaces: number, faces: Uint32Array): boolean
    AddFloatAttributeToMesh(mesh: DracoMesh, type: number, count: number, components: number, data: Float32Array): number
  }
  Mesh: new () => DracoMesh
  DracoInt8Array: new () => DracoInt8Array
  POSITION: number
  NORMAL: number
  TEX_COORD: number
}
export interface DracoDecoderModule extends DracoHeaps {
  Decoder: new () => DracoObject & {
    DecodeArrayToMesh(data: Int8Array, length: number, mesh: DracoMesh): DracoObject & { ok(): boolean; error_msg(): string }
    GetAttributeByUniqueId(mesh: DracoMesh, id: number): DracoAttribute
    GetAttributeDataArrayForAllPoints(mesh: DracoMesh, attr: DracoAttribute, type: number, bytes: number, ptr: number): boolean
    GetTrianglesUInt32Array(mesh: DracoMesh, bytes: number, ptr: number): boolean
  }
  Mesh: new () => DracoMesh
  DT_FLOAT32: number
}

/** Supplies the .wasm bytes in environments where Emscripten cannot locate the file (bundled workers) */
export type DracoWasmSource = (kind: 'encoder' | 'decoder') => Promise<ArrayBuffer>

let wasmSource: DracoWasmSource | null = null
let encoderLoading: Promise<DracoEncoderModule> | null = null
let decoderLoading: Promise<DracoDecoderModule> | null = null

export function setDracoWasmSource(source: DracoWasmSource | null): void {
  wasmSource = source
  encoderLoading = null
  decoderLoading = null
}

interface Draco3dPackage {
  createEncoderModule(options: { wasmBinary?: ArrayBuffer }): Promise<DracoEncoderModule>
  createDecoderModule(options: { wasmBinary?: ArrayBuffer }): Promise<DracoDecoderModule>
}

async function draco3d(): Promise<Draco3dPackage> {
  // CommonJS package: the namespace's default export is module.exports
  const ns = (await import('draco3d')) as unknown as { default?: Draco3dPackage } & Draco3dPackage
  return ns.default ?? ns
}

export async function loadDracoEncoder(): Promise<GeomResult<DracoEncoderModule>> {
  try {
    encoderLoading ??= (async () => {
      const wasmBinary = wasmSource ? await wasmSource('encoder') : undefined
      return (await draco3d()).createEncoderModule(wasmBinary ? { wasmBinary } : {})
    })()
    return ok(await encoderLoading)
  } catch (e) {
    encoderLoading = null
    return err('WASM_LOAD_FAILED', `could not load the Draco encoder: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function loadDracoDecoder(): Promise<GeomResult<DracoDecoderModule>> {
  try {
    decoderLoading ??= (async () => {
      const wasmBinary = wasmSource ? await wasmSource('decoder') : undefined
      return (await draco3d()).createDecoderModule(wasmBinary ? { wasmBinary } : {})
    })()
    return ok(await decoderLoading)
  } catch (e) {
    decoderLoading = null
    return err('WASM_LOAD_FAILED', `could not load the Draco decoder: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function tracked<T extends DracoObject>(scope: WasmScope, module: DracoHeaps, obj: T): T {
  const handle: Deletable = { delete: () => module.destroy(obj) }
  scope.track(handle)
  return obj
}

export interface DracoEncodeOptions {
  /** Quantization bits (glTF-Transform/Blender defaults) */
  positionBits?: number
  normalBits?: number
  uvBits?: number
  /** 0 (best compression) .. 10 (fastest) */
  encodeSpeed?: number
  decodeSpeed?: number
}

/** Unique attribute ids inside the Draco buffer, as KHR_draco_mesh_compression records them */
export interface DracoEncoded {
  data: Uint8Array
  attributes: { POSITION: number; NORMAL?: number; TEXCOORD_0?: number }
  pointCount: number
  faceCount: number
}

export async function encodeDraco(mesh: LindenMesh, options: DracoEncodeOptions = {}): Promise<GeomResult<DracoEncoded>> {
  const loaded = await loadDracoEncoder()
  if (!loaded.ok) return loaded
  const d = loaded.value
  try {
    return await withWasmScope('draco', (scope) => {
      const encoder = tracked(scope, d, new d.Encoder())
      const builder = tracked(scope, d, new d.MeshBuilder())
      const dmesh = tracked(scope, d, new d.Mesh())
      const nv = mesh.positions.length / 3
      builder.AddFacesToMesh(dmesh, mesh.indices.length / 3, mesh.indices)
      const attributes: DracoEncoded['attributes'] = {
        POSITION: builder.AddFloatAttributeToMesh(dmesh, d.POSITION, nv, 3, mesh.positions),
      }
      if (mesh.normals) attributes.NORMAL = builder.AddFloatAttributeToMesh(dmesh, d.NORMAL, nv, 3, mesh.normals)
      if (mesh.uvs) attributes.TEXCOORD_0 = builder.AddFloatAttributeToMesh(dmesh, d.TEX_COORD, nv, 2, mesh.uvs)
      encoder.SetAttributeQuantization(d.POSITION, options.positionBits ?? 14)
      encoder.SetAttributeQuantization(d.NORMAL, options.normalBits ?? 10)
      encoder.SetAttributeQuantization(d.TEX_COORD, options.uvBits ?? 12)
      encoder.SetSpeedOptions(options.encodeSpeed ?? 5, options.decodeSpeed ?? 5)
      encoder.SetTrackEncodedProperties(true)
      const out = tracked(scope, d, new d.DracoInt8Array())
      const length = encoder.EncodeMeshToDracoBuffer(dmesh, out)
      if (length <= 0) return err('INTERNAL', 'Draco encoding produced no data')
      const data = new Uint8Array(length)
      for (let i = 0; i < length; i++) data[i] = out.GetValue(i) & 0xff
      return ok({
        data,
        attributes,
        pointCount: encoder.GetNumberOfEncodedPoints(),
        faceCount: encoder.GetNumberOfEncodedFaces(),
      })
    })
  } catch (e) {
    return fromException(e)
  }
}

export async function decodeDraco(
  data: Uint8Array, attributes: { POSITION: number; NORMAL?: number; TEXCOORD_0?: number },
): Promise<GeomResult<LindenMesh>> {
  const loaded = await loadDracoDecoder()
  if (!loaded.ok) return loaded
  const d = loaded.value
  try {
    return await withWasmScope('draco', (scope) => {
      const decoder = tracked(scope, d, new d.Decoder())
      const dmesh = tracked(scope, d, new d.Mesh())
      const bytes = new Int8Array(data.buffer, data.byteOffset, data.byteLength)
      // The returned Status points at a static temporary owned by the binding: never destroy it
      const status = decoder.DecodeArrayToMesh(bytes, bytes.length, dmesh)
      if (!status.ok()) return err('INVALID_MESH', `Draco decode failed: ${status.error_msg()}`)

      const nv = dmesh.num_points()
      const readFloats = (id: number, components: number): Float32Array | null => {
        const attr = decoder.GetAttributeByUniqueId(dmesh, id)
        if (!attr.ptr) return null
        const count = nv * components
        const ptr = d._malloc(count * 4)
        try {
          decoder.GetAttributeDataArrayForAllPoints(dmesh, attr, d.DT_FLOAT32, count * 4, ptr)
          return new Float32Array(d.HEAPF32.buffer, ptr, count).slice()
        } finally {
          d._free(ptr)
        }
      }
      const positions = readFloats(attributes.POSITION, 3)
      if (!positions) return err('INVALID_MESH', 'Draco buffer has no POSITION attribute')
      const nIdx = dmesh.num_faces() * 3
      const ptr = d._malloc(nIdx * 4)
      let indices: Uint32Array
      try {
        decoder.GetTrianglesUInt32Array(dmesh, nIdx * 4, ptr)
        indices = new Uint32Array(d.HEAPU32.buffer, ptr, nIdx).slice()
      } finally {
        d._free(ptr)
      }
      const out: LindenMesh = { positions, indices }
      if (attributes.NORMAL !== undefined) {
        const n = readFloats(attributes.NORMAL, 3)
        if (n) out.normals = n
      }
      if (attributes.TEXCOORD_0 !== undefined) {
        const uv = readFloats(attributes.TEXCOORD_0, 2)
        if (uv) out.uvs = uv
      }
      return ok(out)
    })
  } catch (e) {
    return fromException(e)
  }
}
