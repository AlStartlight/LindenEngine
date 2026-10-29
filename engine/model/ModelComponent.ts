import { Component } from '../ecs/Component'
import type { ModelPart } from './ModelSpec'

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
  public collider: 'none' | 'box' | 'convexHull' = 'none'
  public category: string = ''
  public placement: 'floor' | 'wall' | 'ceiling' | 'free' = 'floor'
  public animation: string = ''
  public castShadow: boolean = true
  public receiveShadow: boolean = true
  /** Model-space bounds [min, max], stored by the editor/agent so headless physics can size the collider of a src model */
  public bounds?: [[number, number, number], [number, number, number]]

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
