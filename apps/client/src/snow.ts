import { airTemperatureAt, type Terrain } from '../../../packages/shared/src/index.ts'
import { organicNoise } from './noise.ts'

// Where snow lies in the mountains, a whole tile at a time: the same for the ground's picture (render3d/ground-colors.ts),
// the map (ui/map-view.ts) and footsteps (audio/sounds.ts), so what is heard and mapped is what is seen.

// Snow lies where the air is SNOW_LIES_AT °C or colder, after the snow line's wander: it wanders SNOW_LINE_WANDER
// degrees either way of where the air alone would put it, in big tongues and bays, and SNOW_BUMPS more in bumps along
// its length, so it never runs straight across the mountains (the air's temperature changes in straight bands).
const SNOW_LIES_AT = -7
const SNOW_LINE_WANDER = 14
const SNOW_BUMPS = 7

// Whether snow lies at a point (tiles) where the air is `temperature`.
export function isSnowAt(seed: number, temperature: number, x: number, y: number): boolean {
  const drift = organicNoise(seed + 17, x, y, 11) * 0.65 + organicNoise(seed + 19, x, y, 4.5) * 0.35
  const wobble = organicNoise(seed + 5, x, y, 8)
  return temperature + (drift - 0.5) * SNOW_LINE_WANDER + (wobble - 0.5) * SNOW_BUMPS <= SNOW_LIES_AT
}

// Whether snow lies on a tile of the mountains (judged at its middle).
export function snowOnTile(terrain: Terrain, x: number, y: number): boolean {
  return isSnowAt(terrain.seed, airTemperatureAt(terrain, x + 0.5, y + 0.5), x + 0.5, y + 0.5)
}
