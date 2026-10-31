import * as THREE from 'three'
import { mulberry32 } from '../utils/random'

export const SPRITE_KINDS = ['soft', 'spark', 'smoke', 'square'] as const
export type SpriteKind = (typeof SPRITE_KINDS)[number]

/** White RGBA sprite; the shape is in alpha so instance colours tint it */
export function generateSprite(kind: SpriteKind, size = 64): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  const rand = mulberry32(17)
  // Smoke: a few overlapping blobs give a lumpy edge
  const blobs = Array.from({ length: 6 }, () => ({ x: (rand() - 0.5) * 0.5, y: (rand() - 0.5) * 0.5, r: 0.25 + rand() * 0.2 }))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1
      const v = ((y + 0.5) / size) * 2 - 1
      const d = Math.hypot(u, v)
      let a: number
      switch (kind) {
        case 'square':
          a = Math.max(Math.abs(u), Math.abs(v)) < 0.8 ? 1 : 0
          break
        case 'spark':
          a = Math.pow(Math.max(0, 1 - d), 3)
          break
        case 'smoke': {
          let s = 0
          for (const b of blobs) s += Math.max(0, 1 - Math.hypot(u - b.x, v - b.y) / b.r)
          a = Math.min(1, s * 0.6) * Math.max(0, 1 - d)
          break
        }
        case 'soft':
        default:
          a = Math.exp(-d * d * 4) * Math.max(0, 1 - d)
      }
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255)
    }
  }
  return data
}

const cache = new Map<SpriteKind, THREE.DataTexture>()

/** Shared per kind (never disposed with an emitter) */
export function spriteTexture(kind: SpriteKind): THREE.DataTexture {
  let tex = cache.get(kind)
  if (!tex) {
    const size = 64
    tex = new THREE.DataTexture(generateSprite(kind, size), size, size, THREE.RGBAFormat)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.needsUpdate = true
    cache.set(kind, tex)
  }
  return tex
}

export function isSpriteKind(v: unknown): v is SpriteKind {
  return typeof v === 'string' && (SPRITE_KINDS as readonly string[]).includes(v)
}
