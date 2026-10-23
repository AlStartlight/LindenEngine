/**
 * TileMap & TileMapLayer Node (GF-10)
 * Grid-based 2D level painting with terrain autotiling and collision detection.
 */

import { Node2D } from '../scene/Node'
import { TileSet, TileData } from './TileSet'

export interface CellData {
  sourceId: number
  atlasCoords: { x: number; y: number }
  alternativeTile: number
}

export class TileMapLayer extends Node2D {
  public tileSet: TileSet | null = null
  private cells: Map<string, CellData> = new Map()

  constructor(name: string = 'TileMapLayer', id?: string) {
    super(name, id)
  }

  setCell(
    coords: { x: number; y: number },
    sourceId: number,
    atlasCoords: { x: number; y: number } = { x: 0, y: 0 },
    alt: number = 0
  ): void {
    const key = `${coords.x},${coords.y}`
    if (sourceId < 0) {
      this.cells.delete(key)
    } else {
      this.cells.set(key, { sourceId, atlasCoords, alternativeTile: alt })
    }
  }

  getCell(coords: { x: number; y: number }): CellData | undefined {
    return this.cells.get(`${coords.x},${coords.y}`)
  }

  hasCell(coords: { x: number; y: number }): boolean {
    return this.cells.has(`${coords.x},${coords.y}`)
  }

  getCellCount(): number {
    return this.cells.size
  }

  getAllCells(): Map<string, CellData> {
    return this.cells
  }

  /**
   * Simple 4-neighbor autotile resolver to choose border vs center tile
   */
  resolveTerrainAutotile(coords: { x: number; y: number }): { x: number; y: number } {
    const hasNorth = this.hasCell({ x: coords.x, y: coords.y - 1 })
    const hasSouth = this.hasCell({ x: coords.x, y: coords.y + 1 })
    const hasWest = this.hasCell({ x: coords.x - 1, y: coords.y })
    const hasEast = this.hasCell({ x: coords.x + 1, y: coords.y })

    // Center tile if surrounded by all 4 neighbors
    if (hasNorth && hasSouth && hasWest && hasEast) {
      return { x: 1, y: 1 }
    }
    // Top border
    if (!hasNorth && hasSouth) {
      return { x: 1, y: 0 }
    }
    // Bottom border
    if (hasNorth && !hasSouth) {
      return { x: 1, y: 2 }
    }
    // Default / standalone
    return { x: 0, y: 0 }
  }

  hasCollisionAt(cellCoords: { x: number; y: number }): boolean {
    const cell = this.getCell(cellCoords)
    if (!cell || !this.tileSet) return false
    const tileData = this.tileSet.getTileData(cell.atlasCoords.x, cell.atlasCoords.y)
    return tileData?.collision?.hasCollision ?? false
  }
}
