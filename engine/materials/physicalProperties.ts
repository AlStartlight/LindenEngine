import { MaterialSpec } from './MaterialSpec'
import { getMaterialPreset, MaterialPreset } from './presets'

/**
 * Physical properties of the material presets, used for model mass, center of mass and collider
 * friction. Density is kg/m³ of a SOLID piece of the material; a part modelled as a solid block that
 * is hollow in reality (a car body, a fridge, a cabinet) sets ModelPart.density instead.
 */
export interface MaterialPhysics {
  /** kg/m³ */
  density: number
  friction: number
  restitution: number
}

const BY_PRESET: Record<string, MaterialPhysics> = {
  wood_oak: { density: 750, friction: 0.5, restitution: 0.2 },
  wood_teak: { density: 650, friction: 0.5, restitution: 0.2 },
  wood_walnut: { density: 640, friction: 0.5, restitution: 0.2 },
  wood_painted_white: { density: 650, friction: 0.45, restitution: 0.2 },
  rattan: { density: 400, friction: 0.6, restitution: 0.2 },
  metal_steel: { density: 7850, friction: 0.4, restitution: 0.15 },
  metal_chrome: { density: 7850, friction: 0.25, restitution: 0.15 },
  metal_gold: { density: 19300, friction: 0.35, restitution: 0.1 },
  metal_copper: { density: 8960, friction: 0.4, restitution: 0.1 },
  metal_aluminium_brushed: { density: 2700, friction: 0.4, restitution: 0.15 },
  metal_black_matte: { density: 7850, friction: 0.45, restitution: 0.15 },
  metal_brass: { density: 8500, friction: 0.4, restitution: 0.1 },
  plastic_glossy: { density: 1200, friction: 0.35, restitution: 0.3 },
  plastic_matte: { density: 1200, friction: 0.45, restitution: 0.3 },
  rubber: { density: 1100, friction: 0.9, restitution: 0.6 },
  glass_clear: { density: 2500, friction: 0.3, restitution: 0.1 },
  glass_solid: { density: 2500, friction: 0.3, restitution: 0.1 },
  glass_frosted: { density: 2500, friction: 0.35, restitution: 0.1 },
  water: { density: 1000, friction: 0.05, restitution: 0 },
  ceramic_glazed: { density: 2400, friction: 0.35, restitution: 0.1 },
  ceramic_tile: { density: 2300, friction: 0.45, restitution: 0.1 },
  marble: { density: 2700, friction: 0.35, restitution: 0.1 },
  concrete: { density: 2400, friction: 0.7, restitution: 0.05 },
  brick: { density: 1900, friction: 0.7, restitution: 0.05 },
  stone: { density: 2600, friction: 0.6, restitution: 0.05 },
  fabric_cotton: { density: 250, friction: 0.7, restitution: 0.05 },
  fabric_velvet: { density: 250, friction: 0.75, restitution: 0.05 },
  leather: { density: 900, friction: 0.6, restitution: 0.1 },
  grass: { density: 400, friction: 0.6, restitution: 0.05 },
  soil: { density: 1500, friction: 0.7, restitution: 0.02 },
  sand: { density: 1600, friction: 0.6, restitution: 0.02 },
  // Effective density of a car body modelled as solid parts (≈1.4 t over ≈9 m³)
  car_paint: { density: 150, friction: 0.4, restitution: 0.1 },
  car_paint_pearl: { density: 150, friction: 0.4, restitution: 0.1 },
  paint_wall: { density: 1500, friction: 0.6, restitution: 0.05 },
  emissive_light: { density: 1000, friction: 0.3, restitution: 0.1 },
}

const BY_CATEGORY: Record<MaterialPreset['category'], MaterialPhysics> = {
  wood: { density: 650, friction: 0.5, restitution: 0.2 },
  metal: { density: 7850, friction: 0.4, restitution: 0.15 },
  plastic: { density: 1200, friction: 0.4, restitution: 0.3 },
  glass: { density: 2500, friction: 0.3, restitution: 0.1 },
  liquid: { density: 1000, friction: 0.05, restitution: 0 },
  stone: { density: 2500, friction: 0.6, restitution: 0.05 },
  ceramic: { density: 2400, friction: 0.4, restitution: 0.1 },
  fabric: { density: 250, friction: 0.7, restitution: 0.05 },
  ground: { density: 1500, friction: 0.7, restitution: 0.02 },
  paint: { density: 1000, friction: 0.5, restitution: 0.1 },
  other: { density: 1000, friction: 0.5, restitution: 0.1 },
}

/** Properties of a material spec: its preset, the preset's category, or plastic */
export function materialPhysics(spec: MaterialSpec): MaterialPhysics {
  const preset = getMaterialPreset(spec.preset)
  if (preset) return BY_PRESET[preset.id] ?? BY_CATEGORY[preset.category]
  // A custom metal spec without preset is still metal
  if ((spec.metalness ?? 0) > 0.5) return BY_CATEGORY.metal
  if ((spec.transmission ?? 0) > 0.5) return BY_CATEGORY.glass
  return BY_CATEGORY.plastic
}
