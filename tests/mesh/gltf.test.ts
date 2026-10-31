import { describe, expect, it } from 'vitest'
// Independent reader for validation (MIT; present transitively through manifold-3d, used by tests only)
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3d'
import { exportGlb, importGltf } from '../../engine/mesh/io/gltf'
import { makeCube, makeUvSphere } from '../../engine/mesh/core/primitives'
import type { LindenMesh } from '../../engine/mesh/core/LindenMesh'
import { bbox, linden, signedVolume, surfaceArea } from './helpers'

function withAttributes(m: LindenMesh): LindenMesh {
  const nv = m.positions.length / 3
  const normals = new Float32Array(nv * 3)
  const uvs = new Float32Array(nv * 2)
  for (let i = 0; i < nv; i++) {
    const [x, y, z] = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]
    const len = Math.hypot(x, y, z) || 1
    normals.set([x / len, y / len, z / len], i * 3)
    uvs.set([Math.atan2(z, x) / (2 * Math.PI) + 0.5, y + 0.5], i * 2)
  }
  return { positions: m.positions, indices: m.indices, normals, uvs }
}

async function roundTrip(bytes: Uint8Array): Promise<LindenMesh> {
  const r = await importGltf(bytes)
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  return r.value.mesh
}

function glbJson(bytes: Uint8Array): Record<string, unknown> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const len = dv.getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)))
}

describe('GLB export/import without compression', () => {
  it('round-trips positions, normals, uvs and indices exactly', async () => {
    const m = withAttributes(linden(makeUvSphere(1, 24, 12)))
    const glb = await exportGlb(m)
    expect(glb.ok).toBe(true)
    if (!glb.ok) return
    const dv = new DataView(glb.value.buffer)
    expect(dv.getUint32(0, true)).toBe(0x46546c67)
    expect(dv.getUint32(8, true)).toBe(glb.value.byteLength)
    expect(glb.value.byteLength % 4).toBe(0)
    const back = await roundTrip(glb.value)
    expect(back).toEqual(m)
  })

  it('uses 32-bit indices above 65535 vertices', async () => {
    const big = linden(makeUvSphere(1, 400, 200))
    expect(big.positions.length / 3).toBeGreaterThan(65535)
    const glb = await exportGlb(big)
    expect(glb.ok).toBe(true)
    if (!glb.ok) return
    const json = glbJson(glb.value) as { accessors: { componentType: number }[] }
    expect(json.accessors[json.accessors.length - 1].componentType).toBe(5125)
    expect((await roundTrip(glb.value)).indices).toEqual(big.indices)
  })

  it('is readable by an independent glTF implementation', async () => {
    const m = withAttributes(linden(makeCube(2)))
    const glb = await exportGlb(m)
    if (!glb.ok) throw new Error(glb.message)
    const doc = await new NodeIO().readBinary(glb.value)
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
    expect(prim.getAttribute('POSITION')!.getCount()).toBe(m.positions.length / 3)
    expect(Array.from(prim.getAttribute('NORMAL')!.getArray()!)).toEqual(Array.from(m.normals!))
    expect(Array.from(prim.getIndices()!.getArray()!)).toEqual(Array.from(m.indices))
  })
})

describe('GLB with Draco compression', () => {
  it('compresses and reopens with the same counts, shape and attributes', async () => {
    const m = withAttributes(linden(makeUvSphere(1, 64, 32)))
    const plain = await exportGlb(m)
    const compressed = await exportGlb(m, { draco: true })
    expect(plain.ok && compressed.ok).toBe(true)
    if (!plain.ok || !compressed.ok) return
    expect(compressed.value.byteLength).toBeLessThan(plain.value.byteLength / 3)

    const json = glbJson(compressed.value) as { extensionsRequired: string[] }
    expect(json.extensionsRequired).toEqual(['KHR_draco_mesh_compression'])

    const back = await roundTrip(compressed.value)
    expect(back.positions.length).toBe(m.positions.length)
    expect(back.indices.length).toBe(m.indices.length)
    expect(back.normals!.length).toBe(m.normals!.length)
    expect(back.uvs!.length).toBe(m.uvs!.length)
    // 14-bit position quantization over an extent of 2: about 1.2e-4 per axis
    const tol = (2 / (1 << 14)) * 2
    const b0 = bbox(m.positions)
    const b1 = bbox(back.positions)
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(b1.min[k] - b0.min[k])).toBeLessThan(tol)
      expect(Math.abs(b1.max[k] - b0.max[k])).toBeLessThan(tol)
    }
    expect(signedVolume(back)).toBeCloseTo(signedVolume(m), 3)
    expect(surfaceArea(back)).toBeCloseTo(surfaceArea(m), 3)
    // Every decoded vertex is near an original vertex (Draco may reorder them)
    const grid = new Map<string, number[]>()
    const cell = (x: number) => Math.floor(x / 0.01)
    for (let i = 0; i < m.positions.length; i += 3) {
      const key = `${cell(m.positions[i])},${cell(m.positions[i + 1])},${cell(m.positions[i + 2])}`
      grid.set(key, [...(grid.get(key) ?? []), i])
    }
    for (let i = 0; i < back.positions.length; i += 3) {
      const p = [back.positions[i], back.positions[i + 1], back.positions[i + 2]]
      let best = Infinity
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(`${cell(p[0]) + dx},${cell(p[1]) + dy},${cell(p[2]) + dz}`) ?? []) {
          best = Math.min(best, Math.hypot(p[0] - m.positions[j], p[1] - m.positions[j + 1], p[2] - m.positions[j + 2]))
        }
      }
      expect(best).toBeLessThan(tol)
    }
    for (let i = 0; i < back.normals!.length; i += 3) {
      expect(Math.hypot(back.normals![i], back.normals![i + 1], back.normals![i + 2])).toBeCloseTo(1, 2)
    }
  })

  it('is decoded correctly by an independent glTF + Draco implementation', async () => {
    const m = withAttributes(linden(makeUvSphere(1, 32, 16)))
    const glb = await exportGlb(m, { draco: true })
    if (!glb.ok) throw new Error(glb.message)
    const io = new NodeIO()
      .registerExtensions([KHRDracoMeshCompression])
      .registerDependencies({ 'draco3d.decoder': await (draco3d as { createDecoderModule(): Promise<unknown> }).createDecoderModule() })
    const doc = await io.readBinary(glb.value)
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
    expect(prim.getAttribute('POSITION')!.getCount()).toBe(m.positions.length / 3)
    expect(prim.getIndices()!.getCount()).toBe(m.indices.length)
    expect(prim.getAttribute('TEXCOORD_0')!.getCount()).toBe(m.positions.length / 3)
    const decoded: LindenMesh = {
      positions: prim.getAttribute('POSITION')!.getArray() as Float32Array,
      indices: Uint32Array.from(prim.getIndices()!.getArray()!),
    }
    expect(signedVolume(decoded)).toBeCloseTo(signedVolume(m), 3)
  })

  it('exports positions-only meshes and honours quantization options', async () => {
    const m = linden(makeCube(1))
    const coarse = await exportGlb(m, { draco: { positionBits: 8 } })
    expect(coarse.ok).toBe(true)
    if (!coarse.ok) return
    const back = await roundTrip(coarse.value)
    expect(back.normals).toBeUndefined()
    expect(back.indices.length).toBe(36)
    expect(signedVolume(back)).toBeCloseTo(1, 1)
  })
})

describe('glTF import details', () => {
  /** Builds a .gltf (JSON) with one triangle in an embedded data: URI buffer */
  function gltfWithNode(node: Record<string, unknown>, extra: Record<string, unknown> = {}): Uint8Array {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const idx = new Uint16Array([0, 1, 2, 0])
    const bytes = new Uint8Array(pos.byteLength + idx.byteLength)
    bytes.set(new Uint8Array(pos.buffer), 0)
    bytes.set(new Uint8Array(idx.buffer), pos.byteLength)
    const json = {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, ...node }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }, { attributes: { POSITION: 0 }, mode: 1 }] }],
      buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      ...extra,
    }
    return new TextEncoder().encode(JSON.stringify(json))
  }

  it('reads .gltf JSON with embedded buffers, applies node TRS and skips non-triangle primitives', async () => {
    const r = await importGltf(gltfWithNode({ translation: [10, 0, 0], scale: [2, 2, 2] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Array.from(r.value.mesh.positions)).toEqual([10, 0, 0, 12, 0, 0, 10, 2, 0])
    expect(r.value.report).toEqual({ primitives: 1, skippedPrimitives: 1 })
  })

  it('a mirroring transform flips the winding so faces stay outward', async () => {
    const r = await importGltf(gltfWithNode({ scale: [-1, 1, 1] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Array.from(r.value.mesh.indices)).toEqual([0, 2, 1])
  })

  it('composes parent and child transforms (rotation quaternion)', async () => {
    const s = Math.SQRT1_2
    const json = JSON.parse(new TextDecoder().decode(gltfWithNode({})))
    json.nodes = [{ children: [1], translation: [0, 5, 0] }, { mesh: 0, rotation: [0, 0, s, s] }] // 90 deg about Z
    const r = await importGltf(new TextEncoder().encode(JSON.stringify(json)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p = Array.from(r.value.mesh.positions).map((v) => Math.round(v * 1e6) / 1e6 + 0)
    expect(p).toEqual([0, 5, 0, 0, 6, 0, -1, 5, 0])
  })

  it('typed errors for unsupported or broken files', async () => {
    const cases: [Uint8Array, string][] = [
      [new Uint8Array([1, 2, 3, 4, 5]), 'INVALID_MESH'],
      [new TextEncoder().encode('{"asset":{"version":"1.0"}}'), 'INVALID_MESH'],
      [gltfWithNode({}, { extensionsRequired: ['EXT_meshopt_compression'] }), 'NOT_IMPLEMENTED'],
      [gltfWithNode({}, { buffers: [{ byteLength: 42, uri: 'mesh.bin' }] }), 'NOT_IMPLEMENTED'],
      [gltfWithNode({}, { meshes: [] }), 'INVALID_MESH'],
      [gltfWithNode({}, { nodes: [], meshes: [] }), 'EMPTY_MESH'],
    ]
    for (const [bytes, code] of cases) {
      const r = await importGltf(bytes)
      expect(r.ok || r.code).toBe(code)
    }
    const empty = await exportGlb({ positions: new Float32Array(0), indices: new Uint32Array(0) })
    expect(empty.ok || empty.code).toBe('EMPTY_MESH')
  })
})
