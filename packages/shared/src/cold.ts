import { SUB, TPS } from './constants.ts'
import { floorDiv } from './geometry.ts'
import type { PlayerPosition } from './movement.ts'
import type { FactoryWorld } from './sim/factory-world.ts'
import { airTemperatureAt, type Terrain } from './terrain.ts'

// The cold. A player's body has a temperature of its own, which drifts towards the temperature round them (the air's:
// see airTemperatureAt in terrain.ts): down in the mountains' cold (less far in warm armour), up by a campfire. How cold
// their body is, not the air, is what slows and hurts them, so a quick run through the cold is safe and a long stay is
// not. The server keeps each body's temperature and sends it to the player's page (which slows its player by it, as the
// server does, and frosts the view over as it falls).

// The numbers. A body warms and cools towards the temperature round it: the air's, plus the warmth of the armour worn,
// or, by a lit campfire (within CAMPFIRE_WARMTH_RADIUS tiles), that CAMPFIRE_WARMTH degrees warmer and never less than
// CAMPFIRE_COMFORT. It starts at BODY_NORMAL and never goes above BODY_MAX. It cools by BODY_COOLING degrees a second, plus
// BODY_COOLING_GAP percent of how much colder the air is than the body (so bitter cold bites faster), and warms
// likewise by BODY_WARMING and BODY_WARMING_GAP percent.
// Below COLD_AT a player is cold, and slows down more and more the colder their body is, to FREEZING_SPEED_PERCENT
// at DEADLY_COLD_AT; below DEADLY_COLD_AT they lose COLD_DAMAGE health every COLD_DAMAGE_EVERY ticks, which no armour
// stops.
export const COLD_AT = 0
export const FREEZING_AT = -10
export const DEADLY_COLD_AT = -25
export const FREEZING_SPEED_PERCENT = 45
export const COLD_DAMAGE = 6
export const COLD_DAMAGE_EVERY = 2 * TPS
export const BODY_NORMAL = 16
export const BODY_MAX = 20
export const BODY_COOLING = 2
export const BODY_COOLING_GAP = 14
export const BODY_WARMING = 1.5
export const BODY_WARMING_GAP = 12
export const CAMPFIRE_WARMTH = 30
export const CAMPFIRE_COMFORT = 18
export const CAMPFIRE_WARMTH_RADIUS = 3

export type ColdLevel = 'warm' | 'cold' | 'freezing' | 'deadly'

// How the cold is treating a player, by their body's temperature.
export function coldLevel(body: number): ColdLevel {
  if (body < DEADLY_COLD_AT) return 'deadly'
  if (body < FREEZING_AT) return 'freezing'
  if (body < COLD_AT) return 'cold'
  return 'warm'
}

// Whether a lit campfire (or oven) is within CAMPFIRE_WARMTH_RADIUS tiles.
export function byFire(world: FactoryWorld, tileX: number, tileY: number): boolean {
  for (let y = tileY - CAMPFIRE_WARMTH_RADIUS; y <= tileY + CAMPFIRE_WARMTH_RADIUS; y++) {
    for (let x = tileX - CAMPFIRE_WARMTH_RADIUS; x <= tileX + CAMPFIRE_WARMTH_RADIUS; x++) {
      const entity = world.entityAt(x, y)
      if ((entity?.kind === 'campfire' || entity?.kind === 'oven') && entity.lit !== 0) return true
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
