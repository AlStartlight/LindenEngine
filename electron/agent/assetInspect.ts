import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'

/**
 * Headless inspection of imported assets for linden_asset_import: reads glTF/GLB JSON + accessor
 * metadata (no decoding, so Draco/Meshopt/KTX2 files work too), OBJ text, and HDR/EXR headers.
 */

export interface ModelInfo {
  kind: 'model'
  format: 'glb' | 'gltf' | 'obj'
  triangles: number
  meshes: number
  materials: string[]
  animations: { name: string; duration: number }[]
  /** Model-space bounds in file units (glTF: meters) */
  bounds: [[number, number, number], [number, number, number]] | null
  size: [number, number, number] | null
  extensions: string[]
  warnings: string[]
}

export interface EnvironmentInfo {
  kind: 'environment'
  format: 'hdr' | 'exr'
  width: number
  height: number
  warnings: string[]
}

export type AssetInfo = ModelInfo | EnvironmentInfo

function readGlb(buf: Buffer): { json: any; bin: Buffer | null } {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('Bukan file GLB (magic salah)')
  const length = buf.readUInt32LE(8)
  let offset = 12
  let json: any = null
  let bin: Buffer | null = null
  while (offset < Math.min(length, buf.length)) {
    const chunkLength = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    const data = buf.subarray(offset + 8, offset + 8 + chunkLength)
    if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString('utf-8'))
    else if (chunkType === 0x004e4942) bin = data
    offset += 8 + chunkLength
  }
  if (!json) throw new Error('GLB tanpa chunk JSON')
  return { json, bin }
}

function nodeMatrix(node: any): THREE.Matrix4 {
  if (Array.isArray(node.matrix)) return new THREE.Matrix4().fromArray(node.matrix)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(node.scale ?? [1, 1, 1]))
  )
}

/** Accessor max of a sampler input = clip duration; read from the accessor's declared max */
function accessorMax(json: any, index: number): number {
  const acc = json.accessors?.[index]
  return Array.isArray(acc?.max) ? Number(acc.max[0]) || 0 : 0
}

export function inspectGltfJson(json: any): ModelInfo {
  const warnings: string[] = []
  let triangles = 0
  const meshTris: number[] = []
  for (const mesh of json.meshes ?? []) {
    let t = 0
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4
      const count = prim.indices !== undefined ? json.accessors?.[prim.indices]?.count : json.accessors?.[prim.attributes?.POSITION]?.count
      if (typeof count !== 'number') continue
      if (mode === 4) t += count / 3
      else if (mode === 5 || mode === 6) t += Math.max(0, count - 2)
    }
    meshTris.push(Math.round(t))
  }

  // Bounds: POSITION accessor min/max through the node hierarchy of the default scene
  const bounds = new THREE.Box3()
  const sceneIndex = json.scene ?? 0
  const roots: number[] = json.scenes?.[sceneIndex]?.nodes ?? (json.nodes ?? []).map((_: unknown, i: number) => i)
  const visit = (index: number, parent: THREE.Matrix4, depth: number) => {
    const node = json.nodes?.[index]
    if (!node || depth > 64) return
    const world = parent.clone().multiply(nodeMatrix(node))
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh]
      triangles += meshTris[node.mesh] ?? 0
      for (const prim of mesh?.primitives ?? []) {
        const acc = json.accessors?.[prim.attributes?.POSITION]
        if (!Array.isArray(acc?.min) || !Array.isArray(acc?.max)) continue
        const box = new THREE.Box3(new THREE.Vector3(...acc.min), new THREE.Vector3(...acc.max)).applyMatrix4(world)
        bounds.union(box)
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1)
  }
  for (const r of roots) visit(r, new THREE.Matrix4(), 0)
  if (triangles === 0) triangles = meshTris.reduce((a, b) => a + b, 0)

  const animations = (json.animations ?? []).map((a: any, i: number) => ({
    name: a.name || `Animation_${i}`,
    duration: Math.round(Math.max(0, ...(a.samplers ?? []).map((s: any) => accessorMax(json, s.input))) * 1000) / 1000,
  }))
  const extensions: string[] = json.extensionsUsed ?? []
  const supported = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior', 'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_specular', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_emissive_strength', 'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_lights_punctual', 'KHR_materials_unlit', 'EXT_texture_webp', 'KHR_materials_dispersion', 'EXT_mesh_gpu_instancing'])
  for (const ext of json.extensionsRequired ?? []) {
    if (!supported.has(ext)) warnings.push(`Ekstensi wajib ${ext} mungkin tidak didukung`)
  }

  const size = bounds.isEmpty() ? null : (bounds.getSize(new THREE.Vector3()).toArray().map((n) => Math.round(n * 1000) / 1000) as [number, number, number])
  if (size) {
    const max = Math.max(...size)
    if (max > 100) warnings.push(`Ukuran ${max.toFixed(1)} unit: kemungkinan satuan sentimeter; pakai scale 0.01`)
    else if (max < 0.01) warnings.push(`Ukuran ${max.toFixed(4)} unit sangat kecil; periksa satuan`)
    if (bounds.min.y < -0.01 || bounds.min.y > 0.01) warnings.push(`Titik terendah di y=${bounds.min.y.toFixed(3)}, bukan 0: geser posisi entity agar menapak tanah`)
  }
  if (triangles > 500_000) warnings.push(`${triangles} segitiga: berat untuk perangkat mobile; pertimbangkan versi LOD/decimate`)

  return {
    kind: 'model',
    format: 'gltf',
    triangles: Math.round(triangles),
    meshes: json.meshes?.length ?? 0,
    materials: (json.materials ?? []).map((m: any, i: number) => m.name || `Material_${i}`),
    animations,
    bounds: bounds.isEmpty() ? null : [bounds.min.toArray() as [number, number, number], bounds.max.toArray() as [number, number, number]],
    size,
    extensions,
    warnings,
  }
}

export function inspectObj(text: string): ModelInfo {
  const bounds = new THREE.Box3()
  const v = new THREE.Vector3()
  let triangles = 0
  const materials = new Set<string>()
  const groups = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/).map(Number)
      if ([x, y, z].every(Number.isFinite)) bounds.expandByPoint(v.set(x, y, z))
    } else if (line.startsWith('f ')) {
      triangles += Math.max(0, line.trim().split(/\s+/).length - 3)
    } else if (line.startsWith('usemtl ')) materials.add(line.slice(7).trim())
    else if (line.startsWith('o ') || line.startsWith('g ')) groups.add(line.slice(2).trim())
  }
  const info = inspectGltfJson({})
  const size = bounds.isEmpty() ? null : (bounds.getSize(new THREE.Vector3()).toArray().map((n) => Math.round(n * 1000) / 1000) as [number, number, number])
  return {
    ...info,
    format: 'obj',
    triangles,
    meshes: Math.max(1, groups.size),
    materials: [...materials],
    bounds: bounds.isEmpty() ? null : [bounds.min.toArray() as [number, number, number], bounds.max.toArray() as [number, number, number]],
    size,
    warnings: size && Math.max(...size) > 100 ? [`Ukuran ${Math.max(...size).toFixed(1)} unit: kemungkinan satuan sentimeter; pakai scale 0.01`] : [],
  }
}

export function inspectHdr(buf: Buffer): EnvironmentInfo {
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('latin1')
  if (!head.startsWith('#?RADIANCE') && !head.startsWith('#?RGBE')) throw new Error('Bukan file Radiance HDR')
  const m = /\n-Y (\d+) \+X (\d+)\n/.exec(head)
  if (!m) throw new Error('Header resolusi HDR tidak ditemukan')
  const width = Number(m[2])
  const height = Number(m[1])
  const warnings = Math.abs(width / height - 2) > 0.05 ? [`Rasio ${width}x${height} bukan 2:1 (equirectangular)`] : []
  return { kind: 'environment', format: 'hdr', width, height, warnings }
}

export function inspectExr(buf: Buffer): EnvironmentInfo {
  if (buf.readUInt32LE(0) !== 20000630) throw new Error('Bukan file OpenEXR')
  let offset = 8
  while (offset < buf.length) {
    const nameEnd = buf.indexOf(0, offset)
    if (nameEnd < 0 || nameEnd === offset) break
    const name = buf.toString('latin1', offset, nameEnd)
    const typeEnd = buf.indexOf(0, nameEnd + 1)
    const type = buf.toString('latin1', nameEnd + 1, typeEnd)
    const size = buf.readUInt32LE(typeEnd + 1)
    const dataStart = typeEnd + 5
    if (name === 'dataWindow' && type === 'box2i') {
      const xMin = buf.readInt32LE(dataStart)
      const yMin = buf.readInt32LE(dataStart + 4)
      const xMax = buf.readInt32LE(dataStart + 8)
      const yMax = buf.readInt32LE(dataStart + 12)
      const width = xMax - xMin + 1
      const height = yMax - yMin + 1
      const warnings = Math.abs(width / height - 2) > 0.05 ? [`Rasio ${width}x${height} bukan 2:1 (equirectangular)`] : []
      return { kind: 'environment', format: 'exr', width, height, warnings }
    }
    offset = dataStart + size
  }
  throw new Error('dataWindow EXR tidak ditemukan')
}

export function inspectAssetFile(file: string): AssetInfo {
  const ext = path.extname(file).toLowerCase()
  const buf = fs.readFileSync(file)
  if (ext === '.glb') return { ...inspectGltfJson(readGlb(buf).json), format: 'glb' }
  if (ext === '.gltf') {
    const json = JSON.parse(buf.toString('utf-8'))
    const info = inspectGltfJson(json)
    for (const b of json.buffers ?? []) {
      if (typeof b.uri === 'string' && !b.uri.startsWith('data:') && !fs.existsSync(path.join(path.dirname(file), decodeURIComponent(b.uri)))) {
        info.warnings.push(`Buffer ${b.uri} tidak ditemukan di samping file .gltf`)
      }
    }
    return info
  }
  if (ext === '.obj') return inspectObj(buf.toString('utf-8'))
  if (ext === '.hdr') return inspectHdr(buf)
  if (ext === '.exr') return inspectExr(buf)
  throw new Error(`Format ${ext} tidak didukung (glb, gltf, obj, hdr, exr)`)
}

/** Files a .gltf references by relative URI (buffers, images) that must be copied with it */
export function gltfSidecarFiles(file: string): string[] {
  if (path.extname(file).toLowerCase() !== '.gltf') return []
  const json = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const uris = [...(json.buffers ?? []), ...(json.images ?? [])].map((x: any) => x.uri).filter((u: unknown): u is string => typeof u === 'string' && !u.startsWith('data:'))
  return uris.map((u) => decodeURIComponent(u)).filter((u) => !u.includes('..') && !path.isAbsolute(u))
}
