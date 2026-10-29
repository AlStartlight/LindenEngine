import * as THREE from 'three'

/**
 * Minimal binary glTF 2.0 writer for meshes with PBR materials and node animations (TRS tracks).
 * Runs without a DOM (GLTFExporter's binary path needs FileReader), so models built from parts
 * can be exported as .glb by scripts and tests.
 */

export interface GlbNodeInput {
  name: string
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  position?: THREE.Vector3
  quaternion?: THREE.Quaternion
  scale?: THREE.Vector3
}

export function writeGlb(nodes: GlbNodeInput[], animations: THREE.AnimationClip[] = []): Uint8Array {
  const chunks: Buffer[] = []
  let byteLength = 0
  const bufferViews: any[] = []
  const accessors: any[] = []

  const addView = (data: ArrayBufferView, target?: number): number => {
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const pad = (4 - (byteLength % 4)) % 4
    if (pad) {
      chunks.push(Buffer.alloc(pad))
      byteLength += pad
    }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length, ...(target ? { target } : {}) })
    chunks.push(buf)
    byteLength += buf.length
    return bufferViews.length - 1
  }

  const addAccessor = (array: Float32Array | Uint32Array, itemSize: number, opts: { target?: number; minMax?: boolean } = {}): number => {
    const view = addView(array, opts.target)
    const count = array.length / itemSize
    const acc: any = {
      bufferView: view,
      componentType: array instanceof Uint32Array ? 5125 : 5126,
      count,
      type: ({ 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4' } as Record<number, string>)[itemSize],
    }
    if (opts.minMax) {
      const min = new Array(itemSize).fill(Infinity)
      const max = new Array(itemSize).fill(-Infinity)
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < itemSize; k++) {
          const v = array[i * itemSize + k]
          if (v < min[k]) min[k] = v
          if (v > max[k]) max[k] = v
        }
      }
      acc.min = min
      acc.max = max
    }
    accessors.push(acc)
    return accessors.length - 1
  }

  const materials: any[] = []
  const materialIndex = new Map<THREE.Material, number>()
  const extensionsUsed = new Set<string>()
  const materialOf = (m: THREE.MeshStandardMaterial): number => {
    const cached = materialIndex.get(m)
    if (cached !== undefined) return cached
    const c = m.color
    const mat: any = {
      name: m.name || `Material_${materials.length}`,
      pbrMetallicRoughness: { baseColorFactor: [c.r, c.g, c.b, m.opacity], metallicFactor: m.metalness, roughnessFactor: m.roughness },
    }
    if (m.emissive && m.emissive.getHex() !== 0) mat.emissiveFactor = m.emissive.toArray()
    if (m.transparent) mat.alphaMode = 'BLEND'
    const p = m as THREE.MeshPhysicalMaterial
    if (p.isMeshPhysicalMaterial) {
      const ext: any = {}
      if (p.clearcoat > 0) ext.KHR_materials_clearcoat = { clearcoatFactor: p.clearcoat, clearcoatRoughnessFactor: p.clearcoatRoughness }
      if (p.transmission > 0) {
        ext.KHR_materials_transmission = { transmissionFactor: p.transmission }
        ext.KHR_materials_volume = { thicknessFactor: p.thickness }
      }
      if (p.ior !== 1.5) ext.KHR_materials_ior = { ior: p.ior }
      if (Object.keys(ext).length) {
        mat.extensions = ext
        Object.keys(ext).forEach((k) => extensionsUsed.add(k))
      }
    }
    materials.push(mat)
    materialIndex.set(m, materials.length - 1)
    return materials.length - 1
  }

  const meshes: any[] = []
  const gltfNodes: any[] = []
  for (const n of nodes) {
    const g = n.geometry
    const attributes: any = {
      POSITION: addAccessor(new Float32Array(g.attributes.position.array), 3, { target: 34962, minMax: true }),
    }
    if (g.attributes.normal) attributes.NORMAL = addAccessor(new Float32Array(g.attributes.normal.array), 3, { target: 34962 })
    if (g.attributes.uv) attributes.TEXCOORD_0 = addAccessor(new Float32Array(g.attributes.uv.array), 2, { target: 34962 })
    const prim: any = { attributes, material: materialOf(n.material), mode: 4 }
    if (g.index) prim.indices = addAccessor(new Uint32Array(g.index.array), 1, { target: 34963 })
    meshes.push({ name: n.name, primitives: [prim] })
    const node: any = { name: n.name, mesh: meshes.length - 1 }
    if (n.position) node.translation = n.position.toArray()
    if (n.quaternion) node.rotation = n.quaternion.toArray()
    if (n.scale) node.scale = n.scale.toArray()
    gltfNodes.push(node)
  }

  const gltfAnimations = animations.map((clip) => {
    const samplers: any[] = []
    const channels: any[] = []
    for (const track of clip.tracks) {
      const [nodeName, prop] = track.name.split('.')
      const node = gltfNodes.findIndex((n) => n.name === nodeName)
      const pathName = ({ position: 'translation', quaternion: 'rotation', scale: 'scale' } as Record<string, string>)[prop]
      if (node < 0 || !pathName) continue
      const input = addAccessor(new Float32Array(track.times), 1, { minMax: true })
      const output = addAccessor(new Float32Array(track.values), pathName === 'rotation' ? 4 : 3)
      samplers.push({ input, output, interpolation: 'LINEAR' })
      channels.push({ sampler: samplers.length - 1, target: { node, path: pathName } })
    }
    return { name: clip.name, samplers, channels }
  })

  const bin = Buffer.concat(chunks)
  const json: any = {
    asset: { version: '2.0', generator: 'Linden Engine glbWriter' },
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, i) => i) }],
    nodes: gltfNodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  }
  if (gltfAnimations.length) json.animations = gltfAnimations
  if (extensionsUsed.size) json.extensionsUsed = [...extensionsUsed]

  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf-8')
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)])
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)])
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonPadded.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binPadded.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)
  return new Uint8Array(Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]))
}
