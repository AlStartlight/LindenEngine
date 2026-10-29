import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MaterialSpec, MaterialSpecSchema } from '../materials/MaterialSpec'
import { createMaterial, disposeMaterial, MaterialContext } from '../materials/createMaterial'
import { AssetLoader } from '../assets/AssetLoader'
import {
  DEFAULT_SCENE_SETTINGS,
  QUALITY_CAPS,
  QualityCaps,
  QualityProfileType,
  SceneSettings,
  SHADOW_MAP_SIZE,
} from '../scene/SceneSettings'
import { createPostPipeline, PostPipeline } from './postProcessing'
import type { GameRenderer, RendererBackend } from './createRenderer'
import { PRIMITIVE_KINDS, PRIMITIVE_SIZES, normalizePrimitive, PrimitiveKind } from './primitives'

/**
 * The one place that turns scene data into three.js objects, shared by the editor viewport
 * (SceneViewport), the player (player.ts, also the web export), the ECS bridge (SceneBridge) and
 * the legacy v1 builder (buildScene), so a scene looks the same everywhere.
 *
 * Units: 1 unit = 1 meter. Primitives are 1 m: box 1×1×1, sphere Ø1, cylinder and cone Ø1×1,
 * plane 1×1 (XY, facing +Z), torus Ø1 overall. The capsule is Ø1×2 m to match the default
 * CapsuleCollider / CharacterController (radius 0.5, height 2).
 */

// ---- primitives -----------------------------------------------------------

export { PRIMITIVE_KINDS, PRIMITIVE_SIZES, normalizePrimitive }
export type { PrimitiveKind }

export function createPrimitiveGeometry(kind: unknown): THREE.BufferGeometry {
  switch (normalizePrimitive(kind)) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1)
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 48, 32)
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 48)
    case 'capsule':
      return new THREE.CapsuleGeometry(0.5, 1, 8, 32)
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 48)
    case 'torus':
      return new THREE.TorusGeometry(0.375, 0.125, 24, 96)
    case 'plane':
      return new THREE.PlaneGeometry(1, 1)
  }
}

// ---- MeshRenderer ---------------------------------------------------------

/**
 * MeshRenderer material: `material` ({ preset, ...overrides }) when present, otherwise the legacy
 * flat color/roughness/metalness fields.
 */
export function meshRendererMaterialSpec(mr: Record<string, any>): MaterialSpec {
  const legacy: MaterialSpec = {
    color: typeof mr.color === 'string' && /^#[0-9a-f]{6}$/i.test(mr.color) ? mr.color : '#3b82f6',
    roughness: typeof mr.roughness === 'number' ? mr.roughness : 0.5,
    metalness: typeof mr.metalness === 'number' ? mr.metalness : 0.1,
  }
  const m = mr.material
  if (!m || typeof m !== 'object' || Object.keys(m).length === 0) return legacy
  const parsed = MaterialSpecSchema.safeParse(m)
  const spec: MaterialSpec = parsed.success ? parsed.data : {}
  // Without a preset the flat fields remain the base the overrides apply to
  return spec.preset ? spec : { ...legacy, ...spec }
}

export interface RenderContext extends MaterialContext {
  assets?: AssetLoader
  /** Renderer backend (water and particle materials differ per backend); default webgl2 */
  backend?: 'webgl2' | 'webgpu'
  /** Quality caps for water and particles; default medium */
  caps?: Pick<QualityCaps, 'waterReflections' | 'maxParticlesPerEmitter' | 'particleLights'>
}

export function materialContext(ctx: RenderContext): MaterialContext {
  return {
    ...ctx,
    loadTexture: ctx.loadTexture ?? (ctx.assets ? (p, srgb) => ctx.assets!.loadTexture(p, srgb) : undefined),
  }
}

/** The '__mesh__' child of an entity with a MeshRenderer */
export function createMeshRendererMesh(mr: Record<string, any>, ctx: RenderContext = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(createPrimitiveGeometry(mr.primitive), createMaterial(meshRendererMaterialSpec(mr), materialContext(ctx)))
  mesh.name = '__mesh__'
  mesh.castShadow = mr.castShadow ?? true
  mesh.receiveShadow = mr.receiveShadow ?? true
  mesh.visible = mr.isVisible ?? true
  applyMeshSize(mesh, mr.size)
  return mesh
}

/** Mesh-only scale (not inherited by child entities); used by v1 migration to keep old sizes */
export function applyMeshSize(mesh: THREE.Object3D, size: unknown): void {
  const s = Array.isArray(size) && size.length === 3 && size.every((n) => Number.isFinite(n)) ? (size as number[]) : [1, 1, 1]
  mesh.scale.set(s[0], s[1], s[2])
}

// ---- lights ---------------------------------------------------------------

export function lightColor(c: unknown): THREE.Color {
  if (typeof c === 'string') return new THREE.Color(c)
  if (c && typeof c === 'object') {
    const o = c as any
    return new THREE.Color(o.r ?? 1, o.g ?? 1, o.b ?? 1)
  }
  return new THREE.Color(1, 1, 1)
}

/**
 * Light component → three light. Physical units: directional in lux-like units (sun ≈ 2–4),
 * point/spot intensity in candela (a 60 W bulb ≈ 65 cd), range in meters.
 */
export function createLightObject(light: Record<string, any>): THREE.Light {
  const color = lightColor(light.color)
  const intensity = typeof light.intensity === 'number' ? light.intensity : 1
  let obj: THREE.Light
  switch (light.type) {
    case 'point':
      obj = new THREE.PointLight(color, intensity, light.range ?? 0, 2)
      break
    case 'spot':
      obj = new THREE.SpotLight(color, intensity, light.range ?? 0, THREE.MathUtils.degToRad(light.angle ?? 45), light.penumbra ?? 0.3, 2)
      break
    case 'ambient':
      obj = new THREE.AmbientLight(color, intensity)
      break
    default:
      obj = new THREE.DirectionalLight(color, intensity)
  }
  obj.name = '__light__'
  obj.castShadow = light.castShadow ?? obj.type !== 'AmbientLight'
  if ((obj as THREE.DirectionalLight).shadow) {
    const shadow = (obj as THREE.DirectionalLight).shadow
    shadow.bias = -0.0002
    shadow.normalBias = 0.02
  }
  // Directional and spot lights shine along the entity's -Z (forward), like a camera
  if (obj instanceof THREE.DirectionalLight || obj instanceof THREE.SpotLight) {
    obj.position.set(0, 0, 0)
    obj.target.position.set(0, 0, -1)
    obj.add(obj.target)
  }
  return obj
}

// ---- tone mapping ---------------------------------------------------------

const TONE_MAPPING: Record<SceneSettings['toneMapping'], THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
}

const DEFAULT_BACKGROUND = '#1a1d26'

export interface ScenePipelineOptions {
  backend: RendererBackend
  quality?: QualityProfileType
  assets?: AssetLoader
  warn?: (message: string) => void
  /** Editor helpers (grid, gizmos) are excluded from shadow fitting by this flag in userData */
  helperFlag?: string
}

/**
 * Applies SceneSettings to a renderer + scene (tone mapping, exposure, IBL, background, ambient,
 * fog, default sun, shadows) and renders, with post-processing when enabled. One per viewport.
 */
export class ScenePipeline {
  readonly caps: QualityCaps
  private settings: SceneSettings = DEFAULT_SCENE_SETTINGS
  private ambient = new THREE.AmbientLight(0xffffff, 0)
  private sun = new THREE.DirectionalLight(0xffffff, 0)
  private pmrem: { fromScene(scene: THREE.Scene, sigma?: number): { texture: THREE.Texture; dispose(): void }; dispose(): void } | null = null
  private roomTarget: { texture: THREE.Texture; dispose(): void } | null = null
  private envToken = 0
  private envReady: Promise<unknown> = Promise.resolve()
  private postReady: Promise<unknown> = Promise.resolve()
  private post: PostPipeline | null = null
  private postKey = ''
  private postBuilding = false
  private camera: THREE.Camera | null = null
  private frame = 0
  private size = { width: 1, height: 1 }
  private disposed = false

  constructor(
    readonly renderer: GameRenderer,
    readonly scene: THREE.Scene,
    private opts: ScenePipelineOptions
  ) {
    this.caps = QUALITY_CAPS[opts.quality ?? 'medium']
    this.ambient.name = '__ambient__'
    this.sun.name = '__sun__'
    this.sun.userData.defaultSun = true
    this.sun.castShadow = true
    this.scene.add(this.ambient, this.sun, this.sun.target)
    const r = renderer as any
    r.outputColorSpace = THREE.SRGBColorSpace
    if (typeof r.setPixelRatio === 'function' && typeof window !== 'undefined') {
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.caps.maxPixelRatio))
    }
  }

  get isWebGPURenderer(): boolean {
    return !!(this.renderer as any).isWebGPURenderer
  }

  private warn(message: string): void {
    if (this.opts.warn) this.opts.warn(message)
    else console.warn(`[Linden] ${message}`)
  }

  getSettings(): SceneSettings {
    return this.settings
  }

  applySettings(settings: SceneSettings): void {
    const prev = this.settings
    this.settings = settings
    const r = this.renderer as any

    r.toneMapping = TONE_MAPPING[settings.toneMapping] ?? THREE.AgXToneMapping
    r.toneMappingExposure = settings.exposure

    this.ambient.color.set(settings.ambientColor)
    this.ambient.intensity = settings.ambientIntensity

    // Fog
    const fog = settings.fog
    if (fog.enabled) {
      this.scene.fog = fog.type === 'linear' ? new THREE.Fog(fog.color, fog.near, fog.far) : new THREE.FogExp2(fog.color, fog.density)
    } else {
      this.scene.fog = null
    }

    // Shadows
    const mapSize = Math.min(SHADOW_MAP_SIZE[settings.shadowQuality], this.caps.shadowMapSize)
    this.renderer.shadowMap.enabled = mapSize > 0
    // r186: PCFSoftShadowMap was removed; PCFShadowMap filters with shadow.radius (soft edges)
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    if (mapSize > 0 && this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null as any
    }

    // Default sun
    const sun = settings.sun
    this.sun.color.set(sun.color)
    this.sun.intensity = sun.enabled ? sun.intensity : 0
    this.sun.userData.direction = new THREE.Vector3().fromArray(sun.direction).normalize()

    if (prev.environment !== settings.environment || prev.skybox !== settings.skybox || !this.scene.environment || prev === settings) {
      this.applyEnvironment()
    }
    this.scene.environmentIntensity = settings.environmentIntensity
    this.scene.backgroundBlurriness = settings.backgroundBlurriness

    this.frame = 0 // refit shadows next frame
  }

  private ensurePmrem(): void {
    if (this.pmrem) return
    if (this.isWebGPURenderer) {
      // WebGPU builds its own PMREM from an equirect environment; RoomEnvironment needs the webgpu generator
      return
    }
    this.pmrem = new THREE.PMREMGenerator(this.renderer as unknown as THREE.WebGLRenderer) as any
  }

  private async roomEnvironment(): Promise<THREE.Texture> {
    if (this.roomTarget) return this.roomTarget.texture
    const room = new RoomEnvironment()
    if (this.isWebGPURenderer) {
      const { PMREMGenerator } = await import('three/webgpu')
      const gen: any = new PMREMGenerator(this.renderer as any)
      this.roomTarget = gen.fromScene(room, 0.04)
      gen.dispose()
    } else {
      this.ensurePmrem()
      this.roomTarget = this.pmrem!.fromScene(room as unknown as THREE.Scene, 0.04)
    }
    room.dispose()
    return this.roomTarget!.texture
  }

  /** Resolves when the environment map and the post-processing pipeline are in place */
  async whenReady(): Promise<void> {
    await Promise.allSettled([this.envReady, this.postReady])
  }

  private applyEnvironment(): void {
    this.envReady = this.loadEnvironment()
  }

  private loadEnvironment(): Promise<unknown> {
    const token = ++this.envToken
    const env = this.settings.environment
    const sky = this.settings.skybox
    const setBackground = (envTex: THREE.Texture | null) => {
      if (token !== this.envToken || this.disposed) return
      if (typeof sky === 'string' && /^#[0-9a-f]{6}$/i.test(sky)) this.scene.background = new THREE.Color(sky)
      else if (sky === 'environment' && envTex) this.scene.background = envTex
      else if (sky === null && envTex && env !== 'room' && env !== 'none') this.scene.background = envTex
      else if (typeof sky === 'string' && sky.startsWith('assets/') && this.opts.assets) {
        this.opts.assets.loadEnvironment(sky).then(
          (t) => token === this.envToken && (this.scene.background = t),
          (err) => this.warn(err.message)
        )
      } else this.scene.background = new THREE.Color(DEFAULT_BACKGROUND)
    }

    if (env === 'none') {
      this.scene.environment = null
      setBackground(null)
      return Promise.resolve()
    }
    if (env === 'room' || !this.opts.assets) {
      if (env !== 'room') this.warn(`Environment ${env} tidak bisa dimuat di sini; memakai RoomEnvironment`)
      return this.roomEnvironment().then(
        (t) => {
          if (token !== this.envToken || this.disposed) return
          this.scene.environment = t
          setBackground(t)
        },
        (err) => this.warn(`RoomEnvironment gagal: ${err?.message ?? err}`)
      )
    }
    return this.opts.assets.loadEnvironment(env).then(
      (t) => {
        if (token !== this.envToken || this.disposed) return
        this.scene.environment = t
        setBackground(t)
      },
      (err) => {
        this.warn(`${err.message}; memakai RoomEnvironment`)
        setBackground(null)
        return this.roomEnvironment().then((t) => token === this.envToken && (this.scene.environment = t))
      }
    )
  }

  setCamera(camera: THREE.Camera): void {
    if (this.camera !== camera) {
      this.camera = camera
      this.postKey = '' // rebuild post-processing for the new camera
    }
  }

  setSize(width: number, height: number): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) }
    this.renderer.setSize(this.size.width, this.size.height)
    this.post?.setSize(this.size.width, this.size.height)
  }

  /**
   * Point the default sun along settings.sun.direction and fit every shadow-casting directional
   * light's orthographic shadow camera to the bounds of the shadow casters. Terrain-sized casters
   * are left out of the fit so they do not spread the shadow map over hundreds of meters.
   */
  fitShadows(): void {
    const flag = this.opts.helperFlag ?? 'editorHelper'
    const boxes: THREE.Box3[] = []
    let hasSceneSun = false
    this.scene.updateMatrixWorld()
    this.scene.traverseVisible((o) => {
      if (o.userData[flag]) return
      if ((o as THREE.DirectionalLight).isDirectionalLight && !o.userData.defaultSun && (o as THREE.Light).intensity > 0) hasSceneSun = true
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || !mesh.castShadow) return
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      boxes.push(new THREE.Box3().setFromObject(mesh))
    })
    this.sun.visible = !hasSceneSun

    const radii = boxes.map((b) => b.getBoundingSphere(new THREE.Sphere()).radius).sort((a, b) => a - b)
    const median = radii.length ? radii[Math.floor((radii.length - 1) / 2)] : 1
    const bounds = new THREE.Box3()
    for (const b of boxes) {
      const r = b.getBoundingSphere(new THREE.Sphere()).radius
      if (boxes.length > 1 && r > 20 && r > median * 4) continue
      bounds.union(b)
    }
    if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(10, 10, 10))
    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    const radius = Math.max(1, sphere.radius * 1.05)

    const dir = (this.sun.userData.direction as THREE.Vector3 | undefined) ?? new THREE.Vector3(0.5, 1, 0.35).normalize()
    this.sun.position.copy(sphere.center).addScaledVector(dir, radius * 2)
    this.sun.target.position.copy(sphere.center)
    this.sun.target.updateMatrixWorld()

    this.scene.traverse((o) => {
      const light = o as THREE.DirectionalLight
      if (!light.isDirectionalLight || !light.castShadow) return
      const cam = light.shadow.camera
      cam.left = -radius
      cam.right = radius
      cam.top = radius
      cam.bottom = -radius
      cam.near = 0.05
      cam.far = radius * 4
      if (light !== this.sun && light.parent) {
        // Scene lights keep their direction (entity rotation) but move back along it to frame the casters
        const from = light.getWorldPosition(new THREE.Vector3())
        const to = light.target.getWorldPosition(new THREE.Vector3())
        const toLight = from.sub(to).normalize()
        const world = sphere.center.clone().addScaledVector(toLight, radius * 2)
        light.position.copy(light.parent.worldToLocal(world))
        light.updateMatrixWorld(true)
      }
      cam.updateProjectionMatrix()
      // Bias scaled to one shadow-map texel: no acne without visible peter-panning
      const texel = (radius * 2) / light.shadow.mapSize.x
      light.shadow.bias = -0.0001
      light.shadow.normalBias = texel * 1.5
      light.shadow.radius = 3
    })
  }

  private postFxWanted(): boolean {
    return this.settings.postFx.enabled && this.caps.postFx
  }

  private ensurePost(): void {
    if (!this.camera) return
    const wanted = this.postFxWanted()
    const key = wanted ? JSON.stringify(this.settings.postFx) : ''
    if (key === this.postKey || this.postBuilding) return
    this.post?.dispose()
    this.post = null
    this.postKey = key
    if (!wanted) return
    this.postBuilding = true
    const camera = this.camera
    this.postReady = createPostPipeline(this.renderer, this.opts.backend, this.isWebGPURenderer, this.scene, camera, this.settings.postFx, this.size, (m) => this.warn(m))
      .then((p) => {
        if (this.disposed || this.postKey !== key || this.camera !== camera) p?.dispose()
        else this.post = p
      })
      .finally(() => (this.postBuilding = false))
  }

  render(camera: THREE.Camera): void {
    this.setCamera(camera)
    if (this.frame % 30 === 0) this.fitShadows()
    this.frame++
    this.ensurePost()
    if (this.post) this.post.render()
    else this.renderer.render(this.scene, camera)
  }

  dispose(): void {
    this.disposed = true
    this.post?.dispose()
    this.post = null
    this.roomTarget?.dispose()
    this.roomTarget = null
    this.pmrem?.dispose()
    this.pmrem = null
    this.scene.remove(this.ambient, this.sun, this.sun.target)
    this.sun.shadow.map?.dispose()
    this.sun.dispose()
  }
}

/** Free a whole subtree: geometry, materials and the textures they own; shared asset meshes are skipped */
export function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh && !mesh.userData.sharedAsset) {
      mesh.geometry?.dispose()
      if (mesh.material) disposeMaterial(mesh.material)
    }
    const light = child as THREE.DirectionalLight
    if (light.isLight && light.shadow?.map) light.shadow.map.dispose()
  })
}
