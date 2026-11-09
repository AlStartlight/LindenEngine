import * as THREE from 'three'
import { AssetLoader } from '../engine/assets/AssetLoader'
import { factoryExportNames, pickFactoryExport } from '../shared/modelFactory'

/**
 * Factory probe for linden_model_build / linden_model_bake_glb (Model.factory): runs a compiled
 * img2threejs factory once in a real browser context (it needs a DOM canvas) and measures it in
 * its own units, before Linden's fit: bounds, triangles, a convex-hull point set, one box per
 * sculptRuntime collider, exported names, sockets; optionally the meshes (for img2threejs'
 * self_intersection gate) and a binary glTF.
 * Opened as preview.html?probe=models/<x>.ts&export=...&options=<json>&meshes=1&glb=1
 */

export interface FactoryProbeResult {
  exportName: string
  exports: string[]
  bounds: [[number, number, number], [number, number, number]]
  triangles: number
  meshCount: number
  hull: number[]
  boxes: { id: string; center: [number, number, number]; halfExtents: [number, number, number] }[]
  sockets: string[]
  nodes: string[]
  hasTick: boolean
  hasRig: boolean
  materials: string[]
  shaderMaterials: number
  meshes?: { name: string; vertices: number[][]; indices: number[] }[]
  glb?: string
  warnings: string[]
}

const HULL_DIRECTIONS = 160
const MAX_HULL_SAMPLES = 60_000
const MAX_MESH_EXPORT_VERTICES = 400_000

/** Points of `pts` furthest along evenly spread directions: a small set whose hull matches the shape */
export function supportPoints(pts: Float32Array, directions = HULL_DIRECTIONS): number[] {
  const n = pts.length / 3
  if (n === 0) return []
  const chosen = new Set<number>()
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let d = 0; d < directions; d++) {
    const y = 1 - (d / (directions - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const dx = Math.cos(golden * d) * r
    const dz = Math.sin(golden * d) * r
    let best = 0
    let bestDot = -Infinity
    for (let i = 0; i < n; i++) {
      const dot = pts[i * 3] * dx + pts[i * 3 + 1] * y + pts[i * 3 + 2] * dz
      if (dot > bestDot) {
        bestDot = dot
        best = i
      }
    }
    chosen.add(best)
  }
  const out: number[] = []
  for (const i of chosen) out.push(round(pts[i * 3]), round(pts[i * 3 + 1]), round(pts[i * 3 + 2]))
  return out
}

const round = (v: number) => Math.round(v * 1e5) / 1e5
const v3 = (v: THREE.Vector3): [number, number, number] => [round(v.x), round(v.y), round(v.z)]

export async function runFactoryProbe(q: URLSearchParams, resolveUrl: (rel: string) => string): Promise<FactoryProbeResult> {
  const src = q.get('probe') || ''
  const exportName = q.get('export') || undefined
  let options: Record<string, unknown> = {}
  try {
    options = JSON.parse(q.get('options') || '{}')
  } catch {
    options = {}
  }
  const warnings: string[] = []
  const assets = new AssetLoader({ resolveUrl, decoderPath: '', warn: (m) => warnings.push(m) })
  const mod = await assets.loadFactory(src, String(Date.now()))
  const picked = pickFactoryExport(mod, exportName)
  if ('error' in picked) throw new Error(picked.error)
  const group = picked.fn({ castShadow: true, receiveShadow: true, ...options })
  if (!(group instanceof THREE.Object3D)) throw new Error(`${picked.name}() tidak mengembalikan THREE.Group`)
  group.updateMatrixWorld(true)

  const bounds = new THREE.Box3()
  let triangles = 0
  let meshCount = 0
  let shaderMaterials = 0
  const materials = new Set<string>()
  const samples: number[] = []
  let vertexTotal = 0
  const meshList: THREE.Mesh[] = []
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return
    meshList.push(mesh)
    vertexTotal += mesh.geometry.attributes.position.count
  })
  const stride = Math.max(1, Math.ceil(vertexTotal / MAX_HULL_SAMPLES))
  const v = new THREE.Vector3()
  for (const mesh of meshList) {
    meshCount++
    const g = mesh.geometry
    const pos = g.attributes.position
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1
    triangles += ((g.index ? g.index.count : pos.count) / 3) * instances
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(mat.type)
      if ((mat as THREE.ShaderMaterial).isShaderMaterial) shaderMaterials++
    }
    bounds.union(new THREE.Box3().setFromObject(mesh))
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      samples.push(v.x, v.y, v.z)
    }
  }
  if (bounds.isEmpty()) throw new Error('Factory tidak menghasilkan mesh')

  const rt = group.userData?.sculptRuntime ?? {}
  const boxes: FactoryProbeResult['boxes'] = []
  const colliderIds = Object.keys(rt.colliders ?? {})
  const boxFor = (id: string, obj: THREE.Object3D) => {
    const b = new THREE.Box3().setFromObject(obj)
    if (b.isEmpty()) return
    boxes.push({ id, center: v3(b.getCenter(new THREE.Vector3())), halfExtents: v3(b.getSize(new THREE.Vector3()).multiplyScalar(0.5)) })
  }
  for (const id of colliderIds) {
    const obj = rt.meshes?.[id] ?? rt.nodes?.[id]
    if (obj) boxFor(id, obj)
  }
  if (boxes.length === 0) meshList.forEach((m, i) => boxFor(m.name || `mesh${i}`, m))

  const result: FactoryProbeResult = {
    exportName: picked.name,
    exports: factoryExportNames(mod),
    bounds: [v3(bounds.min), v3(bounds.max)],
    triangles: Math.round(triangles),
    meshCount,
    hull: supportPoints(new Float32Array(samples)),
    boxes,
    sockets: Object.keys(rt.sockets ?? {}),
    nodes: Object.keys(rt.nodes ?? {}),
    hasTick: typeof group.userData?.tick === 'function',
    hasRig: !!group.userData?.rig,
    materials: [...materials].sort(),
    shaderMaterials,
    warnings,
  }

  if (q.get('meshes') === '1') {
    let budget = MAX_MESH_EXPORT_VERTICES
    result.meshes = []
    for (const mesh of meshList) {
      const pos = mesh.geometry.attributes.position
      if (pos.count > budget) {
        warnings.push(`meshes.json dipotong: batas ${MAX_MESH_EXPORT_VERTICES} vertex`)
        break
      }
      budget -= pos.count
      const vertices: number[][] = []
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
        vertices.push(v3(v))
      }
      const index = mesh.geometry.index
      const indices = index ? Array.from(index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i)
      result.meshes.push({ name: mesh.name || mesh.uuid, vertices, indices })
    }
  }

  if (q.get('glb') === '1') {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
    const exporter = new GLTFExporter()
    const buf = (await exporter.parseAsync(group, { binary: true, onlyVisible: true, maxTextureSize: Number(options.textureSize) || 2048 })) as ArrayBuffer
    let bin = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    result.glb = btoa(bin)
    if (shaderMaterials > 0) warnings.push(`${shaderMaterials} ShaderMaterial tidak bisa dibawa ke glTF; bagian itu memakai material default`)
  }

  assets.dispose()
  return result
}
