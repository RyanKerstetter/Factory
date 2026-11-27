import type { PuffView } from './render3d/frame.ts'

// The clouds game.ts has the 3D view draw as soft puffs (see PuffView and puffs.ts), worked out from what they show,
// each covering the ground as far as what it shows reaches, with no hard edge: frost flowing out where ice lands, cold
// mist gathering where it is about to, poison billowing out of a hex, and a blizzard (and the frost lich calling one).
// All in tiles; worked out afresh each frame from how far through each is and the time, the same every frame for the
// same `seed` (one per cloud), so nothing is kept.

const FROST = [0xf2f9ff, 0xd8ecff, 0xbfe0ff] as const
const POISON = [0x8fdc58, 0x6cbf3e, 0xa8ec74, 0x4f9a2c] as const
const SNOW = [0xffffff, 0xf2f8ff, 0xe4f0fb] as const

// A number from 0 to 1 for a cloud (`seed`), a puff in it (`i`) and something about the puff (`k`), always the same.
function rand(seed: number, i: number, k: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b) ^ Math.imul(k + 7, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

// Up quickly, then out slowly: how strong a cloud is `age` (0 to 1) of the way through, coming in over `rise` of it.
function swell(age: number, rise: number): number {
  return age < rise ? age / rise : Math.max(0, 1 - (age - rise) / (1 - rise))
}

// Frost where ice has landed (x, y; it hurts within `reach`), `age` 0 to 1 through it: cold mist flowing out over the
// ground from where it hit, fast and then slowing, out to `reach`, swelling as it goes and fading away.
export function frostBurst(x: number, y: number, reach: number, age: number, seed: number): PuffView[] {
  const puffs: PuffView[] = []
  const out = 1 - (1 - age) ** 3
  const strength = swell(age, 0.12)
  const count = Math.round(12 + reach * 16)
  for (let i = 0; i < count; i++) {
    const angle = ((i + rand(seed, i, 1)) / count) * Math.PI * 2
    const size = (0.4 + 0.3 * rand(seed, i, 3)) * (0.6 + 0.6 * age) * Math.max(0.6, Math.min(1.3, reach))
    // Where it ends up: anywhere out to the reach, its soft edge just there, so the whole of it is covered.
    const far = Math.max(0, reach * (0.1 + 0.9 * Math.sqrt(rand(seed, i, 2))) - size * 0.4)
    puffs.push({ x: x + Math.cos(angle) * far * out, y: y + Math.sin(angle) * far * out, height: 0.06 + 0.12 * age * rand(seed, i, 4), size, color: FROST[i % FROST.length], alpha: 0.6 * strength })
  }
  // Glittering bits of ice thrown out with it.
  for (let i = 0; i < 10; i++) {
    const angle = rand(seed, i, 5) * Math.PI * 2
    const far = reach * (0.3 + 0.7 * rand(seed, i, 6)) * out
    puffs.push({ x: x + Math.cos(angle) * far, y: y + Math.sin(angle) * far, height: 0.05 + 0.4 * (1 - age) * rand(seed, i, 7), size: 0.06, color: 0xffffff, alpha: 0.95 * (1 - age) })
  }
  return puffs
}

// Cold mist gathering on the ground where ice is falling (x, y; it will hurt within `reach`), thicker as it comes
// down (`fall`, 0 to 1), slowly turning, its edge where the reach is.
export function frostGathering(x: number, y: number, reach: number, fall: number, now: number, seed: number): PuffView[] {
  const puffs: PuffView[] = []
  const count = Math.round(8 + reach * 10)
  const turn = now / 2200
  for (let i = 0; i < count; i++) {
    const size = Math.max(0.35, reach * (0.55 + 0.25 * rand(seed, i, 3)))
    const far = Math.max(0, reach - size * 0.45) * Math.sqrt(rand(seed, i, 2))
    const angle = rand(seed, i, 1) * Math.PI * 2 + turn * (rand(seed, i, 4) < 0.5 ? 1 : -1)
    puffs.push({ x: x + Math.cos(angle) * far, y: y + Math.sin(angle) * far, height: 0.04, size, color: FROST[i % FROST.length], alpha: (0.15 + 0.4 * fall) * (0.75 + 0.25 * Math.sin(now / 300 + i)) })
  }
  return puffs
}

// Poison billowing out where a hex burst (x, y; it hurts within `reach`), `age` 0 to 1 through it: green clouds rolling
// out to the reach and rising a little as they swell, then thinning away.
export function poisonBurst(x: number, y: number, reach: number, age: number, seed: number): PuffView[] {
  const puffs: PuffView[] = []
  const out = 1 - (1 - age) ** 2.2
  const strength = swell(age, 0.1)
  const count = Math.round(14 + reach * 14)
  for (let i = 0; i < count; i++) {
    const angle = ((i + rand(seed, i, 1)) / count) * Math.PI * 2
    const size = (0.35 + 0.35 * rand(seed, i, 3)) * (0.5 + 0.9 * age) * Math.max(0.6, Math.min(1.3, reach))
    const far = Math.max(0, reach * Math.sqrt(rand(seed, i, 2)) - size * 0.35)
    // Rolling as it goes: turned a little as it spreads.
    const roll = angle + age * (rand(seed, i, 5) - 0.5) * 0.8
    puffs.push({
      x: x + Math.cos(roll) * far * out,
      y: y + Math.sin(roll) * far * out,
      height: 0.1 + age * (0.25 + 0.45 * rand(seed, i, 4)),
      size,
      color: POISON[i % POISON.length],
      alpha: 0.62 * strength,
    })
  }
  return puffs
}

// A blizzard blowing round x, y out to `radius`: snow driven round and round in a whirl, fast, streaking past near the
// ground and up through the air, over a white haze of blown snow that covers the ground it reaches; `fade` (0 to 1) as
// it comes and goes. Calling one up (the frost lich casting, `fade` how far through) it is the same, coming on.
export function blizzard(x: number, y: number, radius: number, fade: number, now: number, seed: number): PuffView[] {
  const puffs: PuffView[] = []
  const seconds = now / 1000
  // The haze: big, faint, slowly turning.
  const hazes = Math.round(12 + radius * radius * 2.5)
  for (let i = 0; i < hazes; i++) {
    const size = 1.2 + 0.8 * rand(seed, i, 3)
    const far = Math.max(0, radius - size * 0.4) * Math.sqrt(rand(seed, i, 2))
    const angle = rand(seed, i, 1) * Math.PI * 2 + seconds * (0.9 - (0.5 * far) / Math.max(1, radius))
    puffs.push({ x: x + Math.cos(angle) * far, y: y + Math.sin(angle) * far, height: 0.1 + 0.5 * rand(seed, i, 4), size, color: SNOW[i % SNOW.length], alpha: 0.16 * fade })
  }
  // The snow: flakes driven round the whirl, each with a short streak behind it.
  const flakes = Math.round(60 + radius * 30)
  for (let i = 0; i < flakes; i++) {
    const far = Math.max(0.3, radius * Math.sqrt(rand(seed, i, 12)))
    // Tiles a second round the whirl, a few more or less for each.
    const speed = 5 + 4 * rand(seed, i, 13)
    const angle = rand(seed, i, 11) * Math.PI * 2 + (seconds * speed) / far
    // Up and down as it is blown about, and in and out a little.
    const height = 0.08 + 1.4 * (0.5 + 0.5 * Math.sin(seconds * (1.5 + rand(seed, i, 14) * 2) + i))
    const wander = 0.25 * Math.sin(seconds * 3 + i * 1.7)
    const size = 0.06 + 0.06 * rand(seed, i, 15)
    for (let trail = 0; trail < 5; trail++) {
      const back = angle - (trail * 0.03 * speed) / far
      const r = far + wander
      puffs.push({ x: x + Math.cos(back) * r, y: y + Math.sin(back) * r, height, size: size * (1 - trail * 0.12), color: trail === 0 ? 0xffffff : 0xeef6ff, alpha: fade * (0.95 - trail * 0.18) })
    }
  }
  return puffs
}
