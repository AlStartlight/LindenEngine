/**
 * Godot-like Resource System for Linden Engine (GF-03)
 * Provides reusable data assets with "res://" path resolution and caching.
 */

import { nanoid } from '../utils/index'

export abstract class Resource {
  public id: string
  public resourcePath: string = ''
  public resourceName: string = ''

  constructor(id: string = nanoid()) {
    this.id = id
  }

  abstract serialize(): Record<string, any>
  abstract deserialize(data: Record<string, any>): void
}

export class StandardMaterial3DResource extends Resource {
  public albedoColor: string = '#ffffff'
  public roughness: number = 0.5
  public metallic: number = 0.0
  public albedoTexturePath?: string

  serialize(): Record<string, any> {
    return {
      type: 'StandardMaterial3D',
      id: this.id,
      albedoColor: this.albedoColor,
      roughness: this.roughness,
      metallic: this.metallic,
      albedoTexturePath: this.albedoTexturePath,
    }
  }

  deserialize(data: Record<string, any>): void {
    if (data.id) this.id = data.id
    if (data.albedoColor) this.albedoColor = data.albedoColor
    if (typeof data.roughness === 'number') this.roughness = data.roughness
    if (typeof data.metallic === 'number') this.metallic = data.metallic
    if (data.albedoTexturePath) this.albedoTexturePath = data.albedoTexturePath
  }
}

export class ResourceLoader {
  private static cache: Map<string, Resource> = new Map()

  static register(path: string, res: Resource): void {
    const normalized = this.normalizePath(path)
    res.resourcePath = normalized
    this.cache.set(normalized, res)
  }

  static get<T extends Resource = Resource>(path: string): T | undefined {
    return this.cache.get(this.normalizePath(path)) as T | undefined
  }

  static has(path: string): boolean {
    return this.cache.has(this.normalizePath(path))
  }

  static clear(): void {
    this.cache.clear()
  }

  static normalizePath(path: string): string {
    if (!path.startsWith('res://')) {
      return `res://${path.replace(/^\/+/, '')}`
    }
    return path
  }
}
