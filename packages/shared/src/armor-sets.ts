import setsData from '../../../data/armor-sets.json' with { type: 'json' }
import { ARMOR_SLOT, PLAYER_MAX_HEALTH } from './constants.ts'
import { failIn, fieldsOf, onlyFields, textField, wholeField } from './data-check.ts'
import type { Inventory } from './inventory.ts'
import { ARMOR_SLOTS, ITEMS, itemFromKey, type ItemId } from './items.ts'

// Armour sets, from data/armor-sets.json (where to tweak them): wearing every one of a set's `pieces` (item keys, each
// worn in its own slot) gives its bonus, on top of what each piece gives by itself (armor.json):
// - `attack`: this much more damage with every attack, whatever it is made with (fists too), to creatures and players;
// - `health`: this much more health at most (see `playerMaxHealth`);
// - `healOnHit`: this much health back every time an attack hurts a creature or a player (each one it hurts).
export type ArmorSet = { key: string; name: string; pieces: readonly ItemId[]; attack: number; health: number; healOnHit: number }
export type SetBonus = { attack: number; health: number; healOnHit: number }

export const ARMOR_SETS: readonly ArmorSet[] = parseSets(setsData)

function parseSets(data: unknown): ArmorSet[] {
  const all = fieldsOf(data, 'data/armor-sets.json', failIn('data/armor-sets.json'))
  return Object.entries(all).map(([key, entry]) => {
    const fail = failIn(`data/armor-sets.json, ${key}`)
    const raw = fieldsOf(entry, 'it', fail)
    onlyFields(raw, ['name', 'pieces', 'attack', 'health', 'healOnHit'], fail)
    if (!Array.isArray(raw.pieces) || raw.pieces.length === 0) fail('"pieces" must be a list of armour item keys')
    const pieces = (raw.pieces as unknown[]).map((piece) => itemFromKey(piece, fail))
    const slots = pieces.map((id) => ITEMS.find((item) => item.id === id)?.armor?.slot ?? fail('each of "pieces" must be armour (armor.json)'))
    if (new Set(slots).size !== slots.length) fail('two of "pieces" are worn in the same slot')
    return {
      key,
      name: textField(raw, 'name', fail),
      pieces,
      attack: wholeField(raw, 'attack', fail, 0, 0),
      health: wholeField(raw, 'health', fail, 0, 0),
      healOnHit: wholeField(raw, 'healOnHit', fail, 0, 0),
    }
  })
}

// The sets a player has on whole: every piece worn.
export function wornSets(inventory: Inventory): ArmorSet[] {
  const worn = new Set<ItemId>()
  for (let i = ARMOR_SLOT; i < ARMOR_SLOT + ARMOR_SLOTS.length; i++) {
    const slot = inventory.slots[i]
    if (slot && slot.count > 0) worn.add(slot.item)
  }
  return ARMOR_SETS.filter((set) => set.pieces.every((piece) => worn.has(piece)))
}

// What the sets a player has on whole give them, all together.
export function setBonus(inventory: Inventory): SetBonus {
  const bonus = { attack: 0, health: 0, healOnHit: 0 }
  for (const set of wornSets(inventory)) {
    bonus.attack += set.attack
    bonus.health += set.health
    bonus.healOnHit += set.healOnHit
  }
  return bonus
}

// How much health a player has at most: PLAYER_MAX_HEALTH, more for good once they have eaten a truesight flesh (its
// `maxHealth` in food.json), and more while they wear a set that gives it.
export const TRUESIGHT_HEALTH = ITEMS.find((item) => item.truesight)?.maxHealth ?? 0
export function playerMaxHealth(inventory: Inventory, truesight: boolean | undefined): number {
  return PLAYER_MAX_HEALTH + (truesight ? TRUESIGHT_HEALTH : 0) + setBonus(inventory).health
}
