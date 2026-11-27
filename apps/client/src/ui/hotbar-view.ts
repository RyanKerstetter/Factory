import { BODY_MAX, COLD_AT, DEADLY_COLD_AT, FREEZING_AT, getItem, HOTBAR_SLOTS, isFilled, type Slot } from '../../../../packages/shared/src/index.ts'
import { showIcon } from './icons.ts'
import { itemTip } from './item-tip.ts'
import { element, pixelImage } from './dom.ts'

export type HotbarState = {
  // The player's whole inventory; the hotbar is its first HOTBAR_SLOTS slots.
  slots: readonly Slot[]
  // The slot picked, or -1 for none (bare hands: Q puts away what is held).
  selected: number
  // The key for each hotbar slot, as the player has bound it ("1"), or an empty string.
  keys: readonly string[]
  // The player's health, out of `maxHealth` (see playerMaxHealth), and how warm their body is, in °C (see cold.ts).
  health: number
  maxHealth: number
  body: number
  // The food slot, its key, and how far through the eating cooldown the player is (1: ready to eat).
  food: Slot
  foodKey: string
  foodReady: number
}

export type HotbarView = { update(state: HotbarState): void }

// The hotbar along the bottom: the first HOTBAR_SLOTS slots of the player's inventory, one of them picked (with its
// key, or a click), or none for bare hands; and at its right end the food slot. Joined to it along its top, the player's health and, beside it, how warm their body
// is (a gauge from deadly cold to warm, its colour going from deep blue through pale blue to orange as it warms, and the
// degrees in it); over both, the name of what is picked.
export function createHotbarView(container: HTMLElement, onSelect: (slot: number) => void): HotbarView {
  const caption = element('div', 'hotbar-caption')
  const healthFill = element('div', 'health-fill')
  const healthText = element('span', 'health-text')
  const healthBar = element('div', 'health-bar', healthFill, healthText)
  healthBar.dataset.tip = 'Health'
  const bodyFill = element('div', 'body-fill')
  const bodyText = element('span', 'body-text')
  const bodyBar = element('div', 'body-bar', bodyFill, bodyText)
  bodyBar.dataset.tip = 'Body temperature: below 0° you are cold and slow down; below the deep blue you freeze, and lose health'
  const vitals = element('div', 'vitals', healthBar, bodyBar)
  const cells = Array.from({ length: HOTBAR_SLOTS }, (_, index) => {
    const key = element('span', 'slot-key')
    const icon = pixelImage('hotbar-icon')
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
  const foodIcon = pixelImage('hotbar-icon')
  const foodCount = element('span', 'slot-count')
  const foodShade = element('span', 'food-shade')
  const foodSlot = element('div', 'hotbar-slot food-slot', foodKey, foodIcon, foodShade, foodCount)
  bar.append(element('div', 'hotbar-gap'), foodSlot)
  // The health bar is the top edge of the hotbar's own panel, so the two read as one.
  container.append(element('div', 'hotbar-wrap', caption, element('div', 'hotbar-panel', vitals, bar)))

  let shown = ''
  return {
    update({ slots, selected, keys, health, maxHealth, body, food, foodKey: eatKey, foodReady }) {
      // The body's warmth, from deadly cold (empty) to as warm as it gets (full).
      const low = DEADLY_COLD_AT - 5
      bodyFill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, (body - low) / (BODY_MAX - low)))})`
      const tone = body >= COLD_AT ? 'is-warm' : body >= FREEZING_AT ? 'is-cold' : body >= DEADLY_COLD_AT ? 'is-freezing' : 'is-deadly'
      if (!bodyFill.classList.contains(tone)) bodyFill.className = `body-fill ${tone}`
      const degrees = `${Math.round(body)}°`
      if (bodyText.textContent !== degrees) bodyText.textContent = degrees
      const hasFood = isFilled(food)
      foodSlot.classList.toggle('is-empty', !hasFood)
      foodKey.textContent = eatKey
      foodIcon.hidden = !hasFood
      if (hasFood) showIcon(foodIcon, food.item)
      foodSlot.dataset.tip = hasFood ? itemTip(food.item) : `Food slot: put food here to eat it with ${eatKey}`
      foodCount.textContent = hasFood && food.count > 1 ? String(food.count) : ''
      const ready = Math.max(0, Math.min(1, foodReady))
      foodIcon.style.filter = `grayscale(${(1 - ready).toFixed(2)}) brightness(${(0.6 + 0.4 * ready).toFixed(2)})`
      foodShade.style.transform = `scaleY(${(1 - ready).toFixed(3)})`
      foodSlot.classList.toggle('is-ready', ready >= 1 && hasFood)
      healthFill.style.transform = `scaleX(${Math.max(0, Math.min(1, health / Math.max(1, maxHealth)))})`
      if (healthText.textContent !== `${health}`) healthText.textContent = `${health}`
      const key = `${selected}|${keys.join(',')}|${slots
        .slice(0, HOTBAR_SLOTS)
        .map((slot) => `${slot.item}:${slot.count}`)
        .join(',')}`
      if (key === shown) return
      shown = key
      cells.forEach((cell, index) => {
        const slot = slots[index]
        const filled = isFilled(slot)
        cell.slot.classList.toggle('is-active', index === selected)
        cell.key.textContent = keys[index] ?? ''
        cell.key.hidden = !keys[index]
        cell.icon.hidden = !filled
        if (filled) showIcon(cell.icon, slot.item)
        cell.count.textContent = filled && slot.count > 1 ? String(slot.count) : ''
        if (filled) cell.slot.dataset.tip = itemTip(slot.item)
        else delete cell.slot.dataset.tip
      })
      const held = slots[selected]
      const holding = isFilled(held)
      caption.hidden = !holding
      caption.textContent = holding ? getItem(held.item).name : ''
      caption.classList.toggle('is-active', holding)
    },
  }
}
