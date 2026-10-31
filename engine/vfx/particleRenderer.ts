import * as THREE from 'three'
import type { ParticleEmitter } from './ParticleEmitter'
import { ParticleSim, parseGradient, sampleCurve, sampleGradient, type Pose, type Rgba } from './ParticleSim'
import { isSpriteKind, spriteTexture } from './sprites'

/** Name of the particle group under an entity group */
export const PARTICLES = '__particles__'

export interface ParticleRenderOptions {
  /** WebGPURenderer needs a node material; default webgl2 */
  backend?: 'webgl2' | 'webgpu'
  /** Quality cap on ParticleEmitter.maxParticles */
  maxParticlesCap?: number
  /** Quality cap on ParticleEmitter.light */
  allowLights?: boolean
  /** Project textures for ParticleEmitter.texture = 'assets/...' */
  loadTexture?: (path: string, srgb: boolean) => THREE.Texture | null
}

interface MaterialOptions {
  map: THREE.Texture | null
  blending: 'additive' | 'normal'
  alpha: THREE.InstancedBufferAttribute
}

/** WebGL: built-in basic material with per-instance alpha patched in */
export function createWebGLParticleMaterial(opts: MaterialOptions): THREE.Material {
  const material = new THREE.MeshBasicMaterial({
    map: opts.map,
    transparent: true,
    depthWrite: false,
    blending: opts.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float instanceAlpha;\nvarying float vInstanceAlpha;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvInstanceAlpha = instanceAlpha;')
    shader.fragmentShader =
      'varying float vInstanceAlpha;\n' +
      shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= vInstanceAlpha;')
  }
  material.customProgramCacheKey = () => 'linden-particles'
  return material
}

/** WebGPU: node material reading the same per-instance alpha attribute */
export async function createWebGPUParticleMaterial(opts: MaterialOptions): Promise<THREE.Material> {
  const [{ MeshBasicNodeMaterial }, { instancedBufferAttribute }] = await Promise.all([import('three/webgpu'), import('three/tsl')])
  const material = new MeshBasicNodeMaterial({
    map: opts.map,
    transparent: true,
    depthWrite: false,
    blending: opts.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  material.opacityNode = instancedBufferAttribute(opts.alpha as any, 'float')
  return material as unknown as THREE.Material
}

/**
 * One emitter: a ParticleSim drawn as camera-facing quads in one InstancedMesh, plus an optional
 * flickering PointLight. `object` goes under the entity's group.
 */
export class ParticleSystem {
  readonly object = new THREE.Group()
  readonly sim: ParticleSim
  readonly mesh: THREE.InstancedMesh
  private alpha: THREE.InstancedBufferAttribute
  private light: THREE.PointLight | null = null
  private gradient
  private sizeKeys
  private worldSpace: boolean
  private lightBase = 0
  private flicker = 0
  private clock = 0
  private camQuat = new THREE.Quaternion()
  private pose: Pose = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  private ownedMap: THREE.Texture | null

  constructor(
    readonly emitter: ParticleEmitter,
    material: THREE.Material,
    alpha: THREE.InstancedBufferAttribute,
    opts: ParticleRenderOptions,
    ownedMap: THREE.Texture | null
  ) {
    const config = emitter.toConfig(opts.maxParticlesCap ?? Infinity)
    this.sim = new ParticleSim(config)
    this.gradient = parseGradient(config.color)
    this.sizeKeys = config.size
    this.worldSpace = emitter.space !== 'local'
    this.alpha = alpha
    this.ownedMap = ownedMap

    const geometry = new THREE.PlaneGeometry(1, 1)
    geometry.setAttribute('instanceAlpha', alpha)
    this.mesh = new THREE.InstancedMesh(geometry, material, this.sim.capacity)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // Allocates instanceColor before the first compile so the shader includes it
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1))
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = 0
    // Instances move every frame, so the cached bounding sphere would cull them wrongly
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      camera.getWorldQuaternion(this.camQuat)
    }

    this.object.name = PARTICLES
    this.object.add(this.mesh)
    if (this.worldSpace) this.object.matrixAutoUpdate = false

    const light = emitter.light
    if (light?.enabled && opts.allowLights !== false) {
      this.lightBase = Math.max(light.intensity ?? 0, 0)
      this.flicker = Math.min(Math.max(light.flicker ?? 0, 0), 1)
      this.light = new THREE.PointLight(new THREE.Color(light.color ?? '#ffaa55'), 0, 8, 2)
      this.light.castShadow = false
      this.object.add(this.light)
    }

    emitter._attached = true
    emitter._commands = []
    if (emitter.playOnStart !== false) this.sim.play()
  }

  /** Advance and redraw; returns true once when a non-looping emitter finished */
  update(dt: number): boolean {
    this.syncPose()
    for (const cmd of this.emitter._commands) {
      if (cmd.kind === 'play') this.sim.play()
      else if (cmd.kind === 'stop') this.sim.stop(cmd.clear)
      else this.sim.burst(cmd.count, this.pose)
    }
    this.emitter._commands.length = 0

    const finished = this.sim.step(dt, this.pose)
    this.writeInstances()
    this.updateLight(dt)
    return finished
  }

  /** Simulate ahead (previews) so a looping emitter is not empty on its first frame */
  prewarm(seconds: number, step = 1 / 30): void {
    this.syncPose()
    for (let t = 0; t < seconds; t += step) this.sim.step(step, this.pose)
    this.writeInstances()
  }

  /** World space: emit from the entity's world pose and cancel its transform on the group */
  private syncPose(): void {
    const parent = this.object.parent
    if (!this.worldSpace || !parent) return
    parent.updateWorldMatrix(true, false)
    // Instance positions are already world space
    this.object.matrix.copy(parent.matrixWorld).invert()
    this.object.matrixWorldNeedsUpdate = true
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    parent.matrixWorld.decompose(p, q, new THREE.Vector3())
    this.pose = { position: { x: p.x, y: p.y, z: p.z }, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w } }
  }

  private writeInstances(): void {
    const sim = this.sim
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const scale = new THREE.Vector3()
    // Billboard: instance rotation in mesh space that faces the last rendering camera
    const rot = this.worldSpace ? this.camQuat.clone() : this.mesh.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.camQuat)
    const colors = this.mesh.instanceColor!.array as Float32Array
    const alphas = this.alpha.array as Float32Array
    const c: Rgba = { r: 1, g: 1, b: 1, a: 1 }
    for (let i = 0; i < sim.count; i++) {
      const t = sim.age[i] / sim.life[i]
      const s = Math.max(sampleCurve(this.sizeKeys, t) * sim.sizeJitter[i], 0)
      sampleGradient(this.gradient, t, c)
      pos.set(sim.px[i], sim.py[i], sim.pz[i])
      scale.set(s, s, s)
      m.compose(pos, rot, scale)
      this.mesh.setMatrixAt(i, m)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
      alphas[i] = c.a
    }
    this.mesh.count = sim.count
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
    this.alpha.needsUpdate = true
  }

  private updateLight(dt: number): void {
    if (!this.light) return
    this.clock += dt
    const active = Math.min(1, this.sim.count / Math.max(1, this.sim.capacity * 0.1))
    const wobble = 1 + this.flicker * 0.5 * (Math.sin(this.clock * 13.1) + Math.sin(this.clock * 7.3 + 1.7))
    this.light.intensity = this.lightBase * active * Math.max(wobble, 0)
    const p = this.pose.position
    if (this.worldSpace) this.light.position.set(p.x, p.y, p.z)
  }

  dispose(): void {
    this.emitter._attached = false
    this.emitter._commands = []
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.ownedMap?.dispose()
    this.mesh.dispose()
    this.object.parent?.remove(this.object)
  }
}

function prepare(emitter: ParticleEmitter, opts: ParticleRenderOptions) {
  const capacity = emitter.toConfig(opts.maxParticlesCap ?? Infinity).maxParticles
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  alpha.setUsage(THREE.DynamicDrawUsage)
  const tex = emitter.texture
  let map: THREE.Texture | null = null
  let owned: THREE.Texture | null = null
  if (isSpriteKind(tex)) map = spriteTexture(tex)
  else if (typeof tex === 'string' && tex && opts.loadTexture) owned = map = opts.loadTexture(tex, true)
  if (!map) map = spriteTexture('soft')
  return { alpha, map, owned, blending: emitter.blending === 'normal' ? ('normal' as const) : ('additive' as const) }
}

/** WebGL builds synchronously (visible at once in the editor); WebGPU waits for its node material chunk */
export function createParticleSystem(emitter: ParticleEmitter, opts: ParticleRenderOptions = {}): ParticleSystem | Promise<ParticleSystem> {
  const p = prepare(emitter, opts)
  if (opts.backend === 'webgpu') {
    return createWebGPUParticleMaterial({ map: p.map, blending: p.blending, alpha: p.alpha }).then(
      (material) => new ParticleSystem(emitter, material, p.alpha, opts, p.owned)
    )
  }
  const material = createWebGLParticleMaterial({ map: p.map, blending: p.blending, alpha: p.alpha })
  return new ParticleSystem(emitter, material, p.alpha, opts, p.owned)
}
