// Seeded random numbers made with 32-bit integer arithmetic only, so every machine and every browser gives the same
// numbers from the same seed. Nothing in the simulation uses Math.random.

// A generator with its own state (mulberry32). Its whole state is one number (`state`), so it can be saved in a
// snapshot and hashed.
export class Rng {
  state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  // A whole number from 0 to `max` - 1.
  nextInt(max: number): number {
    return this.nextU32() % max
  }
}

// A number from 0 to 2³² - 1 made from a few whole numbers, the same for the same numbers and nothing like it for
// any others. It is how the world is generated without keeping anything: a tile's ore is a hash of the seed and
// where the tile is.
export function hashInts(...values: readonly number[]): number {
  let h = 0x811c9dc5
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 0x01000193)
    h ^= h >>> 15
    h = Math.imul(h, 0x2c1b3c6d)
    h ^= h >>> 12
  }
  h ^= h >>> 16
  return h >>> 0
}

// A seed from text a player typed (or from a number written as text).
export function seedFromText(text: string): number {
  const trimmed = text.trim()
  if (/^\d{1,9}$/.test(trimmed)) return Number(trimmed) >>> 0
  let h = 0x811c9dc5
  for (let i = 0; i < trimmed.length; i++) h = Math.imul(h ^ trimmed.charCodeAt(i), 0x01000193)
  return h >>> 0
}
