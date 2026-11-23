import { hashInts } from './rng.ts'

// Smooth noise for how things look (the ground's patches, where snow lies, where the shelf's edge wanders), in
// fractions; the same on the server and every page (it decides where the deep sea starts, which slows a raft). The
// simulation's own noise is whole numbers only (see valueNoise in rng.ts).

// Smooth noise, 0 to 1, without the grid in it: two layers of value noise, each on a grid turned a different way, so
// where it is cut at a threshold (the snow line, the coast's wobble) the edge wanders freely instead of running along
// the grid's lines. `scale` is about the size of its features, in tiles.
export function organicNoise(seed: number, x: number, y: number, scale: number): number {
  const a = smoothNoise(seed, (x * 0.8 + y * 0.6) / scale, (y * 0.8 - x * 0.6) / scale)
  const b = smoothNoise(seed + 101, (x * 0.28 - y * 0.96) / (scale * 0.8), (y * 0.28 + x * 0.96) / (scale * 0.8))
  // Pulled back out towards 0 and 1 (an average of two is bunched round the middle).
  return Math.max(0, Math.min(1, 0.5 + ((a + b) / 2 - 0.5) * 1.6))
}

// Noise from 0 to 1 that changes smoothly: a value for each whole point, blended between them.
function smoothNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const at = (px: number, py: number): number => (hashInts(seed, px, py, 29) % 1000) / 1000
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
  return top + (bottom - top) * sy
}
