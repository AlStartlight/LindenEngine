/**
 * TileSet Resource (GF-10)
 * Defines tile size, textures, atlas coordinates, collision shapes, and terrain rules.
 */

import { Resource } from '../scene/Resource'

export interface TileCollisionData {
  hasCollision: boolean
  shape?: 'box' | 'polygon'
  polygon?: Array<{ x: number; y: number }>
}

export interface TileData {
  atlasCoords: { x: number; y: number }
  collision?: TileCollisionData
  terrain?: number // Terrain ID for autotiling
  bitmask?: number // 3x3 or 2x2 autotile bitmask
}

export class TileSet extends Resource {
  public tileSize = { x: 16, y: 16 }
  public texturePath: string = ''
  private tiles: Map<string, TileData> = new Map()

  setTileData(atlasX: number, atlasY: number, data: TileData): void {
    const key = `${atlasX},${atlasY}`
    this.tiles.set(key, data)
  }

  getTileData(atlasX: number, atlasY: number): TileData | undefined {
    return this.tiles.get(`${atlasX},${atlasY}`)
  }

  serialize(): Record<string, any> {
    const tileList: any[] = []
    for (const [key, val] of this.tiles.entries()) {
      tileList.push({ key, ...val })
    }
    return {
      type: 'TileSet',
      id: this.id,
      tileSize: this.tileSize,
      texturePath: this.texturePath,
      tiles: tileList,
    }
  }

  deserialize(data: Record<string, any>): void {
    if (data.id) this.id = data.id
    if (data.tileSize) this.tileSize = data.tileSize
    if (data.texturePath) this.texturePath = data.texturePath
    if (Array.isArray(data.tiles)) {
      this.tiles.clear()
      for (const t of data.tiles) {
        this.tiles.set(t.key, {
          atlasCoords: t.atlasCoords,
          collision: t.collision,
          terrain: t.terrain,
          bitmask: t.bitmask,
        })
      }
    }
  }
}
