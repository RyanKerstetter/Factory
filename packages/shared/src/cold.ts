import { SUB, TPS } from './constants.ts'
import { floorDiv } from './geometry.ts'
import type { PlayerPosition } from './movement.ts'
import type { FactoryWorld } from './sim/factory-world.ts'
import {
  airTemperatureAt,
  BODY_COOLING,
  BODY_COOLING_GAP,
  BODY_MAX,
  BODY_WARMING,
  BODY_WARMING_GAP,
  CAMPFIRE_COMFORT,
  CAMPFIRE_WARMTH,
  CAMPFIRE_WARMTH_RADIUS,
  COLD_AT,
  coldLevel,
  DEADLY_COLD_AT,
  FREEZING_SPEED_PERCENT,
  type ColdLevel,
  type Terrain,
} from './terrain.ts'

// The cold (see terrain.ts for the numbers). A player's body has a temperature of its own, which drifts towards the
// temperature round them: down in the mountains' cold (less far in warm armour), up by a campfire. How cold their body
// is, not the air, is what slows and hurts them, so a dash through the cold is safe and a long stay is not. The server
// keeps each body's temperature and sends it to the player's page (which slows its player by it, as the server does,
// and frosts the view over as it falls).

// What the cold is doing to a player: the air where they are (°C), their body's temperature, what that means, whether
// a fire is warming them, and the temperature their body is drifting towards.
export type Chill = { air: number; body: number; level: ColdLevel; byFire: boolean; target: number }

// Whether a lit campfire is within CAMPFIRE_WARMTH_RADIUS tiles.
export function byFire(world: FactoryWorld, tileX: number, tileY: number): boolean {
  for (let y = tileY - CAMPFIRE_WARMTH_RADIUS; y <= tileY + CAMPFIRE_WARMTH_RADIUS; y++) {
    for (let x = tileX - CAMPFIRE_WARMTH_RADIUS; x <= tileX + CAMPFIRE_WARMTH_RADIUS; x++) {
      const entity = world.entityAt(x, y)
      if (entity?.kind === 'campfire' && entity.lit !== 0) return true
    }
  }
  return false
}

// The temperature a body drifts towards at a spot: the air's, plus the `warmth` of what the player wears; or, by a
// fire, warmer still.
export function warmthAround(
  terrain: Terrain,
  world: FactoryWorld,
  position: PlayerPosition,
  warmth = 0,
  // The air where it is not the terrain's (a lich's hall in a fight: see the server's dungeons.ts).
  airHere?: number,
): { air: number; target: number; byFire: boolean } {
  const tileX = floorDiv(position.x, SUB)
  const tileY = floorDiv(position.y, SUB)
  const air = airHere ?? airTemperatureAt(terrain, position.x / SUB, position.y / SUB)
  const fire = byFire(world, tileX, tileY)
  const dressed = air + warmth
  const target = Math.min(BODY_MAX, fire ? Math.max(dressed + CAMPFIRE_WARMTH, CAMPFIRE_COMFORT) : dressed)
  return { air, target, byFire: fire }
}

// A body's temperature a tick later, drifting towards `target`.
export function driftBody(body: number, target: number): number {
  const gap = target - body
  if (gap === 0) return body
  const perSecond = gap < 0 ? BODY_COOLING + (-gap * BODY_COOLING_GAP) / 100 : BODY_WARMING + (gap * BODY_WARMING_GAP) / 100
  const step = perSecond / TPS
  return Math.abs(gap) <= step ? target : body + Math.sign(gap) * step
}

export function chillOf(terrain: Terrain, world: FactoryWorld, position: PlayerPosition, body: number, warmth = 0): Chill {
  const around = warmthAround(terrain, world, position, warmth)
  return { air: Math.round(around.air), body, level: coldLevel(body), byFire: around.byFire, target: around.target }
}

// A body's temperature as the server sends it (in tenths of a degree) and as both it and the page slow the player by,
// so they slow them alike.
export function bodyTenths(body: number): number {
  return Math.round(body * 10)
}

// A player's speed, in percent, at how cold their body is (in tenths of a degree, see bodyTenths): full speed while it
// is above COLD_AT, then slower and slower as it cools, down to FREEZING_SPEED_PERCENT at DEADLY_COLD_AT and below.
export function coldSpeedPercent(tenths: number): number {
  const share = Math.max(0, Math.min(1, (COLD_AT * 10 - tenths) / ((COLD_AT - DEADLY_COLD_AT) * 10)))
  return 100 - Math.round(share * (100 - FREEZING_SPEED_PERCENT))
}

// How far the cold has got into a body, 0 (not at all) to 1 (deadly), for how frosted over the view is.
export function frostOf(body: number): number {
  return Math.max(0, Math.min(1, (COLD_AT - body) / (COLD_AT - DEADLY_COLD_AT)))
}
