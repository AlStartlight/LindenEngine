/**
 * Component Base Class
 * Semua komponen harus extend dari class ini
 */
export abstract class Component {
  protected entityId: string = ''
  protected isEnabled: boolean = true

  constructor(public readonly name: string) {}

  /**
   * Dipanggil ketika component ditambahkan ke entity
   */
  onAttach(entityId: string): void {
    this.entityId = entityId
  }

  /**
   * Dipanggil ketika component dihapus dari entity
   */
  onDetach(): void {}

  /**
   * Dipanggil setiap frame
   */
  onUpdate(deltaTime: number): void {}

  /**
   * Dipanggil ketika entity dihapus
   */
  onDestroy(): void {}

  /**
   * Enable/disable component
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled
  }

  getEnabled(): boolean {
    return this.isEnabled
  }

  getEntityId(): string {
    return this.entityId
  }

  /**
   * Clone component untuk duplikasi
   */
  abstract clone(): Component
}

/**
 * Transform Component - Basic untuk semua entities
 */
export class Transform extends Component {
  public position = { x: 0, y: 0, z: 0 }
  public rotation = { x: 0, y: 0, z: 0 }
  public scale = { x: 1, y: 1, z: 1 }
  public parent: string | null = null
  public children: string[] = []

  constructor() {
    super('Transform')
  }

  setPosition(x: number, y: number, z: number): void {
    this.position = { x, y, z }
  }

  setRotation(x: number, y: number, z: number): void {
    this.rotation = { x, y, z }
  }

  setScale(x: number, y: number, z: number): void {
    this.scale = { x, y, z }
  }

  addChild(childId: string): void {
    if (!this.children.includes(childId)) {
      this.children.push(childId)
    }
  }

  removeChild(childId: string): void {
    const index = this.children.indexOf(childId)
    if (index > -1) {
      this.children.splice(index, 1)
    }
  }

  clone(): Transform {
    const cloned = new Transform()
    cloned.position = { ...this.position }
    cloned.rotation = { ...this.rotation }
    cloned.scale = { ...this.scale }
    return cloned
  }
}
