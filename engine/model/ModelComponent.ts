import { Component } from '../ecs/Component'
import type { ModelPart } from './ModelSpec'

/** Facts measured from a Model.factory group, after `fit` (model space, meters) */
export interface ModelFactoryBake {
  /** sha256 of the factory source, its export and options; a mismatch means "rebuild" */
  hash: string
  triangles: number
  /** Up to 256 points, flat xyz, for collider "convexHull" */
  hull?: number[]
  /** One box per sculptRuntime collider entry, for collider "compound" */
  boxes?: { id?: string; center: [number, number, number]; halfExtents: [number, number, number] }[]
  exports?: string[]
  sockets?: string[]
}

/**
 * Model: an object built from parts (roundedBox, lathe, extrude, tube...) or loaded from a
 * glTF/GLB/OBJ file in assets/. See ModelSpec.ts for the data format; built by buildModel.ts.
 */
export class ModelComponent extends Component {
  public parts: ModelPart[] = []
  /** assets/... .glb/.gltf/.obj; when set, parts are ignored */
  public src: string = ''
  public merge: boolean = true
  public instances?: { position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] }[]
  public collider: 'none' | 'box' | 'convexHull' | 'compound' = 'none'
  public category: string = ''
  public placement: 'floor' | 'wall' | 'ceiling' | 'free' = 'floor'
  public animation: string = ''
  public castShadow: boolean = true
  public receiveShadow: boolean = true
  /** Model-space bounds [min, max], stored by the editor/agent so headless physics can size the collider of a src model */
  public bounds?: [[number, number, number], [number, number, number]]
  /** models/<x>.ts procedural factory (img2threejs); when set, parts and src are ignored */
  public factory: string = ''
  public factoryExport: string = ''
  public factoryOptions?: { textureSize?: number; textureAnisotropy?: number; qualityPriority?: 'reference-fidelity' | 'balanced' }
  /** Scale and offset applied to the factory group (meters, resting at y 0); set by linden_model_build */
  public fit?: { scale: number; offset: [number, number, number] }
  /** Measured once from the factory where it can run (renderer); used where it cannot (headless physics) */
  public bake?: ModelFactoryBake

  constructor() {
    super('Model')
  }

  clone(): ModelComponent {
    const c = new ModelComponent()
    Object.assign(c, JSON.parse(JSON.stringify({ ...this, name: undefined, entityId: undefined })))
    c.isEnabled = this.isEnabled
    return c
  }
}
