import { getItem, WEAPONS, type ItemId } from '../../../../packages/shared/src/index.ts'

// What the tooltip over an item says: its name, and under it what it is good for. A weapon (or tool) its damage; food
// how much health it gives back (or takes: a truesight flesh, and what it does); armour how much warmer it keeps you and
// how much it takes off each hit.
export function itemTip(item: ItemId): string {
  const def = getItem(item)
  const lines = [def.name]
  const weapon = WEAPONS.get(def.key)
  if (weapon) lines.push(`Damage: ${weapon.damage}`)
  if (def.heals) lines.push(`Heals: ${def.heals}`)
  if (def.hurts) lines.push(`Hurts: ${def.hurts} (it cannot be eaten if that would kill you)`)
  if (def.truesight) lines.push('Eaten, lifts the fog over the far islands for you, for good')
  if (def.armor) {
    lines.push(`Cold protection: +${def.armor.warmth}°C`)
    lines.push(`Armour: ${def.armor.defense}`)
  }
  return lines.join('\n')
}
