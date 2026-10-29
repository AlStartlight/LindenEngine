/**
 * Primitive kinds and their sizes (1 unit = 1 meter). Kept free of three.js imports so the
 * component registry (also loaded by the agent tools in Electron's main process) stays light.
 */

export const PRIMITIVE_KINDS = ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'torus', 'plane'] as const
export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number]

/** Bounding-box size of each primitive at scale 1 */
export const PRIMITIVE_SIZES: Record<PrimitiveKind, [number, number, number]> = {
  box: [1, 1, 1],
  sphere: [1, 1, 1],
  cylinder: [1, 1, 1],
  capsule: [1, 2, 1],
  cone: [1, 1, 1],
  torus: [1, 1, 0.25],
  plane: [1, 1, 0],
}

export function normalizePrimitive(kind: unknown): PrimitiveKind {
  const k = String(kind ?? 'box').toLowerCase()
  if (k === 'cube') return 'box'
  return (PRIMITIVE_KINDS as readonly string[]).includes(k) ? (k as PrimitiveKind) : 'box'
}
