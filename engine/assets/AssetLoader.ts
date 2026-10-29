import * as THREE from 'three'
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

/**
 * Loads project assets (assets/...) for the editor viewport, the player and the web export.
 * Decoders (Draco, Basis/KTX2) come from a local folder (`decoderPath`, copied from three's
 * examples/jsm/libs by scripts/copy-decoders.mjs) so nothing is fetched from a CDN.
 */

export interface AssetLoaderOptions {
  /** Project-relative path → URL the browser can fetch */
  resolveUrl: (rel: string) => string
  /** URL of the folder holding draco/ and basis/ */
  decoderPath: string
  /** Needed for KTX2 transcoding support detection */
  renderer?: unknown
  warn?: (message: string) => void
}

export interface LoadedModel {
  root: THREE.Group
  animations: THREE.AnimationClip[]
}

const MODEL_EXT = /\.(glb|gltf|obj)$/i
const HDR_EXT = /\.(hdr|exr)$/i

export function isModelAsset(path: string): boolean {
  return MODEL_EXT.test(path)
}

export function isEnvironmentAsset(path: string): boolean {
  return HDR_EXT.test(path) || /\.(jpe?g|png|webp)$/i.test(path)
}

export class AssetLoader {
  private textures = new Map<string, THREE.Texture>()
  private environments = new Map<string, Promise<THREE.Texture>>()
  private models = new Map<string, Promise<LoadedModel>>()
  private gltf: GLTFLoader | null = null
  private draco: DRACOLoader | null = null
  private ktx2: KTX2Loader | null = null
  private disposed = false
  private pending = new Set<Promise<unknown>>()

  constructor(private opts: AssetLoaderOptions) {}

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p)
    const done = () => this.pending.delete(p)
    p.then(done, done)
    return p
  }

  /** Resolves once every load started so far has finished (offscreen previews wait on this) */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
  }

  private warn(message: string): void {
    if (this.opts.warn) this.opts.warn(message)
    else console.warn(`[Linden] ${message}`)
  }

  private url(rel: string): string {
    return this.opts.resolveUrl(rel)
  }

  /** Synchronous handle that fills in when the image arrives; color data must pass srgb=true */
  loadTexture(rel: string, srgb: boolean): THREE.Texture {
    const key = `${rel}|${srgb}`
    const cached = this.textures.get(key)
    if (cached) return cached
    let settle: () => void = () => {}
    this.track(new Promise<void>((resolve) => (settle = resolve)))
    const tex = new THREE.TextureLoader().load(
      this.url(rel),
      () => settle(),
      undefined,
      () => {
        this.warn(`Tekstur ${rel} gagal dimuat`)
        settle()
      }
    )
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 8
    this.textures.set(key, tex)
    return tex
  }

  /** Equirectangular environment (HDR, EXR or an LDR panorama) */
  loadEnvironment(rel: string): Promise<THREE.Texture> {
    let p = this.environments.get(rel)
    if (!p) {
      p = new Promise<THREE.Texture>((resolve, reject) => {
        const onLoad = (tex: THREE.Texture) => {
          tex.mapping = THREE.EquirectangularReflectionMapping
          resolve(tex)
        }
        const onError = (err: unknown) => reject(new Error(`Environment ${rel} gagal dimuat: ${(err as any)?.message ?? err}`))
        if (/\.hdr$/i.test(rel)) new HDRLoader().setDataType(THREE.HalfFloatType).load(this.url(rel), onLoad, undefined, onError)
        else if (/\.exr$/i.test(rel)) new EXRLoader().setDataType(THREE.HalfFloatType).load(this.url(rel), onLoad, undefined, onError)
        else
          new THREE.TextureLoader().load(this.url(rel), (t) => {
            t.colorSpace = THREE.SRGBColorSpace
            onLoad(t)
          }, undefined, onError)
      })
      this.environments.set(rel, this.track(p))
    }
    return p
  }

  private gltfLoader(): GLTFLoader {
    if (this.gltf) return this.gltf
    const base = this.opts.decoderPath.replace(/\/?$/, '/')
    this.draco = new DRACOLoader().setDecoderPath(`${base}draco/`)
    this.ktx2 = new KTX2Loader().setTranscoderPath(`${base}basis/`)
    try {
      if (this.opts.renderer) this.ktx2.detectSupport(this.opts.renderer as any)
    } catch (err: any) {
      this.warn(`KTX2 tidak tersedia di renderer ini: ${err?.message ?? err}`)
    }
    this.gltf = new GLTFLoader().setDRACOLoader(this.draco).setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder)
    return this.gltf
  }

  private loadModelSource(rel: string): Promise<LoadedModel> {
    let p = this.models.get(rel)
    if (!p) {
      p = new Promise<LoadedModel>((resolve, reject) => {
        const fail = (err: unknown) => reject(new Error(`Model ${rel} gagal dimuat: ${(err as any)?.message ?? err}`))
        if (/\.obj$/i.test(rel)) {
          new OBJLoader().load(this.url(rel), (group) => resolve({ root: group, animations: [] }), undefined, fail)
          return
        }
        this.gltfLoader().load(
          this.url(rel),
          (gltf: GLTF) => resolve({ root: gltf.scene, animations: gltf.animations }),
          undefined,
          fail
        )
      })
      this.models.set(rel, this.track(p))
    }
    return p
  }

  /** A fresh copy per call (skinned meshes get their own skeleton); geometry and materials are shared */
  async loadModel(rel: string): Promise<LoadedModel> {
    const src = await this.loadModelSource(rel)
    const root = cloneSkinned(src.root) as THREE.Group
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.userData.sharedAsset = true
      }
    })
    return { root, animations: src.animations }
  }

  /** Free everything this loader created (GPU resources included) */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const t of this.textures.values()) t.dispose()
    this.textures.clear()
    for (const p of this.environments.values()) p.then((t) => t.dispose(), () => {})
    this.environments.clear()
    for (const p of this.models.values()) {
      p.then(
        (m) =>
          m.root.traverse((o) => {
            const mesh = o as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.geometry.dispose()
            for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose()
              mat.dispose()
            }
          }),
        () => {}
      )
    }
    this.models.clear()
    this.draco?.dispose()
    this.ktx2?.dispose()
  }
}
