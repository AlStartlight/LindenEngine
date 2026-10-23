/**
 * Shared helpers for generated test cases.
 * Every generator is seeded so a test ID always produces the same input.
 */

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
export const randFloat = (rng: Rng, min: number, max: number) => min + rng() * (max - min)
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]

export function shuffle<T>(rng: Rng, items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Test ID like TC-VEC-0007 */
export const tcId = (prefix: string, n: number) => `TC-${prefix}-${String(n).padStart(4, '0')}`

export const TAG_POOL = ['Enemy', 'Player', 'Flying', 'Coin', 'Pickup', 'Boss', 'NPC', 'Water', 'Door', 'Trap'] as const
