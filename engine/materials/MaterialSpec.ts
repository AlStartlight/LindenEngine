import { z } from 'zod'

/**
 * Data-driven PBR material: a preset id plus overrides. Used by MeshRenderer.material and by every
 * Model part. Turned into a MeshStandardMaterial / MeshPhysicalMaterial by createMaterial.ts.
 */

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'warna harus #rrggbb')
const Unit = z.number().min(0).max(1)

export const ProceduralKind = z.enum([
  'none',
  'wood',
  'noise',
  'brick',
  'tile',
  'fabric',
  'brushed',
  'scratches',
  'marble',
  'concrete',
  'leather',
  'grass',
  'soil',
  'sand',
  'stone',
  'rattan',
])

export const ProceduralSpec = z.object({
  kind: ProceduralKind,
  /** Secondary tone mixed into the albedo (grain, mortar, veins); default derives from the color */
  color2: HexColor.optional(),
  /** 0..1 how strongly the pattern shows in the albedo */
  contrast: Unit.optional(),
  /** Strength of the generated normal map */
  bump: z.number().min(0).max(4).optional(),
  /** Roughness variation added on top of the base roughness */
  roughnessVariation: Unit.optional(),
  seed: z.number().int().min(0).max(1_000_000).optional(),
})

/** Project-relative texture paths (assets/...). sRGB is applied to map/emissiveMap only. */
export const TextureSetSpec = z.object({
  map: z.string().optional(),
  normalMap: z.string().optional(),
  roughnessMap: z.string().optional(),
  metalnessMap: z.string().optional(),
  aoMap: z.string().optional(),
  emissiveMap: z.string().optional(),
})

export const MaterialSpecSchema = z.object({
  preset: z.string().optional(),
  color: HexColor.optional(),
  roughness: Unit.optional(),
  metalness: Unit.optional(),
  opacity: Unit.optional(),
  emissive: HexColor.optional(),
  emissiveIntensity: z.number().min(0).max(100).optional(),
  clearcoat: Unit.optional(),
  clearcoatRoughness: Unit.optional(),
  transmission: Unit.optional(),
  ior: z.number().min(1).max(2.333).optional(),
  /** Volume thickness in meters for transmission */
  thickness: z.number().min(0).max(10).optional(),
  attenuationColor: HexColor.optional(),
  attenuationDistance: z.number().min(0).optional(),
  sheen: Unit.optional(),
  sheenColor: HexColor.optional(),
  sheenRoughness: Unit.optional(),
  iridescence: Unit.optional(),
  iridescenceIOR: z.number().min(1).max(2.333).optional(),
  anisotropy: Unit.optional(),
  /** Radians */
  anisotropyRotation: z.number().optional(),
  specularIntensity: Unit.optional(),
  normalScale: z.number().min(0).max(4).optional(),
  /** Size in meters of one texture tile (procedural and asset textures) */
  tileSize: z.number().positive().max(100).optional(),
  procedural: ProceduralSpec.optional(),
  textures: TextureSetSpec.optional(),
  doubleSided: z.boolean().optional(),
  flatShading: z.boolean().optional(),
})

export type MaterialSpec = z.infer<typeof MaterialSpecSchema>
export type ProceduralSpecType = z.infer<typeof ProceduralSpec>
export type ProceduralKindType = z.infer<typeof ProceduralKind>

/** Keys whose presence needs MeshPhysicalMaterial (MeshStandardMaterial has no such parameter) */
export const PHYSICAL_KEYS = [
  'clearcoat',
  'transmission',
  'sheen',
  'iridescence',
  'anisotropy',
  'specularIntensity',
] as const

export function needsPhysical(spec: MaterialSpec): boolean {
  return PHYSICAL_KEYS.some((k) => (spec[k] ?? 0) > 0) || spec.ior !== undefined
}
