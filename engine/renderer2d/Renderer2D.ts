/**
 * CanvasItem & 2D rendering components for Linden Engine (GF-07)
 */

import { Node2D } from '../scene/Node'

export class CanvasItem extends Node2D {
  public drawCalls: Array<() => void> = []

  drawRect(rect: { x: number; y: number; width: number; height: number }, color: string): void {
    this.drawCalls.push(() => {
      // Intended for WebGPU / 2D Canvas pipeline
    })
  }
}

export class Sprite2D extends CanvasItem {
  public texturePath: string = ''
  public centered: boolean = true
  public offset = { x: 0, y: 0 }
  public flipH: boolean = false
  public flipV: boolean = false
  public regionEnabled: boolean = false
  public regionRect = { x: 0, y: 0, width: 0, height: 0 }

  constructor(name: string = 'Sprite2D', id?: string) {
    super(name, id)
  }
}

export class Camera2D extends Node2D {
  public zoom = { x: 1, y: 1 }
  public offset = { x: 0, y: 0 }
  public anchorMode: 'drag_center' | 'fixed_top_left' = 'drag_center'
  public isCurrent: boolean = true

  constructor(name: string = 'Camera2D', id?: string) {
    super(name, id)
  }

  makeCurrent(): void {
    this.isCurrent = true
  }
}

export class Renderer2D {
  /**
   * Sorts 2D canvas items by their effective z-index in ascending order
   */
  static sortItemsByZIndex(items: CanvasItem[]): CanvasItem[] {
    return [...items].sort((a, b) => a.zIndex - b.zIndex)
  }
}
