import { ATTACK_DEFS } from './attack-defs.ts'
import { BUILDINGS, type BuildingKind } from './buildings.ts'
import { SUB, TPS } from './constants.ts'
import { floorDiv } from './geometry.ts'
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
export type BasicStyle = 'jab' | 'swing' | 'thrust' | 'shot'
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
  cooldown: number
  basic: BasicStyle
  ammo?: ItemId
  windup: number
  charge: number
  speed: number
  // None for bare hands: their right click is for using things.
  special?: Special
}

const BASICS: readonly BasicStyle[] = ['jab', 'swing', 'thrust', 'shot']
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
    weapons.set(key, {
      key,
      name: typeof raw.name === 'string' ? raw.name : getItem(itemByKey(key)!.id).name,
      damage: num(raw, 'damage'),
      range: units(raw, 'range'),
      arc: radians(raw, 'arc', 90),
      width: units(raw, 'width'),
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
