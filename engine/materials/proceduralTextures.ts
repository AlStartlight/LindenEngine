import * as THREE from 'three'
import { ProceduralKindType } from './MaterialSpec'

/**
 * Runtime-generated, seamlessly tiling PBR textures (no downloads): an albedo tone map (grayscale,
 * multiplied with the material color, so color overrides keep the pattern), a roughness map and a
 * normal map derived from a height field. Pure DataTexture so it also runs under Node (tests, agent).
 */

export interface PatternFields {
  size: number
  /** 0..1 height used for the normal map */
  height: Float32Array
  /** 0..1 mix factor between color (1) and color2 (0) */
  tone: Float32Array
  /** -1..1 roughness offset */
  rough: Float32Array
}

// ---- tileable value noise -------------------------------------------------

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

const fade = (t: number) => t * t * (3 - 2 * t)

/**
 * Value noise with `period` lattice cells across the texture (optionally a different `periodV`
 * along V for streaks and fibers) so it tiles across the texture edge
 */
function tileNoise(u: number, v: number, period: number, seed: number, periodV = period): number {
  const x = u * period
  const y = v * periodV
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = fade(x - xi)
  const yf = fade(y - yi)
  const x0 = ((xi % period) + period) % period
  const y0 = ((yi % periodV) + periodV) % periodV
  const x1 = (x0 + 1) % period
  const y1 = (y0 + 1) % periodV
  const a = hash(x0, y0, seed)
  const b = hash(x1, y0, seed)
  const c = hash(x0, y1, seed)
  const d = hash(x1, y1, seed)
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
}

function fbm(u: number, v: number, basePeriod: number, octaves: number, seed: number, basePeriodV = basePeriod): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let period = basePeriod
  let periodV = basePeriodV
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileNoise(u, v, period, seed + o * 101, periodV)
    norm += amp
    amp *= 0.5
    period *= 2
    periodV *= 2
  }
  return sum / norm
}

/** Cellular (Worley) distance to the nearest feature point, tileable */
function cellular(u: number, v: number, period: number, seed: number): number {
  const x = u * period
  const y = v * period
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  let best = 9
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx
      const cy = yi + dy
      const wx = ((cx % period) + period) % period
      const wy = ((cy % period) + period) % period
      const px = cx + hash(wx, wy, seed)
      const py = cy + hash(wx, wy, seed + 7)
      const d = Math.hypot(px - x, py - y)
      if (d < best) best = d
    }
  }
  return Math.min(1, best)
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

// ---- patterns -------------------------------------------------------------

type Sampler = (u: number, v: number, seed: number) => { h: number; t: number; r: number }

const PATTERNS: Record<Exclude<ProceduralKindType, 'none'>, Sampler> = {
  // Grain runs along V (texture up = along the board): growth rings cut lengthwise give long,
  // gently drifting stripes with sharper dark latewood bands, plus fine fibers
  wood: (u, v, s) => {
    const drift = fbm(u, v, 2, 3, s, 1) - 0.5
    const x = u * 12 + drift * 1.4 + Math.sin(v * Math.PI * 2) * 0.15
    const ring = x - Math.floor(x)
    const late = smooth(0.6, 0.92, ring) * (1 - smooth(0.96, 1, ring))
    const fibers = fbm(u, v, 128, 2, s + 3, 4)
    const t = clamp01(1 - late * 0.85 + (fibers - 0.5) * 0.3)
    return { h: clamp01(0.7 - late * 0.25 + (fibers - 0.5) * 0.25), t, r: late * 0.4 + (fibers - 0.5) * 0.5 }
  },
  noise: (u, v, s) => {
    const n = fbm(u, v, 8, 5, s)
    return { h: n, t: n, r: (n - 0.5) * 2 }
  },
  // 4 rows of bricks per tile, running bond
  brick: (u, v, s) => {
    const rows = 4
    const cols = 2
    const row = Math.floor(v * rows)
    const bu = u * cols + (row % 2) * 0.5
    const fu = bu - Math.floor(bu)
    const fv = v * rows - row
    const mortar = 0.06
    const edge = Math.min(fu * 3.3, (1 - fu) * 3.3, fv, 1 - fv)
    const isBrick = smooth(mortar * 0.6, mortar, edge)
    const brickId = Math.floor(bu) + row * 7
    const variation = hash(brickId, row, s) * 0.3
    const n = fbm(u, v, 16, 4, s)
    return { h: isBrick * (0.8 + n * 0.2), t: isBrick * (0.7 + variation + (n - 0.5) * 0.2), r: (1 - isBrick) * 0.4 + (n - 0.5) * 0.3 }
  },
  // 2x2 tiles with grout
  tile: (u, v, s) => {
    const n = 2
    const fu = u * n - Math.floor(u * n)
    const fv = v * n - Math.floor(v * n)
    const edge = Math.min(fu, 1 - fu, fv, 1 - fv)
    const tileMask = smooth(0.015, 0.03, edge)
    const fine = fbm(u, v, 32, 3, s)
    return { h: tileMask * (0.95 + fine * 0.05), t: tileMask * (0.95 + (fine - 0.5) * 0.1), r: (1 - tileMask) * 0.8 + (fine - 0.5) * 0.1 }
  },
  // Plain weave: alternating over/under threads
  fabric: (u, v, s) => {
    const threads = 48
    const x = u * threads
    const y = v * threads
    const over = (Math.floor(x) + Math.floor(y)) % 2 === 0
    const fx = Math.sin((x - Math.floor(x)) * Math.PI)
    const fy = Math.sin((y - Math.floor(y)) * Math.PI)
    const h = over ? fx * 0.7 + fy * 0.3 : fy * 0.7 + fx * 0.3
    const n = fbm(u, v, 8, 3, s)
    return { h, t: 0.7 + h * 0.3 + (n - 0.5) * 0.2, r: (n - 0.5) * 0.3 }
  },
  // Fine streaks along U
  brushed: (u, v, s) => {
    const streak = fbm(u, v, 4, 3, s, 256)
    return { h: streak, t: 0.9 + streak * 0.1, r: (streak - 0.5) * 1.5 }
  },
  scratches: (u, v, s) => {
    let scratch = 0
    for (let i = 0; i < 6; i++) {
      const a = hash(i, 1, s) * Math.PI
      const d = Math.abs(Math.sin(a) * u - Math.cos(a) * v + hash(i, 2, s))
      const line = 1 - smooth(0, 0.004, Math.abs(d - Math.round(d)))
      scratch = Math.max(scratch, line * hash(i, 3, s))
    }
    const n = fbm(u, v, 8, 4, s)
    return { h: 1 - scratch * 0.5, t: 1 - scratch * 0.2, r: scratch * 0.8 + (n - 0.5) * 0.6 }
  },
  marble: (u, v, s) => {
    const turb = fbm(u, v, 4, 6, s)
    const vein = Math.pow(1 - Math.abs(Math.sin((u + v + turb * 2.5) * Math.PI * 2)), 6)
    return { h: 1 - vein * 0.1, t: 1 - vein, r: vein * 0.3 }
  },
  concrete: (u, v, s) => {
    const n = fbm(u, v, 6, 6, s)
    const pores = 1 - smooth(0, 0.12, cellular(u, v, 40, s + 9))
    return { h: n - pores * 0.4, t: 0.4 + n * 0.6 - pores * 0.3, r: (n - 0.5) * 0.4 }
  },
  leather: (u, v, s) => {
    const c = cellular(u, v, 28, s)
    const n = fbm(u, v, 16, 3, s)
    const h = smooth(0.05, 0.5, c)
    return { h, t: 0.75 + h * 0.25 + (n - 0.5) * 0.15, r: (0.5 - h) * 0.6 }
  },
  grass: (u, v, s) => {
    const blades = fbm(u, v, 128, 2, s, 32)
    const patches = fbm(u, v, 3, 4, s + 5)
    return { h: blades, t: clamp01(0.3 + patches * 0.5 + blades * 0.3), r: (blades - 0.5) * 0.3 }
  },
  soil: (u, v, s) => {
    const n = fbm(u, v, 8, 6, s)
    const clods = 1 - cellular(u, v, 12, s + 3)
    return { h: n * 0.6 + clods * 0.4, t: clamp01(n * 0.7 + clods * 0.3), r: (n - 0.5) * 0.2 }
  },
  sand: (u, v, s) => {
    const grains = tileNoise(u, v, 256, s)
    const ripples = Math.sin((v * 10 + fbm(u, v, 4, 3, s) * 2) * Math.PI * 2) * 0.5 + 0.5
    return { h: grains * 0.5 + ripples * 0.5, t: 0.6 + grains * 0.3 + ripples * 0.1, r: (grains - 0.5) * 0.2 }
  },
  stone: (u, v, s) => {
    const c = cellular(u, v, 5, s)
    const n = fbm(u, v, 8, 6, s + 1)
    const h = clamp01(smooth(0.05, 0.4, c) * 0.6 + n * 0.4)
    return { h, t: clamp01(0.3 + n * 0.7), r: (0.5 - h) * 0.4 }
  },
  // Basket weave of wide flat strands
  rattan: (u, v, s) => {
    const n = 8
    const x = u * n
    const y = v * n
    const over = (Math.floor(x) + Math.floor(y)) % 2 === 0
    const along = over ? x - Math.floor(x) : y - Math.floor(y)
    const across = over ? y - Math.floor(y) : x - Math.floor(x)
    const strand = Math.sin(across * Math.PI)
    const fiber = over ? fbm(u, v, 64, 2, s, 8) : fbm(u, v, 8, 2, s, 64)
    const gap = smooth(0.02, 0.08, Math.min(across, 1 - across))
    return { h: strand * gap * (0.85 + Math.sin(along * Math.PI) * 0.15), t: clamp01(gap * (0.6 + fiber * 0.4)), r: (fiber - 0.5) * 0.4 }
  },
}

export function generatePattern(kind: Exclude<ProceduralKindType, 'none'>, size: number, seed = 1): PatternFields {
  const n = size * size
  const height = new Float32Array(n)
  const tone = new Float32Array(n)
  const rough = new Float32Array(n)
  const sample = PATTERNS[kind]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const r = sample(x / size, y / size, seed)
      height[i] = clamp01(r.h)
      tone[i] = clamp01(r.t)
      rough[i] = Math.max(-1, Math.min(1, r.r))
    }
  }
  return { size, height, tone, rough }
}

// ---- textures -------------------------------------------------------------

/** Roughness maps are centered here; createMaterial divides material.roughness by it to compensate */
export const ROUGHNESS_MAP_CENTER = 0.75

export interface ProceduralTextureSet {
  map: THREE.DataTexture
  roughnessMap: THREE.DataTexture
  normalMap: THREE.DataTexture
}

function toTexture(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 8
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

/**
 * Albedo is a tint multiplied with material.color: color2 relative to color for low tone, white for
 * high tone. Roughness map is centered at 1.0 (material.roughness scales it) with ±variation.
 */
export function buildProceduralTextures(
  fields: PatternFields,
  opts: { color: THREE.Color; color2?: THREE.Color; contrast: number; roughnessVariation: number }
): ProceduralTextureSet {
  const { size, height, tone, rough } = fields
  const n = size * size
  const albedo = new Uint8Array(n * 4)
  const roughData = new Uint8Array(n * 4)
  const normal = new Uint8Array(n * 4)

  // Tint for the dark tone, as a ratio to the base color (both linear)
  const base = opts.color
  const dark = opts.color2 ?? base.clone().multiplyScalar(0.55)
  const ratio = [
    base.r > 1e-4 ? Math.min(1, dark.r / base.r) : 1,
    base.g > 1e-4 ? Math.min(1, dark.g / base.g) : 1,
    base.b > 1e-4 ? Math.min(1, dark.b / base.b) : 1,
  ]
  const c = clamp01(opts.contrast)
  const toSrgb8 = (lin: number) => Math.round(255 * (lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055))

  for (let i = 0; i < n; i++) {
    const t = 1 - c * (1 - tone[i])
    // Lerp between the color2 tint (t=0) and white (t=1)
    for (let k = 0; k < 3; k++) albedo[i * 4 + k] = toSrgb8(ratio[k] + (1 - ratio[k]) * t)
    albedo[i * 4 + 3] = 255

    // Green channel is what MeshStandardMaterial reads for roughness; map value scales material.roughness
    const rv = clamp01(ROUGHNESS_MAP_CENTER + rough[i] * opts.roughnessVariation)
    const rb = Math.round(rv * 255)
    roughData[i * 4] = rb
    roughData[i * 4 + 1] = rb
    roughData[i * 4 + 2] = rb
    roughData[i * 4 + 3] = 255
  }

  // Sobel normal from the tiling height field (OpenGL convention, +Y up)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  const strength = 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      normal[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255)
      normal[i + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255)
      normal[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255)
      normal[i + 3] = 255
    }
  }

  return {
    map: toTexture(albedo, size, true),
    roughnessMap: toTexture(roughData, size, false),
    normalMap: toTexture(normal, size, false),
  }
}
