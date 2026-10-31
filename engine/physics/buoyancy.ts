type Vec3 = { x: number; y: number; z: number }

/** World-space water volume: an XZ rectangle from surfaceY down */
export interface WaterVolume {
  id: string
  surfaceY: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  density: number
  linearDrag: number
  angularDrag: number
}

export interface BuoyancyInput {
  surfaceY: number
  bounds: { min: Vec3; max: Vec3 }
  /** Collider volume in m³ */
  volume: number
  density: number
  gravity: number
}

export interface BuoyancyResult {
  /** 0 = dry, 1 = fully under water (fraction of the AABB height) */
  submerged: number
  /** Upward force in newtons */
  force: number
  /** Where to apply it: centre of the submerged part of the AABB, so tilted bodies right themselves */
  point: Vec3
}

/**
 * Archimedes on the AABB: F = density · g · volume · submerged. The submerged fraction is the share
 * of the AABB height below the surface; good for crates and barrels, rough for long rotated shapes.
 */
export function buoyancyForce(input: BuoyancyInput): BuoyancyResult {
  const { min, max } = input.bounds
  const height = max.y - min.y
  const submerged = height > 0 ? clamp01((input.surfaceY - min.y) / height) : input.surfaceY > min.y ? 1 : 0
  const force = input.density * input.gravity * input.volume * submerged
  const wetTop = min.y + height * submerged
  return {
    submerged,
    force,
    point: { x: (min.x + max.x) / 2, y: (min.y + wetTop) / 2, z: (min.z + max.z) / 2 },
  }
}

/** Whether a body's centre (XZ) lies over the water rectangle */
export function overWater(water: WaterVolume, bounds: { min: Vec3; max: Vec3 }): boolean {
  const cx = (bounds.min.x + bounds.max.x) / 2
  const cz = (bounds.min.z + bounds.max.z) / 2
  return cx >= water.minX && cx <= water.maxX && cz >= water.minZ && cz <= water.maxZ
}

/** World-space volume of a Water component on an entity at `position` with `scale` (rotation ignored) */
export function waterVolume(
  id: string,
  water: { size: { x: number; y: number }; density: number; linearDrag: number; angularDrag: number },
  position: Vec3,
  scale: Vec3
): WaterVolume {
  const hx = (Math.abs(water.size.x * scale.x) || 0) / 2
  const hz = (Math.abs(water.size.y * scale.z) || 0) / 2
  return {
    id,
    surfaceY: position.y,
    minX: position.x - hx,
    maxX: position.x + hx,
    minZ: position.z - hz,
    maxZ: position.z + hz,
    density: Math.max(water.density ?? 1000, 0),
    linearDrag: Math.max(water.linearDrag ?? 0, 0),
    angularDrag: Math.max(water.angularDrag ?? 0, 0),
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
