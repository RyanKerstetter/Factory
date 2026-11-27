import { ARMOR_SETS, getItem, TRUESIGHT_HEALTH, WEAPONS, type ArmorSet, type ItemId } from '../../../../packages/shared/src/index.ts'

// What the tooltip over an item says: its name, and under it what it is good for. A weapon (or tool) its damage; food
// how much health it gives back (or takes: a truesight flesh, and what it does); armour how much warmer it keeps you and
// how much it takes off each hit, and the set it is part of: its name, its pieces and what wearing them all gives.
export function itemTip(item: ItemId): string {
  const def = getItem(item)
  const lines = [def.name]
  const weapon = WEAPONS.get(def.key)
  if (weapon) lines.push(`Damage: ${weapon.damage}`)
  if (def.heals) lines.push(`Heals: ${def.heals}`)
  if (def.hurts) lines.push(`Hurts: ${def.hurts} (it cannot be eaten if that would kill you)`)
  if (def.truesight) lines.push('Eaten, lifts the fog over the far islands for you, for good')
  if (def.truesight && TRUESIGHT_HEALTH > 0) lines.push(`and gives you ${TRUESIGHT_HEALTH} more health at most, for good`)
  if (def.armor) {
    lines.push(`Cold protection: +${def.armor.warmth}°C`)
    lines.push(`Armour: ${def.armor.defense}`)
  }
  for (const set of ARMOR_SETS) {
    if (!set.pieces.includes(item)) continue
    lines.push(`${set.name} set: ${set.pieces.map((piece) => getItem(piece).name).join(', ')}`)
    for (const effect of setEffects(set)) lines.push(`  Set bonus: ${effect}`)
  }
  return lines.join('\n')
}

// What wearing a whole set gives, in words.
function setEffects(set: ArmorSet): string[] {
  const effects: string[] = []
  if (set.attack) effects.push(`+${set.attack} damage with every attack`)
  if (set.health) effects.push(`+${set.health} max health`)
  if (set.healOnHit) effects.push(`heals ${set.healOnHit} each time you hurt something`)
  return effects
}
