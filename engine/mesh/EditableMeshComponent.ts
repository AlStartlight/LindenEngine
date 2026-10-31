import { Component } from '../ecs/Component'
import { editablePrimitive } from './core/editablePrimitives'
import { encodeHalfEdgeMesh, type EncodedMesh } from './core/encoding'

/**
 * Mesh geometry edited in the editor's Edit Mode, stored in the scene as a base64 linden-mesh
 * (n-gons and corner uvs kept). Material fields mirror MeshRenderer so both share material code.
 * Free of three.js: the component registry is also loaded by the agent tools in Electron's main process.
 */
export class EditableMesh extends Component {
  /** Wrapped in an object (World.setProperty treats any 3-element array as a vector) */
  public mesh: EncodedMesh = encodeHalfEdgeMesh(editablePrimitive('box'))
  public material: Record<string, any> = {}
  public color = '#3b82f6'
  public roughness = 0.5
  public metalness = 0.1
  public castShadow = true
  public receiveShadow = true
  public isVisible = true

  constructor() {
    super('EditableMesh')
  }

  clone(): EditableMesh {
    const c = new EditableMesh()
    c.mesh = { ...this.mesh }
    c.material = JSON.parse(JSON.stringify(this.material ?? {}))
    c.color = this.color
    c.roughness = this.roughness
    c.metalness = this.metalness
    c.castShadow = this.castShadow
    c.receiveShadow = this.receiveShadow
    c.isVisible = this.isVisible
    return c
  }
}
