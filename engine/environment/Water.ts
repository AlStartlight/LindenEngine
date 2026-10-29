import { Component } from '../ecs/Component'

/**
 * Water surface: a plane in the entity's local XZ at its Y. Rendering (reflection, waves) lives in
 * engine/renderer/water.ts; buoyancy runs in GameSimulation so play, editor and headless agree.
 * The volume is the plane's XZ area scaled by the Transform, from the surface down; rotation is ignored.
 */
export class Water extends Component {
  public size = { x: 20, y: 20 }
  public color: string = '#1e5f74'
  public distortion: number = 3.7
  public waveSpeed: number = 1
  public reflections: boolean = true
  public buoyancy: boolean = true
  /** kg/m³ (fresh water 1000) */
  public density: number = 1000
  public linearDrag: number = 1
  public angularDrag: number = 0.5

  constructor() {
    super('Water')
  }

  clone(): Water {
    const c = new Water()
    c.size = { ...this.size }
    c.color = this.color
    c.distortion = this.distortion
    c.waveSpeed = this.waveSpeed
    c.reflections = this.reflections
    c.buoyancy = this.buoyancy
    c.density = this.density
    c.linearDrag = this.linearDrag
    c.angularDrag = this.angularDrag
    return c
  }
}
