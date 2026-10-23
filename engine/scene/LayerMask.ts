export class LayerMask {
  private static layerNames: string[] = [
    'Default', // 0
    'TransparentFX', // 1
    'Ignore Raycast', // 2
    '', // 3
    'Water', // 4
    'UI', // 5
    ...Array(26).fill(''),
  ]

  static setLayerNames(names: string[]): void {
    for (let i = 0; i < Math.min(32, names.length); i++) {
      if (names[i]) {
        this.layerNames[i] = names[i]
      }
    }
  }

  static getLayerNames(): string[] {
    return [...this.layerNames]
  }

  static getLayerName(layerIndex: number): string {
    return this.layerNames[layerIndex] || `Layer ${layerIndex}`
  }

  static nameToLayer(name: string): number {
    const idx = this.layerNames.indexOf(name)
    return idx !== -1 ? idx : -1
  }

  static getMask(...layerNames: string[]): number {
    let mask = 0
    for (const name of layerNames) {
      const idx = this.nameToLayer(name)
      if (idx !== -1) {
        mask |= 1 << idx
      }
    }
    return mask
  }

  static hasLayer(mask: number, layer: number): boolean {
    return (mask & (1 << layer)) !== 0
  }
}
