// Every weapon's attacks, in one place to tweak (weapons.ts reads this and works out the rest). Distances are in
// tiles, times in seconds, angles in degrees. A weapon is named by its item's key; "hand" is bare hands.
//
// - `damage`: what the basic attack (left click) does to an animal, and to the resource it is for (an axe to trees and
//   what was put down, a pickaxe to rocks; see `resourceDamage` in weapons.ts).
// - `range`, `arc`: how far and how wide the basic attack reaches. A jab or a thrust is narrow and straight; a swing wide.
//   It hits every animal, and every plant, rock or building, inside that shape, so spacing things right clears more.
//   With `width` (tiles) instead of `arc`, it is a straight rectangle out in front, `range` long and `width` wide.
// - `cooldown`: how long after it before the next attack (with anything: every weapon shares it).
// - `basic`: "jab", "swing" or "thrust" (melee), or "shot": held to charge (`windup` the least, `charge` the most),
//   shooting one of `ammo` at `speed` tiles a second when let go.
// - `special` (right click), held for its `windup` and let go: what it is (see weapons.ts), with its own `damage`,
//   reach and `cooldown`, and what it does on top (`knockback` tiles, `stun` seconds, a `dash` forward, a `hop` back, a
//   spread of `count` shots `spread` degrees apart). A throw's `range` is how far it flies at full charge (less, charged
//   less) before it lands. Bare hands have none: their right click is for using things.
export type AttackDef = {
  name?: string
  damage: number
  range?: number
  arc?: number
  width?: number
  cooldown: number
  basic: 'jab' | 'swing' | 'thrust' | 'shot'
  ammo?: string
  windup?: number
  charge?: number
  speed?: number
  special?: {
    kind: 'haymaker' | 'chop' | 'smash' | 'bash' | 'stun' | 'lunge' | 'throw' | 'volley'
    windup: number
    charge?: number
    damage: number
    range?: number
    arc?: number
    radius?: number
    knockback?: number
    stun?: number
    dash?: number
    hop?: number
    count?: number
    spread?: number
    speed?: number
    cooldown: number
  }
}

export const ATTACK_DEFS: Readonly<Record<string, AttackDef>> = {
  // A quick straight jab: a rectangle just in front.
  hand: { name: 'Fists', damage: 1, range: 1.1, width: 0.4, cooldown: 0.35, basic: 'jab' },
  knife: {
    damage: 2,
    range: 0.8,
    arc: 100,
    cooldown: 0.3,
    basic: 'swing',
    special: { kind: 'lunge', windup: 0.25, damage: 4, range: 0.9, arc: 70, dash: 2, cooldown: 1.2 },
  },
  axe: {
    damage: 3,
    range: 1.3,
    arc: 120,
    cooldown: 0.5,
    basic: 'swing',
    special: { kind: 'chop', windup: 0.7, damage: 8, range: 1.5, arc: 40, knockback: 0.5, cooldown: 1.4 },
  },
  pickaxe: {
    damage: 3,
    range: 1.3,
    arc: 120,
    cooldown: 0.5,
    basic: 'swing',
    special: { kind: 'smash', windup: 0.8, damage: 5, range: 1.1, radius: 1.3, knockback: 1.5, cooldown: 1.5 },
  },
  club: {
    damage: 4,
    range: 1.3,
    arc: 120,
    cooldown: 0.6,
    basic: 'swing',
    special: { kind: 'stun', windup: 0.8, damage: 6, range: 1.5, arc: 200, stun: 2, knockback: 0.8, cooldown: 1.6 },
  },
  'wood-spear': {
    damage: 3,
    range: 2,
    width: 0.4,
    cooldown: 0.55,
    basic: 'thrust',
    special: { kind: 'throw', windup: 0.4, charge: 1, damage: 6, speed: 16, range: 8, cooldown: 0.8 },
  },
  'flint-spear': {
    damage: 5,
    range: 2,
    width: 0.4,
    cooldown: 0.55,
    basic: 'thrust',
    special: { kind: 'throw', windup: 0.4, charge: 1, damage: 10, speed: 17, range: 9, cooldown: 0.8 },
  },
  bow: {
    damage: 4,
    cooldown: 0.4,
    basic: 'shot',
    ammo: 'arrow',
    windup: 0.25,
    charge: 1,
    speed: 22,
    special: { kind: 'volley', windup: 0, damage: 3, count: 3, spread: 15, hop: 1.5, speed: 18, cooldown: 1.5 },
  },
  sling: {
    damage: 2,
    cooldown: 0.5,
    basic: 'shot',
    ammo: 'sling-stone',
    windup: 0.3,
    charge: 1.2,
    speed: 17,
    special: { kind: 'bash', windup: 0.3, damage: 2, range: 1, arc: 110, knockback: 3, cooldown: 1.2 },
  },
}
