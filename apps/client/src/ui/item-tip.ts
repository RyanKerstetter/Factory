import { getItem, WEAPONS, type ItemId } from '../../../../packages/shared/src/index.ts'

// What the tooltip over an item says: its name, and under it what it is good for. A weapon (or tool) its damage; food
// how much health it gives back; armour how much warmer it keeps you and how much it takes off each hit.
export function itemTip(item: ItemId): string {
  const def = getItem(item)
  const lines = [def.name]
  const weapon = WEAPONS.get(def.key)
  if (weapon) lines.push(`Damage: ${weapon.damage}`)
  if (def.heals) lines.push(`Heals: ${def.heals}`)
  if (def.armor) {
    lines.push(`Cold protection: +${def.armor.warmth}°C`)
    lines.push(`Armour: ${def.armor.defense}`)
  }
  return lines.join('\n')
}
