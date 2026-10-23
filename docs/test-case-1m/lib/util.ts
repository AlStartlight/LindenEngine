/** Seeded helpers shared by all generators */

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
/** Rounded to 3 decimals; never returns -0 */
export const round3 = (n: number) => Math.round(n * 1000) / 1000 || 0
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]

export function shuffle<T>(rng: Rng, items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Seed spaces are offset per generator so no two scenarios share a seed stream */
export const seedOf = (space: number, n: number) => space * 1_000_003 + n

export const TAGS = ['Enemy', 'Player', 'Flying', 'Coin', 'Pickup', 'Boss', 'NPC', 'Water', 'Door', 'Trap'] as const

export function quiet<T>(fn: () => T): T {
  const { warn, error, log } = console
  console.warn = console.error = console.log = () => {}
  try {
    return fn()
  } finally {
    console.warn = warn
    console.error = error
    console.log = log
  }
}
