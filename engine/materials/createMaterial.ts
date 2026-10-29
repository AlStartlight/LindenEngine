import * as THREE from 'three'
import { MaterialSpec, needsPhysical } from './MaterialSpec'
import { resolveMaterialSpec } from './presets'
import { buildProceduralTextures, generatePattern, ProceduralTextureSet, ROUGHNESS_MAP_CENTER } from './proceduralTextures'

export interface MaterialContext {
  /** Load a project texture (assets/...). The returned texture fills in asynchronously. */
  loadTexture?: (path: string, srgb: boolean) => THREE.Texture | null
  /** Low quality profile turns transmission (glass/water refraction) into plain transparency */
  allowTransmission?: boolean
  /** Edge length of generated textures */
  textureSize?: number
  warn?: (message: string) => void
}

const DEFAULT_COLOR = '#3b82f6'

// Pattern textures are shared; each material takes clones (same GPU source) with its own repeat
const patternCache = new Map<string, ProceduralTextureSet>()

function patternTextures(spec: MaterialSpec, size: number): ProceduralTextureSet | null {
  const p = spec.procedural
  if (!p || p.kind === 'none') return null
  const color = spec.color ?? DEFAULT_COLOR
  const key = [p.kind, p.seed ?? 1, size, color, p.color2 ?? '', p.contrast ?? 0.5, p.roughnessVariation ?? 0.1].join('|')
  let set = patternCache.get(key)
  if (!set) {
    const fields = generatePattern(p.kind, size, p.seed ?? 1)
    set = buildProceduralTextures(fields, {
      color: new THREE.Color(color),
      color2: p.color2 ? new THREE.Color(p.color2) : undefined,
      contrast: p.contrast ?? 0.5,
      roughnessVariation: p.roughnessVariation ?? 0.1,
    })
    patternCache.set(key, set)
  }
  return set
}

/** Free every shared generated texture (scene unload, tests) */
export function disposeProceduralCache(): void {
  for (const set of patternCache.values()) {
    set.map.dispose()
    set.roughnessMap.dispose()
    set.normalMap.dispose()
  }
  patternCache.clear()
}

function ownTexture(material: THREE.Material, tex: THREE.Texture, repeat: number): THREE.Texture {
  const t = tex.clone()
  t.repeat.set(repeat, repeat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  ;((material.userData.ownedTextures ??= []) as THREE.Texture[]).push(t)
  return t
}

/**
 * Build the three.js material for a spec. MeshPhysicalMaterial only when a physical feature
 * (clearcoat, transmission, sheen, iridescence, anisotropy, ior, specular) is used.
 */
export function createMaterial(input: MaterialSpec, ctx: MaterialContext = {}): THREE.MeshStandardMaterial {
  const { spec, warning } = resolveMaterialSpec(input)
  if (warning) ctx.warn?.(warning)

  const allowTransmission = ctx.allowTransmission !== false
  const transmission = spec.transmission ?? 0
  const physical = needsPhysical(spec)
  const mat: THREE.MeshStandardMaterial = physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial()
  mat.name = spec.preset ?? 'custom'
  mat.userData.materialSpec = spec

  mat.color.set(spec.color ?? DEFAULT_COLOR)
  mat.roughness = spec.roughness ?? 0.5
  mat.metalness = spec.metalness ?? 0
  if (spec.emissive) {
    mat.emissive.set(spec.emissive)
    mat.emissiveIntensity = spec.emissiveIntensity ?? 1
  }
  if (spec.opacity !== undefined && spec.opacity < 1) {
    mat.transparent = true
    mat.opacity = spec.opacity
    // Mostly see-through surfaces (thin glass) must not hide what is behind them through the depth buffer
    if (spec.opacity < 0.5) mat.depthWrite = false
  }
  mat.side = spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide
  mat.flatShading = spec.flatShading ?? false

  if (mat instanceof THREE.MeshPhysicalMaterial) {
    mat.clearcoat = spec.clearcoat ?? 0
    mat.clearcoatRoughness = spec.clearcoatRoughness ?? 0.03
    mat.sheen = spec.sheen ?? 0
    if (spec.sheenColor) mat.sheenColor.set(spec.sheenColor)
    mat.sheenRoughness = spec.sheenRoughness ?? 0.5
    mat.iridescence = spec.iridescence ?? 0
    mat.iridescenceIOR = spec.iridescenceIOR ?? 1.3
    mat.anisotropy = spec.anisotropy ?? 0
    mat.anisotropyRotation = spec.anisotropyRotation ?? 0
    mat.specularIntensity = spec.specularIntensity ?? 1
    mat.ior = spec.ior ?? 1.5
    if (transmission > 0 && allowTransmission) {
      mat.transmission = transmission
      mat.thickness = spec.thickness ?? 0.01
      if (spec.attenuationColor) mat.attenuationColor.set(spec.attenuationColor)
      mat.attenuationDistance = spec.attenuationDistance ?? Infinity
    } else if (transmission > 0) {
      // Quality profile Low: no refraction pass; approximate with alpha blending
      mat.transparent = true
      mat.opacity = Math.min(mat.opacity, 1 - transmission * 0.75)
      mat.depthWrite = false
    }
  }

  const repeat = 1 / (spec.tileSize ?? 1)
  const pattern = patternTextures(spec, ctx.textureSize ?? 256)
  if (pattern) {
    mat.map = ownTexture(mat, pattern.map, repeat)
    mat.roughnessMap = ownTexture(mat, pattern.roughnessMap, repeat)
    mat.normalMap = ownTexture(mat, pattern.normalMap, repeat)
    const bump = spec.normalScale ?? spec.procedural?.bump ?? 1
    mat.normalScale.set(bump, bump)
    mat.roughness = Math.min(1, mat.roughness / ROUGHNESS_MAP_CENTER)
  }

  // Asset textures override generated ones; sRGB only for color data
  const tx = spec.textures
  if (tx && ctx.loadTexture) {
    const load = (p: string | undefined, srgb: boolean) => {
      if (!p) return null
      const t = ctx.loadTexture!(p, srgb)
      return t ? ownTexture(mat, t, repeat) : null
    }
    mat.map = load(tx.map, true) ?? mat.map
    mat.normalMap = load(tx.normalMap, false) ?? mat.normalMap
    mat.roughnessMap = load(tx.roughnessMap, false) ?? mat.roughnessMap
    mat.metalnessMap = load(tx.metalnessMap, false) ?? mat.metalnessMap
    mat.aoMap = load(tx.aoMap, false) ?? mat.aoMap
    mat.emissiveMap = load(tx.emissiveMap, true) ?? mat.emissiveMap
    if (tx.normalMap && spec.normalScale !== undefined) mat.normalScale.set(spec.normalScale, spec.normalScale)
  }

  return mat
}

/** Dispose a material and the texture clones it owns (shared pattern sources stay cached) */
export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const m of Array.isArray(material) ? material : [material]) {
    for (const t of (m.userData.ownedTextures as THREE.Texture[] | undefined) ?? []) t.dispose()
    m.dispose()
  }
}
