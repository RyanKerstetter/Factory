import { ATTACK_DEFS } from './attack-defs.ts'
import { BUILDINGS, type BuildingKind } from './buildings.ts'
import { SUB, TPS } from './constants.ts'
import { floorDiv } from './geometry.ts'
import { dungeonBlocks } from './dungeon.ts'
import { isHittable, type Entity } from './sim/entity.ts'
import type { FactoryWorld } from './sim/factory-world.ts'
import type { PlayerPosition } from './movement.ts'
import type { Inventory } from './inventory.ts'
import { getItem, itemByKey, type ItemId, type ToolKind } from './items.ts'

// Weapons, from attack-defs.ts (where to tweak them): what a player attacks with, by what is in the picked hotbar slot (an item with an
// entry there), or their fists ("hand") with anything else, or with nothing picked (Q). Everything is in tiles and
// seconds in the file, and units and ticks here.
//
// The left click is the basic attack, on a short cooldown and usable on the move:
// - "jab", "swing", "thrust": a hit on everything within `range` and `arc` (degrees) of the way the player faces, and on
//   the nearest plant, rock or building there, for `damage` (see `resourceDamage` for what it does to those);
// - "strike": a hit on everything within `radius` of a spot `range` ahead (a pickaxe's point coming down);
// - "shot": held to charge (`windup` the least, `charge` the most), slowing the player; let go, it shoots one of
//   `ammo`, harder and further the longer it was charged.
// The right click is the special attack: held for its `windup`, then let go (it never touches plants or buildings):
// - "haymaker": a big punch that knocks back, aimed where the mouse is when it lands;
// - "chop": a heavy, narrow blow; "smash": a slam on everything round a spot in front; "bash": a close shove;
// - "stun": a wide swing that stuns (`stun` seconds) what it hits;
// - "lunge": a dash (`dash` tiles) and a stab;
// - "throw": the spear itself is thrown (charged like a shot), and lands to be picked up again;
// - "volley": `count` arrows at once, `spread` degrees apart, no windup, and a hop (`hop` tiles) backwards.
// Every attack, basic or special, puts every weapon on cooldown, so switching does not get round it.
export type BasicStyle = 'jab' | 'swing' | 'thrust' | 'strike' | 'shot'
export type SpecialKind = 'haymaker' | 'chop' | 'smash' | 'bash' | 'stun' | 'lunge' | 'throw' | 'volley'

export type Special = {
  kind: SpecialKind
  windup: number
  charge: number
  damage: number
  range: number
  arc: number
  radius: number
  knockback: number
  stun: number
  dash: number
  hop: number
  count: number
  spread: number
  speed: number
  cooldown: number
}

export type Weapon = {
  key: string
  name: string
  damage: number
  range: number
  arc: number
  // Above 0, the basic attack is a straight rectangle this wide (in units) instead of an arc.
  width: number
  // A strike's reach round the spot it lands on (units).
  radius: number
  cooldown: number
  basic: BasicStyle
  ammo?: ItemId
  windup: number
  charge: number
  speed: number
  // None for bare hands: their right click is for using things.
  special?: Special
}

const BASICS: readonly BasicStyle[] = ['jab', 'swing', 'thrust', 'strike', 'shot']
const SPECIALS: readonly SpecialKind[] = ['haymaker', 'chop', 'smash', 'bash', 'stun', 'lunge', 'throw', 'volley']

export const WEAPONS: ReadonlyMap<string, Weapon> = parseWeapons(ATTACK_DEFS)

function parseWeapons(data: unknown): Map<string, Weapon> {
  if (typeof data !== 'object' || data === null) throw new Error('ATTACK_DEFS must be an object of weapons.')
  const weapons = new Map<string, Weapon>()
  for (const [key, raw] of Object.entries(data as Record<string, Record<string, unknown>>)) {
    const fail = (problem: string): never => {
      throw new Error(`attack-defs.ts, ${key}: ${problem}`)
    }
    if (key !== 'hand' && !itemByKey(key)) fail('there is no item of that key')
    const num = (from: Record<string, unknown>, name: string, fallback?: number): number => {
      const value = from[name] ?? fallback
      return typeof value === 'number' && value >= 0 ? value : fail(`"${name}" must be a number, 0 or more`)
    }
    const ticks = (from: Record<string, unknown>, name: string, fallback = 0): number => Math.round(num(from, name, fallback) * TPS)
    const units = (from: Record<string, unknown>, name: string, fallback = 0): number => Math.round(num(from, name, fallback) * SUB)
    const radians = (from: Record<string, unknown>, name: string, fallback = 0): number => (num(from, name, fallback) * Math.PI) / 180
    const speed = (from: Record<string, unknown>): number => Math.round((num(from, 'speed', 0) * SUB) / TPS)
    const basic = raw.basic as BasicStyle
    if (!BASICS.includes(basic)) fail(`"basic" must be one of ${BASICS.join(', ')}`)
    const s = raw.special as Record<string, unknown> | undefined
    if (s && !SPECIALS.includes(s.kind as SpecialKind)) fail(`"special.kind" must be one of ${SPECIALS.join(', ')}`)
    const ammo = raw.ammo === undefined ? undefined : (itemByKey(raw.ammo as string)?.id ?? fail(`there is no ammo item "${String(raw.ammo)}"`))
    if (basic === 'shot' && ammo === undefined) fail('a "shot" weapon needs "ammo"')
    if (basic === 'strike' && !(typeof raw.radius === 'number' && raw.radius > 0)) fail('a "strike" weapon needs a "radius"')
    weapons.set(key, {
      key,
      name: typeof raw.name === 'string' ? raw.name : getItem(itemByKey(key)!.id).name,
      damage: num(raw, 'damage'),
      range: units(raw, 'range'),
      arc: radians(raw, 'arc', 90),
      width: units(raw, 'width'),
      radius: units(raw, 'radius'),
      cooldown: ticks(raw, 'cooldown'),
      basic,
      ...(ammo !== undefined ? { ammo } : {}),
      windup: ticks(raw, 'windup'),
      charge: ticks(raw, 'charge'),
      speed: speed(raw),
      ...(s ? { special: {
        kind: s.kind as SpecialKind,
        windup: ticks(s, 'windup'),
        charge: ticks(s, 'charge'),
        damage: num(s, 'damage'),
        range: units(s, 'range'),
        arc: radians(s, 'arc', 90),
        radius: units(s, 'radius'),
        knockback: units(s, 'knockback'),
        stun: ticks(s, 'stun'),
        dash: units(s, 'dash'),
        hop: units(s, 'hop'),
        count: num(s, 'count', 1),
        spread: radians(s, 'spread'),
        speed: speed(s),
        cooldown: ticks(s, 'cooldown'),
      } } : {}),
    })
  }
  if (!weapons.has('hand')) throw new Error('ATTACK_DEFS needs a "hand" weapon: what a player hits with bare-handed.')
  return weapons
}

// The weapon in a slot of an inventory: the item's, if it is a weapon; fists otherwise (and for the bare hand, slot -1).
export function weaponIn(inventory: Inventory, slot: number): Weapon {
  const held = inventory.slots[slot]
  const key = held && held.count > 0 ? getItem(held.item).key : 'hand'
  return WEAPONS.get(key) ?? WEAPONS.get('hand')!
}

// What a basic attack with a weapon does to a plant, a rock or a building: a tree only gives way to an axe and a rock to
// a pickaxe, and what a player put down only to an axe, each by the weapon's damage (0: it cannot be broken that way; a
// tree hit with anything else gives up sticks, or bark to a knife). A bush takes any weapon's damage; grass, saplings
// and sprouts come up at a touch.
export function resourceDamage(kind: BuildingKind, weapon: Weapon, tool: ToolKind | undefined): number {
  switch (kind) {
    case 'tree':
      return tool === 'axe' ? weapon.damage : 0
    case 'rock':
      return tool === 'pickaxe' ? weapon.damage : 0
    case 'bush':
      return weapon.damage
    default:
      // Anything a player put down (see `breakable` in buildings.ts) only comes down to an axe.
      return BUILDINGS[kind].breakable ? (tool === 'axe' ? weapon.damage : 0) : 1
  }
}

// A dash (a lunge forward, a volley's hop back) carries the player `distance` units along `angle` over DASH_TICKS
// movement inputs: the ones after the input the player had made when they attacked (`after`, sent with the attack), so
// the page moves its player through it exactly as the server does, smoothly, rather than being put right afterwards.
export const DASH_TICKS = 5
export type Dash = { vx: number; vy: number; ticks: number; after: number }

export function dashOf(angle: number, distance: number, after: number): Dash {
  return {
    vx: Math.round((Math.cos(angle) * distance) / DASH_TICKS),
    vy: Math.round((Math.sin(angle) * distance) / DASH_TICKS),
    ticks: DASH_TICKS,
    after,
  }
}

// The way from one point to another, as an angle in radians, and how far apart two angles are (0 to π).
export function angleTo(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2)
  return d > Math.PI ? Math.PI * 2 - d : d
}

// Whether a point is within an attack's reach: within `range` (plus `margin`, how far the target reaches from its
// middle) of `origin`, and within half of `arc` of the way it faces (anything right on top of the attacker counts).
// With a `width`, the reach is instead a straight rectangle out in front, `range` long and `width` wide.
export function inSwing(origin: { x: number; y: number }, facing: number, range: number, arc: number, target: { x: number; y: number }, margin = 0, width = 0): boolean {
  const distance = Math.hypot(target.x - origin.x, target.y - origin.y)
  if (width > 0) {
    if (distance <= margin + SUB / 4) return true
    const dx = target.x - origin.x
    const dy = target.y - origin.y
    const along = dx * Math.cos(facing) + dy * Math.sin(facing)
    const side = -dx * Math.sin(facing) + dy * Math.cos(facing)
    return along >= 0 && along <= range + margin && Math.abs(side) <= width / 2 + margin
  }
  if (distance > range + margin) return false
  if (distance <= margin + SUB / 4) return true
  return angleBetween(facing, angleTo(origin, target)) <= arc / 2 + Math.atan2(margin, Math.max(distance, 1))
}

// Where a strike (or a smash) `range` ahead of `origin` comes down.
export function strikeSpot(origin: { x: number; y: number }, facing: number, range: number): PlayerPosition {
  return { x: Math.round(origin.x + Math.cos(facing) * range), y: Math.round(origin.y + Math.sin(facing) * range) }
}

// Every plant, rock and building whose tile's middle is within `radius` (give or take half a tile) of a point, nearest
// first: what a strike hits.
export function tilesNear(world: FactoryWorld, middle: PlayerPosition, radius: number): Entity[] {
  const tileX = floorDiv(middle.x, SUB)
  const tileY = floorDiv(middle.y, SUB)
  const reach = Math.ceil(radius / SUB) + 1
  const found: Array<{ entity: Entity; distance: number }> = []
  for (let y = tileY - reach; y <= tileY + reach; y++) {
    for (let x = tileX - reach; x <= tileX + reach; x++) {
      const entity = world.entityAt(x, y)
      if (!entity || !isHittable(entity)) continue
      const distance = Math.hypot(x * SUB + SUB / 2 - middle.x, y * SUB + SUB / 2 - middle.y)
      if (distance <= radius + SUB / 2) found.push({ entity, distance })
    }
  }
  return found.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id).map((entry) => entry.entity)
}

// What a basic melee attack hits of the plants, rocks and buildings: in its swing, or round where a strike lands, and
// with nothing solid between it and the attacker (see attackClear).
export function tilesHitBy(world: FactoryWorld, weapon: Weapon, origin: PlayerPosition, facing: number): Entity[] {
  const covered =
    weapon.basic === 'strike'
      ? tilesNear(world, strikeSpot(origin, facing, weapon.range), weapon.radius)
      : tilesIn(world, origin, facing, weapon.range, weapon.arc, weapon.width)
  return covered.filter((target) => attackClear(world, origin, { x: target.x * SUB + SUB / 2, y: target.y * SUB + SUB / 2 }))
}

// Whether an attack from `from` reaches `to` with nothing in the way: no dungeon wall, and nothing solid (a tree, a
// chest, a rock) on any tile between them (the tiles at the two ends do not count). Attacks do not go through walls.
export function attackClear(world: FactoryWorld, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const fromX = floorDiv(from.x, SUB)
  const fromY = floorDiv(from.y, SUB)
  const toX = floorDiv(to.x, SUB)
  const toY = floorDiv(to.y, SUB)
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (SUB / 4)))
  for (let i = 1; i < steps; i++) {
    const x = floorDiv(Math.round(from.x + ((to.x - from.x) * i) / steps), SUB)
    const y = floorDiv(Math.round(from.y + ((to.y - from.y) * i) / steps), SUB)
    if ((x === fromX && y === fromY) || (x === toX && y === toY)) continue
    if (dungeonBlocks(x, y)) return false
    const entity = world.entityAt(x, y)
    if (entity && BUILDINGS[entity.kind].solid) return false
  }
  return true
}

// Every plant, rock and building whose tile a swing reaches (its middle, give or take half a tile), nearest first. The
// page works out the same, to show what a swing hits the moment it swings.
export function tilesIn(world: FactoryWorld, origin: PlayerPosition, facing: number, range: number, arc: number, width = 0): Entity[] {
  const tileX = floorDiv(origin.x, SUB)
  const tileY = floorDiv(origin.y, SUB)
  const reach = Math.ceil(range / SUB) + 1
  const found: Array<{ entity: Entity; distance: number }> = []
  for (let y = tileY - reach; y <= tileY + reach; y++) {
    for (let x = tileX - reach; x <= tileX + reach; x++) {
      const entity = world.entityAt(x, y)
      if (!entity || !isHittable(entity)) continue
      const middle = { x: x * SUB + SUB / 2, y: y * SUB + SUB / 2 }
      if (!inSwing(origin, facing, range, arc, middle, SUB / 2, width)) continue
      found.push({ entity, distance: Math.hypot(middle.x - origin.x, middle.y - origin.y) })
    }
  }
  return found.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id).map((entry) => entry.entity)
}
