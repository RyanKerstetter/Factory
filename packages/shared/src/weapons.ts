import weaponsData from '../../../data/weapons.json' with { type: 'json' }
import { BUILDINGS, type BuildingKind } from './buildings.ts'
import { SUB, TPS } from './constants.ts'
import { failIn, fieldsOf, numberField, onlyFields, secondsField, speedField, tilesField, type Fail, type Fields } from './data-check.ts'
import { floorDiv, tileMiddle } from './geometry.ts'
import { dungeonBlocks } from './dungeon.ts'
import { isHittable, type Entity } from './sim/entity.ts'
import type { FactoryWorld } from './sim/factory-world.ts'
import type { PlayerPosition } from './movement.ts'
import type { Inventory } from './inventory.ts'
import { getItem, itemByKey, itemFromKey, NO_ITEM, type ItemId, type ToolKind } from './items.ts'

// Weapons, from data/weapons.json (where to tweak them): what a player attacks with, by what is in the picked hotbar
// slot (an item with an entry there), or their fists ("hand") with anything else, or with nothing picked (Q). In the
// file, by item key, distances are in tiles, times in seconds and angles in degrees; here, units, ticks and radians.
// An attack is the left click, on a cooldown every weapon shares, aimed at the mouse; the right click never attacks (it
// is for using things).
//
// - `damage`: what the attack does to a creature, before the creature's armour (see `damageAfterArmor`). Every hit
//   also knocks the creature back a little and stuns it for a moment (see the server's combat.ts).
// - `harvest`: what it does to a plant, a rock or something put down: an axe to trees and what was put down, a pickaxe
//   to rocks, anything to a bush (see `resourceDamage`).
// - `range`, `arc`: how far and how wide the attack reaches. A jab or a thrust is narrow and straight; a swing wide.
//   It hits every creature, and every plant, rock or building, inside that shape, so spacing things right clears more.
//   With `width` (tiles) instead of `arc`, it is a straight rectangle out in front, `range` long and `width` wide.
//   A "strike" is a small circle instead, `radius` across, `range` ahead (a pickaxe's point coming down).
// - `cooldown`: how long after it before the next attack (with anything: every weapon shares it).
// - `windup`: how long (seconds) between the button and the attack: a melee attack lands, a shot or a cast flies
//   (the bow drawn, the sling whirled once round, the staff raised), that long after it.
// - `lunge`: how far (tiles) a melee attack steps the player forward as it is made (0, or left out: they stand), over
//   LUNGE_TICKS, so walking backwards and swinging is cut short.
// - `basic`: "jab", "swing", "thrust" or "strike" (melee), "row" (an oar: a stroke pulled in towards the player from
//   the way it is aimed, hitting like a jab, and, aboard a raft, pushing the raft that way: see the server's rafts.ts),
//   or "shot": after its `windup` one of `ammo` flies at `speed` tiles a second, at most `range` tiles (then it
//   comes down);
//   or "cast" (a staff): the same, but what flies is its `projectile` (an item only drawn: none is used up, and none
//   lands).
// - `name`: what it is called (bare hands only: a weapon item is called what the item is).
// - `charged`: what it does with the attack button held down for its `charge` (seconds; CHARGE_TICKS, half a second, if
//   not given) and let go, by `kind`:
//   - "spin": round and round `spins` times (SPIN_TICKS each), hitting everything all round within its `range` on each
//     turn, for `damage` (no weapon has it now);
//   - "strike": a bigger strike, `radius` across, `range` ahead (no weapon has it now);
//   - "dash": the player dashes `range` tiles the way it is aimed, hitting everything `width` wide along the way (no
//     weapon has it now);
//   - "slam": a long, narrow strip, `range` long and `width` wide (the club);
//   - "throw": the weapon itself flies `range` tiles at `speed`, and sticks in the ground where it comes down, to be
//     knocked loose and picked up again (a spear);
//   - "shot": the ammo flies at `speed` instead (the bow, the sling: drawn while held, so its `windup` is usually 0),
//     at most `range` tiles (the weapon's own if not given).
//   - "blast" (a staff): its `projectile` (an icicle) comes down from high above on the spot aimed at (at most `range`
//     tiles away), `delay` seconds later, hurting every creature within `radius` tiles of it.
//   `damage` is what it does, `cooldown` how long after it before the next attack, `windup` how long after the
//   button is let go it lands (or flies), and (a spin, a strike, a slam) `lunge` how far it steps the player forward.
//   A dash runs the player its `range` instead.
export type BasicStyle = 'jab' | 'swing' | 'thrust' | 'strike' | 'shot' | 'row' | 'cast'

// What an attack covers, in units, from where the attacker stands, aimed along `facing`: everything within `range` and
// half of `arc` either side (a swing; an `arc` of a full turn is all round), a straight strip `length` long and `width`
// wide (a jab, a thrust, a slam, a dash), or a circle `radius` across, `distance` ahead (a strike).
export type AttackArea =
  | { kind: 'cone'; range: number; arc: number }
  | { kind: 'band'; length: number; width: number }
  | { kind: 'circle'; distance: number; radius: number }

export type ChargedKind = 'spin' | 'strike' | 'dash' | 'slam' | 'throw' | 'shot' | 'blast'
export type ChargedAttack = {
  kind: ChargedKind
  damage: number
  // A melee one's reach.
  area?: AttackArea
  // How many times it hits (a spin's turns), SPIN_TICKS apart.
  hits: number
  // A throw's or a shot's: how fast it flies (units a tick), and how far at most (units).
  speed: number
  range: number
  cooldown: number
  // How long the attack button has to be held for it, in ticks (its `charge`, or CHARGE_TICKS); how long after it is let
  // go it lands (or flies), in ticks; and how far it steps the player forward, in units (a spin, a strike, a slam).
  charge: number
  windup: number
  lunge: number
  // A blast's: what comes down, how far round it it hurts (units), and how long it takes to come down (ticks).
  projectile?: ItemId
  radius?: number
  delay?: number
}

// How long the attack button has to be held for a charged attack that does not say (its `charge`), in ticks (half a
// second).
export const CHARGE_TICKS = 15
// How long each turn of a spin takes, in ticks.
export const SPIN_TICKS = 8
// A melee attack steps the player forward its `lunge` over LUNGE_TICKS (so walking backwards and swinging is cut
// short). A dash goes its `range` over DASH_TICKS.
export const LUNGE_TICKS = 3
export const DASH_TICKS = 6

export type Weapon = {
  key: string
  name: string
  // To creatures (before their armour), and to plants, rocks and what was put down.
  damage: number
  harvest: number
  range: number
  arc: number
  // Above 0, the attack is a straight rectangle this wide (in units) instead of an arc.
  width: number
  // A strike's reach round the spot it lands on (units).
  radius: number
  cooldown: number
  basic: BasicStyle
  ammo?: ItemId
  // What a cast sends flying (drawn only).
  projectile?: ItemId
  // How long after the button its attack lands (a melee attack) or flies (a shot, a cast), in ticks; how fast what it
  // shoots flies, in units a tick; and how far a melee attack steps the player forward, in units.
  windup: number
  speed: number
  lunge: number
  // What it does held down and let go, if anything.
  charged?: ChargedAttack
}

const BASICS: readonly BasicStyle[] = ['jab', 'swing', 'thrust', 'strike', 'shot', 'row', 'cast']
const WEAPON_FIELDS = ['name', 'damage', 'harvest', 'range', 'arc', 'width', 'radius', 'cooldown', 'basic', 'ammo', 'projectile', 'windup', 'speed', 'charged', 'lunge']
// The fields of each kind of charged attack, besides `kind`.
const CHARGED_FIELDS: Readonly<Record<ChargedKind, readonly string[]>> = {
  spin: ['damage', 'spins', 'cooldown', 'windup', 'lunge'],
  strike: ['damage', 'range', 'radius', 'cooldown', 'windup', 'lunge'],
  dash: ['damage', 'range', 'width', 'cooldown', 'windup'],
  slam: ['damage', 'range', 'width', 'cooldown', 'windup', 'lunge'],
  throw: ['damage', 'speed', 'range', 'cooldown', 'windup'],
  shot: ['damage', 'speed', 'range', 'cooldown', 'windup'],
  blast: ['projectile', 'damage', 'range', 'radius', 'delay', 'cooldown', 'windup'],
}

export const WEAPONS: ReadonlyMap<string, Weapon> = parseWeapons(weaponsData)

function parseWeapons(data: unknown): Map<string, Weapon> {
  if (typeof data !== 'object' || data === null) throw new Error('data/weapons.json must be an object of weapons.')
  const weapons = new Map<string, Weapon>()
  for (const [key, entry] of Object.entries(data)) {
    const fail: Fail = failIn(`data/weapons.json, ${key}`)
    const raw = fieldsOf(entry, 'it', fail)
    onlyFields(raw, WEAPON_FIELDS, fail)
    if (key !== 'hand' && !itemByKey(key)) fail('there is no item of that key')
    const basic = raw.basic as BasicStyle
    if (!BASICS.includes(basic)) fail(`"basic" must be one of ${BASICS.join(', ')}`)
    const ammo = raw.ammo === undefined ? undefined : itemFromKey(raw.ammo, fail)
    if (basic === 'shot' && ammo === undefined) fail('a "shot" weapon needs "ammo"')
    if ((basic === 'shot' || basic === 'cast') && !(typeof raw.range === 'number' && raw.range > 0)) fail(`a "${basic}" weapon needs a "range": how far it flies at most`)
    const projectile = raw.projectile === undefined ? undefined : itemFromKey(raw.projectile, fail)
    if ((basic === 'cast') !== (projectile !== undefined)) fail('a "cast" weapon needs a "projectile", and only it has one')
    if (basic === 'strike' && !(typeof raw.radius === 'number' && raw.radius > 0)) fail('a "strike" weapon needs a "radius"')
    const range = tilesField(raw, 'range', fail, 0)
    const charged = raw.charged === undefined ? undefined : chargedOf(fieldsOf(raw.charged, '"charged"', fail), range, basic, fail)
    weapons.set(key, {
      key,
      name: typeof raw.name === 'string' ? raw.name : getItem(itemByKey(key)!.id).name,
      damage: numberField(raw, 'damage', fail),
      harvest: numberField(raw, 'harvest', fail),
      range,
      arc: (numberField(raw, 'arc', fail, 0, 90) * Math.PI) / 180,
      width: tilesField(raw, 'width', fail, 0),
      radius: tilesField(raw, 'radius', fail, 0),
      cooldown: secondsField(raw, 'cooldown', fail),
      basic,
      ...(ammo !== undefined ? { ammo } : {}),
      ...(projectile !== undefined ? { projectile } : {}),
      windup: Math.round(numberField(raw, 'windup', fail, 0, 0) * TPS),
      speed: Math.round((numberField(raw, 'speed', fail, 0, 0) * SUB) / TPS),
      lunge: tilesField(raw, 'lunge', fail, 0),
      ...(charged ? { charged } : {}),
    })
  }
  if (!weapons.has('hand')) throw new Error('data/weapons.json needs a "hand" weapon: what a player hits with bare-handed.')
  return weapons
}

// A weapon's charged attack, from its "charged" in weapons.json (`range` is the weapon's own, in units: a spin's reach).
function chargedOf(raw: Fields, range: number, basic: BasicStyle, fail: Fail): ChargedAttack {
  const kind = raw.kind as ChargedKind
  if (!Object.hasOwn(CHARGED_FIELDS, kind)) fail(`"charged.kind" must be one of ${Object.keys(CHARGED_FIELDS).join(', ')}`)
  onlyFields(raw, ['kind', 'charge', ...CHARGED_FIELDS[kind]], fail, '"charged": ')
  if ((kind === 'shot') !== (basic === 'shot')) fail('a "shot" weapon charges a "shot", and only it does')
  const tiles = (field: string): number => tilesField(raw, field, fail)
  const base = {
    kind,
    damage: numberField(raw, 'damage', fail, 1),
    cooldown: secondsField(raw, 'cooldown', fail),
    charge: secondsField(raw, 'charge', fail, CHARGE_TICKS / TPS),
    windup: Math.round(numberField(raw, 'windup', fail, 0, 0) * TPS),
    lunge: raw.lunge === undefined ? 0 : tiles('lunge'),
    hits: 1,
    speed: 0,
    range: 0,
  }
  const speed = (): number => speedField(raw, 'speed', fail)
  switch (kind) {
    case 'spin':
      return { ...base, area: { kind: 'cone', range, arc: Math.PI * 2 }, hits: Math.round(numberField(raw, 'spins', fail, 1)) }
    case 'strike':
      return { ...base, area: { kind: 'circle', distance: tiles('range'), radius: tiles('radius') } }
    case 'dash':
    case 'slam':
      return { ...base, area: { kind: 'band', length: tiles('range'), width: tiles('width') } }
    case 'throw':
      return { ...base, speed: speed(), range: tiles('range') }
    case 'shot':
      return { ...base, speed: speed(), range: raw.range === undefined ? range : tiles('range') }
    case 'blast':
      return {
        ...base,
        range: tiles('range'),
        projectile: itemFromKey(raw.projectile, fail),
        radius: tiles('radius'),
        delay: secondsField(raw, 'delay', fail),
      }
  }
}

// What a weapon's basic attack covers (nothing for a shot or a cast: what it shoots does the hitting).
export function basicArea(weapon: Weapon): AttackArea | undefined {
  if (weapon.basic === 'shot' || weapon.basic === 'cast') return undefined
  if (weapon.basic === 'strike') return { kind: 'circle', distance: weapon.range, radius: weapon.radius }
  if (weapon.width > 0) return { kind: 'band', length: weapon.range, width: weapon.width }
  return { kind: 'cone', range: weapon.range, arc: weapon.arc }
}

// How far from the attacker an area reaches at most, in units.
export function areaReach(area: AttackArea): number {
  return area.kind === 'cone' ? area.range : area.kind === 'band' ? area.length : area.distance + area.radius
}

// Whether a point is inside an area an attack from `origin` along `facing` covers, give or take `margin` (how far the
// target reaches from its middle).
export function inArea(area: AttackArea, origin: { x: number; y: number }, facing: number, target: { x: number; y: number }, margin = 0): boolean {
  if (area.kind === 'circle') {
    const spot = strikeSpot(origin, facing, area.distance)
    return Math.hypot(target.x - spot.x, target.y - spot.y) <= area.radius + margin
  }
  if (area.kind === 'band') return inSwing(origin, facing, area.length, 0, target, margin, area.width)
  return inSwing(origin, facing, area.range, area.arc, target, margin)
}

// How a player steps as they attack: its `lunge` (a dash: its range), in units, over how many ticks; nothing for an
// attack with no lunge, which they make standing.
export function lungeOf(weapon: Weapon, charged: boolean): { distance: number; ticks: number } | undefined {
  if (charged && weapon.charged) {
    const attack = weapon.charged
    if (attack.kind === 'dash') return { distance: attack.area?.kind === 'band' ? attack.area.length : 0, ticks: DASH_TICKS }
    return attack.lunge > 0 ? { distance: attack.lunge, ticks: LUNGE_TICKS } : undefined
  }
  return weapon.lunge > 0 ? { distance: weapon.lunge, ticks: LUNGE_TICKS } : undefined
}

// How many ticks something shot or thrown flies before it comes down: as long as it takes to go `range` units at
// `speed` units a tick.
export function flightTicks(range: number, speed: number): number {
  return Math.max(1, Math.ceil(range / Math.max(1, speed)))
}

// Bare fists: what a player attacks with holding nothing that is a weapon (nothing at all, or logs, seeds, a hide: any
// item that is not a weapon or a tool is punched with).
const HAND = WEAPONS.get('hand')!

// What an attack holding an item is made with: the item's weapon, if it is one; fists otherwise (and holding nothing).
export function weaponOf(item: ItemId): Weapon {
  return (item !== NO_ITEM ? WEAPONS.get(getItem(item).key) : undefined) ?? HAND
}

// The weapon in a slot of an inventory (see weaponOf; fists for the bare hand, slot -1).
export function weaponIn(inventory: Inventory, slot: number): Weapon {
  const held = inventory.slots[slot]
  return weaponOf(held && held.count > 0 ? held.item : NO_ITEM)
}

// What an attack with a weapon does to a plant, a rock or a building: a tree only gives way to an axe and a rock to a
// pickaxe, and what a player put down only to an axe, each by the weapon's `harvest` (0: it cannot be broken that way;
// a tree hit with anything else gives up sticks, or bark to a knife). A bush takes any weapon's; grass, saplings and
// sprouts come up at a touch.
export function resourceDamage(kind: BuildingKind, weapon: Weapon, tool: ToolKind | undefined): number {
  switch (kind) {
    case 'tree':
      return tool === 'axe' ? weapon.harvest : 0
    case 'rock':
    case 'clay':
    case 'copper-rock':
    case 'tin-rock':
    // The mummies' sandstone tomb, like a rock.
    case 'tomb':
      return tool === 'pickaxe' ? weapon.harvest : 0
    // A skeletons' tent and a goblins' lean-to come down to an axe, as anything put down.
    case 'skeleton-camp':
    case 'goblin-camp':
      return tool === 'axe' ? weapon.harvest : 0
    // A stone floor, put down by a player, comes up only to a pickaxe.
    case 'stone-floor':
      return tool === 'pickaxe' ? weapon.harvest : 0
    case 'bush':
    case 'sand':
    case 'cactus':
      return weapon.harvest
    // A wild beehive: a punch knocks a honeycomb out of it without hurting it; anything else hurts it.
    case 'hive':
      return weapon.key === 'hand' ? 0 : weapon.harvest
    default:
      // Anything a player put down (see `breakable` in buildings.ts) only comes down to an axe.
      return BUILDINGS[kind].breakable ? (tool === 'axe' ? weapon.harvest : 0) : 1
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

// Where a strike `range` ahead of `origin` comes down.
export function strikeSpot(origin: { x: number; y: number }, facing: number, range: number): PlayerPosition {
  return { x: Math.round(origin.x + Math.cos(facing) * range), y: Math.round(origin.y + Math.sin(facing) * range) }
}

// Every plant, rock and building whose tile's middle is within `radius` (give or take half a tile) of a point, nearest
// first: what a strike hits.
export function tilesNear(world: FactoryWorld, middle: PlayerPosition, radius: number): Entity[] {
  return hittableAround(world, middle, radius, (tile) => Math.hypot(tile.x - middle.x, tile.y - middle.y) <= radius + SUB / 2)
}

// The plants, rocks and buildings within `reach` (units, plus a tile) of a point whose tile's middle `covered` says is
// covered, nearest the point first.
function hittableAround(world: FactoryWorld, from: PlayerPosition, reach: number, covered: (middle: PlayerPosition) => boolean): Entity[] {
  const tileX = floorDiv(from.x, SUB)
  const tileY = floorDiv(from.y, SUB)
  const tiles = Math.ceil(reach / SUB) + 1
  const found: Array<{ entity: Entity; distance: number }> = []
  for (let y = tileY - tiles; y <= tileY + tiles; y++) {
    for (let x = tileX - tiles; x <= tileX + tiles; x++) {
      // What stands on the tile, else (once nothing that can be hit is) the floor under it.
      const on = world.entityAt(x, y)
      const entity = on && isHittable(on) ? on : world.floorAt(x, y)
      if (!entity || !isHittable(entity)) continue
      const middle = tileMiddle(x, y)
      if (covered(middle)) found.push({ entity, distance: Math.hypot(middle.x - from.x, middle.y - from.y) })
    }
  }
  return found.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id).map((entry) => entry.entity)
}

// What a melee attack covering `area` hits of the plants, rocks and buildings: in its swing or strip, or round where a
// strike lands. A swing is not stopped by what is in the way (only what flies is: see the server's combat.ts).
export function tilesHitBy(world: FactoryWorld, area: AttackArea, origin: PlayerPosition, facing: number): Entity[] {
  return area.kind === 'circle'
    ? tilesNear(world, strikeSpot(origin, facing, area.distance), area.radius)
    : area.kind === 'band'
      ? tilesIn(world, origin, facing, area.length, 0, area.width)
      : tilesIn(world, origin, facing, area.range, area.arc)
}

// Whether `to` can be seen from `from` with nothing in the way: no dungeon wall, and nothing solid (a tree, a chest, a
// rock) on any tile between them (the tiles at the two ends do not count). What a monster can see past.
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
  return hittableAround(world, origin, range, (middle) => inSwing(origin, facing, range, arc, middle, SUB / 2, width))
}
