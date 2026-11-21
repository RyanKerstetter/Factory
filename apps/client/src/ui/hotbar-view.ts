import { getItem, HOTBAR_SLOTS, NO_ITEM, PLAYER_MAX_HEALTH, type Slot } from '../../../../packages/shared/src/index.ts'
import { artUrl } from '../render/art.ts'
import { itemArt } from '../render/art-catalog.ts'
import { itemTip } from './item-tip.ts'
import { element } from './dom.ts'

export type HotbarState = {
  // The player's whole inventory; the hotbar is its first HOTBAR_SLOTS slots.
  slots: readonly Slot[]
  // The slot picked, or -1 for none (bare hands: Q puts away what is held).
  selected: number
  // The key for each hotbar slot, as the player has bound it ("1"), or an empty string.
  keys: readonly string[]
  // The player's health, out of PLAYER_MAX_HEALTH.
  health: number
  // The food slot, its key, and how far through the eating cooldown the player is (1: ready to eat).
  food: Slot
  foodKey: string
  foodReady: number
}

export type HotbarView = { update(state: HotbarState): void }

// The hotbar along the bottom: the first six slots of the player's inventory, one of them picked (with its key, or a
// click), or none for bare hands. Joined to it along its top, the player's health; over both, the name of what is picked.
export function createHotbarView(container: HTMLElement, onSelect: (slot: number) => void): HotbarView {
  const caption = element('div', 'hotbar-caption')
  const healthFill = element('div', 'health-fill')
  const healthText = element('span', 'health-text')
  const healthBar = element('div', 'health-bar', healthFill, healthText)
  healthBar.dataset.tip = 'Health'
  const cells = Array.from({ length: HOTBAR_SLOTS }, (_, index) => {
    const key = element('span', 'slot-key')
    const icon = element('img', 'pixel hotbar-icon')
    icon.alt = ''
    icon.draggable = false
    const count = element('span', 'slot-count')
    const slot = element('button', 'hotbar-slot', key, icon, count)
    slot.type = 'button'
    slot.addEventListener('click', () => onSelect(index))
    return { slot, key, icon, count }
  })
  const bar = element('div', 'hotbar', ...cells.map((cell) => cell.slot))
  // The food slot, at the right end: what F eats. Grey while the player cannot eat yet, its colour coming back as the
  // cooldown runs down, with a shade drawing back up over it.
  const foodKey = element('span', 'slot-key')
  const foodIcon = element('img', 'pixel hotbar-icon')
  foodIcon.alt = ''
  foodIcon.draggable = false
  const foodCount = element('span', 'slot-count')
  const foodShade = element('span', 'food-shade')
  const foodSlot = element('div', 'hotbar-slot food-slot', foodKey, foodIcon, foodShade, foodCount)
  bar.append(element('div', 'hotbar-gap'), foodSlot)
  // The health bar is the top edge of the hotbar's own panel, so the two read as one.
  container.append(element('div', 'hotbar-wrap', caption, element('div', 'hotbar-panel', healthBar, bar)))

  let shown = ''
  return {
    update({ slots, selected, keys, health, food, foodKey: eatKey, foodReady }) {
      const hasFood = food.count > 0 && food.item !== NO_ITEM
      foodSlot.classList.toggle('is-empty', !hasFood)
      foodKey.textContent = eatKey
      foodIcon.hidden = !hasFood
      if (hasFood) {
        const url = artUrl(itemArt(food.item))
        if (foodIcon.src !== url) foodIcon.src = url
        foodSlot.dataset.tip = itemTip(food.item)
      } else foodSlot.dataset.tip = 'Food slot: put food here to eat it with ' + eatKey
      foodCount.textContent = hasFood && food.count > 1 ? String(food.count) : ''
      const ready = Math.max(0, Math.min(1, foodReady))
      foodIcon.style.filter = `grayscale(${(1 - ready).toFixed(2)}) brightness(${(0.6 + 0.4 * ready).toFixed(2)})`
      foodShade.style.transform = `scaleY(${(1 - ready).toFixed(3)})`
      foodSlot.classList.toggle('is-ready', ready >= 1 && hasFood)
      healthFill.style.transform = `scaleX(${Math.max(0, Math.min(1, health / PLAYER_MAX_HEALTH))})`
      if (healthText.textContent !== `${health}`) healthText.textContent = `${health}`
      const key = `${selected}|${keys.join(',')}|${slots
        .slice(0, HOTBAR_SLOTS)
        .map((slot) => `${slot.item}:${slot.count}`)
        .join(',')}`
      if (key === shown) return
      shown = key
      cells.forEach((cell, index) => {
        const slot = slots[index]
        const filled = slot !== undefined && slot.count > 0 && slot.item !== NO_ITEM
        cell.slot.classList.toggle('is-active', index === selected)
        cell.key.textContent = keys[index] ?? ''
        cell.key.hidden = !keys[index]
        cell.icon.hidden = !filled
        if (filled) {
          const url = artUrl(itemArt(slot.item))
          if (cell.icon.src !== url) cell.icon.src = url
        }
        cell.count.textContent = filled && slot.count > 1 ? String(slot.count) : ''
        if (filled) cell.slot.dataset.tip = itemTip(slot.item)
        else delete cell.slot.dataset.tip
      })
      const held = slots[selected]
      const filled = held !== undefined && held.count > 0
      caption.hidden = !filled
      caption.textContent = filled ? getItem(held.item).name : ''
      caption.classList.toggle('is-active', filled)
    },
  }
}
