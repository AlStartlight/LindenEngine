import * as THREE from 'three'
import { mulberry32 } from '../utils/random'

/** Name of the water child under an entity group */
export const WATER = '__water__'

export type WaterBackend = 'webgl2' | 'webgpu'

export interface WaterLike {
  size?: { x: number; y: number }
  color?: string
  distortion?: number
  waveSpeed?: number
  reflections?: boolean
}

export interface WaterRenderOptions {
  /** Renderer backend; WaterMesh (TSL) needs WebGPURenderer, Water (GLSL) needs WebGLRenderer */
  backend?: WaterBackend
  /** Quality cap: false renders a plain animated plane without the reflection pass */
  allowReflections?: boolean
}

/** Noise scale of the reflective shaders; the three examples tune theirs for 10 km oceans */
const WAVE_SCALE = 10
const DEFAULT_SUN = new THREE.Vector3(0.70707, 0.70707, 0)

/**
 * Tileable tangent-space normal map (RGBA8) from a sum of integer-frequency sine waves, so it
 * wraps seamlessly. Replaces three's waternormals.jpg, which the npm package does not ship.
 */
export function generateWaterNormals(size = 256, seed = 1): Uint8Array {
  const rand = mulberry32(seed)
  const waves = Array.from({ length: 12 }, (_, i) => {
    const fx = Math.round((rand() * 2 - 1) * (2 + i))
    const fy = Math.round((rand() * 2 - 1) * (2 + i)) || 1
    return { fx, fy, amp: 1 / (1 + i * 0.6), phase: rand() * Math.PI * 2 }
  })
  const data = new Uint8Array(size * size * 4)
  const strength = 0.12
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0
      let dy = 0
      for (const w of waves) {
        const a = (2 * Math.PI * (w.fx * x + w.fy * y)) / size + w.phase
        const c = Math.cos(a) * w.amp
        dx += c * w.fx
        dy += c * w.fy
      }
      const nx = -dx * strength
      const ny = -dy * strength
      const len = Math.hypot(nx, ny, 1)
      const i = (y * size + x) * 4
      data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }
  return data
}

let normalTexture: THREE.DataTexture | null = null

export function waterNormalTexture(): THREE.DataTexture {
  if (!normalTexture) {
    const size = 256
    normalTexture = new THREE.DataTexture(generateWaterNormals(size), size, size, THREE.RGBAFormat)
    normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping
    normalTexture.magFilter = THREE.LinearFilter
    normalTexture.minFilter = THREE.LinearMipmapLinearFilter
    normalTexture.generateMipmaps = true
    normalTexture.needsUpdate = true
  }
  return normalTexture
}

function waterColor(c: unknown): THREE.Color {
  return new THREE.Color(typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#1e5f74')
}

function planeGeometry(water: WaterLike): THREE.PlaneGeometry {
  const sx = Math.max(Math.abs(water.size?.x ?? 20), 0.01)
  const sz = Math.max(Math.abs(water.size?.y ?? 20), 0.01)
  return new THREE.PlaneGeometry(sx, sz)
}

function finish(mesh: THREE.Mesh, kind: 'plain' | 'webgl' | 'webgpu', water: WaterLike): THREE.Mesh {
  mesh.name = WATER
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.userData.water = { kind, waveSpeed: water.waveSpeed ?? 1 }
  return mesh
}

/** Animated transparent plane: low quality profile, reflections off, or as the placeholder while the shader loads */
export function createPlainWater(water: WaterLike): THREE.Mesh {
  const geometry = planeGeometry(water)
  const normalMap = waterNormalTexture().clone()
  normalMap.needsUpdate = true
  normalMap.repeat.set(geometry.parameters.width / 8, geometry.parameters.height / 8)
  const material = new THREE.MeshPhysicalMaterial({
    color: waterColor(water.color),
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.82,
    normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  // disposeMaterial frees textures listed here; the source normal map stays cached
  material.userData.ownedTextures = [normalMap]
  return finish(new THREE.Mesh(geometry, material), 'plain', water)
}

/** Reflective water when the quality profile allows it, otherwise the plain plane */
export async function createWaterObject(water: WaterLike, opts: WaterRenderOptions = {}): Promise<THREE.Mesh> {
  if (water.reflections === false || opts.allowReflections === false) return createPlainWater(water)
  const options = {
    waterNormals: waterNormalTexture(),
    sunDirection: DEFAULT_SUN.clone(),
    sunColor: 0xffffff,
    waterColor: waterColor(water.color),
    distortionScale: Math.max(water.distortion ?? 3.7, 0),
    size: WAVE_SCALE,
  }
  if (opts.backend === 'webgpu') {
    const { WaterMesh } = await import('three/examples/jsm/objects/WaterMesh.js')
    return finish(new WaterMesh(planeGeometry(water), { ...options, resolutionScale: 0.5 }) as unknown as THREE.Mesh, 'webgpu', water)
  }
  const { Water } = await import('three/examples/jsm/objects/Water.js')
  const mesh = new Water(planeGeometry(water), { ...options, textureWidth: 512, textureHeight: 512, fog: false })
  const material = mesh.material as THREE.ShaderMaterial
  material.uniforms.size.value = WAVE_SCALE
  material.userData.ownedTextures = [material.uniforms.mirrorSampler.value]
  return finish(mesh, 'webgl', water)
}

const scratch = new THREE.Vector3()

/** Sun direction from the scene's first directional light (position − target) */
export function sunDirection(scene: THREE.Object3D | null, out = new THREE.Vector3()): THREE.Vector3 {
  let light: THREE.DirectionalLight | null = null
  scene?.traverse((o) => {
    if (!light && (o as THREE.DirectionalLight).isDirectionalLight && o.visible) light = o as THREE.DirectionalLight
  })
  if (!light) return out.copy(DEFAULT_SUN)
  const l = light as THREE.DirectionalLight
  l.getWorldPosition(out)
  l.target.getWorldPosition(scratch)
  out.sub(scratch)
  return out.lengthSq() > 0 ? out.normalize() : out.copy(DEFAULT_SUN)
}

/** Advance waves; WaterMesh reads TSL's global time, so waveSpeed applies to WebGL and the plain plane */
export function updateWater(mesh: THREE.Mesh, dt: number, sun?: THREE.Vector3): void {
  const info = mesh.userData.water as { kind: string; waveSpeed: number } | undefined
  if (!info) return
  const speed = info.waveSpeed
  if (info.kind === 'webgl') {
    const u = (mesh.material as THREE.ShaderMaterial).uniforms
    u.time.value += dt * speed
    if (sun) u.sunDirection.value.copy(sun)
  } else if (info.kind === 'webgpu') {
    if (sun) (mesh as any).sunDirection.value.copy(sun)
  } else {
    const map = (mesh.material as THREE.MeshPhysicalMaterial).normalMap
    if (map) {
      map.offset.x += dt * speed * 0.02
      map.offset.y += dt * speed * 0.013
    }
  }
}
