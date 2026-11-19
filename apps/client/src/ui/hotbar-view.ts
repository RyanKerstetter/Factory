import { getItem, HOTBAR_SLOTS, NO_ITEM, type Slot } from '../../../../packages/shared/src/index.ts'
import { artUrl } from '../render/art.ts'
import { itemArt } from '../render/art-catalog.ts'
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
}

export type HotbarView = { update(state: HotbarState): void }

// The hotbar along the bottom: the first six slots of the player's inventory, one of them picked (with its key, or a
// click), or none for bare hands. Over it, the player's health and the name of what is picked.
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
  container.append(element('div', 'hotbar-wrap', healthBar, caption, bar))

  let shown = ''
  return {
    update({ slots, selected, keys, health }) {
      healthFill.style.transform = `scaleX(${Math.max(0, Math.min(1, health / 100))})`
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
        if (filled) cell.slot.dataset.tip = getItem(slot.item).name
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
